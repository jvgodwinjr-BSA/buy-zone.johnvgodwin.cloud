'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../indicators.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ±${tol}, got ${a}`);
const DAY = I.DAY_MS;

// StockCharts' worked RSI(14) example — a widely reproduced reference series.
const RSI_CLOSES = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328,
  45.6140, 46.2820, 46.2820, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439, 46.2122, 46.2521, 45.7137, 46.4515, 45.7835, 45.3548,
  44.0288, 44.1783, 44.2181, 44.5672, 43.4205, 42.6628, 43.1314];
const RSI_EXPECTED = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.30, 33.08, 37.77];

test('avg / sma / ema basics', () => {
  assert.equal(I.avg([1, 2, 3]), 2);
  assert.equal(I.sma([9, 9, 1, 2, 3], 3), 2);
  assert.equal(I.ema([1, 2, 3, 4, 5], 3), 4); // seed avg(1,2,3)=2 -> 3 -> 4
});

test('rsiSeries matches the reference RSI(14) values', () => {
  const r = I.rsiSeries(RSI_CLOSES, 14);
  assert.equal(r.length, RSI_EXPECTED.length);
  RSI_EXPECTED.forEach((e, i) => close(r[i], e, 0.02, `rsi[${i}]`));
});

test('rsi edge cases follow TradingView: no losses -> 100, no gains -> 0', () => {
  const up = Array.from({ length: 20 }, (_, i) => 100 + i);
  const down = Array.from({ length: 20 }, (_, i) => 100 - i);
  assert.equal(I.rsiSeries(up, 14).pop(), 100);
  assert.equal(I.rsiSeries(down, 14).pop(), 0);
  assert.deepEqual(I.rsiSeries([1, 2, 3], 14), []);
});

test('stochRSI(14,14,3) equals an independent naive computation', () => {
  const closes = Array.from({ length: 120 }, (_, i) => 100 + 10 * Math.sin(i / 5) + (i % 7) * 0.3);
  // naive reference
  const r = I.rsiSeries(closes, 14);
  const st = []; for (let i = 13; i < r.length; i++) { const w = r.slice(i - 13, i + 1); const lo = Math.min(...w), hi = Math.max(...w); st.push((r[i] - lo) / (hi - lo) * 100); }
  const kRef = (st[st.length - 1] + st[st.length - 2] + st[st.length - 3]) / 3;
  const s = I.stochRSI(closes, 14, 14, 3);
  close(s.k, kRef, 1e-9, 'k');
  assert.ok(s.k >= 0 && s.k <= 100);
  assert.ok(s.d >= 0 && s.d <= 100);
  assert.equal(I.stochRSI(closes.slice(0, 20), 14, 14, 3), null); // not enough RSI values
});

test('legacyWeeklyStochRSI still runs (comparison only)', () => {
  const daily = Array.from({ length: 365 }, (_, i) => 100 + 20 * Math.sin(i / 30));
  const v = I.legacyWeeklyStochRSI(daily);
  assert.ok(v >= 0 && v <= 100);
});

test('parseBinanceKlines / splitClosedForming', () => {
  const t0 = Date.UTC(2026, 8, 18); // 4h candles
  const rows = [0, 1, 2].map(i => [t0 + i * 4 * 3600e3, '1', '2', '0.5', String(10 + i), '0', t0 + (i + 1) * 4 * 3600e3 - 1]);
  const bars = I.parseBinanceKlines(rows);
  assert.equal(bars[2].close, 12);
  const now = t0 + 2 * 4 * 3600e3 + 5000; // 5s into the third candle
  const { closed, forming } = I.splitClosedForming(bars, now);
  assert.equal(closed.length, 2);
  assert.equal(forming.openTime, bars[2].openTime);
  const all = I.splitClosedForming(bars, t0 + 3 * 4 * 3600e3 + 1);
  assert.equal(all.closed.length, 3); assert.equal(all.forming, null);
});

test('parseTwelveData: newest-first input, daily and intraday datetimes', () => {
  const vals = [{ datetime: '2026-09-18', open: '1', high: '2', low: '0', close: '5' }, { datetime: '2026-09-17', open: '1', high: '2', low: '0', close: '4' }];
  const bars = I.parseTwelveData(vals, 21 * 3600e3);
  assert.equal(bars[0].close, 4); assert.equal(bars[1].openTime, Date.UTC(2026, 8, 18));
  assert.equal(bars[1].closeTime, Date.UTC(2026, 8, 18) + 21 * 3600e3 - 1);
  const intra = I.parseTwelveData([{ datetime: '2026-09-18 13:30:00', open: '1', high: '1', low: '1', close: '1' }], 4 * 3600e3);
  assert.equal(intra[0].openTime, Date.UTC(2026, 8, 18, 13, 30));
});

test('aggregateBars: 1w -> 2W on a Monday-anchored grid, 1d -> 3d on the epoch-day grid', () => {
  const monday = Date.UTC(2026, 8, 7); // 2026-09-07 is a Monday
  assert.equal(((monday - I.WEEK_SHIFT_MS) / I.WEEK_MS) % 1, 0, 'fixture Monday sits on the weekly grid');
  const weekly = Array.from({ length: 9 }, (_, i) => ({ openTime: monday - (8 - i) * I.WEEK_MS, open: 1, high: 1, low: 1, close: i + 1, closeTime: monday - (7 - i) * I.WEEK_MS - 1 }));
  const twoW = I.aggregateBars(weekly, 2, I.WEEK_MS, I.WEEK_SHIFT_MS, 0);
  // 9 weekly bars -> 5 buckets, first (partial or not) dropped -> 4; each close is the later week's close
  assert.equal(twoW.length, 4);
  assert.ok(twoW.every(b => b.count === 2 || b === twoW[twoW.length - 1]));
  assert.equal(twoW[twoW.length - 1].close, 9);
  const shifted = I.aggregateBars(weekly, 2, I.WEEK_MS, I.WEEK_SHIFT_MS, 1);
  assert.notEqual(shifted[shifted.length - 1].count, twoW[twoW.length - 1].count, 'anchor offset moves the grid');

  const d0 = Date.UTC(2026, 8, 1);
  const daily = Array.from({ length: 10 }, (_, i) => ({ openTime: d0 + i * DAY, open: 1, high: 2 + i, low: 0, close: 10 + i, closeTime: d0 + i * DAY + 21 * 3600e3 - 1 }));
  const threeD = I.aggregateBars(daily, 3, DAY, 0, 0);
  assert.ok(threeD.length >= 2);
  const last = threeD[threeD.length - 1];
  assert.equal(last.close, 19);
  assert.equal((last.closeTime + 1 - 0) % (3 * DAY), 0, 'bucket ends on the 3-day grid');
  assert.equal(last.closeTime > last.openTime, true);
});

test('tfSetup at each condition boundary and the insufficient-data guard', () => {
  const flat = Array(219).fill(100);
  assert.equal(I.tfSetup(Array(100).fill(100)).insufficient, true);
  const setup = I.tfSetup(flat.concat(101.4));       // above 200, 21 EMA above 200, within 1.5% of the 21
  assert.equal(setup.setup, true); assert.equal(setup.mingling, true); assert.equal(setup.compressed, true);
  const extended = I.tfSetup(flat.concat(103));      // above 200 but > 1.5% from the 21 EMA
  assert.equal(extended.above200, true); assert.equal(extended.mingling, false); assert.equal(extended.setup, false);
  const below = I.tfSetup(flat.concat(98));          // below the 200 MA
  assert.equal(below.above200, false); assert.equal(below.setup, false);
  const wide = I.tfSetup(flat.concat(101.4), { mingle_pct: 1.0 });
  assert.equal(wide.mingling, false, 'mingle threshold comes from config');
});

const CRYPTO_CFG = {
  weights: { sentiment: 40, stoch: 30, ma200: 15, ema21: 15 },
  ladders: {
    sentiment: { steps: [[5, 100], [10, 92], [20, 75], [30, 60], [45, 42], [60, 28], [75, 15]], else: 5 },
    ma200: { steps: [[-20, 100], [-10, 85], [0, 70], [10, 50], [25, 30]], else: 12 },
    ema21: { steps: [[0, 85], [3, 70], [8, 45], [15, 25]], else: 10 },
  },
  zones: [{ min: 80, zone: 'DEPLOY' }, { min: 60, zone: 'STRONG_BUY' }, { min: 40, zone: 'NEUTRAL' }, { min: 0, zone: 'EXTENDED' }],
};

test('scoreProfile reproduces the original formula and renormalises on a missing component', () => {
  const s = I.scoreProfile({ sentiment: 29, stoch: 40, ma200: 5, ema21: 2 }, CRYPTO_CFG);
  assert.equal(s.components.sentiment.score, 60); assert.equal(s.components.stoch.score, 60);
  assert.equal(s.components.ma200.score, 50); assert.equal(s.components.ema21.score, 70);
  assert.equal(s.total, Math.round(60 * .4 + 60 * .3 + 50 * .15 + 70 * .15)); // 60
  assert.equal(s.zone, 'STRONG_BUY');
  const noSent = I.scoreProfile({ sentiment: null, stoch: 40, ma200: 5, ema21: 2 }, CRYPTO_CFG);
  assert.equal(noSent.weight_used, 60); assert.equal(noSent.total, 60);
  assert.equal(I.scoreProfile({ sentiment: 3, stoch: 5, ma200: -25, ema21: -1 }, CRYPTO_CFG).zone, 'DEPLOY');
  assert.equal(I.scoreProfile({ sentiment: 90, stoch: 95, ma200: 40, ema21: 20 }, CRYPTO_CFG).zone, 'EXTENDED');
  assert.equal(I.zoneFor(79, CRYPTO_CFG.zones), 'STRONG_BUY'); assert.equal(I.zoneFor(80, CRYPTO_CFG.zones), 'DEPLOY');
});

test('computeAccumulation end-to-end and insufficient path', () => {
  const d0 = Date.UTC(2024, 0, 1);
  const dailyBars = Array.from({ length: 400 }, (_, i) => ({ openTime: d0 + i * DAY, open: 1, high: 1, low: 1, close: 100 + 30 * Math.sin(i / 40), closeTime: d0 + (i + 1) * DAY - 1 }));
  const monday = Date.UTC(2026, 8, 7);
  const weeklyBars = Array.from({ length: 300 }, (_, i) => ({ openTime: monday - (299 - i) * I.WEEK_MS, open: 1, high: 1, low: 1, close: 100 + 30 * Math.sin(i / 9), closeTime: monday - (298 - i) * I.WEEK_MS - 1 }));
  const r = I.computeAccumulation({ dailyBars, weeklyBars, sentimentRaw: '29', cfg: Object.assign({ stoch: { group: 2 } }, CRYPTO_CFG) });
  assert.equal(r.insufficient, false);
  assert.ok(r.stoch_rsi >= 0 && r.stoch_rsi <= 100);
  assert.equal(r.bars_2w, 149); // 300 weekly -> 150 buckets, first dropped
  assert.ok(['DEPLOY', 'STRONG_BUY', 'NEUTRAL', 'EXTENDED'].includes(r.score.zone));
  assert.equal(I.computeAccumulation({ dailyBars: dailyBars.slice(0, 50), weeklyBars, sentimentRaw: 29, cfg: CRYPTO_CFG }).insufficient, true);
});

test('computeSetupRows emits a final row for the last closed candle and a live row for the forming one', () => {
  const t0 = Date.UTC(2026, 8, 1);
  const bars = Array.from({ length: 300 }, (_, i) => ({ openTime: t0 + i * 900e3, open: 1, high: 1, low: 1, close: 100 + (i === 299 ? 5 : 0), closeTime: t0 + (i + 1) * 900e3 - 1 }));
  const now = t0 + 299 * 900e3 + 60e3; // one minute into the last candle
  const rows = I.computeSetupRows(bars, '15m', {}, now);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].is_final, 1); assert.equal(rows[0].period_start, bars[298].openTime); assert.equal(rows[0].p, 100);
  assert.equal(rows[1].is_final, 0); assert.equal(rows[1].period_start, bars[299].openTime); assert.equal(rows[1].p, 105);
  const closedOnly = I.computeSetupRows(bars, '15m', {}, t0 + 300 * 900e3 + 1);
  assert.equal(closedOnly.length, 1); assert.equal(closedOnly[0].is_final, 1);
});

test('computeAccumulationSeries: each point equals a live run truncated to that day; F&G by date; warm-up cap', () => {
  const d0 = Date.UTC(2024, 0, 1); // a Monday
  const N = 500;
  const dailyBars = Array.from({ length: N }, (_, i) => ({ openTime: d0 + i * DAY, open: 1, high: 1, low: 1, close: 100 + 30 * Math.sin(i / 40) + 5 * Math.cos(i / 3), closeTime: d0 + (i + 1) * DAY - 1 }));
  const weeklyBars = [];
  for (let i = 0; i < N; i += 7) {
    const wk = dailyBars.slice(i, i + 7);
    weeklyBars.push({ openTime: wk[0].openTime, open: 1, high: 1, low: 1, close: wk[wk.length - 1].close, closeTime: wk[0].openTime + I.WEEK_MS - 1 });
  }
  const dateOf = b => new Date(b.openTime).toISOString().slice(0, 10);
  const fng = {}; dailyBars.forEach((b, i) => { fng[dateOf(b)] = 5 + (i % 80); });
  const cfg = Object.assign({ stoch: { group: 2 } }, CRYPTO_CFG);
  const series = I.computeAccumulationSeries({ dailyBars, weeklyBars, fngByDate: fng, cfg, days: 100 });
  assert.equal(series.length, 100);
  assert.equal(series[0].date, dateOf(dailyBars[N - 100]));
  // last point == the live computation on the full inputs (the last weekly bar is the forming week)
  const last = series[series.length - 1];
  const live = I.computeAccumulation({ dailyBars, weeklyBars, sentimentRaw: fng[last.date], cfg });
  assert.equal(last.acc.score.total, live.score.total);
  assert.equal(last.acc.stoch_rsi, live.stoch_rsi);
  assert.equal(last.acc.ma200, live.ma200);
  assert.equal(last.acc.ema21, live.ema21);
  // a mid-week day (Tuesday): equals a live run that only knew bars up to that day, with the week's close = that day's close
  const k = N - 2;
  const p = series.find(s => s.period_start === dailyBars[k].openTime);
  const truncW = weeklyBars.filter(b => b.openTime <= dailyBars[k].openTime).map(b => Object.assign({}, b));
  truncW[truncW.length - 1].close = dailyBars[k].close;
  const liveK = I.computeAccumulation({ dailyBars: dailyBars.slice(0, k + 1), weeklyBars: truncW, sentimentRaw: fng[p.date], cfg });
  assert.equal(p.acc.score.total, liveK.score.total);
  assert.equal(p.acc.stoch_rsi, liveK.stoch_rsi);
  assert.equal(p.acc.sentiment_raw, fng[p.date]);
  // a Sunday keeps the real weekly close (no substitution): still equals the truncated live run
  const s = N - 4; // 2024-01-01 + 496 days is a Sunday
  assert.equal(new Date(dailyBars[s].openTime).getUTCDay(), 0);
  const ps = series.find(x => x.period_start === dailyBars[s].openTime);
  const liveS = I.computeAccumulation({ dailyBars: dailyBars.slice(0, s + 1), weeklyBars: weeklyBars.filter(b => b.openTime <= dailyBars[s].openTime), sentimentRaw: fng[ps.date], cfg });
  assert.equal(ps.acc.stoch_rsi, liveS.stoch_rsi);
  // a date without a Fear & Greed entry renormalises instead of failing
  const noFng = I.computeAccumulationSeries({ dailyBars, weeklyBars, fngByDate: {}, cfg, days: 3 });
  assert.equal(noFng[0].acc.sentiment_raw, null);
  assert.equal(noFng[0].acc.score.components.sentiment.used, false);
  assert.equal(noFng[0].acc.score.weight_used, 60);
  // warm-up cap: 250 bars -> 250 - 219 = 31 points at most
  assert.equal(I.computeAccumulationSeries({ dailyBars: dailyBars.slice(0, 250), weeklyBars, fngByDate: fng, cfg, days: 730 }).length, 31);
});

test('parseFngHistory keys values by UTC date and skips junk', () => {
  const m = I.parseFngHistory([{ value: '29', timestamp: String(Date.UTC(2026, 8, 19) / 1000) }, { value: 'x', timestamp: '1' }, { value: '50' }]);
  assert.deepEqual(m, { '2026-09-19': 29 });
});
