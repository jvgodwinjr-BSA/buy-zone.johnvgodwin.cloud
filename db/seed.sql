-- Initial scoring profiles and assets. Run after db/schema.sql. Safe to re-run (upserts by name/symbol).
-- Weights, ladders and zone cutoffs are the framework spec from CLAUDE.md; edit them HERE (or in
-- phpMyAdmin), never in code. Weights must sum to 100 within a profile.

SET NAMES utf8mb4;

INSERT INTO scoring_profiles (name, config, notes) VALUES
('crypto_accum', JSON_OBJECT(
  'sentiment_source', 'alternative_me',
  'weights', JSON_OBJECT('sentiment', 40, 'stoch', 30, 'ma200', 15, 'ema21', 15),
  'ladders', JSON_OBJECT(
    'sentiment', JSON_OBJECT('steps', JSON_ARRAY(JSON_ARRAY(5,100), JSON_ARRAY(10,92), JSON_ARRAY(20,75), JSON_ARRAY(30,60), JSON_ARRAY(45,42), JSON_ARRAY(60,28), JSON_ARRAY(75,15)), 'else', 5),
    'ma200',     JSON_OBJECT('steps', JSON_ARRAY(JSON_ARRAY(-20,100), JSON_ARRAY(-10,85), JSON_ARRAY(0,70), JSON_ARRAY(10,50), JSON_ARRAY(25,30)), 'else', 12),
    'ema21',     JSON_OBJECT('steps', JSON_ARRAY(JSON_ARRAY(0,85), JSON_ARRAY(3,70), JSON_ARRAY(8,45), JSON_ARRAY(15,25)), 'else', 10)),
  'zones', JSON_ARRAY(
    JSON_OBJECT('min', 80, 'zone', 'DEPLOY',     'label', 'DEPLOY RESERVES — max-fear accumulation zone', 'tone', 'good'),
    JSON_OBJECT('min', 60, 'zone', 'STRONG_BUY', 'label', 'STRONG BUY ZONE — accumulate',                 'tone', 'good'),
    JSON_OBJECT('min', 40, 'zone', 'NEUTRAL',    'label', 'NEUTRAL — baseline DCA only',                  'tone', 'mid'),
    JSON_OBJECT('min', 0,  'zone', 'EXTENDED',   'label', 'EXTENDED — DCA only, hold reserves',           'tone', 'bad')),
  'stoch', JSON_OBJECT('rsi_len', 14, 'stoch_len', 14, 'k_smooth', 3, 'group', 2, 'anchor_offset', 0),
  'setup', JSON_OBJECT('mingle_pct', 1.5, 'compress_pct', 5),
  'setup_anchor_3d', 0
), 'Crypto Lifer framework, unchanged weights. Sentiment = alternative.me Fear & Greed.'),

('stock_accum', JSON_OBJECT(
  'sentiment_source', 'cnn',
  'weights', JSON_OBJECT('sentiment', 40, 'stoch', 30, 'ma200', 15, 'ema21', 15),
  'ladders', JSON_OBJECT(
    'sentiment', JSON_OBJECT('steps', JSON_ARRAY(JSON_ARRAY(5,100), JSON_ARRAY(10,92), JSON_ARRAY(20,75), JSON_ARRAY(30,60), JSON_ARRAY(45,42), JSON_ARRAY(60,28), JSON_ARRAY(75,15)), 'else', 5),
    'ma200',     JSON_OBJECT('steps', JSON_ARRAY(JSON_ARRAY(-20,100), JSON_ARRAY(-10,85), JSON_ARRAY(0,70), JSON_ARRAY(10,50), JSON_ARRAY(25,30)), 'else', 12),
    'ema21',     JSON_OBJECT('steps', JSON_ARRAY(JSON_ARRAY(0,85), JSON_ARRAY(3,70), JSON_ARRAY(8,45), JSON_ARRAY(15,25)), 'else', 10)),
  'zones', JSON_ARRAY(
    JSON_OBJECT('min', 80, 'zone', 'DEPLOY',     'label', 'DEPLOY RESERVES — max-fear accumulation zone', 'tone', 'good'),
    JSON_OBJECT('min', 60, 'zone', 'STRONG_BUY', 'label', 'STRONG BUY ZONE — accumulate',                 'tone', 'good'),
    JSON_OBJECT('min', 40, 'zone', 'NEUTRAL',    'label', 'NEUTRAL — baseline DCA only',                  'tone', 'mid'),
    JSON_OBJECT('min', 0,  'zone', 'EXTENDED',   'label', 'EXTENDED — DCA only, hold reserves',           'tone', 'bad')),
  'stoch', JSON_OBJECT('rsi_len', 14, 'stoch_len', 14, 'k_smooth', 3, 'group', 2, 'anchor_offset', 0),
  'setup', JSON_OBJECT('mingle_pct', 1.5, 'compress_pct', 5),
  'setup_anchor_3d', 0
), 'Same weights as crypto; sentiment = CNN Fear & Greed (stocks).'),

('commodity_accum', JSON_OBJECT(
  'sentiment_source', 'none',
  'weights', JSON_OBJECT('stoch', 45, 'ma200', 30, 'ema21', 25),
  'ladders', JSON_OBJECT(
    'ma200',     JSON_OBJECT('steps', JSON_ARRAY(JSON_ARRAY(-20,100), JSON_ARRAY(-10,85), JSON_ARRAY(0,70), JSON_ARRAY(10,50), JSON_ARRAY(25,30)), 'else', 12),
    'ema21',     JSON_OBJECT('steps', JSON_ARRAY(JSON_ARRAY(0,85), JSON_ARRAY(3,70), JSON_ARRAY(8,45), JSON_ARRAY(15,25)), 'else', 10)),
  'zones', JSON_ARRAY(
    JSON_OBJECT('min', 80, 'zone', 'DEPLOY',     'label', 'DEPLOY RESERVES — max-fear accumulation zone', 'tone', 'good'),
    JSON_OBJECT('min', 60, 'zone', 'STRONG_BUY', 'label', 'STRONG BUY ZONE — accumulate',                 'tone', 'good'),
    JSON_OBJECT('min', 40, 'zone', 'NEUTRAL',    'label', 'NEUTRAL — baseline DCA only',                  'tone', 'mid'),
    JSON_OBJECT('min', 0,  'zone', 'EXTENDED',   'label', 'EXTENDED — DCA only, hold reserves',           'tone', 'bad')),
  'stoch', JSON_OBJECT('rsi_len', 14, 'stoch_len', 14, 'k_smooth', 3, 'group', 2, 'anchor_offset', 0),
  'setup', JSON_OBJECT('mingle_pct', 1.5, 'compress_pct', 5),
  'setup_anchor_3d', 0
), 'No sentiment index exists for commodities; remaining components reweighted.')
ON DUPLICATE KEY UPDATE config = VALUES(config), notes = VALUES(notes);

-- Assets. Add more rows here or in phpMyAdmin. source_symbol is the provider's ticker.
INSERT INTO assets (symbol, display_name, asset_class, data_source, source_symbol, accum_profile_id, swing_enabled, is_active, sort_order) VALUES
('BTC',  'Bitcoin',              'crypto',    'binance',    'BTCUSDT', (SELECT id FROM scoring_profiles WHERE name='crypto_accum'),    1, 1, 10),
('ETH',  'Ethereum',             'crypto',    'binance',    'ETHUSDT', (SELECT id FROM scoring_profiles WHERE name='crypto_accum'),    1, 1, 20),
-- Templates (inactive): flip is_active to 1 once a Twelve Data key is configured in n8n.
('AAPL', 'Apple',                'stock',     'twelvedata', 'AAPL',    (SELECT id FROM scoring_profiles WHERE name='stock_accum'),     0, 0, 100),
('GOLD', 'Gold (spot, XAU/USD)', 'commodity', 'twelvedata', 'XAU/USD', (SELECT id FROM scoring_profiles WHERE name='commodity_accum'), 0, 0, 200)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), asset_class = VALUES(asset_class), data_source = VALUES(data_source),
  source_symbol = VALUES(source_symbol), accum_profile_id = VALUES(accum_profile_id);
