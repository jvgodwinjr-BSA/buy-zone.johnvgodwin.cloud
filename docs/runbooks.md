# Runbooks

Step-by-step procedures. Anything touching n8n or the VPS runs from John's Mac (see
`docs/environment.md`); the rest works from anywhere. "phpMyAdmin" = hPanel → Databases → phpMyAdmin.

## 1. Add a crypto asset
1. phpMyAdmin → SQL:
   ```sql
   INSERT INTO assets (symbol, display_name, asset_class, data_source, source_symbol, accum_profile_id, swing_enabled, is_active, sort_order)
   VALUES ('SOL', 'Solana', 'crypto', 'binance', 'SOLUSDT', (SELECT id FROM scoring_profiles WHERE name = 'crypto_accum'), 1, 1, 30);
   ```
   `source_symbol` is the Binance spot pair. `swing_enabled` 1 = also on the swing page.
2. Nothing to deploy: the next collector runs pick it up (swing within 15 min, long-term within 4 h).
   The card shows "waiting for first collector run" until then; the trend chart needs two days of readings.
3. Fewer than ~600 days of Binance history → the 3d row shows "insufficient history" (harmless).

## 2. Add a stock or commodity (first time: Twelve Data key)
1. Get a key at twelvedata.com (free tier: 8 requests/min, 800/day; each symbol costs 3 requests per day).
2. In the n8n UI (tunnel) open Credentials → `BuyZone — Twelve Data` and replace `placeholder` with the
   key (the public API cannot change an existing credential's secret). Also put it in `n8n/deploy.env`
   as `TWELVEDATA_API_KEY=…` so a fresh install creates the credential correctly.
3. phpMyAdmin:
   ```sql
   INSERT INTO assets (symbol, display_name, asset_class, data_source, source_symbol, accum_profile_id, swing_enabled, is_active, sort_order)
   VALUES ('NVDA', 'NVIDIA', 'stock', 'twelvedata', 'NVDA', (SELECT id FROM scoring_profiles WHERE name = 'stock_accum'), 0, 1, 100),
          ('GOLD', 'Gold (spot)', 'commodity', 'twelvedata', 'XAU/USD', (SELECT id FROM scoring_profiles WHERE name = 'commodity_accum'), 0, 1, 200);
   ```
   Commodity tickers: prefer a spot series (`XAU/USD`, `XAG/USD`, `WTI/USD` if available on your plan);
   otherwise an ETF/futures proxy (`USO`, `GLD`) — note it in `display_name`.
4. The stocks collector runs at 21:30 UTC on weekdays. Check the next morning with
   `python3 n8n/diagnose.py --workflow Stocks`.

## 3. Change weights, ladders or zone cutoffs
1. phpMyAdmin → `scoring_profiles` → edit the `config` JSON of the profile (`docs/data-model.md` has
   the schema). Weights must sum to 100 within a profile.
2. Takes effect on the next run — no deploy. Scores on the pages change; history is not rescored.
3. Update the table in `CLAUDE.md` and `db/seed.sql` so a fresh install matches, and add a
   `docs/changelog.md` line. Framework rules themselves come from `reference/` — check before changing.

## 4. Change the indicator math or a workflow
1. Edit `n8n/indicators.js` (math) or `n8n/drivers/*.js` (per-workflow glue) or `n8n/build.js` (node graph).
2. Add/adjust a test in `n8n/test/indicators.test.js`; `npm test`.
3. `npm run build:n8n` (regenerates `n8n/workflows/*.n8n.json`; `npm run check:n8n` must pass in CI/PR).
4. Commit, PR, merge.
5. On the Mac: `git pull && python3 n8n/deploy.py` — updates the three workflows in place and
   re-activates them; watch for "DRAFT differs from published" and click Publish in the UI if shown.
6. `python3 n8n/diagnose.py` after the next scheduled run; confirm on the site.

## 5. Re-deploy or verify n8n
```bash
python3 n8n/deploy.py --list        # every workflow on the instance (read-only)
python3 n8n/deploy.py --dry-run     # what would change
python3 n8n/deploy.py               # create/update + activate the three BuyZone workflows
python3 n8n/diagnose.py             # latest executions, failing node + error, Ingest responses
```
The scripts open their own SSH tunnel (local port 15678). They only ever write workflows named
`BuyZone — …` and reuse credential ids from `n8n/.deploy-state.json`.

## 6. Rotate a secret
- **Site `api_token`**: new value with `openssl rand -hex 32` → `config.local.php` on Hostinger → in the
  n8n UI edit `BuyZone — Ingest Token` (value `Bearer <new>`); also update `SITE_API_TOKEN` in
  `deploy.env`. Until both are done, ingest returns 401 (harmless — data resumes next run).
- **n8n API key**: Settings → n8n API → create new, revoke old → `N8N_API_KEY` in `deploy.env`.
- **ntfy topic**: `TOPIC="buyzone-$(openssl rand -hex 6)"; sed -i '' "s#^NTFY_URL=.*#NTFY_URL=https://ntfy.sh/$TOPIC#" n8n/deploy.env` →
  `python3 n8n/deploy.py` → re-subscribe the phone. A ntfy access token would go in `NTFY_TOKEN`.

## 7. Mute alerts or change schedules
- Mute a scope: `alerts_enabled` in `public/includes/defaults.php` — or add to `config.local.php`:
  `'alerts_enabled' => ['setup_swing' => false]`. Data keeps flowing.
- Cadence for the STALE badge: `cadence_seconds` in the same file.
- Schedules: the `Schedule` node cron in `n8n/build.js` → `npm run build:n8n` → deploy. Keep them
  candle-aligned (a minute after the close) and in UTC.

## 8. Troubleshooting
| Symptom | Cause / fix |
|---|---|
| Page says `config.local.php is missing` | Create it at `public_html/public/config.local.php` from the `.example`. |
| Page says `Database error…` | Credentials in `config.local.php`, or schema not imported. The line starting `[buyzone] PDOException` in the nearest `error_log` file says which. |
| Cards say "waiting for first collector run" | No rows yet for that asset — check the next scheduled run with `diagnose.py`. |
| Red **STALE** badge | Newest row older than 2× the collector cadence → the workflow is failing or inactive: `diagnose.py`, then the n8n UI executions list. |
| `diagnose.py`: `FAILED at node "Get Assets" … 401` | Site token mismatch — runbook 6. |
| `FAILED at node "… Klines"` with 451 / restricted location | Binance geo-block on the VPS: `BINANCE_BASE=https://api.binance.us` in `deploy.env`, `source_symbol` → `BTCUSD`/`ETHUSD`, deploy. |
| `FAILED at node "TD …"` | Twelve Data key/plan/limits; check the message. Placeholder key = no stocks yet. |
| `FAILED at node "Ingest"` | The site rejected the payload; the error body names the row and field. Usually a code change on one side only — rebuild + redeploy. |
| No phone alerts | Expected until a real transition; test the topic with `curl -d test https://ntfy.sh/<topic>`; check `alert_log` in phpMyAdmin to see what was sent. |
| `deploy.py`: `ssh exited` / tunnel timeout | Key access to `john@76.13.110.193` from this machine; try `ssh john@76.13.110.193 true`. |
| `deploy.py`: `404 for /api/v1/workflows` | n8n public API disabled or wrong base URL. |
| Draft ≠ published after deploy | Click **Publish** on that workflow in the n8n UI (this n8n build separates the two). |

## 9. Backups
- Database: phpMyAdmin → Export (SQL, all tables) monthly, or before schema changes. Restores by import.
- n8n: the workflows are fully reproducible from the repo with `deploy.py`; back up `n8n/deploy.env`
  and `n8n/.deploy-state.json` from the Mac (password manager or encrypted disk).
- Hostinger secrets: keep a copy of `config.local.php` values in the same place.

## 10. Add a page or a new data source (checklist)
- PHP is presentation only: queries in `public/includes/queries.php`, rendering in `render.php`; every page
  includes `auth.php` first. No indicator math in PHP.
- A new provider = a new driver in `n8n/drivers/`, wired in `n8n/build.js`, parsed with a
  `parse…` helper in `indicators.js` (bars ascending, UTC ms, `closeTime` correct), tested.
- New columns = migration SQL in `db/` (schema.sql updated too) and the API validation list in
  `public/api/ingest.php`.
- Update `docs/data-model.md`, `docs/api.md`, this file, and `docs/changelog.md`.
