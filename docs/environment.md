# Environment: where everything runs

Facts a new session needs before touching anything. Secrets are never here — only where they live.

## The website — Hostinger shared hosting

| Item | Value |
|---|---|
| URL | `https://buy-zone.johnvgodwin.cloud` → `/investing/` and `/swing/` |
| hPanel account | `u729751111` (also the prefix of the MySQL database and user names) |
| Deploy | hPanel → Advanced → Git, tracking GitHub `main`, auto-deploy on push (deploy key on the repo). A merge to `main` is live within about a minute. |
| Document root | The **repo root** (`public_html`). The root `.htaccess` routes requests into `public/` and blocks `db/`, `n8n/`, `legacy/`, `.git`, `CLAUDE.md`, `README.md`, `package.json`; `public/.htaccess` blocks `includes/` and `config.local.php*`. Consequence: `/public/investing/` also works. Pointing the document root at `public_html/public` in hPanel is the clean option and needs no code change. |
| Secrets | `public_html/public/config.local.php` — DB host/name/user/password and `api_token` (64 hex). Git-ignored; edited in hPanel File Manager. |
| Database | MySQL, `host` = `localhost` for PHP. Managed through hPanel → phpMyAdmin (imports, adding assets, tuning profiles, backups). |
| Runtime | PHP 8.3 on LiteSpeed behind Hostinger's CDN (`server: hcdn`). PHP pages are not cached (`x-hcdn-cache-status: DYNAMIC`); `assets/*` are cached 7 days, so `asset_url()` appends a content hash. `Authorization` headers reach PHP (verified). Uncaught exceptions are logged with `error_log()`; look for `error_log` files next to the executing script (e.g. `public_html/public/investing/error_log`) or hPanel → Logs. |
| DNS | `ALIAS @` and `CNAME www` point at `*.cdn.hstgr.net` (Hostinger CDN). Do not replace them with the server IP. |

## The collectors — shared n8n on the VPS

| Item | Value |
|---|---|
| VPS | `76.13.110.193` (also serves the Troop Parking app at `parking.johnvgodwin.com` via Caddy). SSH `john@76.13.110.193`, key-based, from John's Mac only. |
| n8n | Docker, bound to `127.0.0.1:5678` — **never exposed publicly**. UI: `ssh -L 5678:127.0.0.1:5678 john@76.13.110.193` then `http://127.0.0.1:5678`. Public REST API at `/api/v1` with an API key (Settings → n8n API). |
| Shared with | `SecOps –` and `Troop Parking —` workflows from other projects (see the rules in `CLAUDE.md`). |
| Our workflows | `BuyZone — Crypto Long-Term Collector` (`LZvIi1mpMymwyOAa`, cron `5 */4 * * *`), `BuyZone — Swing Setup Collector` (`LQ4BT3TnOc8Vg87L`, cron `1,16,31,46 * * * *`), `BuyZone — Stocks & Commodities Collector` (`wfQlcODR2OyYxpPZ`, cron `30 21 * * 1-5`). All UTC. `BuyZone — Crypto Backfill (manual)`: no schedule, run from the UI; its id is in `n8n/.deploy-state.json` after the first deploy. |
| Our credentials | `BuyZone — Ingest Token` (`PHsz1VKxoZbX76qq`, Header Auth `Authorization: Bearer <site api_token>`), `BuyZone — Twelve Data` (`1z3zaazmfZVmXE7c`, Query Auth `apikey`, currently `placeholder`). |
| Deploy tooling | `n8n/deploy.py` and `n8n/diagnose.py`, run on John's Mac from the repo clone (`~/buy-zone.johnvgodwin.cloud`). They read `n8n/deploy.env` (n8n API key, site token, ntfy URL, optional keys) and keep created ids in `n8n/.deploy-state.json`. Both files are git-ignored — back them up with the Mac. |
| Alerts | Public `ntfy.sh` topic (random `buyzone-…` name = the secret). Stored only in `n8n/deploy.env`, the workflows' Config nodes, and the ntfy phone app. |
| Data sources from the VPS | `api.binance.com` and `api.alternative.me` work (verified 2026-09-20). Twelve Data and CNN are used only once stock/commodity assets are active. |

## Claude Code — cloud sandbox vs. local sessions

| | Cloud session (claude.ai/code) | Local session (John's Mac: `claude`, teleport, or remote-control) |
|---|---|---|
| Network | HTTPS only, through a policy proxy. Allowed: `buy-zone.johnvgodwin.cloud`, `parking.johnvgodwin.com`, GitHub, npm. **Blocked: SSH (any port-22 tunnel), Binance, alternative.me, public CDNs.** | Normal internet + SSH to the VPS. |
| Can do | Everything in the repo, GitHub PRs, verify the live site over HTTPS, local verification with a throwaway MariaDB/Apache (`apt-get install mariadb-server apache2`; PHP 8.4, Node 22, Python 3 preinstalled — reinstall per container). | All of that plus `n8n/deploy.py`, `n8n/diagnose.py`, and anything on the VPS. |
| Cannot do | Reach n8n or the VPS in any way; no amount of credentials changes that. | — |

Rule of thumb: code, docs and site verification in the cloud; n8n/VPS operations locally. Two live sessions must not both deploy — pick one driver.

## Local verification recipe (cloud sandbox or any machine)

```bash
apt-get install -y mariadb-server            # sandbox only; Homebrew/MySQL on a Mac
service mariadb start
mysql -e "CREATE DATABASE buyzone CHARACTER SET utf8mb4; CREATE USER 'buyzone'@'localhost' IDENTIFIED BY 'buyzone'; GRANT ALL ON buyzone.* TO 'buyzone'@'localhost';"
mysql buyzone < db/schema.sql && mysql buyzone < db/seed.sql
cp public/config.local.php.example public/config.local.php   # host 127.0.0.1, db/user/pass buyzone, any 64-hex token
php -S 127.0.0.1:8080 -t public
API_TOKEN=<that token> node n8n/test/sample_data.js          # ~50 days of fake history for BTC/ETH
npm test && npm run check:n8n
```
