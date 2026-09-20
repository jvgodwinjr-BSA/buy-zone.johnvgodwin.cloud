// Crypto Backfill (manual): the accumulation gauge for the last N closed days of every crypto asset,
// computed the same way the live collector does, posted with backfill:true (stored, never alerted).
const assets = $('Split Assets').all().map(i => i.json);
const daily = $('Daily Klines').all();
const weekly = $('Weekly Klines').all();
const fngRaw = responseBody($('Fear & Greed History').all(), 0);
const fngByDate = fngRaw && Array.isArray(fngRaw.data) ? parseFngHistory(fngRaw.data) : null;
const days = Number($('Config').first().json.backfill_days) || 730;
const CHUNK = 400;   // ingest accepts up to 500 rows per request
const now = Date.now();
const out = [];

for (let i = 0; i < assets.length; i++) {
  const a = assets[i];
  const cfg = a.config || {};
  const dRows = klineRows(responseBody(daily, i));
  const wRows = klineRows(responseBody(weekly, i));
  if (!dRows || !wRows) {
    console.log(a.symbol + ': missing klines (daily=' + !!dRows + ', weekly=' + !!wRows + ')');
    out.push({ json: { symbol: a.symbol, error: 'missing klines', rows: [] } });
    continue;
  }
  const closedDays = splitClosedForming(parseBinanceKlines(dRows), now).closed;   // finished days only
  const useFng = (cfg.sentiment_source || 'none') !== 'none';
  const series = computeAccumulationSeries({ dailyBars: closedDays, weeklyBars: parseBinanceKlines(wRows), fngByDate: useFng ? fngByDate : null, cfg, days });
  const rows = series.map(p => accRow(a.symbol, p.period_start, now, p.acc, { backfill: true, date: p.date }));
  console.log(a.symbol + ': ' + rows.length + ' days (' + (series[0] ? series[0].date : '-') + ' .. ' + (series.length ? series[series.length - 1].date : '-') + ')');
  for (let c = 0; c < rows.length; c += CHUNK) out.push({ json: { symbol: a.symbol, part: c / CHUNK + 1, rows: rows.slice(c, c + CHUNK) } });
}
return out;
