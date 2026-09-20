<?php
declare(strict_types=1);
require __DIR__ . '/../includes/bootstrap.php';
require __DIR__ . '/../includes/api_auth.php';
require __DIR__ . '/../includes/alerts.php';

// POST /api/ingest.php  — body: one row object, or {"rows":[...]} for a batch.
//   accumulation row: {type:"accumulation", symbol, period_start, collected_at?, is_final?, price, sentiment_raw,
//                      sentiment_score, stoch_rsi, stoch_score, ma200, vs_ma200_pct, ma_score, ema21, vs_ema21_pct,
//                      ema_score, total_score, zone, insufficient_data?, source_payload?}
//   setup row:        {type:"setup", symbol, timeframe, period_start, collected_at?, is_final, price, ma200, ema21,
//                      above_200, ema_above_200, dist21_pct, mingling, spread_pct, compressed, setup_bool, insufficient_data?}
// Rows are upserted on (asset, [timeframe,] period_start). Response: {ok, results:[...], alerts:[...]}.
//   {"rows":[...], "backfill": true} stores historical rows without touching alert_state or sending alerts.

require_api_token();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_out(['error' => 'method not allowed'], 405);
}
$body = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($body)) {
    json_out(['error' => 'invalid JSON body'], 400);
}
$rows = isset($body['rows']) && is_array($body['rows']) ? $body['rows'] : [$body];
$backfill = !empty($body['backfill']);   // historical rows: store only, no transition rules
if (!$rows || count($rows) > 500) {
    json_out(['error' => 'rows must contain 1..500 items'], 400);
}

const TIMEFRAMES = ['15m', '1h', '4h', '1d', '3d'];
const ACC_NUM = ['price', 'sentiment_raw', 'sentiment_score', 'stoch_rsi', 'stoch_score', 'ma200', 'vs_ma200_pct', 'ma_score', 'ema21', 'vs_ema21_pct', 'ema_score', 'total_score'];
const SETUP_NUM = ['price', 'ma200', 'ema21', 'dist21_pct', 'spread_pct'];
const SETUP_BOOL = ['above_200', 'ema_above_200', 'mingling', 'compressed', 'setup_bool'];

function num($v): ?string
{
    if ($v === null || $v === '' || (is_float($v) && !is_finite($v))) {
        return null;
    }
    if (!is_numeric($v)) {
        throw new InvalidArgumentException('not numeric: ' . json_encode($v));
    }
    return (string)$v;
}
function boolint($v): ?int
{
    if ($v === null || $v === '') {
        return null;
    }
    return ($v === true || $v === 1 || $v === '1' || $v === 'true') ? 1 : 0;
}

$pdo = db();
$assetStmt = $pdo->prepare('SELECT a.*, p.config AS profile_config FROM assets a JOIN scoring_profiles p ON p.id = a.accum_profile_id WHERE a.symbol = ?');

// Validate everything first; store nothing if any row is bad.
$prepared = [];
$errors = [];
foreach ($rows as $i => $r) {
    try {
        if (!is_array($r)) {
            throw new InvalidArgumentException('row is not an object');
        }
        $type = $r['type'] ?? '';
        if (!in_array($type, ['accumulation', 'setup'], true)) {
            throw new InvalidArgumentException('type must be accumulation|setup');
        }
        $assetStmt->execute([(string)($r['symbol'] ?? '')]);
        $asset = $assetStmt->fetch();
        if (!$asset) {
            throw new InvalidArgumentException('unknown symbol ' . json_encode($r['symbol'] ?? null));
        }
        $ps = to_utc_datetime($r['period_start'] ?? null);
        if ($ps === null) {
            throw new InvalidArgumentException('period_start missing/invalid');
        }
        $ca = to_utc_datetime($r['collected_at'] ?? null) ?? gmdate('Y-m-d H:i:s');
        $row = ['type' => $type, 'asset' => $asset, 'period_start' => $ps, 'collected_at' => $ca,
            'insufficient_data' => boolint($r['insufficient_data'] ?? 0) ?? 0];
        if ($type === 'accumulation') {
            foreach (ACC_NUM as $k) {
                $row[$k] = num($r[$k] ?? null);
            }
            $row['is_final'] = boolint($r['is_final'] ?? 1) ?? 1;
            $row['zone'] = isset($r['zone']) ? substr((string)$r['zone'], 0, 24) : null;
            $row['source_payload'] = isset($r['source_payload']) ? json_encode($r['source_payload'], JSON_UNESCAPED_SLASHES) : null;
        } else {
            $tf = (string)($r['timeframe'] ?? '');
            if (!in_array($tf, TIMEFRAMES, true)) {
                throw new InvalidArgumentException('timeframe must be one of ' . implode(',', TIMEFRAMES));
            }
            $row['timeframe'] = $tf;
            if (!isset($r['is_final'])) {
                throw new InvalidArgumentException('is_final is required for setup rows');
            }
            $row['is_final'] = boolint($r['is_final']);
            foreach (SETUP_NUM as $k) {
                $row[$k] = num($r[$k] ?? null);
            }
            foreach (SETUP_BOOL as $k) {
                $row[$k] = boolint($r[$k] ?? null);
            }
        }
        $prepared[] = $row;
    } catch (InvalidArgumentException $e) {
        $errors[] = ['row' => $i, 'error' => $e->getMessage()];
    }
}
if ($errors) {
    json_out(['ok' => false, 'errors' => $errors], 400);
}

$upAcc = $pdo->prepare('INSERT INTO readings (asset_id, period_start, collected_at, is_final, price, sentiment_raw, sentiment_score, stoch_rsi, stoch_score,
        ma200, vs_ma200_pct, ma_score, ema21, vs_ema21_pct, ema_score, total_score, zone, insufficient_data, source_payload)
    VALUES (:asset_id, :period_start, :collected_at, :is_final, :price, :sentiment_raw, :sentiment_score, :stoch_rsi, :stoch_score,
        :ma200, :vs_ma200_pct, :ma_score, :ema21, :vs_ema21_pct, :ema_score, :total_score, :zone, :insufficient_data, :source_payload)
    ON DUPLICATE KEY UPDATE collected_at = VALUES(collected_at), is_final = VALUES(is_final), price = VALUES(price),
        sentiment_raw = VALUES(sentiment_raw), sentiment_score = VALUES(sentiment_score), stoch_rsi = VALUES(stoch_rsi), stoch_score = VALUES(stoch_score),
        ma200 = VALUES(ma200), vs_ma200_pct = VALUES(vs_ma200_pct), ma_score = VALUES(ma_score), ema21 = VALUES(ema21), vs_ema21_pct = VALUES(vs_ema21_pct),
        ema_score = VALUES(ema_score), total_score = VALUES(total_score), zone = VALUES(zone), insufficient_data = VALUES(insufficient_data),
        source_payload = VALUES(source_payload)');
$upSetup = $pdo->prepare('INSERT INTO setup_readings (asset_id, timeframe, period_start, collected_at, is_final, price, ma200, ema21, above_200, ema_above_200,
        dist21_pct, mingling, spread_pct, compressed, setup_bool, insufficient_data)
    VALUES (:asset_id, :timeframe, :period_start, :collected_at, :is_final, :price, :ma200, :ema21, :above_200, :ema_above_200,
        :dist21_pct, :mingling, :spread_pct, :compressed, :setup_bool, :insufficient_data)
    ON DUPLICATE KEY UPDATE collected_at = VALUES(collected_at), is_final = VALUES(is_final), price = VALUES(price), ma200 = VALUES(ma200), ema21 = VALUES(ema21),
        above_200 = VALUES(above_200), ema_above_200 = VALUES(ema_above_200), dist21_pct = VALUES(dist21_pct), mingling = VALUES(mingling),
        spread_pct = VALUES(spread_pct), compressed = VALUES(compressed), setup_bool = VALUES(setup_bool), insufficient_data = VALUES(insufficient_data)');

// Store the whole batch, then evaluate each affected setup scope ONCE (a run that changes two
// timeframes of the same asset must produce one transition, not two).
$results = [];
$alerts = [];
$scopesToEval = [];
$pdo->beginTransaction();
try {
    foreach ($prepared as $row) {
        $asset = $row['asset'];
        $profileCfg = json_decode((string)$asset['profile_config'], true) ?: [];
        $new = [];
        if ($row['type'] === 'accumulation') {
            $upAcc->execute([
                ':asset_id' => (int)$asset['id'], ':period_start' => $row['period_start'], ':collected_at' => $row['collected_at'], ':is_final' => $row['is_final'],
                ':price' => $row['price'], ':sentiment_raw' => $row['sentiment_raw'], ':sentiment_score' => $row['sentiment_score'],
                ':stoch_rsi' => $row['stoch_rsi'], ':stoch_score' => $row['stoch_score'], ':ma200' => $row['ma200'], ':vs_ma200_pct' => $row['vs_ma200_pct'],
                ':ma_score' => $row['ma_score'], ':ema21' => $row['ema21'], ':vs_ema21_pct' => $row['vs_ema21_pct'], ':ema_score' => $row['ema_score'],
                ':total_score' => $row['total_score'], ':zone' => $row['zone'], ':insufficient_data' => $row['insufficient_data'], ':source_payload' => $row['source_payload'],
            ]);
            $new = $backfill ? [] : alerts_for_accumulation($pdo, $asset, $row, $profileCfg);
        } else {
            $upSetup->execute([
                ':asset_id' => (int)$asset['id'], ':timeframe' => $row['timeframe'], ':period_start' => $row['period_start'], ':collected_at' => $row['collected_at'],
                ':is_final' => $row['is_final'], ':price' => $row['price'], ':ma200' => $row['ma200'], ':ema21' => $row['ema21'], ':above_200' => $row['above_200'],
                ':ema_above_200' => $row['ema_above_200'], ':dist21_pct' => $row['dist21_pct'], ':mingling' => $row['mingling'], ':spread_pct' => $row['spread_pct'],
                ':compressed' => $row['compressed'], ':setup_bool' => $row['setup_bool'], ':insufficient_data' => $row['insufficient_data'],
            ]);
            // Forming candles never drive alerts (candle-close rule); insufficient rows carry no verdict.
            if (!$backfill && (int)$row['is_final'] === 1 && (int)$row['insufficient_data'] === 0) {
                $scope = setup_scope_for((string)$row['timeframe']);
                if ($scope !== null) {
                    $scopesToEval[$asset['id'] . '|' . $scope] = ['asset' => $asset, 'scope' => $scope, 'row' => $row];
                }
            }
        }
        foreach ($new as $a) {
            $alerts[] = $a + ['symbol' => $asset['symbol']];
        }
        $results[] = ['symbol' => $asset['symbol'], 'type' => $row['type'], 'timeframe' => $row['timeframe'] ?? null,
            'period_start' => $row['period_start'], 'is_final' => $row['is_final'], 'stored' => true];
    }
    foreach ($scopesToEval as $e) {
        foreach (alerts_for_setup($pdo, $e['asset'], $e['scope'], $e['row']) as $a) {
            $alerts[] = $a + ['symbol' => $e['asset']['symbol']];
        }
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    json_out(['ok' => false, 'error' => 'storage failure: ' . $e->getMessage()], 500);
}
json_out(['ok' => true, 'stored' => count($results), 'backfill' => $backfill, 'results' => $results, 'alerts' => $alerts, 'alert_count' => count($alerts)]);
