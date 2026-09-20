# Swing page — from Binance candles to the chart

What `/swing/` computes and draws, in the order it happens, so the logic can be checked against the
code. The Investing page's setup panel (4h / 1d / 3d) runs the same functions; only the timeframes,
the alert scope (`setup_ltf` instead of `setup_swing`) and the collector differ.

## 1. Collection — n8n `BuyZone — Swing Setup`, cron `1,16,31,46 * * * *` (UTC)

Node chain (`n8n/build.js`): Schedule → Config → Get Assets → Split Assets → 15m Klines → 1h Klines →
Compute → Ingest → Split Alerts → ntfy Push.

- **Get Assets**: `GET /api/assets.php?swing=1` → every asset with `swing_enabled = 1`, each with its
  profile `config` (the setup part is `{"mingle_pct": 1.5, "compress_pct": 5}`).
- **15m Klines / 1h Klines**: per asset, `GET {binance_base}/api/v3/klines?symbol=<source_symbol>&interval=15m|1h&limit=300`.
  300 bars = 75 hours of 15m candles, 12.5 days of 1h candles. Each kline is
  `[openTime, open, high, low, close, volume, closeTime, …]`; `closeTime = openTime + interval − 1 ms`.
- **Compute** is one Code node containing `n8n/indicators.js` + `n8n/drivers/_common.js` +
  `n8n/drivers/swing.js`. Per asset and timeframe:

  ```js
  for (const r of computeSetupRows(parseBinanceKlines(mRows), '15m', cfg.setup, now)) rows.push(setupRow(a.symbol, r, now));
  for (const r of computeSetupRows(parseBinanceKlines(hRows), '1h',  cfg.setup, now)) rows.push(setupRow(a.symbol, r, now));
  ```

## 2. Closed vs forming candle — `splitClosedForming`

```js
const closed  = bars.filter(b => b.closeTime < now);
const forming = last && last.closeTime >= now ? last : null;
```

`computeSetupRows` then emits at most two rows per timeframe:

| Row | `period_start` | Closes fed to `tfSetup` | `is_final` |
|---|---|---|---|
| last closed candle | its `openTime` | closes of the closed bars only (last value = that candle's close) | 1 |
| forming candle | its `openTime` | closes of all 300 bars (last value = the current price) | 0 |

Worked example, run at **12:16 UTC**:

| Timeframe | Final row | Live row |
|---|---|---|
| 15m | 12:00 candle (closed 12:14:59.999) | 12:15 candle (closes 12:29:59.999) |
| 1h | 11:00 candle (closed 11:59:59.999) | 12:00 candle (closes 12:59:59.999) |

The 1h final row therefore only changes once an hour (at the :01 run); the other three runs rewrite the
same 1h final row with identical values and refresh the live row.

## 3. The setup test — `tfSetup(closes, cfg)`

```js
if (closes.length < MIN_BARS) return { insufficient: true, bars: closes.length };   // MIN_BARS = 220
const p     = closes[closes.length - 1];
const ma200 = sma(closes, 200);                     // mean of the last 200 closes
const e21   = ema(closes, 21);                      // SMA-seeded, run over all closes
const above200  = p > ma200;
const emaAbove  = e21 > ma200;
const dist21    = (p - e21) / e21 * 100;
const mingling  = Math.abs(dist21) <= cfg.mingle_pct;   // 1.5
const spread    = Math.abs(e21 - ma200) / ma200 * 100;
const compressed = spread < cfg.compress_pct;           // 5
setup = above200 && emaAbove && mingling;
```

- Only **closes** are used — wicks never enter the test ("wicks don't count").
- `sma(closes, 200)` is exactly TradingView's `ta.sma(close, 200)` on the same candles.
- `ema` seeds with the SMA of the first 21 closes and then iterates over the remaining ~279 bars; the
  seed's residual weight after that is `(1 − 2/22)^279 ≈ 3 × 10⁻¹²`, so it equals TradingView's
  `ta.ema(close, 21)` to display precision (validated on the 1D chart, `docs/changelog.md` 2026-09-20).
- Compression is a **bonus flag** shown on the badge; it is not one of the three conditions.
- Fewer than 220 bars → the row is stored with `insufficient_data = 1` and no indicator values.

## 4. Row → database — `setupRow` → `POST /api/ingest.php` → `setup_readings`

| `tfSetup` field | column | meaning |
|---|---|---|
| `p` | `price` | last close (final row) or current price (live row) |
| `ma200`, `e21` | `ma200`, `ema21` | the two averages |
| `above200`, `emaAbove` | `above_200`, `ema_above_200` | conditions 1 and 2 |
| `dist21` | `dist21_pct` | % distance from the 21 EMA (the chart line) |
| `mingling` | `mingling` | condition 3 |
| `spread`, `compressed` | `spread_pct`, `compressed` | 21/200 spread and the bonus flag |
| `setup` | `setup_bool` | all three conditions true |

The unique key is `(asset_id, timeframe, period_start)` and the insert is `ON DUPLICATE KEY UPDATE`, so:
- the live row for 12:15 is **overwritten in place** by the next run's final row for 12:15
  (`is_final` flips from 0 to 1);
- re-runs and retries never create duplicates;
- a missed run (n8n down) leaves a gap: only the *last* closed candle is written per run, nothing is
  backfilled, and a forming row from before the outage stays `is_final = 0` for good.

After every batch the API evaluates the `setup_swing` scope for the asset (`public/includes/alerts.php`):
the newest **final** row per timeframe → state string `15m+1h`, `15m`, `1h` or `NONE`. An alert is
pushed when the state changes to a non-`NONE` value and the previous state was already known
(first observation seeds silently): both of the pair → `max`, one → `high`. Note that `15m+1h → 15m`
also counts as a change and sends a `high` alert; the message lists each timeframe's verdict and
`dist21`.

## 5. Reading it back — `public/includes/queries.php`

- `latest_setup_rows(asset, ['15m','1h'])` → per timeframe `['final' => newest is_final=1 row,
  'live' => newest is_final=0 row]`; the live row is dropped when its `period_start` is not newer than
  the final one (a forming row that was already superseded).
- `setup_series(asset, tf, 48)` → the last 48 rows with `is_final = 1`, oldest first:
  `period_start, price, dist21_pct, spread_pct, above_200, ema_above_200, mingling, compressed,
  setup_bool, insufficient_data`. 48 closed candles = 12 h of 15m, 48 h of 1h.

## 6. Badges, rows and the verdict — `public/includes/render.php`

`setup_state($row)` collapses a row to one of four states (used by the badge colour and the chart):

| state | rule | colour |
|---|---|---|
| `setup` | `setup_bool = 1` | green `#2ecc71` |
| `wait` | `above_200 = 1` but no setup (price not mingling, **or** 21 EMA below the 200 MA) | yellow `#f1c40f` |
| `below` | `above_200 = 0` | red `#e74c3c` |
| `none` | no row, `insufficient_data = 1`, or NULL `setup_bool` | grey `#5f6368` |

`badge_html` adds the wording: `SETUP` / `SETUP + COMPRESSED`, `waiting for pullback` (above 200, not
mingling), `21 EMA below 200` (mingling, but condition 2 fails), `below 200 MA`, `insufficient history`,
`no data`.

`tf_rows_html` prints, per timeframe: the **live** badge (labelled *live*) when a live row exists,
otherwise the final badge; under it "last closed candle: <badge> <time>"; then three detail rows from
the row being shown (live if present): Price vs 200 MA (`(price − ma200) / ma200`, computed for
display from the stored numbers), Price vs 21 EMA (`dist21_pct`, "— mingling"), 21/200 spread
(`spread_pct`, "— compressed (pre-breakout)").

`setup_verdict($rows, ['15m','1h'])` looks at the live row when there is one, else the final row:

| condition | banner | tone |
|---|---|---|
| both 15m and 1h `setup_bool = 1` | `SETUP ON 15M + 1H — watch for candle-body breakout` | good |
| one of them | `SETUP ON 15M ONLY — reduced size per framework` | mid |
| none, but every timeframe `above_200 = 1` | `TREND OK, NO SETUP — waiting for 21 EMA pullback` | mid |
| otherwise | `NO TRADE — timeframe conflict or below 200 MA` | bad |

So the banner reflects the **forming** candle (it can say SETUP before any alert has fired), while
alerts and the charts use closed candles only. The badge row shows both.

The red **STALE** tag appears when the newest row for the asset is older than 2 × the 15m cadence
(30 min); it is suppressed until the first row exists.

## 7. The chart — `public/swing/asset.php` + `swingChart` in `public/assets/app.js`

Per timeframe the page builds one JSON payload from the 48-row series (nothing is computed here):

```php
$chart = [
  'labels' => gmdate('M j H:i', period_start),      // candle open, UTC
  'dist'   => dist21_pct as float (null if missing),
  'states' => setup_state($row) for each row,       // setup | wait | below | none
];
<canvas data-kind="swing" data-chart='…json…'>
```

`swingChart` draws a Chart.js mixed chart with two datasets over the same 48 labels:

1. **Line** on the left axis: `dist` (% distance from the 21 EMA), light grey line, each point
   coloured by that candle's state, `spanGaps` so an insufficient-data candle leaves a hole rather
   than a break to zero.
2. **Strip** at the bottom: a bar of constant height 1 per candle on a hidden second axis with
   `max: 12`, so the bars occupy the bottom twelfth of the plot; `barPercentage: 1` makes them touch.
   Bar colour = state colour. This is the "48-candle state strip".

Tooltips show `dist from 21 EMA x.xx%` on the line and `state: setup|wait|below|none` on the strip.
Fewer than two closed rows → "Collecting history — appears after two closed candles."

Reading the chart: a green run means the three conditions held on those closed candles; the line
sitting inside ±1.5% is the "mingling" band; a line rising away from zero while the strip stays yellow
is price extending above the 21 EMA (no pullback yet); red is price under the 200 MA.

## 8. Things to know when verifying against TradingView

- Compare with **BINANCE:BTCUSDT** (or the asset's `source_symbol`) on the 15 / 60 chart, using the
  **closed** candle that matches the final row's `period_start` (UTC). The live row moves with every tick.
- `ta.sma(close, 200)` and `ta.ema(close, 21)` should match to the cent; `dist21_pct` is
  `(close − ema) / ema × 100`.
- Chart x-axis labels are in **UTC**; the timestamps in the badge table are converted to the viewer's
  local time by `app.js`. Keep that in mind when lining up a bar with the TradingView cursor.
- Each collector run happens one minute after the candle close, so a final row for 12:00 exists from
  12:16 (15m) and the 11:00 1h row from 12:01.
