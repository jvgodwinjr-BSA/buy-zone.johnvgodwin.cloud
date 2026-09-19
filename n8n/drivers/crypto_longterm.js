// Crypto Long-Term Collector: accumulation gauge + 4h / 1d / 3d setup rows, one output item per asset.
const assets = $('Split Assets').all().map(i => i.json);
const daily = $('Daily Klines').all();
const weekly = $('Weekly Klines').all();
const h4 = $('4h Klines').all();
const fngRaw = responseBody($('Fear & Greed').all(), 0);
const fngEntry = fngRaw && Array.isArray(fngRaw.data) && fngRaw.data[0] ? fngRaw.data[0] : null;
const fng = fngEntry ? fngEntry.value : null;
const now = Date.now();
const FOUR_H = 4 * 3600 * 1000;
const out = [];

for (let i = 0; i < assets.length; i++) {
  const a = assets[i];
  const cfg = a.config || {};
  const dRows = klineRows(responseBody(daily, i));
  const wRows = klineRows(responseBody(weekly, i));
  const hRows = klineRows(responseBody(h4, i));
  if (!dRows || !wRows || !hRows) {
    console.log(a.symbol + ': missing klines (daily=' + !!dRows + ', weekly=' + !!wRows + ', 4h=' + !!hRows + ')');
    out.push({ json: { symbol: a.symbol, error: 'missing klines', rows: [] } });
    continue;
  }
  const dBars = parseBinanceKlines(dRows), wBars = parseBinanceKlines(wRows), hBars = parseBinanceKlines(hRows);
  const rows = [];
  const acc = computeAccumulation({ dailyBars: dBars, weeklyBars: wBars, sentimentRaw: (cfg.sentiment_source || 'none') === 'none' ? null : fng, cfg });
  rows.push(accRow(a.symbol, Math.floor(now / FOUR_H) * FOUR_H, now, acc, { fng_label: fngEntry ? fngEntry.value_classification : null }));
  for (const r of computeSetupRows(hBars, '4h', cfg.setup, now)) rows.push(setupRow(a.symbol, r, now));
  for (const r of computeSetupRows(dBars, '1d', cfg.setup, now)) rows.push(setupRow(a.symbol, r, now));
  const d3 = aggregateBars(dBars, 3, DAY_MS, 0, cfg.setup_anchor_3d || 0);
  for (const r of computeSetupRows(d3, '3d', cfg.setup, now)) rows.push(setupRow(a.symbol, r, now));
  out.push({ json: { symbol: a.symbol, rows } });
}
return out;
