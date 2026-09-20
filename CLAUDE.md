# Buy-Zone Tracker (multi-asset)

Website + n8n collectors that score crypto, stocks and commodities on the "Crypto Lifer"
trading framework (synthesized from 17 videos, Jan–Jul 2026), store every reading in MySQL,
and push ntfy alerts on state transitions. Successor to the single-file BTC dashboard in
`legacy/`.

## Project Purpose

Two independent frameworks, each an information tool — never an order router:

1. **Long-term accumulation gauge (0–100)** per asset — when to deploy DCA/stablecoin
   reserves into spot. Page: `/investing/`.
2. **Trade-setup detector (21 EMA + 200 MA)** — on 4h / 1d / 3d for long-term trades
   (Investing page) and on 15m / 1h for swing trades (`/swing/`, crypto only for now).

This tool must never be extended to place orders or hold exchange keys with trade permissions.

## The Framework (source of truth — do not change rules without checking `reference/`)

### Accumulation (spot, long-term)
- Baseline: fixed daily/weekly DCA regardless of conditions; stablecoin reserves for extremes.
- Deploy-reserves trigger = confluence of **Fear & Greed ≤ 10** (ideally ≤ 5) AND
  **2-week stochastic RSI at historic lows**. A zone, not precise timing.
- Spot only — no leverage, no stop-losses on accumulation positions.

### Trade setup (21 EMA + 200 MA model), per timeframe
1. Price above the 200 MA; 2. 21 EMA above the 200 MA; 3. price "mingling" with the 21 EMA
(within 1.5%); bonus: 21/200 spread < 5% = compression. Entry only on a candle-**body** close
breakout; humble stop below the 200 MA / wick low. Daily + 4H aligned = full size, one
timeframe = reduced, conflict = no trade. Exits on entry-timeframe closes (timeframe loyalty).

### Scoring is configuration, not code
Weights, component ladders and zone cutoffs live in `scoring_profiles.config` (seeded by
`db/seed.sql`). Change them there; the n8n Code node is generic.

| Profile | Components (weight) | Zones |
|---|---|---|
| `crypto_accum` | alternative.me F&G 40 · 2W stochRSI 30 · vs MA200 15 · vs EMA21 15 | 80 DEPLOY · 60 STRONG_BUY · 40 NEUTRAL · <40 EXTENDED |
| `stock_accum` | CNN F&G 40 · 2W stochRSI 30 · vs MA200 15 · vs EMA21 15 | same |
| `commodity_accum` | 2W stochRSI 45 · vs MA200 30 · vs EMA21 25 | same |

Ladders (unchanged): F&G ≤5→100, ≤10→92, ≤20→75, ≤30→60, ≤45→42, ≤60→28, ≤75→15, else 5.
StochRSI score = 100 − stochRSI. vs MA200: ≤−20%→100, ≤−10→85, ≤0→70, ≤10→50, ≤25→30, else 12.
vs EMA21: ≤0→85, ≤3→70, ≤8→45, ≤15→25, else 10. A missing component (no sentiment index,
or an API outage) renormalises the remaining weights.

### Alert rules (transition-only, state in `alert_state`, first observation seeds silently)
| Trigger | Priority |
|---|---|
| Zone enters DEPLOY / STRONG_BUY / other change | max / high / default |
| F&G drops to ≤ 10 (crypto profile only) | max |
| Setup on 1d + 4h (closed candles) / one of them / 3d only | max / high / default |
| Swing setup on 15m + 1h / one of them | max / high |

## Architecture

```
n8n (VPS, cron in UTC)                                  Hostinger (buy-zone.johnvgodwin.cloud)
  Crypto Long-Term  5 */4 * * *   Binance 1d/1w/4h  ──┐   GET  /api/assets.php  (bearer token)
  Swing Setup       1,16,31,46    Binance 15m/1h    ──┼── POST /api/ingest.php  (bearer token)
  Stocks/Commod.    30 21 * * 1-5 Twelve Data + CNN ──┘        ├─ upsert readings / setup_readings
                                                               ├─ transition rules vs alert_state
        ntfy Push  ◄── alerts in the ingest response ──────────┘
  PHP pages read MySQL only.  Chart.js is vendored in public/assets/vendor.
```

- `n8n/indicators.js` is the **only** implementation of the math. `n8n/build.js` embeds it
  (plus `n8n/drivers/*.js`) into `n8n/workflows/*.n8n.json`. Never edit the JSON by hand.
- Every time-series row is keyed by `period_start` (candle open, UTC) → ingest is an upsert.
- **Closed-candle rule**: each run writes the last closed candle (`is_final=1`) and the forming
  candle (`is_final=0`). Charts and setup alerts use final rows only; pages show the live badge
  labeled *live*. Accumulation zone transitions are evaluated per run.
- `readings` keeps every 4h crypto run; the trend chart shows one point per UTC day (48 days).
- `alert_state` has one row per (asset, scope): `accumulation`, `fng_extreme`, `setup_ltf`,
  `setup_swing`. Scopes and their max-priority pairs are in `public/includes/defaults.php`.
- Insufficient history (< 220 bars on a timeframe) stores a row with `insufficient_data=1` and
  never alerts; the page shows "insufficient history".

## Shared n8n Instance — Rules

- One n8n (Docker) on the VPS `john@76.13.110.193`, bound to `127.0.0.1:5678`, shared with
  `SecOps –` and `Troop Parking —` workflows built by other projects. Reach it only over SSH;
  **never change the binding or expose it publicly.** The cloud Claude Code sandbox cannot SSH,
  so n8n work runs from John's machine with `n8n/deploy.py` (public API over an SSH tunnel).
- Prefix everything we create with `BuyZone — ` (workflows and credentials). Never modify,
  rename, deactivate or delete a workflow or credential that is not ours — including the
  original `BTC Buy-Zone Alerts` workflow (John deactivates it himself at cut-over) and the
  deprecated `Gmail account` credential.
- Never edit `~/secops/data/n8n/database.sqlite` directly; go through the API. This n8n build
  separates draft (`versionId`) from published (`activeVersionId`); they converge only when
  Publish is clicked in the UI. Verify real state (active flag, executions, rows landing on the
  site) — never trust a "success" label.
- Sudo on the VPS is John's; flag anything that needs it instead of attempting it.

## Indicators (match TradingView)
- RSI: Wilder/RMA, SMA-seeded (`ta.rsi`). Stoch RSI: `sma(stoch(rsi,14),3)` = TV (14,14,3,3) %K.
- 2-week closes: weekly candles aggregated on a Monday-anchored epoch grid (`stoch.anchor_offset`
  shifts it by a week if TV's 2W bars differ). 3d bars: daily candles on the epoch-day grid
  (`setup_anchor_3d`). Validated 2026-09-20 on BINANCE:BTCUSDT: 2W Stoch RSI %K, 1D SMA 200 and
  EMA 21 matched TradingView exactly with both anchors at 0. Re-check only if a rule or anchor changes.
- EMA is seeded with the SMA of the first n closes and run over all fetched history.

## Commands
- `npm test` — indicator tests (incl. a published RSI reference series) + workflow JSON tests.
- `npm run build:n8n` / `npm run check:n8n` — regenerate / verify the workflow files.
- `BASE_URL=… API_TOKEN=… node n8n/test/api.smoke.js` — end-to-end API/transition test (uses a
  throwaway `ZZTEST` asset; see README).
- Local site: `php -S 127.0.0.1:8080 -t public` with MariaDB + `public/config.local.php`.
- `python3 n8n/diagnose.py [--workflow Swing]` — read-only: latest executions per BuyZone workflow with the failing node/error.
- `python3 n8n/deploy.py --list | --dry-run | (deploy)` — from a machine with SSH to the VPS;
  `python3 n8n/test/mock_n8n.py 15678` + `--no-tunnel --base-url http://127.0.0.1:15678` tests it here.

## Known Issues / Caveats
- Binance.com is geo-blocked from US IPs — `binance_base` in each workflow's Config node can be
  switched to binance.us (symbols become `BTCUSD`).
- CNN's Fear & Greed JSON endpoint is unofficial; it needs a browser User-Agent and may change.
  A failure degrades to a reweighted score, it does not stop the run.
- Twelve Data free tier: 8 req/min, 800/day. Collector throttles to one call per 8 s.
  Stock 4h bars only span market hours, so 4h readings for stocks are coarser than crypto's.
- Commodities without a spot series are tracked via ETF/futures proxies (`assets.source_symbol`).
- Accumulation alerts can re-fire if the score oscillates around a zone boundary between runs
  (same as the original workflow). Hysteresis is a possible config addition.
- Framework gap: no sell plan for long-term spot (only contrarian hints).

## Roadmap Ideas
- [ ] Candle-body breakout confirmation alert (the actual entry trigger, not just setup)
- [ ] Nested-stochastics filter: the smaller timeframe's stochastics must reset before entry
- [ ] Sell-side/trim alerts: F&G ≥ 90 + distance from 21 EMA + overbought stochastics
- [ ] 15m/1h swing tracking for stocks/commodities (needs a paid data tier)
- [ ] Reports/queries page over `readings` / `setup_readings` / `alert_log`
- [ ] Password gate (`public/includes/auth.php` is the single hook)
- [ ] Zone hysteresis; daily digest alert

## Conventions for Claude Code
- Test every calculation change against known values (`n8n/test/indicators.test.js`) before
  rebuilding the workflows; compare with TradingView when a rule or anchor changes.
- Never auto-execute trades or connect exchange API keys with trade permissions.
- Thresholds/weights/zones: change `db/seed.sql` + the live `scoring_profiles` row, and this file.
- Secrets (DB credentials, API token, ntfy topic, Twelve Data key) live in
  `public/config.local.php` and n8n credentials only — never in committed files.
- The site is read-only presentation; do not add computation to PHP that belongs in
  `n8n/indicators.js`.
