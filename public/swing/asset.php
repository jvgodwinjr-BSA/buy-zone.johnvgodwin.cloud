<?php
declare(strict_types=1);
require __DIR__ . '/../includes/bootstrap.php';
require __DIR__ . '/../includes/auth.php';
require __DIR__ . '/../includes/queries.php';
require __DIR__ . '/../includes/render.php';
require_page_auth();

$symbol = (string)($_GET['symbol'] ?? '');
$asset = $symbol !== '' ? get_asset($symbol) : null;
if (!$asset || (int)$asset['swing_enabled'] !== 1) {
    http_response_code(404);
    page_head('Not found', 'swing');
    echo '<h1>Unknown swing asset</h1><p class="muted">No swing-enabled asset with that symbol. <a href="./">Back to the swing overview</a>.</p>';
    page_foot();
    exit;
}
$swing = cfg('setup_scopes')['setup_swing'];
$cadence = cfg('cadence_seconds');
$points = (int)cfg('chart_points', 48);
$rows = latest_setup_rows((int)$asset['id'], $swing['timeframes']);
$collected = latest_setup_collected_at((int)$asset['id'], $swing['timeframes']);
[$verdict, $tone] = setup_verdict($rows, $swing['max_pair']);

page_head($asset['symbol'] . ' · Swing', 'swing', true);
echo '<h1>' . h($asset['display_name']) . ' <span class="muted">(' . h($asset['symbol']) . ')</span> — swing</h1>';
echo '<div class="sub"><a href="./">all swing assets</a> · <a href="../investing/asset.php?symbol=' . h(urlencode($asset['symbol'])) . '">long-term view</a></div>';

echo '<h2 class="first">Trade Setup — 21 EMA + 200 MA (' . h(implode(' / ', array_map('strtoupper', $swing['timeframes']))) . ')'
    . stale_html($collected, (int)($cadence[$swing['timeframes'][0]] ?? 900)) . '</h2>';
echo '<div class="zone ' . h($tone) . '">' . h($verdict) . '</div><table>';
foreach ($swing['timeframes'] as $tf) {
    echo tf_rows_html(strtoupper($tf), $rows[$tf]);
}
echo '</table>';

foreach ($swing['timeframes'] as $tf) {
    $series = setup_series((int)$asset['id'], $tf, $points);
    echo '<h2>' . h(strtoupper($tf)) . ' — last ' . $points . ' closed candles</h2>';
    echo '<div class="chart-legend"><span><i style="background:' . STATE_COLORS['setup'] . '"></i>setup</span><span><i style="background:' . STATE_COLORS['wait'] . '"></i>above 200, waiting</span><span><i style="background:' . STATE_COLORS['below'] . '"></i>below 200 MA</span><span>line = % distance from 21 EMA</span></div>';
    if (count($series) < 2) {
        echo '<p class="muted">Collecting history — appears after two closed candles.</p>';
        continue;
    }
    $chart = [
        'times' => array_map(fn($p) => gmdate('c', strtotime($p['period_start'] . ' UTC')), $series),   // ISO UTC; app.js formats in local time
        'dist' => array_map(fn($p) => $p['dist21_pct'] === null ? null : (float)$p['dist21_pct'], $series),
        'states' => array_map('setup_state', $series),
    ];
    echo '<div class="chart-box"><canvas data-kind="swing" data-chart=\'' . h(json_encode($chart, JSON_UNESCAPED_SLASHES)) . '\'></canvas></div>';
}

echo '<div class="note">Conditions per timeframe: price above the 200 MA, 21 EMA above the 200 MA, price within ~' . h((string)($asset['config']['setup']['mingle_pct'] ?? 1.5)) . '% of the 21 EMA; 21/200 spread under ' . h((string)($asset['config']['setup']['compress_pct'] ?? 5)) . '% flags compression. Entry only on a candle-<i>body</i> close breakout; stop below the 200 MA / wick low; exits on entry-timeframe closes (timeframe loyalty). '
    . strtoupper(implode(' + ', $swing['max_pair'])) . ' aligned = full size, one = reduced, conflict = no trade. Alerts fire on closed candles only.</div>';
page_foot();
