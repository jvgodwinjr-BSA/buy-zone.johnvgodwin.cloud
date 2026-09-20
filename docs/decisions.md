# Decision log

Short records of the choices that shape the system, so they are not re-litigated by accident. Newest
last. Format: what was decided, why, what it rules out.

**D1 — Custom PHP + MySQL on Hostinger, not WordPress (2026-09-19).** A data dashboard needs a schema,
charts and an ingest endpoint, not a CMS. Git deploy from `main` keeps it reproducible. Rules out plugin-
based approaches; a future password is a single include (`public/includes/auth.php`).

**D2 — n8n is the only place indicators are computed.** The browser and PHP never compute scores; they
render rows. Removes the "keep HTML and n8n in sync" problem of the original single-file dashboard.
`n8n/indicators.js` is embedded into the workflow JSON by `n8n/build.js`, so there is one implementation.

**D3 — Scoring is configuration.** Weights, ladders, zone cutoffs and indicator parameters live in
`scoring_profiles.config` per asset class; one generic Code node serves every class. Stocks use CNN's
Fear & Greed, commodities have no sentiment component and renormalise. Framework rules come from the
Crypto Lifer synthesis (`reference/`), and changes to them are documented in `CLAUDE.md`.

**D4 — True 2-week Stoch RSI from weekly candles.** The original sampled every 7th daily close with no
smoothing. Now: weekly candles → 2-week bars on a Monday-anchored grid → RSI(14) → Stoch(14) → 3-period
%K, i.e. TradingView's default on the 2W chart. Validated equal to TradingView on 2026-09-20.

**D5 — Closed-candle rule.** Every run stores the last closed candle (final, immutable) and the forming
candle (live, overwritten). Charts and setup alerts use closed candles only; pages show the live badge
labeled *live*. Matches "wicks don't count" and "timeframe loyalty", and avoids intrabar alert flicker.

**D6 — Rows keyed by candle open time; ingest is an upsert.** Retries, re-polls and re-deploys can
never duplicate history. "48 periods" means 48 candles.

**D7 — Alert state per (asset, scope) in the database**, not in n8n static data. Scopes:
`accumulation`, `fng_extreme`, `setup_ltf` (4h/1d/3d), `setup_swing` (15m/1h). The framework's
"Daily + 4H aligned = full size" rule is kept exactly: `1d`+`4h` → max, one → high, `3d` is context.
First observation seeds silently.

**D8 — Long-term page shows 4h/1d/3d; swing page shows 15m/1h with the same badge panel.** No new
"swing score" formula — the user's swing timeframes just reuse the framework's setup checklist. Swing
is crypto-only until a paid stock data plan exists (free tiers cannot sustain 15-minute polling).

**D9 — Trend chart is one point per UTC day.** Every 4h reading is stored, but the 48-period chart plots
the day's last reading so crypto and daily-collected stocks compare on the same axis.

**D10 — Cron-aligned schedules in UTC** (`5 */4 * * *`, `1,16,31,46 * * * *`, `30 21 * * 1-5`) instead
of n8n's "every N hours", so runs land just after candle closes.

**D11 — Shared n8n instance is reached only over SSH; deployment goes through its public API from
John's Mac (`n8n/deploy.py`).** The cloud Claude Code sandbox cannot SSH (port 22 is dropped by its
egress proxy), and n8n must never be exposed publicly. Raw SQLite edits are avoided in favour of the
API. Only `BuyZone — ` workflows/credentials are ever written.

**D12 — Document root is the repo root on Hostinger** (hPanel default). Root `.htaccess` routes into
`public/` and blocks everything else; `base_url()` derives links from the request path so both layouts
produce clean URLs. Pointing the document root at `public/` remains the recommended clean-up.

**D13 — Alerts via public ntfy.sh with a random topic name** rather than a self-hosted ntfy (would need
sudo and a Caddy route on the VPS). The topic name is the secret; rotate by re-deploying.

**D14 — Chart.js is vendored** (`public/assets/vendor/`) rather than loaded from a CDN, so the site has
no third-party runtime dependency and renders in restricted networks.

**D15 — No legacy cut-over.** The original `BTC Buy-Zone Alerts` workflow was never on this n8n
instance, so nothing was deactivated; the old dashboard and workflow live in `legacy/` for reference only.

**D16 — History is backfilled by a manual n8n workflow on the VPS, not by a script on a laptop.** Binance.com is
geo-blocked from US IPs, so John's Mac cannot fetch the candles; the VPS already can. The workflow reuses the
same embedded `indicators.js` (`computeAccumulationSeries`: for each past day, the 2W series is built from the
weekly bars known by then with the running week closed at that day's close, so every point equals what a live
run would have stored), and posts with `backfill: true` so alert state is never touched.

**D17 — The score chart shows its inputs on the same 0–100 axis, never a second axis.** Fear & Greed and the
2-week stochastic RSI are already 0–100 and are the hypothesis ("F&G ≤ 10 with the 2W stoch RSI at lows"), so
they were the only extra lines; the price-distance components stay in the metrics table. After the backfill
John found the daily Fear & Greed line too noisy to read next to the score, so it was removed (PR #11): the chart
is the score plus the 2W stoch RSI. The F&G value is still in the metrics table and the score's sentiment component. Line colours were
validated with the dataviz palette checker against each other and the zone colours on the page surface (no
further hue cleared the checks next to the red/yellow/green zone palette, which settled the two-line limit).
