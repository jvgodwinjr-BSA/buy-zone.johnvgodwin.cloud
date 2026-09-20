# Changelog

Append a line per merged PR (newest first). Include the PR number and anything an operator must do
(re-deploy n8n, re-import SQL, edit `config.local.php`).

## 2026-09-20
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
