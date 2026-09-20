# Buy-Zone Tracker (multi-asset)

PHP/MySQL site on Hostinger (`https://buy-zone.johnvgodwin.cloud`) fed by three scheduled n8n
workflows (plus a manual backfill) on John's shared VPS. It scores crypto, stocks and commodities on the "Crypto Lifer" trading framework
(synthesized from 17 videos, Jan–Jul 2026), stores every reading in MySQL, draws zone-colored trend
charts and pushes ntfy alerts on state transitions. **An information tool — never an order router.**
Live since 2026-09-20; successor to the single-file BTC dashboard in `legacy/`.

## Read first

| Need | Where |
|---|---|
| Where things run, ids, what a cloud vs local Claude session can reach | `docs/environment.md` |
| Add an asset, tune weights, change the math, redeploy n8n, rotate a secret, troubleshoot | `docs/runbooks.md` |
| Tables, profile config JSON, glossary, report queries | `docs/data-model.md` |
| API contracts and the alert transition rules | `docs/api.md` |
| How the Swing page computes and draws (same code as the Investing setup panel) | `docs/swing-page.md` |
| Why it is built this way (D1–D15) | `docs/decisions.md` |
| What changed, per PR, with any operator action | `docs/changelog.md` |

## Hard rules

1. Never place orders, never hold exchange keys with trade permissions, never add an order path.
2. Secrets (DB credentials, site API token, ntfy topic, Twelve Data key, n8n API key) live only in
   `public/config.local.php`, `n8n/deploy.env` (both git-ignored) and n8n credentials. Never in
   committed files and never pasted into chat — John enters them in the secure field or his own terminal.
3. `n8n/indicators.js` is the only implementation of the math. `n8n/build.js` embeds it (plus
   `n8n/drivers/*.js`) into `n8n/workflows/*.n8n.json`. Never edit the JSON by hand; never put
   indicator math in PHP (the site is read-only presentation over MySQL).
4. Framework rules come from `reference/`; scoring numbers are data in `scoring_profiles.config`
   (seeded by `db/seed.sql`). Changing a weight, ladder, zone, timeframe or schedule means updating the
   live DB row (or `n8n/build.js` for schedules), `db/seed.sql`, this file and `docs/changelog.md`.
5. Every calculation change gets a test in `n8n/test/indicators.test.js` against known values, then
   `npm run build:n8n`, then a TradingView comparison when a rule or grid anchor changes.
6. The shared n8n instance (VPS `john@76.13.110.193`, Docker, bound to `127.0.0.1:5678`, SSH-only,
   shared with `SecOps –` and `Troop Parking —` workflows built by other projects):
   - Never change the binding or expose it publicly. Never sudo — flag anything that needs it for John.
   - Prefix everything we create with `BuyZone — ` (workflows and credentials). Never modify, rename,
     deactivate or delete a workflow or credential that is not ours, including the deprecated
     `Gmail account` credential.
   - Never edit `~/secops/data/n8n/database.sqlite` directly; go through the public API (`n8n/deploy.py`).
   - This n8n build separates draft (`versionId`) from published (`activeVersionId`); they converge only
     when Publish is clicked in the UI. Verify real state (active flag, executions, rows landing on the
     site) — never trust a "success" label.
   - The cloud Claude Code sandbox cannot SSH (port 22 is blocked), so n8n work runs from John's Mac:
     `python3 n8n/deploy.py` / `python3 n8n/diagnose.py` over an SSH tunnel.

## The framework as a config spec

### Accumulation (spot, long-term) — page `/investing/`
- Baseline: fixed daily/weekly DCA regardless of conditions; stablecoin reserves for extremes.
- Deploy-reserves trigger = confluence of **Fear & Greed ≤ 10** (ideally ≤ 5) AND **2-week stochastic
  RSI at historic lows**. A zone, not precise timing. Spot only — no leverage, no stop-losses.

| Profile | Components (weight) | Zones |
|---|---|---|
| `crypto_accum` | alternative.me F&G 40 · 2W stochRSI 30 · vs MA200 15 · vs EMA21 15 | ≥80 DEPLOY · ≥60 STRONG_BUY · ≥40 NEUTRAL · <40 EXTENDED |
| `stock_accum` | CNN F&G 40 · 2W stochRSI 30 · vs MA200 15 · vs EMA21 15 | same |
| `commodity_accum` | 2W stochRSI 45 · vs MA200 30 · vs EMA21 25 | same |

Ladders: F&G ≤5→100, ≤10→92, ≤20→75, ≤30→60, ≤45→42, ≤60→28, ≤75→15, else 5.
StochRSI score = 100 − stochRSI. vs MA200: ≤−20%→100, ≤−10→85, ≤0→70, ≤10→50, ≤25→30, else 12.
vs EMA21: ≤0→85, ≤3→70, ≤8→45, ≤15→25, else 10. A missing component (no sentiment index, or an
API outage) renormalises the remaining weights.

### Trade setup (21 EMA + 200 MA model), per timeframe
1. Price above the 200 MA; 2. 21 EMA above the 200 MA; 3. price "mingling" with the 21 EMA
(within 1.5%); bonus: 21/200 spread < 5% = compression. Entry only on a candle-**body** close
breakout; humble stop below the 200 MA / wick low. Both timeframes of a pair aligned = full size,
one = reduced, conflict = no trade. Exits on entry-timeframe closes (timeframe loyalty).

| Scope | Timeframes | Max-priority pair | Page | Collector (cron, UTC) |
|---|---|---|---|---|
| `setup_ltf` | 4h · 1d · 3d | 1d + 4h (3d is context) | `/investing/` | Crypto Long-Term `5 */4 * * *`; Stocks `30 21 * * 1-5` |
| `setup_swing` | 15m · 1h | 15m + 1h | `/swing/` (crypto only) | Swing Setup `1,16,31,46 * * * *` |

Scopes, max pairs, `alerts_enabled`, `cadence_seconds`, `chart_points` (48, swing strips and sparklines)
and `score_chart` (trend window: default 180 days, selector 48/90/180/365/730/all) are in
`public/includes/defaults.php` (overridable from `config.local.php`).

### Alert rules (transition-only; state in `alert_state`; first observation seeds silently)
| Trigger | ntfy priority |
|---|---|
| Zone enters DEPLOY / STRONG_BUY / any other change | max / high / default |
| F&G drops to ≤ 10 (crypto profile only) | max |
| Setup on 1d + 4h (closed candles) / one of them / 3d only | max / high / default |
| Swing setup on 15m + 1h / one of them | max / high |

## How it fits together

```
n8n (VPS, cron in UTC)                                  Hostinger (buy-zone.johnvgodwin.cloud)
  Crypto Long-Term  5 */4 * * *   Binance 1d/1w/4h  ──┐   GET  /api/assets.php  (bearer token)
  Swing Setup       1,16,31,46    Binance 15m/1h    ──┼── POST /api/ingest.php  (bearer token)
  Stocks/Commod.    30 21 * * 1-5 Twelve Data + CNN ──┤        ├─ upsert readings / setup_readings
  Crypto Backfill   manual (UI)   Binance 1d/1w + F&G ──┘        │  (backfill:true = store only, no alerts)
                                                               ├─ transition rules vs alert_state
        ntfy Push  ◄── alerts in the ingest response ──────────┘
  PHP pages read MySQL only.  Chart.js is vendored in public/assets/vendor.
```

- Every time-series row is keyed by `period_start` (candle open, UTC) → ingest is an upsert; retries
  and re-polls never duplicate.
- **Closed-candle rule**: each run writes the last closed candle (`is_final=1`) and the forming candle
  (`is_final=0`). Charts and setup alerts use final rows only; pages show the live badge labeled *live*
  next to the last closed candle's verdict. Accumulation zone transitions are evaluated per run.
- `readings` keeps every 4h crypto run; the trend chart shows one point per UTC day (48 days).
- `alert_state` has one row per (asset, scope): `accumulation`, `fng_extreme`, `setup_ltf`, `setup_swing`.
- Insufficient history (< 220 bars on a timeframe) stores a row with `insufficient_data=1`, never
  alerts, and shows "insufficient history".
- Indicators match TradingView: RSI is Wilder/RMA, SMA-seeded (`ta.rsi`); Stoch RSI is
  `sma(stoch(rsi,14),3)` = TV (14,14,3,3) %K; 2-week closes come from weekly candles on a
  Monday-anchored epoch grid (`stoch.anchor_offset` shifts it a week if TV's 2W bars differ); 3d bars
  from daily candles on the epoch-day grid (`setup_anchor_3d`); EMA is SMA-seeded and run over all
  fetched history. Validated 2026-09-20 on BINANCE:BTCUSDT (2W Stoch RSI, 1D SMA 200, EMA 21 exact,
  both anchors 0). Re-check only after a rule or anchor change.

## Commands
- `npm test` — indicator tests (incl. a published RSI reference series) + workflow JSON tests.
- `npm run build:n8n` / `npm run check:n8n` — regenerate / verify the workflow files.
- `BASE_URL=… API_TOKEN=… node n8n/test/api.smoke.js` — end-to-end API/transition test (throwaway
  `ZZTEST` asset). `API_TOKEN=… node n8n/test/sample_data.js` — fake history for a local site.
- Local site: `php -S 127.0.0.1:8080 -t public` with MariaDB + `public/config.local.php`.
- `python3 n8n/diagnose.py [--workflow Swing]` — read-only: latest executions per BuyZone workflow
  with the failing node and error (John's Mac).
- `python3 n8n/deploy.py --list | --dry-run | (deploy)` — John's Mac; here it is testable with
  `python3 n8n/test/mock_n8n.py 15678` + `--no-tunnel --base-url http://127.0.0.1:15678`.

## Current state (keep this accurate)
- Assets live: BTC, ETH, ADA (crypto, swing-enabled; ADA added 2026-09-20). AAPL and GOLD are seeded inactive; activating stocks
  or commodities needs a Twelve Data key first (`docs/runbooks.md` §2).
- Hostinger: Git auto-deploy from `main`; document root is the repo root (`.htaccess` routes into
  `public/`); `/public/…` URLs still resolve on LiteSpeed — cosmetic, fixed by a doc-root change.
- n8n: the three scheduled `BuyZone — ` workflows are active; `BuyZone — Crypto Backfill (manual)` is run
  from the UI (runbook 11) after adding a crypto asset; ids in `docs/environment.md`;
  `n8n/deploy.env` and `n8n/.deploy-state.json` exist only on John's Mac.
- Alerts: a public ntfy.sh topic (name in `deploy.env`), phone subscribed; nothing has transitioned yet.
- Flow: work on a `claude/…` branch, open a PR to `main`, John merges, Hostinger deploys automatically.
  n8n changes additionally need `deploy.py` from the Mac.

## Known issues / caveats
- Binance.com is geo-blocked from US IPs — `binance_base` (`BINANCE_BASE` in `deploy.env`) can be
  switched to binance.us (symbols become `BTCUSD`).
- CNN's Fear & Greed JSON endpoint is unofficial; it needs a browser User-Agent and may change.
  A failure degrades to a reweighted score, it does not stop the run.
- Twelve Data free tier: 8 req/min, 800/day; the collector throttles to one call per 8 s. Stock 4h
  bars only span market hours, so 4h readings for stocks are coarser than crypto's.
- Commodities without a spot series are tracked via ETF/futures proxies (`assets.source_symbol`).
- Accumulation alerts can re-fire if the score oscillates around a zone boundary between runs (same
  as the original workflow). Hysteresis is a possible config addition.
- Framework gap: no sell plan for long-term spot (only contrarian hints).

## Roadmap ideas
- [ ] Candle-body breakout confirmation alert (the actual entry trigger, not just setup)
- [ ] Nested-stochastics filter: the smaller timeframe's stochastics must reset before entry
- [ ] Sell-side/trim alerts: F&G ≥ 90 + distance from 21 EMA + overbought stochastics
- [ ] 15m/1h swing tracking for stocks/commodities (needs a paid data tier)
- [ ] Reports/queries page over `readings` / `setup_readings` / `alert_log` (queries in `docs/data-model.md`)
- [ ] Password gate (`public/includes/auth.php` is the single hook)
- [ ] Zone hysteresis; daily digest alert; document root → `public/`
