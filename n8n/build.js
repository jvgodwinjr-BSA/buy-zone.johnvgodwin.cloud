#!/usr/bin/env node
'use strict';
// Generates n8n/workflows/*.n8n.json. Every Code node embeds indicators.js + drivers/_common.js +
// its driver verbatim, so the math in n8n can never drift from the file in this repo.
//   node n8n/build.js          # write the three workflow files
//   node n8n/build.js --check  # exit 1 if the committed files are out of date
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const INDICATORS = read('indicators.js');
const COMMON = read('drivers/_common.js');
const code = (driver, subs = {}) => {
  let d = read('drivers/' + driver);
  for (const [k, v] of Object.entries(subs)) d = d.split(k).join(v);
  return `${INDICATORS}\n\n// ===== drivers/_common.js =====\n${COMMON}\n\n// ===== drivers/${driver} =====\n${d}`;
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
let idCounter = 0;
const uid = () => 'b2000000-0000-4000-8000-' + String(++idCounter).padStart(12, '0');

function node(name, type, typeVersion, parameters, pos, extra = {}) {
  return Object.assign({ parameters, id: uid(), name, type, typeVersion, position: pos }, extra);
}
const cron = expr => node('Schedule', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'cronExpression', expression: expr }] } }, [0, 0]);
const config = (pos, extraAssignments = []) => node('Config', 'n8n-nodes-base.set', 3.4, {
  assignments: { assignments: [
    { id: uid(), name: 'base_url', value: 'https://buy-zone.johnvgodwin.cloud', type: 'string' },
    { id: uid(), name: 'ntfy_url', value: 'https://ntfy.example.com/btc-alerts', type: 'string' },
    ...extraAssignments,
  ] }, options: {},
}, pos);
const fullResponse = () => ({ response: { response: { fullResponse: true, responseFormat: 'json' } } });
const continueOnFail = { onError: 'continueRegularOutput' };

function http(name, url, pos, opts = {}) {
  const p = { url, options: Object.assign({}, opts.options || {}) };
  if (opts.auth) { p.authentication = 'genericCredentialType'; p.genericAuthType = opts.auth; }
  if (opts.headers) { p.sendHeaders = true; p.headerParameters = { parameters: opts.headers }; }
  if (opts.method) p.method = opts.method;
  if (opts.body !== undefined) { p.sendBody = true; p.specifyBody = 'json'; p.jsonBody = opts.body; }
  if (opts.rawBody !== undefined) { p.sendBody = true; p.contentType = 'raw'; p.rawContentType = 'text/plain'; p.body = opts.rawBody; }
  return node(name, 'n8n-nodes-base.httpRequest', 4.2, p, pos, opts.extra || {});
}
const codeNode = (name, js, pos) => node(name, 'n8n-nodes-base.code', 2, { jsCode: js }, pos);

const getAssets = (query, pos) => http('Get Assets', `={{ $('Config').first().json.base_url }}/api/assets.php${query}`, pos, { auth: 'httpHeaderAuth', options: fullResponse() });
const ingest = pos => http('Ingest', `={{ $('Config').first().json.base_url }}/api/ingest.php`, pos, {
  method: 'POST', auth: 'httpHeaderAuth', body: '={{ JSON.stringify({ rows: $json.rows }) }}', extra: continueOnFail,
});
const ntfy = pos => http('ntfy Push', `={{ $('Config').first().json.ntfy_url }}`, pos, {
  method: 'POST',
  headers: [{ name: 'Title', value: '={{ $json.title }}' }, { name: 'Priority', value: '={{ $json.priority }}' }, { name: 'Tags', value: '={{ $json.tags }}' }],
  rawBody: '={{ $json.msg }}',
});
const binance = (name, interval, limit, pos) => http(name,
  `={{ $('Config').first().json.binance_base }}/api/v3/klines?symbol={{ $('Split Assets').item.json.source_symbol }}&interval=${interval}&limit=${limit}`,
  pos, { options: fullResponse(), extra: continueOnFail });
const twelve = (name, interval, outputsize, pos) => http(name,
  `=https://api.twelvedata.com/time_series?symbol={{ encodeURIComponent($('Split Assets').item.json.source_symbol) }}&interval=${interval}&outputsize=${outputsize}&timezone=UTC`,
  pos, { auth: 'httpQueryAuth', options: Object.assign(fullResponse(), { batching: { batch: { batchSize: 1, batchInterval: 8000 } } }), extra: continueOnFail });

function chain(names) {
  const c = {};
  for (let i = 0; i < names.length - 1; i++) c[names[i]] = { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] };
  return c;
}
const workflow = (name, nodes, connections, notes) => ({
  name, nodes, connections, settings: { executionOrder: 'v1', timezone: 'UTC' }, pinData: {},
  meta: { buyzone: { generated_by: 'n8n/build.js', notes } },
});

const X = i => [i * 220, 0];

const crypto = workflow('BuyZone — Crypto Long-Term Collector', [
  cron('5 */4 * * *'),
  config(X(1), [{ id: uid(), name: 'binance_base', value: 'https://api.binance.com', type: 'string' }]),
  getAssets('?class=crypto', X(2)),
  codeNode('Split Assets', code('split_assets.js', { __DATA_SOURCE__: 'binance' }), X(3)),
  http('Fear & Greed', 'https://api.alternative.me/fng/?limit=1', X(4), { options: fullResponse(), extra: continueOnFail }),
  binance('Daily Klines', '1d', 1000, X(5)),
  binance('Weekly Klines', '1w', 1000, X(6)),
  binance('4h Klines', '4h', 500, X(7)),
  codeNode('Compute', code('crypto_longterm.js'), X(8)),
  ingest(X(9)),
  codeNode('Split Alerts', code('split_alerts.js'), X(10)),
  ntfy(X(11)),
], chain(['Schedule', 'Config', 'Get Assets', 'Split Assets', 'Fear & Greed', 'Daily Klines', 'Weekly Klines', '4h Klines', 'Compute', 'Ingest', 'Split Alerts', 'ntfy Push']),
  'Runs 5 minutes after every 4h candle close (UTC). Fear & Greed runs once per run; the kline nodes run once per asset item.');

const swing = workflow('BuyZone — Swing Setup Collector', [
  cron('1,16,31,46 * * * *'),
  config(X(1), [{ id: uid(), name: 'binance_base', value: 'https://api.binance.com', type: 'string' }]),
  getAssets('?class=crypto&swing=1', X(2)),
  codeNode('Split Assets', code('split_assets.js', { __DATA_SOURCE__: 'binance' }), X(3)),
  binance('15m Klines', '15m', 300, X(4)),
  binance('1h Klines', '1h', 300, X(5)),
  codeNode('Compute', code('swing.js'), X(6)),
  ingest(X(7)),
  codeNode('Split Alerts', code('split_alerts.js'), X(8)),
  ntfy(X(9)),
], chain(['Schedule', 'Config', 'Get Assets', 'Split Assets', '15m Klines', '1h Klines', 'Compute', 'Ingest', 'Split Alerts', 'ntfy Push']),
  'Runs one minute after every 15m candle close (UTC), crypto with swing_enabled=1 only.');

const stocks = workflow('BuyZone — Stocks & Commodities Collector', [
  cron('30 21 * * 1-5'),
  config(X(1)),
  getAssets('', X(2)),
  codeNode('Split Assets', code('split_assets.js', { __DATA_SOURCE__: 'twelvedata' }), X(3)),
  http('CNN Fear & Greed', 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata', X(4),
    { headers: [{ name: 'User-Agent', value: UA }, { name: 'Accept', value: 'application/json' }], options: fullResponse(), extra: continueOnFail }),
  twelve('TD Daily', '1day', 800, X(5)),
  twelve('TD Weekly', '1week', 400, X(6)),
  twelve('TD 4h', '4h', 500, X(7)),
  codeNode('Compute', code('stocks_commodities.js'), X(8)),
  ingest(X(9)),
  codeNode('Split Alerts', code('split_alerts.js'), X(10)),
  ntfy(X(11)),
], chain(['Schedule', 'Config', 'Get Assets', 'Split Assets', 'CNN Fear & Greed', 'TD Daily', 'TD Weekly', 'TD 4h', 'Compute', 'Ingest', 'Split Alerts', 'ntfy Push']),
  'Runs at 21:30 UTC on weekdays (after the 16:00 ET close). Twelve Data nodes are throttled to one request per 8s (free tier: 8/min).');

const OUT = path.join(ROOT, 'workflows');
const files = { 'crypto-longterm.n8n.json': crypto, 'swing-setup.n8n.json': swing, 'stocks-commodities.n8n.json': stocks };
const check = process.argv.includes('--check');
let stale = 0;
fs.mkdirSync(OUT, { recursive: true });
for (const [f, wf] of Object.entries(files)) {
  const text = JSON.stringify(wf, null, 2) + '\n';
  const p = path.join(OUT, f);
  if (check) {
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== text) { console.error('out of date: ' + f); stale++; }
  } else {
    fs.writeFileSync(p, text);
    console.log('wrote ' + path.relative(process.cwd(), p));
  }
}
if (check) { console.log(stale ? `${stale} workflow file(s) need "node n8n/build.js"` : 'workflow files are up to date'); process.exit(stale ? 1 : 0); }
