<?php
declare(strict_types=1);
require __DIR__ . '/../includes/bootstrap.php';
require __DIR__ . '/../includes/auth.php';
require __DIR__ . '/../includes/queries.php';
require __DIR__ . '/../includes/render.php';
require_page_auth();

$assets = list_assets();
$groups = ['crypto' => 'Crypto', 'stock' => 'Stocks', 'commodity' => 'Commodities'];
$cadence = cfg('cadence_seconds');
$points = (int)cfg('chart_points', 48);

page_head('Long-Term Investing', 'investing');
echo '<h1>Long-Term Accumulation</h1><div class="sub">Spot / DCA-reserve gauge per asset. Sparkline = daily score over the last ' . $points . ' days, colored by zone.</div>';

if (!$assets) {
    echo '<p class="muted">No active assets. Add rows to the <code>assets</code> table.</p>';
}
foreach ($groups as $class => $label) {
    $in = array_filter($assets, fn($a) => $a['asset_class'] === $class);
    if (!$in) {
        continue;
    }
    echo '<h3 class="class">' . h($label) . '</h3><div class="cards">';
    foreach ($in as $a) {
        $r = latest_reading((int)$a['id']);
        $series = daily_series((int)$a['id'], $points);
        $zi = zone_info($a['config'], $r['zone'] ?? null);
        $score = $r && $r['total_score'] !== null ? (int)round((float)$r['total_score']) : null;
        echo '<a class="card" href="asset.php?symbol=' . h(urlencode($a['symbol'])) . '">';
        echo '<div class="head"><span class="sym">' . h($a['symbol']) . '</span><span class="name">' . h($a['display_name']) . '</span></div>';
        echo '<div class="big" style="color:' . h($zi['color']) . '">' . ($score === null ? '—' : $score . ' <small class="muted">/ 100</small>') . '</div>';
        echo '<div class="zl" style="color:' . h($zi['color']) . '">' . h($zi['label']) . '</div>';
        echo sparkline_svg($a['config'], $series);
        echo '<div class="meta">' . ($r ? money((float)$r['price']) . ' · updated ' . time_tag($r['collected_at']) : 'waiting for first collector run')
            . stale_html($r['collected_at'] ?? null, (int)($cadence[$class] ?? 86400)) . '</div>';
        echo '</a>';
    }
    echo '</div>';
}
page_foot();
