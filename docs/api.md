# HTTP API (`public/api/`)

Two endpoints, used only by the n8n collectors. Both require the shared secret from
`config.local.php`:

```
Authorization: Bearer <api_token>      (or X-Api-Token: <api_token> if a host strips Authorization)
```
Wrong or missing token → `401 {"error":"unauthorized"}`. Comparison is constant-time. The page
password (future, `includes/auth.php`) is independent of this — adding a login never affects n8n.

## `GET /api/assets.php`

Query: `class=crypto|stock|commodity` (optional), `swing=1` (optional, only `swing_enabled` assets).
Returns active assets with their full profile config so a collector carries no symbol lists or
formulas:

```json
{ "assets": [ { "id": 1, "symbol": "BTC", "display_name": "Bitcoin", "asset_class": "crypto",
                "data_source": "binance", "source_symbol": "BTCUSDT", "swing_enabled": true,
                "profile": "crypto_accum", "config": { "weights": {…}, "ladders": {…}, "zones": […], … } } ],
  "count": 1, "server_time": "2026-09-20T17:00:00+00:00" }
```
The `Split Assets` Code node in each workflow then keeps only its own `data_source`.

## `POST /api/ingest.php`

Body: one row object, or `{"rows":[…]}` (1–500). The whole batch is validated first; if any row is
bad nothing is stored and the response is `400 {"ok":false,"errors":[{"row":i,"error":"…"}]}`.
Rows are stored in one transaction, then transition rules run once per affected asset+scope.

### Accumulation row
```json
{ "type": "accumulation", "symbol": "BTC", "period_start": 1758384000000, "collected_at": 1758384305000,
  "is_final": 1, "price": 81299, "sentiment_raw": 71, "sentiment_score": 15, "stoch_rsi": 99, "stoch_score": 1,
  "ma200": 70540, "vs_ma200_pct": 15.3, "ma_score": 30, "ema21": 77875, "vs_ema21_pct": 4.4, "ema_score": 45,
  "total_score": 18, "zone": "EXTENDED", "insufficient_data": 0, "source_payload": { "bars": 1000 } }
```
Timestamps accept epoch milliseconds, epoch seconds or ISO-8601; stored as UTC. Upsert key:
(`asset`, `period_start`). Numeric fields may be `null`.

### Setup row
```json
{ "type": "setup", "symbol": "BTC", "timeframe": "1h", "period_start": 1758387600000, "is_final": 1,
  "price": 81299, "ma200": 78050, "ema21": 80802, "above_200": 1, "ema_above_200": 1, "dist21_pct": 0.6,
  "mingling": 1, "spread_pct": 3.5, "compressed": 1, "setup_bool": 1, "insufficient_data": 0 }
```
`timeframe` ∈ `15m 1h 4h 1d 3d`; `is_final` is required. Upsert key: (`asset`, `timeframe`,
`period_start`).

### Response
```json
{ "ok": true, "stored": 3,
  "results": [ { "symbol": "BTC", "type": "setup", "timeframe": "1h", "period_start": "2026-09-20 16:00:00", "is_final": 1, "stored": true } ],
  "alerts": [ { "scope": "setup_swing", "priority": "max", "tags": "dart", "title": "BTC swing: SETUP ON 15M + 1H", "message": "…", "symbol": "BTC" } ],
  "alert_count": 1 }
```
The workflow's `Split Alerts` node turns `alerts[]` into ntfy pushes (`Title`, `Priority`, `Tags`
headers; `message` as the body). Everything sent is also written to `alert_log`.

### Transition rules (in `public/includes/alerts.php`)
- First observation of an asset+scope seeds `alert_state` and never alerts.
- `accumulation`: zone changed → `DEPLOY` max, `STRONG_BUY` high (title says "pulled back from Deploy"
  when coming down), anything else default. Evaluated on every reading (live row).
- `fng_extreme` (profiles with `sentiment_source = alternative_me`): raw F&G crosses to ≤ `fng_extreme_threshold` (10) → max.
- `setup_ltf` (4h/1d/3d) and `setup_swing` (15m/1h): only **closed** rows count. After a batch, the latest
  closed row per timeframe forms a state string such as `4h+1d` or `NONE`. Alert when the state changes
  to a non-`NONE` value: both timeframes of the scope's `max_pair` (`1d`+`4h`, `15m`+`1h`) → max, one of
  them → high, only a context timeframe (`3d`) → default. Downgrades that still include a setup alert at
  the lower priority (same as the original workflow's BOTH → DAILY behaviour); dropping to `NONE` is silent.
- Scopes, pairs, cadences and muting live in `public/includes/defaults.php` (`setup_scopes`,
  `alerts_enabled`, `cadence_seconds`); override any key in `config.local.php`.

### Errors
`400` validation (message names the row and field) · `401` token · `405` wrong method ·
`500 {"error":"Database error. …"}` for DB failures (details in the server error log).

## Smoke test
`n8n/test/api.smoke.js` exercises auth, validation, upserts, first-run seeding and every transition
rule against a throwaway `ZZTEST` asset — see README "API check".
