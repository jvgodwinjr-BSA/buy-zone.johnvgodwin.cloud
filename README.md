# Buy Zone — multi-asset buy-zone tracker

A PHP/MySQL website on Hostinger (`https://buy-zone.johnvgodwin.cloud`) fed by n8n collectors on a
VPS. It scores crypto, stocks and commodities on the "Crypto Lifer" framework, stores every reading,
draws zone-colored trend charts, and pushes ntfy alerts when a state changes. It is an information
tool, not a trading bot.

- **Long-Term Investing** (`/investing/`): a 0–100 accumulation gauge per asset (Fear & Greed,
  2-week stochastic RSI, price vs 200-day MA, price vs 21-day EMA), a 48-day zone-colored trend, and
  the 21 EMA + 200 MA setup panel on 4h / 1d / 3d.
- **Swing Trades** (`/swing/`): the same setup panel on 15m / 1h for crypto, with a 48-candle
  state strip per timeframe.

```
n8n collectors (cron, UTC)                     Hostinger
  Crypto Long-Term   5 */4 * * *   ─┐        ┌─ public/api/assets.php   (symbol list + profile config)
  Swing Setup        1,16,31,46 *  ─┼─ HTTPS ┼─ public/api/ingest.php   (upsert + transition alerts)
  Stocks/Commod.     30 21 * * 1-5 ─┘        └─ public/investing/  public/swing/   (read-only pages)
                                                     MySQL: scoring_profiles, assets, readings,
                                                            setup_readings, alert_state, alert_log
```

All indicator math lives in `n8n/indicators.js` and is embedded into the workflows by `n8n/build.js`;
the site only reads the database. Weights, ladders and zone cutoffs are data (`scoring_profiles`).

## Documentation map

| | |
|---|---|
| `CLAUDE.md` | Hard rules, the framework as a config spec, current state — read by Claude Code every session |
| `docs/environment.md` | Where everything runs: Hostinger layout, the shared n8n VPS, ids, what cloud vs local Claude sessions can reach |
| `docs/runbooks.md` | Add an asset · add a stock/commodity · tune weights · change the math · re-deploy n8n · rotate secrets · troubleshoot · backups |
| `docs/data-model.md` | Tables, profile config JSON, glossary, ready-made report queries |
| `docs/api.md` | `assets.php` / `ingest.php` contracts and the alert transition rules |
| `docs/swing-page.md` | How the Swing page computes and draws, step by step (verification reference) |
| `docs/decisions.md` | The decision log (why PHP not WordPress, closed-candle rule, shared-n8n constraints, …) |
| `docs/changelog.md` | What changed, per PR, with any operator action |

## Repository layout

| Path | What |
|---|---|
| `public/` | Web root: `investing/`, `swing/`, `api/`, `includes/`, `assets/` (Chart.js vendored) |
| `public/config.local.php` | **Not committed.** DB credentials + API bearer token (copy from `.example`) |
| `db/schema.sql`, `db/seed.sql` | Tables; the three scoring profiles and the initial assets |
| `n8n/indicators.js`, `n8n/drivers/`, `n8n/build.js` | Canonical math, per-workflow glue, generator of `n8n/workflows/*.n8n.json` |
| `n8n/deploy.py`, `n8n/diagnose.py`, `n8n/deploy.env.example` | Deploy/verify the workflows on the shared n8n over an SSH tunnel (from John's Mac) |
| `n8n/test/` | Unit tests, workflow tests, API smoke test, mock n8n API, sample-data pusher |
| `legacy/` | The original single-file BTC dashboard and workflow, reference only |
| `reference/` | Drop the framework synthesis files here when a rule needs checking |

## Local development

Requirements: PHP 8.1+ with `pdo_mysql`, MySQL 8 / MariaDB 10.x, Node 20+, Python 3.

```bash
mysql -e "CREATE DATABASE buyzone CHARACTER SET utf8mb4; CREATE USER 'buyzone'@'localhost' IDENTIFIED BY 'buyzone'; GRANT ALL ON buyzone.* TO 'buyzone'@'localhost';"
mysql buyzone < db/schema.sql && mysql buyzone < db/seed.sql
cp public/config.local.php.example public/config.local.php   # edit db + api_token
php -S 127.0.0.1:8080 -t public
npm test                                                     # indicator + workflow tests
API_TOKEN=<token> node n8n/test/sample_data.js               # optional: fake history so the pages have data
```

Changing the math: edit `n8n/indicators.js` (or a driver), add a test, `npm run build:n8n`, commit the
regenerated JSON (`npm run check:n8n` fails if it is stale), then re-deploy (`docs/runbooks.md` §4).

## Production setup (already done — kept as the reference procedure)

**Hostinger** (hPanel): create the MySQL database and user → Advanced → Git: connect this repository
on `main` with auto-deploy (private repo: add hPanel's SSH key as a read-only deploy key on GitHub) →
File Manager: create `public/config.local.php` from the `.example` with the DB values and a token from
`openssl rand -hex 32` → phpMyAdmin: import `db/schema.sql`, then `db/seed.sql` → open `/investing/`.
The document root is the repo root; the `.htaccess` files route into `public/` and block everything
else. Setting the document root to `<folder>/public` is optional and cleaner.

API check from your machine (the token never leaves it):
```bash
read -s TOKEN
curl -s -H "Authorization: Bearer $TOKEN" https://buy-zone.johnvgodwin.cloud/api/assets.php | head -c 300   # -> {"assets":[…
curl -s -o /dev/null -w "%{http_code}\n" https://buy-zone.johnvgodwin.cloud/api/assets.php                  # -> 401
```
If the first call is 401 with the right token, the host strips `Authorization`: use header
`X-Api-Token: <token>` instead (the API accepts both) in the n8n `BuyZone — Ingest Token` credential.

**n8n** (shared instance, SSH-only — details and rules in `docs/environment.md` and `CLAUDE.md`):
one-time in the UI through a tunnel (`ssh -L 5678:127.0.0.1:5678 john@76.13.110.193`,
`http://127.0.0.1:5678`): Settings → n8n API → create a key. On the Mac:
```bash
cp n8n/deploy.env.example n8n/deploy.env     # N8N_API_KEY, SITE_API_TOKEN, NTFY_URL (git-ignored)
TOPIC="buyzone-$(openssl rand -hex 6)"; sed -i '' "s#^NTFY_URL=.*#NTFY_URL=https://ntfy.sh/$TOPIC#" n8n/deploy.env; echo "$TOPIC"
python3 n8n/deploy.py --list                 # read-only sanity check
python3 n8n/deploy.py --dry-run              # plan
python3 n8n/deploy.py                        # create/update + activate the three BuyZone — workflows
python3 n8n/diagnose.py                      # after the next run: executions, failing node, Ingest response
```
Subscribe the ntfy phone app to the topic; test with `curl -d test https://ntfy.sh/<topic>`. The
script creates the `BuyZone — ` credentials, binds them, and never touches anything else on the instance.

## Operating it

Day to day everything is in `docs/runbooks.md`: adding assets (a SQL insert; no deploy), tuning
weights/zones (edit the profile JSON; no deploy), changing the math (test → build → PR → deploy),
rotating secrets, muting alert scopes, and a troubleshooting table keyed by what the page or
`diagnose.py` says. A red **STALE** badge means a collector stopped writing.

## Alert rules

| Trigger | ntfy priority |
|---|---|
| Accumulation zone enters DEPLOY / STRONG_BUY / any other change | max / high / default |
| Fear & Greed drops to ≤ 10 (crypto) | max |
| Setup on 1d + 4h (closed candles) / one of them / 3d only | max / high / default |
| Swing setup on 15m + 1h / one of them | max / high |

Alerts fire on state *transitions* only; the first run for an asset seeds state silently. Everything
sent is in `alert_log`.

## Verification history

2026-09-20: BTC 2W Stoch RSI (99), 1D SMA 200 ($70,540) and EMA 21 ($77,875) matched TradingView
exactly with both grid anchors at 0. Re-check only after a rule or anchor change.
