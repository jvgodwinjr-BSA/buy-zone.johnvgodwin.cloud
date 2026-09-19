<?php
declare(strict_types=1);
require __DIR__ . '/../includes/bootstrap.php';
require __DIR__ . '/../includes/api_auth.php';

// GET /api/assets.php?class=crypto&swing=1
// Active assets with their full scoring-profile config, so n8n carries no symbol lists or formulas.
require_api_token();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_out(['error' => 'method not allowed'], 405);
}

$where = ['a.is_active = 1'];
$params = [];
if (!empty($_GET['class'])) {
    if (!in_array($_GET['class'], ['crypto', 'stock', 'commodity'], true)) {
        json_out(['error' => 'bad class'], 400);
    }
    $where[] = 'a.asset_class = ?';
    $params[] = $_GET['class'];
}
if (isset($_GET['swing']) && $_GET['swing'] === '1') {
    $where[] = 'a.swing_enabled = 1';
}

$st = db()->prepare('SELECT a.id, a.symbol, a.display_name, a.asset_class, a.data_source, a.source_symbol, a.swing_enabled,
        p.name AS profile_name, p.config AS profile_config
    FROM assets a JOIN scoring_profiles p ON p.id = a.accum_profile_id
    WHERE ' . implode(' AND ', $where) . ' ORDER BY a.sort_order, a.symbol');
$st->execute($params);

$assets = [];
foreach ($st as $r) {
    $assets[] = [
        'id' => (int)$r['id'],
        'symbol' => $r['symbol'],
        'display_name' => $r['display_name'],
        'asset_class' => $r['asset_class'],
        'data_source' => $r['data_source'],
        'source_symbol' => $r['source_symbol'],
        'swing_enabled' => (bool)$r['swing_enabled'],
        'profile' => $r['profile_name'],
        'config' => json_decode($r['profile_config'], true),
    ];
}
json_out(['assets' => $assets, 'count' => count($assets), 'server_time' => gmdate('c')]);
