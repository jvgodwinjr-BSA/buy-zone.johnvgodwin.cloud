'use strict';
// End-to-end smoke test for /api/assets.php and /api/ingest.php against a running site.
// Usage: BASE_URL=https://buy-zone.johnvgodwin.cloud API_TOKEN=... node n8n/test/api.smoke.js
// It writes rows for SMOKE_SYMBOL (default ZZTEST). Add that asset first (see README), and delete the
// asset row afterwards — ON DELETE CASCADE removes everything the test wrote.
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN || '';
const SYM = process.env.SMOKE_SYMBOL || 'ZZTEST';
if (!TOKEN) { console.error('API_TOKEN is required'); process.exit(2); }

let failures = 0;
const check = (cond, msg, extra) => { if (cond) console.log('ok   - ' + msg); else { failures++; console.log('FAIL - ' + msg, extra !== undefined ? JSON.stringify(extra) : ''); } };

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.auth === false ? {} : { Authorization: 'Bearer ' + TOKEN }), ...(opts.headers || {}) } });
  let body = null; try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}
const post = rows => call('/api/ingest.php', { method: 'POST', body: JSON.stringify(Array.isArray(rows) ? { rows } : rows) });
const iso = (d, h = 0) => new Date(Date.UTC(2026, 0, d, h)).toISOString();
const acc = (day, hour, zone, score, fng, extra = {}) => ({ type: 'accumulation', symbol: SYM, period_start: iso(day, hour), price: 100000, sentiment_raw: fng,
  sentiment_score: 60, stoch_rsi: 40, stoch_score: 60, ma200: 95000, vs_ma200_pct: 5.2632, ma_score: 50, ema21: 99000, vs_ema21_pct: 1.0101, ema_score: 70,
  total_score: score, zone, ...extra });
const setup = (tf, day, hour, on, isFinal = 1) => ({ type: 'setup', symbol: SYM, timeframe: tf, period_start: iso(day, hour), is_final: isFinal, price: 100000,
  ma200: 95000, ema21: 99500, above_200: 1, ema_above_200: 1, dist21_pct: on ? 0.5 : 4, mingling: on ? 1 : 0, spread_pct: 4.7, compressed: 1, setup_bool: on ? 1 : 0 });

(async () => {
  let r = await call('/api/assets.php', { auth: false });
  check(r.status === 401, 'assets.php rejects a missing token');
  r = await call('/api/assets.php', { headers: { Authorization: 'Bearer wrong' } });
  check(r.status === 401, 'assets.php rejects a wrong token');
  r = await call('/api/assets.php');
  check(r.status === 200 && Array.isArray(r.body.assets), 'assets.php returns the active asset list', r.body);
  check(r.body.assets.every(a => a.config && a.config.weights && a.config.zones), 'every asset carries its profile config');
  r = await call('/api/assets.php?class=crypto&swing=1');
  check(r.status === 200 && r.body.assets.every(a => a.asset_class === 'crypto' && a.swing_enabled), 'class/swing filters apply');

  r = await post({ type: 'accumulation', symbol: 'NOPE_' + Date.now(), period_start: iso(1) });
  check(r.status === 400, 'unknown symbol is rejected with 400', r.body);
  r = await post({ type: 'setup', symbol: SYM, timeframe: '2h', period_start: iso(1), is_final: 1 });
  check(r.status === 400, 'bad timeframe is rejected with 400');

  // --- accumulation transitions ---
  r = await post(acc(1, 0, 'NEUTRAL', 50, 29));
  check(r.status === 200 && r.body.alert_count === 0, 'first accumulation ingest seeds state without alerting', r.body);
  r = await post(acc(1, 0, 'NEUTRAL', 51, 29));
  check(r.status === 200 && r.body.alert_count === 0 && r.body.stored === 1, 'same period_start upserts (no duplicate, no alert)');
  r = await post(acc(1, 4, 'STRONG_BUY', 62, 29));
  check(r.body.alert_count === 1 && r.body.alerts[0].priority === 'high' && /Strong Buy Zone entered/.test(r.body.alerts[0].title), 'NEUTRAL -> STRONG_BUY alerts high', r.body.alerts);
  r = await post(acc(1, 8, 'DEPLOY', 85, 29));
  check(r.body.alert_count === 1 && r.body.alerts[0].priority === 'max' && /DEPLOY/.test(r.body.alerts[0].title), 'STRONG_BUY -> DEPLOY alerts max', r.body.alerts);
  r = await post(acc(1, 12, 'STRONG_BUY', 70, 29));
  check(r.body.alert_count === 1 && /pulled back/.test(r.body.alerts[0].title), 'DEPLOY -> STRONG_BUY says pulled back', r.body.alerts);
  r = await post(acc(1, 16, 'STRONG_BUY', 72, 8));
  check(r.body.alert_count === 1 && r.body.alerts[0].scope === 'fng_extreme' && r.body.alerts[0].priority === 'max', 'F&G crossing to <=10 alerts max (zone unchanged)', r.body.alerts);
  r = await post(acc(1, 20, 'STRONG_BUY', 72, 7));
  check(r.body.alert_count === 0, 'staying <=10 does not re-alert');
  r = await post(acc(2, 0, null, null, null, { insufficient_data: 1 }));
  check(r.status === 200 && r.body.alert_count === 0, 'insufficient-data reading is stored but never alerts');

  // --- long-term setup scope: 4h/1d/3d, framework rule 1d+4h -> max ---
  r = await post([setup('4h', 3, 0, false), setup('1d', 3, 0, false), setup('3d', 3, 0, false)]);
  check(r.body.alert_count === 0, 'first setup rows seed the scope (NONE) without alerting', r.body);
  r = await post(setup('1d', 4, 0, true));
  check(r.body.alert_count === 1 && r.body.alerts[0].priority === 'high' && r.body.alerts[0].scope === 'setup_ltf', '1d-only setup alerts high', r.body.alerts);
  r = await post(setup('4h', 4, 4, true));
  check(r.body.alert_count === 1 && r.body.alerts[0].priority === 'max' && /1D \+ 4H/.test(r.body.alerts[0].title), '1d + 4h aligned alerts max', r.body.alerts);
  r = await post(setup('3d', 6, 0, true));
  check(r.body.alert_count === 1 && r.body.alerts[0].priority === 'max', '3d joining keeps max (pair still aligned)', r.body.alerts);
  r = await post(setup('4h', 4, 8, false, 0));
  check(r.body.alert_count === 0, 'a forming (is_final=0) candle never changes alert state');
  r = await post([setup('4h', 4, 8, false), setup('1d', 5, 0, false)]);
  check(r.body.alert_count === 1 && r.body.alerts[0].priority === 'default' && /3d/.test(r.body.alerts[0].title),
    'a batch changing two timeframes evaluates the scope ONCE; 3d-only is a context-level (default) alert', r.body.alerts);
  r = await post([setup('4h', 4, 12, true), setup('1d', 6, 0, true)]);
  check(r.body.alert_count === 1 && r.body.alerts[0].priority === 'max', 'batch re-aligning 1d + 4h yields exactly one max alert', r.body.alerts);
  r = await post([setup('4h', 4, 16, false)]);
  check(r.body.alert_count === 1 && r.body.alerts[0].priority === 'high', 'downgrade to 1d(+3d) alerts high, as the original BOTH -> DAILY rule does', r.body.alerts);

  // --- swing scope: 15m/1h ---
  r = await post(setup('15m', 7, 0, true));
  check(r.body.alert_count === 0, 'first swing row seeds without alerting');
  r = await post(setup('1h', 7, 0, true));
  check(r.body.alert_count === 1 && r.body.alerts[0].scope === 'setup_swing' && r.body.alerts[0].priority === 'max', '15m + 1h aligned alerts max on the swing scope', r.body.alerts);
  r = await post(setup('15m', 7, 1, false));
  check(r.body.alert_count === 1 && r.body.alerts[0].priority === 'high', 'swing dropping to 1h-only alerts high (downgrade rule)', r.body.alerts);
  r = await post(setup('1h', 7, 1, false));
  check(r.body.alert_count === 0, 'swing dropping to NONE never alerts');
  r = await post(setup('1h', 7, 2, false));
  check(r.body.alert_count === 0, 'staying NONE never alerts');

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
