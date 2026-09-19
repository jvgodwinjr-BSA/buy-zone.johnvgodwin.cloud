'use strict';
// Canonical indicator math for the Buy-Zone tracker.
// n8n/build.js embeds this file verbatim into every workflow's Code node,
// so this is the single source of truth: edit here, run `node n8n/build.js`.

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const WEEK_SHIFT_MS = 4 * DAY_MS; // 1970-01-05 was a Monday; Binance weekly candles open Monday 00:00 UTC
const MIN_BARS = 220;             // 200 for the MA plus EMA warm-up

const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const sma = (a, n) => avg(a.slice(-n));

function ema(a, n) {
  const k = 2 / (n + 1);
  let e = avg(a.slice(0, n));
  for (let i = n; i < a.length; i++) e = a[i] * k + e * (1 - k);
  return e;
}

// Wilder RSI, SMA-seeded, identical to TradingView's ta.rsi (ta.rma smoothing).
function rsiSeries(closes, n) {
  if (closes.length <= n) return [];
  let ag = 0, al = 0;
  for (let i = 1; i <= n; i++) { const c = closes[i] - closes[i - 1]; ag += Math.max(c, 0); al += Math.max(-c, 0); }
  ag /= n; al /= n;
  const out = [rsiValue(ag, al)];
  for (let i = n + 1; i < closes.length; i++) {
    const c = closes[i] - closes[i - 1];
    ag = (ag * (n - 1) + Math.max(c, 0)) / n;
    al = (al * (n - 1) + Math.max(-c, 0)) / n;
    out.push(rsiValue(ag, al));
  }
  return out;
}
function rsiValue(ag, al) {
  if (al === 0) return 100;
  if (ag === 0) return 0;
  return 100 - 100 / (1 + ag / al);
}

// TradingView Stoch RSI: k = sma(stoch(rsi, rsi, rsi, stochLen), kSmooth); d = sma(k, 3).
function stochRSI(closes, rsiLen = 14, stochLen = 14, kSmooth = 3) {
  const r = rsiSeries(closes, rsiLen);
  if (r.length < stochLen) return null;
  const st = [];
  for (let i = stochLen - 1; i < r.length; i++) {
    const w = r.slice(i - stochLen + 1, i + 1);
    const lo = Math.min(...w), hi = Math.max(...w);
    st.push(hi > lo ? (r[i] - lo) / (hi - lo) * 100 : 50);
  }
  if (st.length < kSmooth) return null;
  const ks = [];
  for (let i = kSmooth - 1; i < st.length; i++) ks.push(avg(st.slice(i - kSmooth + 1, i + 1)));
  const k = ks[ks.length - 1];
  const d = ks.length >= 3 ? avg(ks.slice(-3)) : null;
  return { k, d, raw: st[st.length - 1], bars: closes.length };
}

// The pre-2W approximation from btc-buy-zone-gauge.html, kept ONLY for side-by-side comparison.
function legacyWeeklyStochRSI(daily) {
  const wk = []; for (let i = daily.length - 1; i >= 0; i -= 7) wk.unshift(daily[i]);
  const n = 14, out = []; let ag = 0, al = 0;
  for (let i = 1; i <= n; i++) { const c = wk[i] - wk[i - 1]; ag += Math.max(c, 0); al += Math.max(-c, 0); }
  ag /= n; al /= n; out.push(100 - 100 / (1 + (al ? ag / al : 1e9)));
  for (let i = n + 1; i < wk.length; i++) {
    const c = wk[i] - wk[i - 1];
    ag = (ag * (n - 1) + Math.max(c, 0)) / n; al = (al * (n - 1) + Math.max(-c, 0)) / n;
    out.push(100 - 100 / (1 + (al ? ag / al : 1e9)));
  }
  const rec = out.slice(-14), lo = Math.min(...rec), hi = Math.max(...rec);
  return hi > lo ? (out[out.length - 1] - lo) / (hi - lo) * 100 : 50;
}

// ---------- bars: { openTime, open, high, low, close, closeTime } in ms UTC, ascending ----------

function parseBinanceKlines(rows) {
  return rows.map(r => ({ openTime: +r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], closeTime: +r[6] }));
}

// Twelve Data returns newest-first; request with timezone=UTC. closeOffsetMs = how long after
// openTime the bar is considered closed (e.g. 21h for a US daily bar: 16:00 ET is <= 21:00 UTC).
function parseTwelveData(values, closeOffsetMs) {
  return values.slice().reverse().map(v => {
    const iso = v.datetime.length === 10 ? v.datetime + 'T00:00:00Z' : v.datetime.replace(' ', 'T') + 'Z';
    const t = Date.parse(iso);
    return { openTime: t, open: +v.open, high: +v.high, low: +v.low, close: +v.close, closeTime: t + closeOffsetMs - 1 };
  });
}

function splitClosedForming(bars, now) {
  now = now == null ? Date.now() : now;
  const closed = bars.filter(b => b.closeTime < now);
  const last = bars[bars.length - 1];
  const forming = last && last.closeTime >= now ? last : null;
  return { closed, forming };
}

// Calendar-anchored aggregation (e.g. 1w -> 2W, 1d -> 3d). Buckets are fixed on the epoch grid
// (shifted so weekly buckets start on Monday), so boundaries never move as history grows.
// anchorOffset shifts the grid by whole base bars to match a charting platform's anchor.
// The first (possibly partial) bucket is dropped. closeTime = end of the calendar bucket.
function aggregateBars(bars, group, baseMs, shiftMs, anchorOffset) {
  shiftMs = shiftMs || 0; anchorOffset = anchorOffset || 0;
  const out = []; let cur = null, curKey = null;
  for (const b of bars) {
    const key = Math.floor((Math.floor((b.openTime - shiftMs) / baseMs) + anchorOffset) / group);
    if (key !== curKey) {
      if (cur) out.push(cur);
      cur = { openTime: b.openTime, open: b.open, high: b.high, low: b.low, close: b.close,
              closeTime: ((key + 1) * group - anchorOffset) * baseMs + shiftMs - 1, count: 1 };
      curKey = key;
    } else {
      cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low);
      cur.close = b.close; cur.count++;
    }
  }
  if (cur) out.push(cur);
  if (out.length > 1) out.shift();
  return out;
}

// ---------- the framework ----------

const DEFAULT_SETUP = { mingle_pct: 1.5, compress_pct: 5 };

function tfSetup(closes, cfg) {
  cfg = Object.assign({}, DEFAULT_SETUP, cfg || {});
  if (closes.length < MIN_BARS) return { insufficient: true, bars: closes.length };
  const p = closes[closes.length - 1];
  const ma200 = sma(closes, 200);
  const e21 = ema(closes, 21);
  const above200 = p > ma200;
  const emaAbove = e21 > ma200;
  const dist21 = (p - e21) / e21 * 100;
  const mingling = Math.abs(dist21) <= cfg.mingle_pct;
  const spread = Math.abs(e21 - ma200) / ma200 * 100;
  const compressed = spread < cfg.compress_pct;
  return { insufficient: false, bars: closes.length, p, ma200, e21, above200, emaAbove, dist21, mingling, spread, compressed,
           setup: above200 && emaAbove && mingling };
}

function ladder(v, L) {
  for (const [t, s] of L.steps) if (v <= t) return s;
  return L.else;
}

function zoneFor(total, zones) {
  const z = zones.slice().sort((a, b) => b.min - a.min);
  for (const zz of z) if (total >= zz.min) return zz.zone;
  return z[z.length - 1].zone;
}

// values: { sentiment, stoch, ma200, ema21 } (null = unavailable -> the remaining weights are
// renormalised, which is how a commodity profile with no sentiment component works, and how a
// sentiment-API outage degrades instead of failing).
function scoreProfile(values, cfg) {
  const comps = {}; let ws = 0, tot = 0;
  for (const key of Object.keys(cfg.weights)) {
    const w = cfg.weights[key]; const v = values[key];
    if (v == null || Number.isNaN(v)) { comps[key] = { value: null, score: null, weight: w, used: false }; continue; }
    const s = key === 'stoch' ? 100 - v : ladder(v, cfg.ladders[key]);
    comps[key] = { value: v, score: s, weight: w, used: true };
    ws += w; tot += w * s;
  }
  const total = ws ? Math.round(tot / ws) : null;
  return { components: comps, total, zone: total == null ? null : zoneFor(total, cfg.zones), weight_used: ws };
}

function computeAccumulation(input) {
  const { dailyBars, weeklyBars, sentimentRaw, cfg } = input;
  const daily = dailyBars.map(b => b.close);
  if (daily.length < MIN_BARS) return { insufficient: true, bars: daily.length };
  const sc = cfg.stoch || {};
  const twoW = aggregateBars(weeklyBars, sc.group || 2, WEEK_MS, WEEK_SHIFT_MS, sc.anchor_offset || 0).map(b => b.close);
  const st = stochRSI(twoW, sc.rsi_len || 14, sc.stoch_len || 14, sc.k_smooth || 3);
  const price = daily[daily.length - 1];
  const ma200 = sma(daily, 200), e21 = ema(daily, 21);
  const vs200 = (price - ma200) / ma200 * 100, vs21 = (price - e21) / e21 * 100;
  const sentiment = sentimentRaw == null || sentimentRaw === '' ? null : +sentimentRaw;
  const score = scoreProfile({ sentiment, stoch: st ? st.k : null, ma200: vs200, ema21: vs21 }, cfg);
  return { insufficient: false, price, ma200, ema21: e21, vs_ma200_pct: vs200, vs_ema21_pct: vs21,
           stoch_rsi: st ? st.k : null, stoch: st, sentiment_raw: sentiment, score, bars: daily.length, bars_2w: twoW.length };
}

// One final row (last closed candle) + one live row (forming candle) per timeframe.
function computeSetupRows(bars, timeframe, cfg, now) {
  const { closed, forming } = splitClosedForming(bars, now);
  const row = (bs, bar, isFinal) => Object.assign({ timeframe, period_start: bar.openTime, is_final: isFinal }, tfSetup(bs.map(b => b.close), cfg));
  const rows = [];
  if (closed.length) rows.push(row(closed, closed[closed.length - 1], 1));
  if (forming) rows.push(row(bars, forming, 0));
  return rows;
}

const Indicators = { DAY_MS, WEEK_MS, WEEK_SHIFT_MS, MIN_BARS, avg, sma, ema, rsiSeries, stochRSI, legacyWeeklyStochRSI,
  parseBinanceKlines, parseTwelveData, splitClosedForming, aggregateBars, tfSetup, ladder, zoneFor, scoreProfile,
  computeAccumulation, computeSetupRows };
if (typeof module !== 'undefined' && module.exports) module.exports = Indicators;
