# Data model and report queries

Schema: `db/schema.sql`. Seed (profiles + initial assets): `db/seed.sql`. All timestamps are UTC
`DATETIME`. Every time-series row is keyed by the candle's open time (`period_start`), so writes are
upserts and re-runs never duplicate.

## Glossary

| Term | Meaning |
|---|---|
| Accumulation gauge | The 0–100 long-term score per asset (Fear & Greed, 2W stochRSI, price vs 200-day MA, price vs 21-day EMA). Page `/investing/`. |
| Zone | Band of the gauge: `DEPLOY` ≥ 80, `STRONG_BUY` ≥ 60, `NEUTRAL` ≥ 40, `EXTENDED` < 40 (cutoffs live in the profile). |
| Setup | The 21 EMA + 200 MA entry condition on one timeframe: price > 200 MA, 21 EMA > 200 MA, price within `mingle_pct` (1.5%) of the 21 EMA. |
| Mingling / compressed | Price within 1.5% of the 21 EMA / 21–200 spread under `compress_pct` (5%). |
| Timeframes | Long-term panel `4h`, `1d`, `3d`; swing page `15m`, `1h`. |
| Closed vs forming | Each run stores the last **closed** candle (`is_final=1`, immutable) and the **forming** one (`is_final=0`, overwritten until it closes). Charts and setup alerts use closed candles only. |
| Scope | One independently transitioning alert state per asset: `accumulation`, `fng_extreme`, `setup_ltf` (4h/1d/3d), `setup_swing` (15m/1h). |
| Profile | A row of `scoring_profiles`: weights, component ladders, zone cutoffs, stochRSI/setup parameters for an asset class. |
| Ladder | Step table mapping a raw value to a 0–100 component score, e.g. F&G ≤5→100 … else 5. |

## Tables

### `scoring_profiles`
| Column | Meaning |
|---|---|
| `name` | `crypto_accum`, `stock_accum`, `commodity_accum` (add more as needed) |
| `config` | JSON — see schema below |
| `notes` | Free text |

`config` JSON:
```json
{
  "sentiment_source": "alternative_me | cnn | none",
  "weights":  { "sentiment": 40, "stoch": 30, "ma200": 15, "ema21": 15 },   // must sum to 100; omit a component to exclude it
  "ladders": {
    "sentiment": { "steps": [[5,100],[10,92],[20,75],[30,60],[45,42],[60,28],[75,15]], "else": 5 },
    "ma200":     { "steps": [[-20,100],[-10,85],[0,70],[10,50],[25,30]], "else": 12 },
    "ema21":     { "steps": [[0,85],[3,70],[8,45],[15,25]], "else": 10 }
  },                                                                       // stoch has no ladder: score = 100 - stochRSI
  "zones": [ { "min": 80, "zone": "DEPLOY", "label": "…", "tone": "good" }, … { "min": 0, … } ],
  "stoch": { "rsi_len": 14, "stoch_len": 14, "k_smooth": 3, "group": 2, "anchor_offset": 0 },   // group 2 = two-week bars from weekly candles
  "setup": { "mingle_pct": 1.5, "compress_pct": 5 },
  "setup_anchor_3d": 0                                                     // shifts the 3-day bar grid (0, 1, 2)
}
```
A `steps` entry `[threshold, score]` applies when `value <= threshold`, first match wins, `else` otherwise.
A component whose raw value is missing (no sentiment index, API outage) is dropped and the remaining
weights are renormalised.

### `assets`
| Column | Meaning |
|---|---|
| `symbol` | Display symbol and URL key (`BTC`, `NVDA`, `GOLD`) — unique |
| `display_name` | Card title |
| `asset_class` | `crypto` / `stock` / `commodity` — selects the collector |
| `data_source` | `binance` or `twelvedata` — the collector filters on this |
| `source_symbol` | Provider ticker: `BTCUSDT` (Binance), `NVDA`, `XAU/USD`, `USO` (Twelve Data) |
| `accum_profile_id` | FK → `scoring_profiles` |
| `swing_enabled` | 1 = included in the 15m/1h swing collector (crypto only for now) |
| `is_active` | 0 = ignored by every collector and page |
| `sort_order` | Card order |

### `readings` — accumulation gauge, one row per asset per collector period
`period_start` (4h bucket for crypto, trading day for stocks), `collected_at`, `is_final`, `price`,
`sentiment_raw`/`sentiment_score`, `stoch_rsi`/`stoch_score`, `ma200`/`vs_ma200_pct`/`ma_score`,
`ema21`/`vs_ema21_pct`/`ema_score`, `total_score`, `zone`, `insufficient_data`, `source_payload` (JSON
debug: bar counts, stoch internals, F&G label). UNIQUE (`asset_id`, `period_start`).

### `setup_readings` — badge panel, all timeframes
`timeframe` (`15m`,`1h`,`4h`,`1d`,`3d`), `period_start`, `collected_at`, `is_final`, `price`, `ma200`,
`ema21`, `above_200`, `ema_above_200`, `dist21_pct`, `mingling`, `spread_pct`, `compressed`,
`setup_bool`, `insufficient_data`. UNIQUE (`asset_id`, `timeframe`, `period_start`).

### `alert_state` — PK (`asset_id`, `scope`), `last_value`, `updated_at`
What the last observation was per scope; a differing new observation is a transition. First
observation seeds silently.

### `alert_log` — every alert sent: `scope`, `triggered_at`, `priority`, `title`, `message`.

## Retention
Nothing is pruned. Volumes: swing 15m ≈ 96 closed rows/day/asset + 1h ≈ 24; long-term 6 readings +
3 setup timeframes per 4h run; stocks 1/day. Tens of MB per year at 25 assets — fine for MySQL.

## Report queries (phpMyAdmin → SQL)

Latest gauge per asset:
```sql
SELECT a.symbol, r.period_start, r.price, r.total_score, r.zone, r.sentiment_raw, r.stoch_rsi, r.vs_ma200_pct, r.vs_ema21_pct
FROM assets a
JOIN readings r ON r.asset_id = a.id
JOIN (SELECT asset_id, MAX(period_start) ps FROM readings GROUP BY asset_id) m ON m.asset_id = r.asset_id AND m.ps = r.period_start
WHERE a.is_active = 1 ORDER BY a.sort_order;
```

Daily score history for one asset (last reading of each UTC day, 90 days):
```sql
SELECT DATE(r.period_start) day, r.total_score, r.zone, r.price
FROM readings r JOIN assets a ON a.id = r.asset_id
JOIN (SELECT asset_id, DATE(period_start) d, MAX(period_start) ps FROM readings GROUP BY asset_id, DATE(period_start)) m
  ON m.asset_id = r.asset_id AND m.ps = r.period_start
WHERE a.symbol = 'BTC' AND r.period_start >= UTC_TIMESTAMP() - INTERVAL 90 DAY ORDER BY day;
```

Share of time in each zone per asset (all history):
```sql
SELECT a.symbol, r.zone, COUNT(*) readings, ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY a.symbol), 1) pct
FROM readings r JOIN assets a ON a.id = r.asset_id WHERE r.zone IS NOT NULL GROUP BY a.symbol, r.zone ORDER BY a.symbol, pct DESC;
```

Closed-candle setups per timeframe in the last 30 days:
```sql
SELECT a.symbol, s.timeframe, SUM(s.setup_bool) setup_candles, COUNT(*) candles, ROUND(100 * SUM(s.setup_bool) / COUNT(*), 1) pct
FROM setup_readings s JOIN assets a ON a.id = s.asset_id
WHERE s.is_final = 1 AND s.period_start >= UTC_TIMESTAMP() - INTERVAL 30 DAY GROUP BY a.symbol, s.timeframe ORDER BY a.symbol, s.timeframe;
```

Assets currently in setup on both 1d and 4h (closed candles):
```sql
SELECT a.symbol FROM assets a
JOIN setup_readings d ON d.asset_id = a.id AND d.timeframe = '1d' AND d.is_final = 1 AND d.period_start = (SELECT MAX(period_start) FROM setup_readings WHERE asset_id = a.id AND timeframe = '1d' AND is_final = 1)
JOIN setup_readings h ON h.asset_id = a.id AND h.timeframe = '4h' AND h.is_final = 1 AND h.period_start = (SELECT MAX(period_start) FROM setup_readings WHERE asset_id = a.id AND timeframe = '4h' AND is_final = 1)
WHERE d.setup_bool = 1 AND h.setup_bool = 1;
```

Alerts fired in the last 30 days:
```sql
SELECT l.triggered_at, a.symbol, l.scope, l.priority, l.title FROM alert_log l JOIN assets a ON a.id = l.asset_id
WHERE l.triggered_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY ORDER BY l.triggered_at DESC;
```

Collector health (newest row per asset and timeframe — anything older than 2× its cadence is stale):
```sql
SELECT a.symbol, s.timeframe, MAX(s.collected_at) last_collected FROM setup_readings s JOIN assets a ON a.id = s.asset_id
GROUP BY a.symbol, s.timeframe ORDER BY a.symbol, FIELD(s.timeframe,'15m','1h','4h','1d','3d');
```
