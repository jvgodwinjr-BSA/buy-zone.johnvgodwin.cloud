<?php
declare(strict_types=1);

// Read-side queries shared by the pages. Everything is UTC "Y-m-d H:i:s" as stored.

function list_assets(?string $class = null, ?bool $swing = null): array
{
    $where = ['a.is_active = 1'];
    $params = [];
    if ($class !== null) {
        $where[] = 'a.asset_class = ?';
        $params[] = $class;
    }
    if ($swing !== null) {
        $where[] = 'a.swing_enabled = ?';
        $params[] = $swing ? 1 : 0;
    }
    $st = db()->prepare('SELECT a.*, p.name AS profile_name, p.config AS profile_config
        FROM assets a JOIN scoring_profiles p ON p.id = a.accum_profile_id
        WHERE ' . implode(' AND ', $where) . ' ORDER BY a.sort_order, a.symbol');
    $st->execute($params);
    $out = [];
    foreach ($st as $r) {
        $r['config'] = json_decode((string)$r['profile_config'], true) ?: [];
        $out[] = $r;
    }
    return $out;
}

function get_asset(string $symbol): ?array
{
    $st = db()->prepare('SELECT a.*, p.name AS profile_name, p.config AS profile_config
        FROM assets a JOIN scoring_profiles p ON p.id = a.accum_profile_id WHERE a.symbol = ? AND a.is_active = 1');
    $st->execute([$symbol]);
    $r = $st->fetch();
    if (!$r) {
        return null;
    }
    $r['config'] = json_decode((string)$r['profile_config'], true) ?: [];
    return $r;
}

function latest_reading(int $assetId): ?array
{
    $st = db()->prepare('SELECT * FROM readings WHERE asset_id = ? ORDER BY period_start DESC LIMIT 1');
    $st->execute([$assetId]);
    $r = $st->fetch();
    return $r ?: null;
}

// One point per UTC day (the day's last row), oldest first. All intraday rows stay in the table.
function daily_series(int $assetId, int $n): array
{
    $st = db()->prepare('SELECT r.period_start, r.total_score, r.zone, r.price
        FROM readings r
        JOIN (SELECT MAX(period_start) AS ps FROM readings WHERE asset_id = ? GROUP BY DATE(period_start)) m ON m.ps = r.period_start
        WHERE r.asset_id = ? ORDER BY r.period_start DESC LIMIT ' . (int)$n);
    $st->execute([$assetId, $assetId]);
    return array_reverse($st->fetchAll());
}

// For each timeframe: the latest closed row ('final') and, if newer, the forming row ('live').
function latest_setup_rows(int $assetId, array $timeframes): array
{
    $out = [];
    $st = db()->prepare('SELECT * FROM setup_readings WHERE asset_id = ? AND timeframe = ? AND is_final = ? ORDER BY period_start DESC LIMIT 1');
    foreach ($timeframes as $tf) {
        $st->execute([$assetId, $tf, 1]);
        $final = $st->fetch() ?: null;
        $st->execute([$assetId, $tf, 0]);
        $live = $st->fetch() ?: null;
        if ($live && $final && $live['period_start'] <= $final['period_start']) {
            $live = null;   // stale forming row already superseded by its closed version
        }
        $out[$tf] = ['final' => $final, 'live' => $live];
    }
    return $out;
}

// Closed candles only, oldest first.
function setup_series(int $assetId, string $tf, int $n): array
{
    $st = db()->prepare('SELECT period_start, price, dist21_pct, spread_pct, above_200, ema_above_200, mingling, compressed, setup_bool, insufficient_data
        FROM setup_readings WHERE asset_id = ? AND timeframe = ? AND is_final = 1 ORDER BY period_start DESC LIMIT ' . (int)$n);
    $st->execute([$assetId, $tf]);
    return array_reverse($st->fetchAll());
}

function latest_setup_collected_at(int $assetId, array $timeframes): ?string
{
    $in = implode(',', array_fill(0, count($timeframes), '?'));
    $st = db()->prepare("SELECT MAX(collected_at) FROM setup_readings WHERE asset_id = ? AND timeframe IN ($in)");
    $st->execute(array_merge([$assetId], $timeframes));
    $v = $st->fetchColumn();
    return $v ?: null;
}
