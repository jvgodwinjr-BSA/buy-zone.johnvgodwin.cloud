-- Buy-Zone tracker schema. MySQL 8 / MariaDB 10.x. All DATETIME values are UTC.
-- Run once on the Hostinger database (phpMyAdmin > Import), then db/seed.sql.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS scoring_profiles (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(64)  NOT NULL,
  config      JSON         NOT NULL,          -- {weights, ladders, zones, stoch, setup, sentiment_source}
  notes       VARCHAR(255) NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_profile_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS assets (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  symbol           VARCHAR(24)  NOT NULL,     -- display symbol used in URLs, e.g. BTC, AAPL, GOLD
  display_name     VARCHAR(80)  NOT NULL,
  asset_class      ENUM('crypto','stock','commodity') NOT NULL,
  data_source      VARCHAR(32)  NOT NULL,     -- binance | twelvedata
  source_symbol    VARCHAR(32)  NOT NULL,     -- provider ticker, e.g. BTCUSDT, AAPL, XAU/USD
  accum_profile_id INT UNSIGNED NOT NULL,
  swing_enabled    TINYINT(1)   NOT NULL DEFAULT 0,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order       INT          NOT NULL DEFAULT 100,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_asset_symbol (symbol),
  KEY ix_assets_class (asset_class, is_active),
  CONSTRAINT fk_assets_profile FOREIGN KEY (accum_profile_id) REFERENCES scoring_profiles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Accumulation gauge, one row per asset per collector period (4h bucket for crypto, trading day
-- for stocks/commodities). period_start is the candle open time from the data source.
CREATE TABLE IF NOT EXISTS readings (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  asset_id          INT UNSIGNED    NOT NULL,
  period_start      DATETIME        NOT NULL,
  collected_at      DATETIME        NOT NULL,
  is_final          TINYINT(1)      NOT NULL DEFAULT 1,
  price             DECIMAL(18,8)   NULL,
  sentiment_raw     DECIMAL(9,4)    NULL,
  sentiment_score   DECIMAL(5,2)    NULL,
  stoch_rsi         DECIMAL(9,4)    NULL,
  stoch_score       DECIMAL(5,2)    NULL,
  ma200             DECIMAL(18,8)   NULL,
  vs_ma200_pct      DECIMAL(9,4)    NULL,
  ma_score          DECIMAL(5,2)    NULL,
  ema21             DECIMAL(18,8)   NULL,
  vs_ema21_pct      DECIMAL(9,4)    NULL,
  ema_score         DECIMAL(5,2)    NULL,
  total_score       DECIMAL(5,2)    NULL,
  zone              VARCHAR(24)     NULL,
  insufficient_data TINYINT(1)      NOT NULL DEFAULT 0,
  source_payload    JSON            NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reading (asset_id, period_start),
  KEY ix_readings_asset_time (asset_id, period_start),
  CONSTRAINT fk_readings_asset FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 21 EMA / 200 MA setup badge panel, every timeframe. 15m/1h feed the Swing page, 4h/1d/3d the
-- Investing page. is_final=1 rows are closed candles (charts + alerts); is_final=0 is the forming candle.
CREATE TABLE IF NOT EXISTS setup_readings (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  asset_id          INT UNSIGNED    NOT NULL,
  timeframe         ENUM('15m','1h','4h','1d','3d') NOT NULL,
  period_start      DATETIME        NOT NULL,
  collected_at      DATETIME        NOT NULL,
  is_final          TINYINT(1)      NOT NULL DEFAULT 0,
  price             DECIMAL(18,8)   NULL,
  ma200             DECIMAL(18,8)   NULL,
  ema21             DECIMAL(18,8)   NULL,
  above_200         TINYINT(1)      NULL,
  ema_above_200     TINYINT(1)      NULL,
  dist21_pct        DECIMAL(9,4)    NULL,
  mingling          TINYINT(1)      NULL,
  spread_pct        DECIMAL(9,4)    NULL,
  compressed        TINYINT(1)      NULL,
  setup_bool        TINYINT(1)      NULL,
  insufficient_data TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_setup (asset_id, timeframe, period_start),
  KEY ix_setup_asset_tf_time (asset_id, timeframe, is_final, period_start),
  CONSTRAINT fk_setup_asset FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per independently transitioning thing, so scopes never overwrite each other.
CREATE TABLE IF NOT EXISTS alert_state (
  asset_id    INT UNSIGNED NOT NULL,
  scope       ENUM('accumulation','fng_extreme','setup_ltf','setup_swing') NOT NULL,
  last_value  VARCHAR(64)  NOT NULL,
  updated_at  DATETIME     NOT NULL,
  PRIMARY KEY (asset_id, scope),
  CONSTRAINT fk_alert_state_asset FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS alert_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  asset_id      INT UNSIGNED    NOT NULL,
  scope         VARCHAR(24)     NOT NULL,
  triggered_at  DATETIME        NOT NULL,
  priority      VARCHAR(16)     NOT NULL,
  title         VARCHAR(160)    NOT NULL,
  message       TEXT            NOT NULL,
  PRIMARY KEY (id),
  KEY ix_alert_log_asset_time (asset_id, triggered_at),
  CONSTRAINT fk_alert_log_asset FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
