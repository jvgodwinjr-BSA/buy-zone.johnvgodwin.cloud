// Stocks & Commodities Collector (Twelve Data): accumulation gauge + 4h / 1d / 3d setup rows.
const assets = $('Split Assets').all().map(i => i.json);
const daily = $('TD Daily').all();
const weekly = $('TD Weekly').all();
const h4 = $('TD 4h').all();
const cnn = responseBody($('CNN Fear & Greed').all(), 0);
const cnnScore = cnn && cnn.fear_and_greed && cnn.fear_and_greed.score != null ? +cnn.fear_and_greed.score : null;
const cnnRating = cnn && cnn.fear_and_greed ? cnn.fear_and_greed.rating : null;
const now = Date.now();
const H21 = 21 * 3600 * 1000;   // a US daily bar is closed by 21:00 UTC in both DST states
const out = [];

function tdValues(body) {
  if (!body || body.status === 'error' || !Array.isArray(body.values)) return null;
  return body.values;
}

for (let i = 0; i < assets.length; i++) {
  const a = assets[i];
  const cfg = a.config || {};
  const dVals = tdValues(responseBody(daily, i));
  const wVals = tdValues(responseBody(weekly, i));
  const hVals = tdValues(responseBody(h4, i));
  if (!dVals || !wVals || !hVals) {
    const err = responseBody(daily, i);
    console.log(a.symbol + ': missing Twelve Data series (daily=' + !!dVals + ', weekly=' + !!wVals + ', 4h=' + !!hVals + ') ' + (err && err.message ? err.message : ''));
    out.push({ json: { symbol: a.symbol, error: 'missing series', rows: [] } });
    continue;
  }
  const dBars = parseTwelveData(dVals, H21);
  const wBars = parseTwelveData(wVals, 7 * DAY_MS);
  const hBars = parseTwelveData(hVals, 4 * 3600 * 1000);
  const rows = [];
  const sentiment = (cfg.sentiment_source || 'none') === 'cnn' ? cnnScore : null;
  const acc = computeAccumulation({ dailyBars: dBars, weeklyBars: wBars, sentimentRaw: sentiment, cfg });
  rows.push(accRow(a.symbol, dBars[dBars.length - 1].openTime, now, acc, { cnn_rating: cnnRating }));
  for (const r of computeSetupRows(hBars, '4h', cfg.setup, now)) rows.push(setupRow(a.symbol, r, now));
  for (const r of computeSetupRows(dBars, '1d', cfg.setup, now)) rows.push(setupRow(a.symbol, r, now));
  const d3 = aggregateBars(dBars, 3, DAY_MS, 0, cfg.setup_anchor_3d || 0);
  for (const r of computeSetupRows(d3, '3d', cfg.setup, now)) rows.push(setupRow(a.symbol, r, now));
  out.push({ json: { symbol: a.symbol, rows } });
}
return out;
