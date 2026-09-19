<?php
declare(strict_types=1);
require __DIR__ . '/../includes/bootstrap.php';
require __DIR__ . '/../includes/auth.php';
require __DIR__ . '/../includes/queries.php';
require __DIR__ . '/../includes/render.php';
require_page_auth();

$assets = list_assets(null, true);
$swing = cfg('setup_scopes')['setup_swing'];
$cadence = cfg('cadence_seconds');

page_head('Swing Trades', 'swing');
echo '<h1>Swing Trades — 21 EMA + 200 MA on ' . h(implode(' / ', array_map('strtoupper', $swing['timeframes']))) . '</h1>';
echo '<div class="sub">Same setup model as the long-term panel, recalculated every 15 minutes on fast timeframes. Badge shows the forming candle; the closed-candle verdict is on each asset page.</div>';

if (!$assets) {
    echo '<p class="muted">No assets have <code>swing_enabled = 1</code>.</p>';
}
echo '<div class="cards">';
foreach ($assets as $a) {
    $rows = latest_setup_rows((int)$a['id'], $swing['timeframes']);
    $collected = latest_setup_collected_at((int)$a['id'], $swing['timeframes']);
    [$verdict, $tone] = setup_verdict($rows, $swing['max_pair']);
    echo '<a class="card" href="asset.php?symbol=' . h(urlencode($a['symbol'])) . '">';
    echo '<div class="head"><span class="sym">' . h($a['symbol']) . '</span><span class="name">' . h($a['display_name']) . '</span></div>';
    echo '<div class="zl ' . h($tone) . '">' . h($verdict) . '</div><div class="tfs">';
    foreach ($swing['timeframes'] as $tf) {
        $r = $rows[$tf]['live'] ?: $rows[$tf]['final'];
        echo '<div><span>' . h(strtoupper($tf)) . '</span>' . badge_html($r) . '</div>';
    }
    echo '</div><div class="meta">' . ($collected ? 'updated ' . time_tag($collected) : 'waiting for first collector run')
        . stale_html($collected, (int)($cadence[$swing['timeframes'][0]] ?? 900)) . '</div></a>';
}
echo '</div>';
page_foot();
