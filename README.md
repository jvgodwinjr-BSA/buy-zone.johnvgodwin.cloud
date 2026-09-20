# Buy Zone — multi-asset buy-zone tracker

A PHP/MySQL website (Hostinger, `buy-zone.johnvgodwin.cloud`) fed by n8n collectors on the VPS.
It scores crypto, stocks and commodities on the "Crypto Lifer" framework (see `CLAUDE.md`),
stores every reading, shows zone-colored trend charts, and pushes ntfy alerts on transitions.

```
n8n collectors (cron, UTC)                     Hostinger
  Crypto Long-Term   5 */4 * * *   ─┐        ┌─ public/api/assets.php   (symbol list + profile config)
  Swing Setup        1,16,31,46 *  ─┼─ HTTPS ┼─ public/api/ingest.php   (upsert + transition alerts)
  Stocks/Commod.     30 21 * * 1-5 ─┘        └─ public/investing/  public/swing/   (read-only pages)
                                                     MySQL: scoring_profiles, assets, readings,
                                                            setup_readings, alert_state, alert_log
```

n8n is the only place indicators are computed (`n8n/indicators.js`, embedded into the workflow
Code nodes by `n8n/build.js`). The site only reads the database.

## Repository layout

| Path | What |
|---|---|
| `public/` | Web root. `investing/`, `swing/`, `api/`, `includes/`, `assets/` |
| `public/config.local.php` | **Not committed.** DB credentials + API bearer token (copy from `.example`) |
| `db/schema.sql`, `db/seed.sql` | Tables; scoring profiles (weights / ladders / zones) and the initial assets |
| `n8n/indicators.js` | Canonical math (EMA, Wilder RSI, Stoch RSI 14/14/3, 2W & 3d aggregation, `tfSetup`, scoring) |
| `n8n/drivers/*.js` | Per-workflow Code-node logic; `n8n/build.js` assembles `n8n/workflows/*.n8n.json` |
| `n8n/workflows/` | The three importable workflows (generated — do not hand-edit) |
| `n8n/test/` | Unit tests, workflow tests, API smoke test, dev sample-data pusher |
| `legacy/` | The original single-file BTC dashboard and n8n workflow, for reference |
| `reference/` | Drop the framework synthesis files here when a rule needs checking |

## Local development

Requirements: PHP 8.1+ with `pdo_mysql`, MySQL 8 / MariaDB 10.x, Node 20+.

```bash
mysql -e "CREATE DATABASE buyzone CHARACTER SET utf8mb4; CREATE USER 'buyzone'@'localhost' IDENTIFIED BY 'buyzone'; GRANT ALL ON buyzone.* TO 'buyzone'@'localhost';"
mysql buyzone < db/schema.sql && mysql buyzone < db/seed.sql
cp public/config.local.php.example public/config.local.php   # edit db + api_token
php -S 127.0.0.1:8080 -t public
npm test                                                     # indicator + workflow tests
API_TOKEN=<token> node n8n/test/sample_data.js               # optional: fake history so the pages have data
```

Changing the math: edit `n8n/indicators.js` (or a driver), add/adjust a test, then
`npm run build:n8n` and commit the regenerated workflow JSON. `npm run check:n8n` fails if the
JSON is out of date.

## Deploying to Hostinger (in this order)

1. **Database** — hPanel → Databases → MySQL: create a database and user, note host/name/user/password.
2. **Git deploy** — hPanel → Advanced → Git: connect this repository, branch `main`, deploy into the
   subdomain's folder (e.g. `domains/buy-zone.johnvgodwin.cloud/`). Enable auto-deploy on push.
   If the GitHub repository is private, hPanel shows an SSH public key under Git → *Generate SSH key*:
   add it on GitHub as a **deploy key** (repo → Settings → Deploy keys, read-only) before connecting,
   and use the repository's SSH URL (`git@github.com:jvgodwinjr-BSA/buy-zone.johnvgodwin.cloud.git`).
3. **Document root** — hPanel → Websites → the subdomain → set the document root to
   `<deploy folder>/public`. (If the root cannot be changed, the repo-level `.htaccess` rewrites
   into `public/` and blocks `db/`, `n8n/`, `legacy/` — but setting the root is the clean option.)
4. **Secrets** — File Manager: create `public/config.local.php` from `config.local.php.example`
   with the DB values and a fresh token (`php -r 'echo bin2hex(random_bytes(32));'`).
5. **Schema** — phpMyAdmin → the database → Import `db/schema.sql`, then `db/seed.sql`.
6. **Check** — open `https://buy-zone.johnvgodwin.cloud/investing/` (cards show "waiting for first
   collector run") and run the API check below.

### API check (run from your machine; the token never leaves it)

```bash
export BASE=https://buy-zone.johnvgodwin.cloud TOKEN=<your api_token>
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/assets.php"            # -> {"assets":[BTC, ETH ...]}
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/assets.php"             # -> 401
```
If the first call returns 401 with the right token, the host is stripping the `Authorization`
header: set `SITE_API_TOKEN` as usual and, in the n8n UI, edit the `BuyZone — Ingest Token` credential to header name
`X-Api-Token` with the raw token as the value — the API accepts both.

Full transition test (optional; uses a throwaway asset):
```sql
INSERT INTO assets (symbol, display_name, asset_class, data_source, source_symbol, accum_profile_id, swing_enabled, is_active, sort_order)
VALUES ('ZZTEST','Smoke test','crypto','binance','ZZTESTUSDT',(SELECT id FROM scoring_profiles WHERE name='crypto_accum'),1,0,999);
```
```bash
BASE_URL=$BASE API_TOKEN=$TOKEN node n8n/test/api.smoke.js      # expects "all checks passed"
```
```sql
DELETE FROM assets WHERE symbol='ZZTEST';   -- cascades: removes everything the test wrote
```

## n8n setup (shared instance on the VPS)

n8n runs in Docker on the VPS bound to `127.0.0.1:5678` — reachable only over SSH, never exposed
publicly, and shared with other projects (`SecOps –`, `Troop Parking —`). Everything BuyZone
creates there is prefixed `BuyZone — `; nothing else is touched. Deployment goes through n8n's
public REST API over an SSH tunnel (`n8n/deploy.py`, Python stdlib only), never through the
database file. The cloud Claude Code sandbox cannot SSH, so this runs from your own machine.

One-time, in the n8n UI (tunnel from your machine: `ssh -L 5678:127.0.0.1:5678 john@76.13.110.193`,
then open http://127.0.0.1:5678): **Settings → n8n API → Create an API key** (label `claude-buyzone`).
Credentials are created by the script, not by hand.

On your machine (key-based SSH to the VPS must already work):

```bash
cp n8n/deploy.env.example n8n/deploy.env      # git-ignored; fill in N8N_API_KEY and SITE_API_TOKEN
python3 n8n/deploy.py --list                  # read-only: lists every workflow on the instance
python3 n8n/deploy.py --dry-run               # prints the plan, writes nothing
python3 n8n/deploy.py                         # creates/updates + activates the three workflows
```

The script:
- opens the SSH tunnel itself and talks to `http://127.0.0.1:5678/api/v1`;
- reads the ntfy URL from the existing `BTC Buy-Zone Alerts` workflow (override with `NTFY_URL`);
- creates `BuyZone — Ingest Token` (Header Auth), `BuyZone — Twelve Data` (Query Auth, `placeholder`
  until you have a key) and, only if a token is needed, `BuyZone — ntfy`, binds them to the right
  nodes, and remembers their ids in `n8n/.deploy-state.json` (git-ignored) so re-runs reuse them;
- refuses to write any workflow whose name does not start with `BuyZone — `.

Afterwards, in the UI: each `BuyZone — ` workflow should show active/published. This n8n build
separates draft from published — API activation normally publishes, and the script warns if the
draft still differs; in that case click **Publish** on that workflow. Run *Test workflow* once on
each and check the **Ingest** node output shows `"ok": true`; the first run seeds alert state, so
no ntfy alerts fire until a later transition. Keep the old `BTC Buy-Zone Alerts` workflow active
until the numbers are validated (below), then deactivate it yourself in the UI — the script never
modifies it.

Re-deploying after a change: edit `n8n/indicators.js` or a driver, `npm run build:n8n`, commit,
then `python3 n8n/deploy.py` again — it updates the existing workflows in place.

Requests per run: crypto = 1 (F&G) + 3 per asset; stocks/commodities = 1 (CNN) + 3 per asset,
throttled to one Twelve Data call per 8 s (free tier: 8/min, 800/day → fine for ~25 symbols daily).

## Validating against TradingView (once, after the first runs)

Open BTC on TradingView and compare with the BTC page / the `readings` and `setup_readings` rows:

- **2-week Stoch RSI** — TradingView, 2W chart, Stoch RSI (14, 14, 3, 3): the `%K` value should
  match `readings.stoch_rsi` within a point or two. If it is consistently off by one bucket, set
  `stoch.anchor_offset` to `1` in the profile config (`scoring_profiles.config`) — it shifts the
  2-week grid by one week.
- **3d MA200 / EMA21** — TradingView 3D chart vs the 3D row of the setup panel. If the bar
  boundaries differ, set `setup_anchor_3d` (0, 1 or 2) in the profile config.
- **Daily 200 MA / 21 EMA** and the **4h** values should match closely as-is.

## Operating it

- **Add an asset** — insert a row in `assets` (phpMyAdmin). `source_symbol` is the provider ticker
  (`SOLUSDT`, `NVDA`, `XAU/USD`, or an ETF proxy such as `USO` for oil); `data_source` is `binance`
  or `twelvedata`; pick the profile; `swing_enabled=1` for 15m/1h tracking (crypto only for now).
  The next collector run picks it up — no deploy needed.
- **Tune weights / thresholds / zones** — edit `scoring_profiles.config` (JSON). Weights must sum to 100.
- **Mute an alert scope** — `alerts_enabled` in `public/includes/defaults.php` (or override the key
  in `config.local.php`). Data keeps flowing; only the push stops.
- **Change a schedule** — the cron expression in the workflow's Schedule node (UTC).
- **STALE badge** on a page — the collector has not written for more than twice its cadence: check
  the n8n execution list for that workflow.
- **Add a password later** — implement `require_page_auth()` in `public/includes/auth.php`; every
  page already calls it, and the API is unaffected.

## Alert rules (unchanged from the original workflow)

| Trigger | ntfy priority |
|---|---|
| Accumulation zone enters DEPLOY | max |
| Accumulation zone enters STRONG_BUY | high |
| Any other zone change | default |
| Fear & Greed drops to ≤ 10 (crypto) | max |
| Setup on 1d + 4h (closed candles) | max |
| Setup on one of 1d / 4h, or a downgrade to one | high |
| Setup on 3d only | default |
| Swing: 15m + 1h / one of them | max / high |

Alerts fire on state *transitions* only, evaluated on closed candles; the first run for an asset
seeds state silently. Everything sent is in `alert_log`.
