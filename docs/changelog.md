# Changelog

Append a line per merged PR (newest first). Include the PR number and anything an operator must do
(re-deploy n8n, re-import SQL, edit `config.local.php`).

## 2026-09-20
- PR #11 — Score-trend chart: Fear & Greed line and its trigger marker removed (too noisy to read on real
  data); the chart is the zone-coloured score plus the 2W stoch RSI.
- PR #10 — Score-trend chart: 180-day default with a 48d/90d/180d/1y/2y/all selector, Fear & Greed and 2W
  stoch RSI lines on the same 0–100 axis, dashed F&G ≤ 10 trigger. New manual workflow
  `BuyZone — Crypto Backfill (manual)` + ingest `backfill: true` flag (stores history, never alerts).
  **Operator action:** `git pull && python3 n8n/deploy.py`, then Execute the backfill workflow once in the n8n UI.
- PR #9 — Static assets are versioned by content hash (`asset_url()` in `render.php`): Hostinger's CDN
  caches `assets/*` for 7 days, which left browsers running the old `app.js` against the new swing chart
  payload from PR #8 (blank charts until a hard refresh). `swingChart` also accepts either payload key.
- PR #8 — Swing chart x-axis labels shown in the viewer's local time (ISO timestamps from PHP, formatted
  by the shared `localTime()` helper in `app.js`) so they match the badge table.
- PR #7 — Documentation overhaul: `docs/` (environment, data model + report queries, API, runbooks,
  swing-page walkthrough, decision log, this changelog), PR template, `.claude/settings.json` read-only allowlist, `CLAUDE.md`
  restructured as an index of hard rules, README refreshed to the deployed reality.
- PR #6 — Recorded the TradingView validation of the live BTC indicators (2W stochRSI 99, SMA200
  $70,540, EMA21 $77,875 — exact match, anchors 0).
- **Go-live.** n8n collectors deployed from John's Mac with `deploy.py`; ntfy.sh topic created; first
  swing data on the site at 17:01 UTC, long-term gauge from a manual run at 16:36 UTC. Workflow ids and
  credential ids in `docs/environment.md`.
- PR #5 — `n8n/diagnose.py` (read-only executions/failing-node report); mock API serves executions.
- PR #4 — `n8n/deploy.py` + `deploy.env.example` + mock API test; README n8n section rewritten for the
  shared, SSH-only instance; `CLAUDE.md` shared-instance rules. STALE badge suppressed before first data.
- PR #3 — `/public/…` canonical redirect moved into `public/.htaccess` (subdirectory `.htaccess`
  overrides the root's rewrite rules). Note: Hostinger's LiteSpeed/CDN still serves `/public/…` directly;
  cosmetic, fixed for good by setting the document root to `public/`.
- PR #2 — Clean URLs when the document root is the repo root (`base_url()` from `REQUEST_URI`);
  uncaught exceptions become a short 500 with a hint (DB errors say to check `config.local.php`/schema).
- Site deployed on Hostinger: Git deploy on `main`, `config.local.php`, schema + seed imported; BTC and
  ETH cards live.

## 2026-09-19
- PR #1 — Initial build: PHP/MySQL site (`/investing/`, `/swing/`), ingest API with transition
  alerts, schema + seed (three scoring profiles, BTC/ETH swing-enabled), `n8n/indicators.js` with tests
  against a published RSI series, three generated workflows, README runbook, `CLAUDE.md`.
- Plan approved after four review rounds (see `docs/decisions.md` D1–D10).
