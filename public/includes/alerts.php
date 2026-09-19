<?php
declare(strict_types=1);

// Transition detection. Ported from the n8n "Score + Detect Transitions" Code node, with the
// state moved from workflow static data into alert_state (one row per asset + scope).
// Every function returns a list of alerts: ['scope','priority','tags','title','message'].
// First observation of an asset/scope seeds the state and never alerts.

function alerts_get_state(PDO $pdo, int $assetId, string $scope): ?string
{
    $st = $pdo->prepare('SELECT last_value FROM alert_state WHERE asset_id = ? AND scope = ?');
    $st->execute([$assetId, $scope]);
    $v = $st->fetchColumn();
    return $v === false ? null : (string)$v;
}

function alerts_set_state(PDO $pdo, int $assetId, string $scope, string $value): void
{
    $st = $pdo->prepare('INSERT INTO alert_state (asset_id, scope, last_value, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE last_value = VALUES(last_value), updated_at = VALUES(updated_at)');
    $st->execute([$assetId, $scope, $value]);
}

function alerts_log(PDO $pdo, int $assetId, array $alert): void
{
    $st = $pdo->prepare('INSERT INTO alert_log (asset_id, scope, triggered_at, priority, title, message) VALUES (?, ?, UTC_TIMESTAMP(), ?, ?, ?)');
    $st->execute([$assetId, $alert['scope'], $alert['priority'], $alert['title'], $alert['message']]);
}

function fmt_price($p): string
{
    if ($p === null) {
        return 'n/a';
    }
    $p = (float)$p;
    return '$' . ($p >= 100 ? number_format($p) : number_format($p, $p >= 1 ? 2 : 4));
}

function alerts_for_accumulation(PDO $pdo, array $asset, array $row, array $profileCfg): array
{
    $out = [];
    $enabled = cfg('alerts_enabled');
    if ((int)$row['insufficient_data'] === 1 || $row['zone'] === null) {
        return $out;
    }
    $sym = $asset['symbol'];
    $px = fmt_price($row['price']);
    $score = (int)round((float)$row['total_score']);
    $zone = (string)$row['zone'];

    $prev = alerts_get_state($pdo, (int)$asset['id'], 'accumulation');
    if ($prev !== null && $prev !== $zone && !empty($enabled['accumulation'])) {
        $order = array_map(fn($z) => $z['zone'], array_reverse(alerts_sorted_zones($profileCfg['zones'])));
        $improving = array_search($zone, $order, true) > array_search($prev, $order, true);
        $sent = $row['sentiment_raw'] !== null ? ' F&G ' . (int)round((float)$row['sentiment_raw']) . ',' : '';
        $stoch = $row['stoch_rsi'] !== null ? ' 2W stochRSI ' . (int)round((float)$row['stoch_rsi']) . ',' : '';
        if ($zone === 'DEPLOY') {
            $out[] = ['scope' => 'accumulation', 'priority' => 'max', 'tags' => 'rotating_light,moneybag',
                'title' => "$sym: DEPLOY RESERVES ZONE",
                'message' => "Accumulation score $score/100 — max-fear zone.$sent$stoch price $px (" . sprintf('%+.1f', (float)$row['vs_ma200_pct']) . "% vs 200d MA)."];
        } elseif ($zone === 'STRONG_BUY') {
            $out[] = ['scope' => 'accumulation', 'priority' => 'high', 'tags' => 'chart_with_downwards_trend,moneybag',
                'title' => "$sym: Strong Buy Zone " . ($improving ? 'entered' : '(pulled back from Deploy)'),
                'message' => "Accumulation score $score/100.$sent price $px."];
        } else {
            $out[] = ['scope' => 'accumulation', 'priority' => 'default', 'tags' => 'information_source',
                'title' => "$sym zone: $prev → $zone",
                'message' => "Accumulation score $score/100.$sent price $px."];
        }
    }
    alerts_set_state($pdo, (int)$asset['id'], 'accumulation', $zone);

    // Extreme-fear trigger: only meaningful for the crypto Fear & Greed index.
    if (($profileCfg['sentiment_source'] ?? 'none') === 'alternative_me' && $row['sentiment_raw'] !== null) {
        $fng = (float)$row['sentiment_raw'];
        $extreme = $fng <= (int)cfg('fng_extreme_threshold', 10) ? '1' : '0';
        $prevX = alerts_get_state($pdo, (int)$asset['id'], 'fng_extreme');
        if ($prevX !== null && $prevX === '0' && $extreme === '1' && !empty($enabled['fng_extreme'])) {
            $stochTxt = $row['stoch_rsi'] !== null ? (int)round((float)$row['stoch_rsi']) : 'n/a';
            $out[] = ['scope' => 'fng_extreme', 'priority' => 'max', 'tags' => 'scream',
                'title' => "$sym: Fear & Greed ≤ " . (int)cfg('fng_extreme_threshold', 10),
                'message' => "F&G hit " . (int)round($fng) . " — framework extreme-fear trigger. Check 2W stochRSI (currently $stochTxt) for confluence. Price $px."];
        }
        alerts_set_state($pdo, (int)$asset['id'], 'fng_extreme', $extreme);
    }
    foreach ($out as $a) {
        alerts_log($pdo, (int)$asset['id'], $a);
    }
    return $out;
}

function alerts_sorted_zones(array $zones): array
{
    usort($zones, fn($a, $b) => $b['min'] <=> $a['min']);
    return $zones;
}

function setup_scope_for(string $timeframe): ?string
{
    foreach (cfg('setup_scopes') as $scope => $def) {
        if (in_array($timeframe, $def['timeframes'], true)) {
            return $scope;
        }
    }
    return null;
}

// Latest FINAL (closed-candle) setup row per timeframe in a scope -> "4h+1d" style state string.
function setup_scope_state(PDO $pdo, int $assetId, string $scope): array
{
    $def = cfg('setup_scopes')[$scope];
    $st = $pdo->prepare('SELECT s.timeframe, s.setup_bool, s.compressed, s.dist21_pct, s.insufficient_data
        FROM setup_readings s
        JOIN (SELECT timeframe, MAX(period_start) ps FROM setup_readings WHERE asset_id = ? AND is_final = 1 GROUP BY timeframe) m
          ON m.timeframe = s.timeframe AND m.ps = s.period_start
        WHERE s.asset_id = ? AND s.is_final = 1');
    $st->execute([$assetId, $assetId]);
    $byTf = [];
    foreach ($st as $r) {
        $byTf[$r['timeframe']] = $r;
    }
    $on = [];
    foreach ($def['timeframes'] as $tf) {
        if (!empty($byTf[$tf]) && (int)$byTf[$tf]['setup_bool'] === 1 && (int)$byTf[$tf]['insufficient_data'] === 0) {
            $on[] = $tf;
        }
    }
    return ['state' => $on ? implode('+', $on) : 'NONE', 'on' => $on, 'rows' => $byTf];
}

// Evaluate one asset's scope after its final rows for this run are stored. Mirrors the original
// rule exactly: alert whenever the combined state changes to something other than NONE — so a
// downgrade (e.g. 1d+4h -> 1d only) also alerts, at the lower priority, as it does today.
function alerts_for_setup(PDO $pdo, array $asset, string $scope, array $row): array
{
    $out = [];
    $def = cfg('setup_scopes')[$scope];
    $cur = setup_scope_state($pdo, (int)$asset['id'], $scope);
    $state = $cur['state'];
    $prev = alerts_get_state($pdo, (int)$asset['id'], $scope);
    $enabled = cfg('alerts_enabled');

    if ($prev !== null && $prev !== $state && $state !== 'NONE' && !empty($enabled[$scope])) {
        $pairOn = count(array_intersect($def['max_pair'], $cur['on']));
        $priority = $pairOn === 2 ? 'max' : ($pairOn === 1 ? 'high' : 'default');
        $sym = $asset['symbol'];
        $label = $pairOn === 2
            ? 'SETUP ON ' . strtoupper(implode(' + ', $def['max_pair']))
            : 'Setup on ' . implode(' + ', $cur['on']) . ($pairOn === 1 ? ' only (reduced size)' : ' (context timeframe only)');
        $parts = [];
        foreach ($def['timeframes'] as $tf) {
            $r = $cur['rows'][$tf] ?? null;
            if (!$r) {
                $parts[] = "$tf: no data";
                continue;
            }
            $parts[] = "$tf: " . ((int)$r['setup_bool'] === 1 ? 'SETUP' : 'no') . ((int)$r['compressed'] === 1 ? ' (compressed)' : '')
                . ', dist21 ' . sprintf('%+.1f', (float)$r['dist21_pct']) . '%';
        }
        $out[] = ['scope' => $scope, 'priority' => $priority, 'tags' => 'dart',
            'title' => "$sym " . ($scope === 'setup_swing' ? 'swing' : 'trade') . ": $label",
            'message' => '21EMA+200MA conditions met on closed candle. ' . implode('. ', $parts)
                . '. Wait for candle-BODY close breakout before entry. Price ' . fmt_price($row['price']) . '.'];
    }
    alerts_set_state($pdo, (int)$asset['id'], $scope, $state);
    foreach ($out as $a) {
        alerts_log($pdo, (int)$asset['id'], $a);
    }
    return $out;
}
