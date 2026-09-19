// Swing Setup Collector: 15m + 1h setup rows (closed + forming candle) for swing-enabled crypto.
const assets = $('Split Assets').all().map(i => i.json);
const m15 = $('15m Klines').all();
const h1 = $('1h Klines').all();
const now = Date.now();
const out = [];

for (let i = 0; i < assets.length; i++) {
  const a = assets[i];
  const cfg = a.config || {};
  const mRows = klineRows(responseBody(m15, i));
  const hRows = klineRows(responseBody(h1, i));
  if (!mRows || !hRows) {
    console.log(a.symbol + ': missing klines (15m=' + !!mRows + ', 1h=' + !!hRows + ')');
    out.push({ json: { symbol: a.symbol, error: 'missing klines', rows: [] } });
    continue;
  }
  const rows = [];
  for (const r of computeSetupRows(parseBinanceKlines(mRows), '15m', cfg.setup, now)) rows.push(setupRow(a.symbol, r, now));
  for (const r of computeSetupRows(parseBinanceKlines(hRows), '1h', cfg.setup, now)) rows.push(setupRow(a.symbol, r, now));
  out.push({ json: { symbol: a.symbol, rows } });
}
return out;
