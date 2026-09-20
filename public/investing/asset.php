<?php
declare(strict_types=1);
require __DIR__ . '/../includes/bootstrap.php';
require __DIR__ . '/../includes/auth.php';
require __DIR__ . '/../includes/queries.php';
require __DIR__ . '/../includes/render.php';
require_page_auth();

$symbol = (string)($_GET['symbol'] ?? '');
$asset = $symbol !== '' ? get_asset($symbol) : null;
if (!$asset) {
    http_response_code(404);
    page_head('Not found', 'investing');
    echo '<h1>Unknown asset</h1><p class="muted">No active asset with that symbol. <a href="./">Back to the overview</a>.</p>';
    page_foot();
    exit;
}
$cfg = $asset['config'];
$cadence = cfg('cadence_seconds');
$reading = latest_reading((int)$asset['id']);
$sc = cfg('score_chart');
$win = (string)($_GET['days'] ?? '');
if (!in_array($win, $sc['options'], true)) {
    $win = (string)$sc['default'];
}
$series = daily_series((int)$asset['id'], $win === 'all' ? 0 : (int)$win);
$ltf = cfg('setup_scopes')['setup_ltf'];
$setupRows = latest_setup_rows((int)$asset['id'], $ltf['timeframes']);
$setupCollected = latest_setup_collected_at((int)$asset['id'], $ltf['timeframes']);
[$verdict, $verdictTone] = setup_verdict($setupRows, $ltf['max_pair']);

$spanDays = count($series) > 1 ? (strtotime(end($series)['period_start'] . ' UTC') - strtotime($series[0]['period_start'] . ' UTC')) / 86400 : 0;
$labelFmt = $spanDays > 365 ? 'M j Y' : 'M j';
$col = fn(string $k) => array_map(fn($p) => $p[$k] === null ? null : (float)$p[$k], $series);
$chart = [
    'labels' => array_map(fn($p) => gmdate($labelFmt, strtotime($p['period_start'] . ' UTC')), $series),
    'scores' => $col('total_score'),
    'zones' => array_map(fn($z) => ['min' => (int)$z['min'], 'zone' => $z['zone'], 'color' => $z['color']], zones_with_colors($cfg)),
    'stoch' => $col('stoch_rsi'),   // the raw 2W stoch RSI on the same 0-100 axis (the daily Fear & Greed line was too noisy to read)
];

page_head($asset['symbol'] . ' · Long-Term', 'investing', true);
echo '<h1>' . h($asset['display_name']) . ' <span class="muted">(' . h($asset['symbol']) . ')</span></h1>';
echo '<div class="sub">' . h(ucfirst($asset['asset_class'])) . ' · profile <code>' . h($asset['profile_name']) . '</code> · <a href="./">all assets</a></div>';

echo '<h2 class="first">1 · Long-Term Accumulation (spot / DCA reserves)' . stale_html($reading['collected_at'] ?? null, (int)($cadence[$asset['asset_class']] ?? 86400)) . '</h2>';
render_gauge($cfg, $reading);
render_metrics_table($asset, $reading);

echo '<h2>Score trend — ' . ($win === 'all' ? 'all history' : 'last ' . (int)$win . ' days') . '</h2>';
echo '<div class="range">';
foreach ($sc['options'] as $o) {
    $lbl = $o === 'all' ? 'all' : ((int)$o % 365 === 0 ? ((int)$o / 365) . 'y' : $o . 'd');
    echo '<a href="?symbol=' . h(urlencode($asset['symbol'])) . '&amp;days=' . h($o) . '"' . ($o === $win ? ' class="on"' : '') . '>' . h($lbl) . '</a>';
}
echo '</div>';
echo '<div class="chart-legend">';
foreach (zones_with_colors($cfg) as $z) {
    echo '<span><i style="background:' . h($z['color']) . '"></i>' . h($z['zone']) . ' ≥ ' . (int)$z['min'] . '</span>';
}
echo '</div>';
if (count($series) < 2) {
    echo '<p class="muted">Collecting history — the trend line appears once at least two days of readings exist.</p>';
} else {
    echo '<div class="chart-box tall"><canvas data-kind="score" data-chart=\'' . h(json_encode($chart, JSON_UNESCAPED_SLASHES)) . '\'></canvas></div>';
    echo '<div class="muted" style="font-size:.75rem">One point per UTC day (the day\'s last reading); every intraday reading is kept. The score is coloured by zone; the thin line is the 2-week stochastic RSI on the same 0–100 scale. Click a legend entry to hide or show a line.</div>';
}

echo '<h2>2 · Trade Setup — 21 EMA + 200 MA (' . h(implode(' / ', array_map('strtoupper', $ltf['timeframes']))) . ')'
    . stale_html($setupCollected, (int)($cadence[$ltf['timeframes'][0]] ?? 14400)) . '</h2>';
echo '<div class="zone ' . h($verdictTone) . '">' . h($verdict) . '</div>';
echo '<table>';
foreach ($ltf['timeframes'] as $tf) {
    echo tf_rows_html(strtoupper($tf), $setupRows[$tf]);
}
echo '</table>';

echo '<div class="note"><b>Panel 1 (weights):</b> ';
$w = [];
foreach ($cfg['weights'] ?? [] as $k => $v) {
    $w[] = h(['sentiment' => ($cfg['sentiment_source'] ?? '') === 'cnn' ? 'CNN Fear &amp; Greed' : 'Fear &amp; Greed', 'stoch' => '2-week stochastic RSI', 'ma200' => 'price vs 200-day MA', 'ema21' => 'distance from 21-day EMA'][$k] ?? $k) . ' ' . (int)$v . '%';
}
echo implode(', ', $w) . '. ';
foreach (zones_with_colors($cfg) as $z) {
    echo (int)$z['min'] . '+ = ' . h($z['label']) . ' · ';
}
echo '<br><br><b>Panel 2 (per timeframe):</b> price above the 200 MA, 21 EMA above the 200 MA, price pulled back to "mingle" with the 21 EMA (within ~' . h((string)($cfg['setup']['mingle_pct'] ?? 1.5)) . '%), bonus: 21/200 spread under ' . h((string)($cfg['setup']['compress_pct'] ?? 5)) . '% = pre-breakout loading. Badges are evaluated on the forming candle (<span class="live">live</span>) and on the last closed candle; alerts use closed candles only. '
    . strtoupper(implode(' + ', $ltf['max_pair'])) . ' agreeing = highest conviction; one timeframe = reduced size; ' . strtoupper($ltf['timeframes'][2] ?? '3d') . ' is shown as trend context.</div>';
page_foot();
