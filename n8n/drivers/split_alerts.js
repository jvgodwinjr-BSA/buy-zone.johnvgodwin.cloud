// One item per alert returned by /api/ingest.php; zero items = nothing downstream runs.
const out = [];
for (const it of $input.all()) {
  const b = it.json.body !== undefined ? it.json.body : it.json;
  if (!b || b.ok !== true) { console.log('ingest failed: ' + JSON.stringify(b).slice(0, 300)); continue; }
  for (const a of b.alerts || []) {
    out.push({ json: { title: a.title, priority: a.priority, tags: a.tags || 'information_source', msg: a.message, symbol: a.symbol, scope: a.scope } });
  }
}
return out;
