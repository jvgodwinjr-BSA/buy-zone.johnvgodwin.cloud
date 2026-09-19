'use strict';
// Dev helper: pushes ~50 days of plausible-looking readings and setup rows for BTC and ETH through
// the real ingest API so the pages can be reviewed before n8n is wired up. NOT for production.
// Usage: BASE_URL=http://127.0.0.1:8080 API_TOKEN=... node n8n/test/sample_data.js
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN || '';
const DAYS = +(process.env.DAYS || 52);
const now = Date.now();
const DAY = 86400000;

async function post(rows) {
  const res = await fetch(BASE + '/api/ingest.php', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ rows }) });
  const body = await res.json();
  if (!res.ok) { console.error(res.status, JSON.stringify(body)); process.exit(1); }
  return body;
}
const zoneOf = s => s >= 80 ? 'DEPLOY' : s >= 60 ? 'STRONG_BUY' : s >= 40 ? 'NEUTRAL' : 'EXTENDED';
const ladder = (v, steps, els) => { for (const [t, s] of steps) if (v <= t) return s; return els; };

(async () => {
  for (const [sym, base] of [['BTC', 110000], ['ETH', 4200]]) {
    const rows = [];
    for (let d = DAYS; d >= 0; d--) {
      for (const hour of d === 0 ? [0, 4, 8] : [0, 12]) {
        const t = new Date(now - d * DAY); t.setUTCHours(hour, 0, 0, 0);
        const ps = t.getTime(); if (ps > now) continue;
        const wave = Math.sin((DAYS - d) / 9);
        const price = base * (1 + 0.12 * wave + 0.02 * Math.sin((DAYS - d) / 2));
        const ma200 = base * 0.97, ema21 = base * (1 + 0.10 * wave);
        const fng = Math.round(50 - 35 * wave), stoch = Math.max(0, Math.min(100, 50 + 45 * wave));
        const vs200 = (price - ma200) / ma200 * 100, vs21 = (price - ema21) / ema21 * 100;
        const sScore = ladder(fng, [[5, 100], [10, 92], [20, 75], [30, 60], [45, 42], [60, 28], [75, 15]], 5);
        const mScore = ladder(vs200, [[-20, 100], [-10, 85], [0, 70], [10, 50], [25, 30]], 12);
        const eScore = ladder(vs21, [[0, 85], [3, 70], [8, 45], [15, 25]], 10);
        const total = Math.round(sScore * .4 + (100 - stoch) * .3 + mScore * .15 + eScore * .15);
        rows.push({ type: 'accumulation', symbol: sym, period_start: ps, collected_at: ps + 300e3, is_final: 1, price, sentiment_raw: fng, sentiment_score: sScore,
          stoch_rsi: stoch, stoch_score: 100 - stoch, ma200, vs_ma200_pct: vs200, ma_score: mScore, ema21, vs_ema21_pct: vs21, ema_score: eScore, total_score: total, zone: zoneOf(total) });
      }
    }
    const r = await post(rows);
    console.log(sym, 'accumulation rows stored:', r.stored, 'alerts:', r.alert_count);

    for (const [tf, ms, n] of [['15m', 900e3, 50], ['1h', 3600e3, 50], ['4h', 4 * 3600e3, 50], ['1d', DAY, 50], ['3d', 3 * DAY, 50]]) {
      const srows = [];
      const lastClosedOpen = Math.floor(now / ms) * ms - ms;
      for (let i = n - 1; i >= 0; i--) {
        const ps = lastClosedOpen - i * ms;
        const wave = Math.sin(i / 6 + tf.length);
        const price = base * (1 + 0.03 * wave), ma200 = base * 0.985, ema21 = base * (1 + 0.015 * wave);
        const dist = (price - ema21) / ema21 * 100, spread = Math.abs(ema21 - ma200) / ma200 * 100;
        const above = price > ma200, emaAbove = ema21 > ma200, mingling = Math.abs(dist) <= 1.5;
        srows.push({ type: 'setup', symbol: sym, timeframe: tf, period_start: ps, collected_at: ps + ms + 60e3, is_final: 1, price, ma200, ema21,
          above_200: above ? 1 : 0, ema_above_200: emaAbove ? 1 : 0, dist21_pct: dist, mingling: mingling ? 1 : 0, spread_pct: spread, compressed: spread < 5 ? 1 : 0,
          setup_bool: above && emaAbove && mingling ? 1 : 0 });
      }
      // forming candle
      const fp = lastClosedOpen + ms;
      srows.push({ ...srows[srows.length - 1], period_start: fp, collected_at: now, is_final: 0, price: base * 1.004, dist21_pct: 0.4, mingling: 1, setup_bool: srows[srows.length - 1].above_200 ? 1 : 0 });
      const rs = await post(srows);
      console.log(sym, tf, 'setup rows stored:', rs.stored, 'alerts:', rs.alert_count);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
