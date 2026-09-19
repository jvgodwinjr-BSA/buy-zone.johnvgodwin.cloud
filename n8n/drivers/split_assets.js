// Turn the /api/assets.php response into one item per asset for the data source this workflow serves.
const first = $input.first().json;
const body = first.body !== undefined ? first.body : first;
const wanted = '__DATA_SOURCE__';
const list = ((body && body.assets) || []).filter(a => a.data_source === wanted);
if (!list.length) console.log('No active assets for data_source=' + wanted);
return list.map(a => ({ json: a }));
