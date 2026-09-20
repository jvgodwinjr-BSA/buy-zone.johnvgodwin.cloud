'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'workflows');
const files = ['crypto-longterm.n8n.json', 'swing-setup.n8n.json', 'stocks-commodities.n8n.json', 'crypto-backfill.n8n.json'];

for (const f of files) {
  test(`${f}: structure, connections and embedded code`, () => {
    const wf = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const names = new Set(wf.nodes.map(n => n.name));
    assert.equal(names.size, wf.nodes.length, 'node names are unique');
    for (const [from, conn] of Object.entries(wf.connections)) {
      assert.ok(names.has(from), `connection source exists: ${from}`);
      for (const out of conn.main) for (const t of out) assert.ok(names.has(t.node), `connection target exists: ${t.node}`);
    }
    assert.equal(wf.settings.timezone, 'UTC');
    const trigger = wf.nodes.find(n => n.type === 'n8n-nodes-base.scheduleTrigger');
    const manualTrigger = wf.nodes.find(n => n.type === 'n8n-nodes-base.manualTrigger');
    if (f.includes('backfill')) assert.ok(manualTrigger && !trigger, 'backfill runs only from a manual trigger');
    else assert.ok(trigger && trigger.parameters.rule.interval[0].expression, 'cron trigger present');
    const codeNodes = wf.nodes.filter(n => n.type === 'n8n-nodes-base.code');
    assert.ok(codeNodes.length >= (manualTrigger ? 2 : 3), 'has Split Assets / Compute (/ Split Alerts) code nodes');
    const indicators = fs.readFileSync(path.join(__dirname, '..', 'indicators.js'), 'utf8');
    for (const n of codeNodes) {
      assert.ok(n.parameters.jsCode.startsWith(indicators), `${n.name} embeds indicators.js verbatim`);
      // n8n wraps the code in an async function with $, $input, $json in scope: syntax-check the same way.
      assert.doesNotThrow(() => new vm.Script(`(async function($, $input, $json, console){\n${n.parameters.jsCode}\n})`), `${n.name} code parses`);
      assert.ok(/\breturn\b/.test(n.parameters.jsCode), `${n.name} returns items`);
    }
    for (const n of wf.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest')) {
      assert.ok(n.parameters.url, `${n.name} has a url`);
      if (/klines|twelvedata/.test(n.parameters.url)) assert.ok(n.parameters.options.response.response.fullResponse, `${n.name} keeps the array response intact (fullResponse)`);
    }
    const ingest = wf.nodes.find(n => n.name === 'Ingest');
    assert.equal(ingest.parameters.genericAuthType, 'httpHeaderAuth', 'ingest uses the Header Auth credential');
  });
}

test('the Split Assets driver returns one item per matching asset', () => {
  const wf = JSON.parse(fs.readFileSync(path.join(DIR, 'crypto-longterm.n8n.json'), 'utf8'));
  const js = wf.nodes.find(n => n.name === 'Split Assets').parameters.jsCode;
  const fn = new vm.Script(`(async function($, $input, $json, console){\n${js}\n})`).runInThisContext();
  const input = { first: () => ({ json: { body: { assets: [{ symbol: 'BTC', data_source: 'binance' }, { symbol: 'AAPL', data_source: 'twelvedata' }] } } }) };
  return fn(null, input, null, { log() {} }).then(items => { assert.equal(items.length, 1); assert.equal(items[0].json.symbol, 'BTC'); });
});

test('the Split Alerts driver flattens ingest responses', () => {
  const wf = JSON.parse(fs.readFileSync(path.join(DIR, 'swing-setup.n8n.json'), 'utf8'));
  const js = wf.nodes.find(n => n.name === 'Split Alerts').parameters.jsCode;
  const fn = new vm.Script(`(async function($, $input, $json, console){\n${js}\n})`).runInThisContext();
  const input = { all: () => [{ json: { ok: true, alerts: [{ title: 'T', priority: 'max', tags: 'dart', message: 'M', symbol: 'BTC', scope: 'setup_swing' }] } }, { json: { ok: true, alerts: [] } }, { json: { error: 'x' } }] };
  return fn(null, input, null, { log() {} }).then(items => { assert.equal(items.length, 1); assert.equal(items[0].json.msg, 'M'); });
});

test('the Compute driver produces accumulation + setup rows from Binance-shaped inputs', () => {
  const wf = JSON.parse(fs.readFileSync(path.join(DIR, 'crypto-longterm.n8n.json'), 'utf8'));
  const js = wf.nodes.find(n => n.name === 'Compute').parameters.jsCode;
  const fn = new vm.Script(`(async function($, $input, $json, console){\n${js}\n})`).runInThisContext();
  const now = Date.now();
  const mk = (ms, n, base) => Array.from({ length: n }, (_, i) => { const o = Math.floor(now / ms) * ms - (n - 1 - i) * ms; return [o, '1', '2', '0.5', String(base + Math.sin(i / 20) * 5), '0', o + ms - 1]; });
  const cfg = { sentiment_source: 'alternative_me', weights: { sentiment: 40, stoch: 30, ma200: 15, ema21: 15 },
    ladders: { sentiment: { steps: [[5, 100], [10, 92], [20, 75], [30, 60], [45, 42], [60, 28], [75, 15]], else: 5 }, ma200: { steps: [[-20, 100], [-10, 85], [0, 70], [10, 50], [25, 30]], else: 12 }, ema21: { steps: [[0, 85], [3, 70], [8, 45], [15, 25]], else: 10 } },
    zones: [{ min: 80, zone: 'DEPLOY' }, { min: 60, zone: 'STRONG_BUY' }, { min: 40, zone: 'NEUTRAL' }, { min: 0, zone: 'EXTENDED' }], stoch: { group: 2 }, setup: { mingle_pct: 1.5, compress_pct: 5 } };
  const nodes = {
    'Split Assets': [{ json: { symbol: 'BTC', source_symbol: 'BTCUSDT', config: cfg } }],
    'Daily Klines': [{ json: { body: mk(86400e3, 1000, 100), statusCode: 200 } }],
    'Weekly Klines': [{ json: { body: mk(7 * 86400e3, 400, 100).map(r => { r[0] = r[0] - ((r[0] - 4 * 86400e3) % (7 * 86400e3)); return r; }), statusCode: 200 } }],
    '4h Klines': [{ json: { body: mk(4 * 3600e3, 500, 100), statusCode: 200 } }],
    'Fear & Greed': [{ json: { body: { data: [{ value: '29', value_classification: 'Fear' }] }, statusCode: 200 } }],
  };
  const $ = name => ({ all: () => nodes[name], first: () => nodes[name][0] });
  return fn($, null, null, { log() {} }).then(items => {
    assert.equal(items.length, 1);
    const rows = items[0].json.rows;
    const acc = rows.find(r => r.type === 'accumulation');
    assert.ok(acc && acc.insufficient_data === 0 && typeof acc.total_score === 'number' && acc.zone, 'accumulation row computed');
    assert.equal(acc.sentiment_raw, 29);
    for (const tf of ['4h', '1d', '3d']) {
      const tfRows = rows.filter(r => r.type === 'setup' && r.timeframe === tf);
      assert.ok(tfRows.some(r => r.is_final === 1), `${tf} has a final row`);
      assert.ok(tfRows.every(r => r.insufficient_data === 0), `${tf} has enough bars`);
    }
  });
});

test('the Backfill Compute driver emits one flagged accumulation row per closed day, chunked for ingest', () => {
  const wf = JSON.parse(fs.readFileSync(path.join(DIR, 'crypto-backfill.n8n.json'), 'utf8'));
  const js = wf.nodes.find(n => n.name === 'Compute').parameters.jsCode;
  const fn = new vm.Script(`(async function($, $input, $json, console){\n${js}\n})`).runInThisContext();
  const now = Date.now();
  const dayMs = 86400e3;
  const mk = (ms, n, base) => Array.from({ length: n }, (_, i) => { const o = Math.floor(now / ms) * ms - (n - 1 - i) * ms; return [o, '1', '2', '0.5', String(base + Math.sin(i / 20) * 5), '0', o + ms - 1]; });
  const cfg = { sentiment_source: 'alternative_me', weights: { sentiment: 40, stoch: 30, ma200: 15, ema21: 15 },
    ladders: { sentiment: { steps: [[5, 100], [10, 92], [20, 75], [30, 60], [45, 42], [60, 28], [75, 15]], else: 5 }, ma200: { steps: [[-20, 100], [-10, 85], [0, 70], [10, 50], [25, 30]], else: 12 }, ema21: { steps: [[0, 85], [3, 70], [8, 45], [15, 25]], else: 10 } },
    zones: [{ min: 80, zone: 'DEPLOY' }, { min: 60, zone: 'STRONG_BUY' }, { min: 40, zone: 'NEUTRAL' }, { min: 0, zone: 'EXTENDED' }], stoch: { group: 2 } };
  const fngData = Array.from({ length: 800 }, (_, i) => ({ value: String(10 + (i % 70)), timestamp: String((Math.floor(now / dayMs) - i) * dayMs / 1000) }));
  const nodes = {
    'Config': [{ json: { backfill_days: 730 } }],
    'Split Assets': [{ json: { symbol: 'BTC', source_symbol: 'BTCUSDT', config: cfg } }],
    'Daily Klines': [{ json: { body: mk(dayMs, 1000, 100), statusCode: 200 } }],
    'Weekly Klines': [{ json: { body: mk(7 * dayMs, 400, 100).map(r => { r[0] = r[0] - ((r[0] - 4 * dayMs) % (7 * dayMs)); return r; }), statusCode: 200 } }],
    'Fear & Greed History': [{ json: { body: { data: fngData }, statusCode: 200 } }],
  };
  const $ = name => ({ all: () => nodes[name], first: () => nodes[name][0] });
  return fn($, null, null, { log() {} }).then(items => {
    const rows = items.flatMap(i => i.json.rows);
    assert.equal(rows.length, 730, '1000 bars, last one forming -> 999 closed days, capped to backfill_days');
    assert.equal(items.length, 2); assert.equal(items[0].json.rows.length, 400);
    assert.ok(rows.every(r => r.type === 'accumulation' && r.is_final === 1 && r.source_payload.backfill === true), 'flagged backfill rows');
    assert.ok(rows.every(r => r.insufficient_data === 0 && typeof r.total_score === 'number' && r.zone), 'every day scored');
    assert.equal(new Set(rows.map(r => r.period_start)).size, 730, 'one row per day');
    assert.ok(rows.every(r => r.sentiment_raw != null), 'Fear & Greed joined by date for every day');
    assert.ok(rows[rows.length - 1].period_start < now - dayMs + 1, 'today (forming) is not written');
  });
});
