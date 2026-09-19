// Shared helpers embedded after indicators.js in every collector Code node.

// n8n hands HTTP responses over either as { body, headers, statusCode } (Full Response on) or as the
// bare JSON. Return the JSON body for the i-th item, or null when the request failed.
function responseBody(items, i) {
  const it = items[i];
  if (!it || !it.json) return null;
  const j = it.json;
  if (j.body !== undefined) return j.body;
  if (j.error !== undefined && j.statusCode === undefined) return null;   // Continue-On-Fail error item
  return j;
}

function klineRows(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.data)) return body.data;
  return null;
}

function accRow(symbol, periodStart, now, acc, extra) {
  const base = { type: 'accumulation', symbol, period_start: periodStart, collected_at: now, is_final: 1 };
  if (!acc || acc.insufficient) return Object.assign(base, { insufficient_data: 1, source_payload: { bars: acc ? acc.bars : 0 } });
  const c = acc.score.components;
  const sc = k => (c[k] && c[k].used ? c[k].score : null);
  return Object.assign(base, {
    price: acc.price, sentiment_raw: acc.sentiment_raw, sentiment_score: sc('sentiment'),
    stoch_rsi: acc.stoch_rsi, stoch_score: sc('stoch'),
    ma200: acc.ma200, vs_ma200_pct: acc.vs_ma200_pct, ma_score: sc('ma200'),
    ema21: acc.ema21, vs_ema21_pct: acc.vs_ema21_pct, ema_score: sc('ema21'),
    total_score: acc.score.total, zone: acc.score.zone, insufficient_data: 0,
    source_payload: Object.assign({ bars: acc.bars, bars_2w: acc.bars_2w, stoch: acc.stoch, weight_used: acc.score.weight_used }, extra || {}),
  });
}

function setupRow(symbol, r, now) {
  const base = { type: 'setup', symbol, timeframe: r.timeframe, period_start: r.period_start, collected_at: now, is_final: r.is_final };
  if (r.insufficient) return Object.assign(base, { insufficient_data: 1 });
  return Object.assign(base, {
    price: r.p, ma200: r.ma200, ema21: r.e21, above_200: r.above200 ? 1 : 0, ema_above_200: r.emaAbove ? 1 : 0,
    dist21_pct: r.dist21, mingling: r.mingling ? 1 : 0, spread_pct: r.spread, compressed: r.compressed ? 1 : 0,
    setup_bool: r.setup ? 1 : 0, insufficient_data: 0,
  });
}
