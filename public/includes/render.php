<?php
declare(strict_types=1);

// Presentation helpers shared by the Investing and Swing pages. Palette and gauge markup are
// ported from legacy/btc-buy-zone-gauge.html.

const ZONE_PALETTE = ['#0b7a3b', '#27ae60', '#f1c40f', '#e74c3c'];   // best zone -> worst zone
const STATE_COLORS = ['setup' => '#2ecc71', 'wait' => '#f1c40f', 'below' => '#e74c3c', 'none' => '#5f6368'];

function base_url(): string
{
    static $b = null;
    if ($b === null) {
        $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
        $b = preg_replace('#/(investing|swing|api)$#', '', $dir) ?? '';
    }
    return $b;
}

function page_head(string $title, string $active, bool $charts = false): void
{
    $b = base_url();
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<title>' . h($title) . ' · ' . h(cfg('site')['name']) . '</title>';
    echo '<link rel="stylesheet" href="' . h($b) . '/assets/style.css">';
    if ($charts) {
        echo '<script src="' . h($b) . '/assets/vendor/chart.umd.min.js"></script>';
    }
    echo '</head><body><header class="top"><a class="brand" href="' . h($b) . '/investing/">' . h(cfg('site')['name']) . '</a><nav>';
    echo '<a href="' . h($b) . '/investing/"' . ($active === 'investing' ? ' class="on"' : '') . '>Long-Term Investing</a>';
    echo '<a href="' . h($b) . '/swing/"' . ($active === 'swing' ? ' class="on"' : '') . '>Swing Trades</a>';
    echo '</nav></header><main>';
}

function page_foot(): void
{
    echo '</main><footer class="note">Information tool built from the "Crypto Lifer" framework — not financial advice. Times shown in your local timezone.</footer>';
    echo '<script src="' . h(base_url()) . '/assets/app.js"></script></body></html>';
}

function time_tag(?string $utc): string
{
    if (!$utc) {
        return '<span class="muted">—</span>';
    }
    $iso = gmdate('c', strtotime($utc . ' UTC'));
    return '<time datetime="' . h($iso) . '">' . h($utc) . ' UTC</time>';
}

// Zones sorted best -> worst with a color attached.
function zones_with_colors(array $cfg): array
{
    $zones = $cfg['zones'] ?? [];
    usort($zones, fn($a, $b) => $b['min'] <=> $a['min']);
    $n = count($zones);
    foreach ($zones as $i => &$z) {
        $z['color'] = ZONE_PALETTE[$n <= 1 ? 0 : (int)round($i * (count(ZONE_PALETTE) - 1) / ($n - 1))];
    }
    return $zones;
}

function zone_info(array $cfg, ?string $zone): array
{
    foreach (zones_with_colors($cfg) as $z) {
        if ($z['zone'] === $zone) {
            return $z;
        }
    }
    return ['zone' => $zone ?? '—', 'label' => $zone ?? 'No data yet', 'tone' => 'muted', 'color' => STATE_COLORS['none'], 'min' => 0];
}

function score_color(array $cfg, ?float $score): string
{
    if ($score === null) {
        return STATE_COLORS['none'];
    }
    foreach (zones_with_colors($cfg) as $z) {
        if ($score >= $z['min']) {
            return $z['color'];
        }
    }
    return ZONE_PALETTE[count(ZONE_PALETTE) - 1];
}

function is_stale(?string $collectedAt, int $cadenceSec): bool
{
    if (!$collectedAt) {
        return true;
    }
    return (time() - strtotime($collectedAt . ' UTC')) > 2 * $cadenceSec;
}

function stale_html(?string $collectedAt, int $cadenceSec): string
{
    return is_stale($collectedAt, $cadenceSec)
        ? '<span class="stale" title="Newest row is older than twice the collector cadence">STALE</span>'
        : '';
}

function render_gauge(array $cfg, ?array $reading): void
{
    $score = $reading && $reading['total_score'] !== null ? (float)$reading['total_score'] : null;
    $zi = zone_info($cfg, $reading['zone'] ?? null);
    $zones = zones_with_colors($cfg);
    echo '<div class="score">' . ($score === null ? '—' : (int)round($score) . ' / 100') . '</div>';
    echo '<div class="zone ' . h($zi['tone']) . '">' . h($zi['label']) . '</div>';
    echo '<div class="gauge-wrap"><div class="needle" style="left:calc(' . ($score === null ? 0 : (int)round($score)) . '% - 2px)"></div></div>';
    echo '<div class="scale-labels"><span>0 — Overheated</span>';
    foreach (array_reverse($zones) as $i => $z) {
        if ($i === 0) {
            continue;
        }
        echo '<span>' . (int)$z['min'] . '</span>';
    }
    echo '<span>100 — Max Fear / Deploy</span></div>';
}

function pct(?float $v): string
{
    return $v === null ? '—' : ($v >= 0 ? '+' : '') . number_format($v, 1) . '%';
}

function money(?float $v): string
{
    if ($v === null) {
        return '—';
    }
    return '$' . ($v >= 100 ? number_format($v) : number_format($v, $v >= 1 ? 2 : 4));
}

function cls_for_score(?float $s): string
{
    return $s === null ? 'muted' : ($s >= 70 ? 'good' : ($s >= 40 ? 'mid' : 'bad'));
}

function row_html(string $k, string $v, string $cls = ''): string
{
    return '<tr><td>' . $k . '</td><td class="' . h($cls) . '">' . $v . '</td></tr>';
}

function render_metrics_table(array $asset, ?array $r): void
{
    $cfg = $asset['config'];
    echo '<table>';
    if (!$r) {
        echo row_html('Status', 'Waiting for the first collector run.', 'muted');
        echo '</table>';
        return;
    }
    if ((int)$r['insufficient_data'] === 1) {
        echo row_html('Status', 'Insufficient price history to compute the gauge (needs ~220 daily bars).', 'bad');
    }
    echo row_html(h($asset['symbol']) . ' price', money($r['price'] === null ? null : (float)$r['price']));
    $src = $cfg['sentiment_source'] ?? 'none';
    if ($src !== 'none' && isset($cfg['weights']['sentiment'])) {
        $name = $src === 'cnn' ? 'CNN Fear & Greed' : 'Fear & Greed Index';
        $v = $r['sentiment_raw'] === null ? '— (unavailable, reweighted)' : (int)round((float)$r['sentiment_raw']) . ' → score ' . (int)round((float)$r['sentiment_score']);
        echo row_html($name . ' (' . (int)$cfg['weights']['sentiment'] . '%)', $v, cls_for_score($r['sentiment_score'] === null ? null : (float)$r['sentiment_score']));
    }
    echo row_html('2-week stochastic RSI (' . (int)($cfg['weights']['stoch'] ?? 0) . '%)',
        $r['stoch_rsi'] === null ? '—' : number_format((float)$r['stoch_rsi'], 0) . ' → score ' . number_format((float)$r['stoch_score'], 0),
        cls_for_score($r['stoch_score'] === null ? null : (float)$r['stoch_score']));
    echo row_html('Price vs 200-day MA (' . (int)($cfg['weights']['ma200'] ?? 0) . '%)',
        pct($r['vs_ma200_pct'] === null ? null : (float)$r['vs_ma200_pct']) . ' (' . money($r['ma200'] === null ? null : (float)$r['ma200']) . ') → score ' . number_format((float)$r['ma_score'], 0),
        cls_for_score($r['ma_score'] === null ? null : (float)$r['ma_score']));
    echo row_html('Price vs 21-day EMA (' . (int)($cfg['weights']['ema21'] ?? 0) . '%)',
        pct($r['vs_ema21_pct'] === null ? null : (float)$r['vs_ema21_pct']) . ' (' . money($r['ema21'] === null ? null : (float)$r['ema21']) . ') → score ' . number_format((float)$r['ema_score'], 0),
        cls_for_score($r['ema_score'] === null ? null : (float)$r['ema_score']));
    echo row_html('Candle', time_tag($r['period_start']) . ($r['is_final'] ? '' : ' <span class="live">live</span>'));
    echo row_html('Updated', time_tag($r['collected_at']));
    echo '</table>';
}

// Badge state for a setup row: setup | wait | below | none
function setup_state(?array $r): string
{
    if (!$r || (int)$r['insufficient_data'] === 1 || $r['setup_bool'] === null) {
        return 'none';
    }
    if ((int)$r['setup_bool'] === 1) {
        return 'setup';
    }
    return (int)$r['above_200'] === 1 ? 'wait' : 'below';
}

function badge_html(?array $r): string
{
    if (!$r) {
        return '<span class="badge b-none">no data</span>';
    }
    if ((int)$r['insufficient_data'] === 1) {
        return '<span class="badge b-none">insufficient history</span>';
    }
    if ((int)$r['setup_bool'] === 1) {
        return '<span class="badge b-good">SETUP' . ((int)$r['compressed'] === 1 ? ' + COMPRESSED' : '') . '</span>';
    }
    if ((int)$r['above_200'] === 1) {
        return '<span class="badge b-mid">' . ((int)$r['mingling'] === 1 ? '21 EMA below 200' : 'waiting for pullback') . '</span>';
    }
    return '<span class="badge b-bad">below 200 MA</span>';
}

// The per-timeframe block of the setup panel: live badge + last closed verdict + the numbers.
function tf_rows_html(string $name, array $pair): string
{
    $live = $pair['live'];
    $final = $pair['final'];
    $show = $live ?: $final;
    $out = row_html('<b>' . h($name) . '</b>',
        ($live ? badge_html($live) . ' <span class="live">live</span>' : badge_html($final))
        . ($final ? '<div class="closed">last closed candle: ' . badge_html($final) . ' <small>' . time_tag($final['period_start']) . '</small></div>' : ''));
    if ($show && (int)$show['insufficient_data'] === 0 && $show['ma200'] !== null) {
        $p = (float)$show['price'];
        $ma = (float)$show['ma200'];
        $e = (float)$show['ema21'];
        $out .= row_html('&nbsp;&nbsp;Price vs 200 MA', pct(($p - $ma) / $ma * 100) . ' (' . money($ma) . ')', (int)$show['above_200'] === 1 ? 'good' : 'bad');
        $out .= row_html('&nbsp;&nbsp;Price vs 21 EMA', pct((float)$show['dist21_pct']) . ' (' . money($e) . ')' . ((int)$show['mingling'] === 1 ? ' — mingling' : ''), (int)$show['mingling'] === 1 ? 'good' : 'mid');
        $out .= row_html('&nbsp;&nbsp;21/200 spread', number_format((float)$show['spread_pct'], 1) . '%' . ((int)$show['compressed'] === 1 ? ' — compressed (pre-breakout)' : ''), (int)$show['compressed'] === 1 ? 'good' : 'mid');
    }
    return $out;
}

function setup_verdict(array $rows, array $maxPair): array
{
    $on = [];
    $above = 0;
    foreach ($rows as $tf => $pair) {
        $r = $pair['live'] ?: $pair['final'];
        if ($r && (int)$r['setup_bool'] === 1) {
            $on[] = $tf;
        }
        if ($r && (int)$r['above_200'] === 1) {
            $above++;
        }
    }
    $pairOn = count(array_intersect($maxPair, $on));
    if ($pairOn === 2) {
        return ['SETUP ON ' . strtoupper(implode(' + ', $maxPair)) . ' — watch for candle-body breakout', 'good'];
    }
    if ($on) {
        return ['SETUP ON ' . strtoupper(implode(' + ', $on)) . ' ONLY — reduced size per framework', 'mid'];
    }
    if ($above === count($rows) && $rows) {
        return ['TREND OK, NO SETUP — waiting for 21 EMA pullback', 'mid'];
    }
    return ['NO TRADE — timeframe conflict or below 200 MA', 'bad'];
}

// Inline SVG sparkline colored by zone thresholds (no JS needed on the overview cards).
function sparkline_svg(array $cfg, array $series, int $w = 220, int $h = 44): string
{
    if (count($series) < 2) {
        return '<svg class="spark" viewBox="0 0 ' . $w . ' ' . $h . '"><text x="4" y="' . ($h - 6) . '" fill="#9aa0a6" font-size="11">collecting history…</text></svg>';
    }
    $n = count($series);
    $pts = [];
    foreach ($series as $i => $p) {
        $x = $i * ($w - 4) / ($n - 1) + 2;
        $y = $h - 2 - ((float)($p['total_score'] ?? 0)) / 100 * ($h - 4);
        $pts[] = [$x, $y, $p['total_score'] === null ? null : (float)$p['total_score']];
    }
    $svg = '<svg class="spark" viewBox="0 0 ' . $w . ' ' . $h . '" preserveAspectRatio="none">';
    foreach (zones_with_colors($cfg) as $z) {
        $y = $h - 2 - ((float)$z['min']) / 100 * ($h - 4);
        $svg .= '<line x1="0" x2="' . $w . '" y1="' . round($y, 1) . '" y2="' . round($y, 1) . '" stroke="' . $z['color'] . '" stroke-opacity=".25" stroke-width="1"/>';
    }
    for ($i = 1; $i < $n; $i++) {
        [$x0, $y0] = $pts[$i - 1];
        [$x1, $y1, $s1] = $pts[$i];
        $svg .= '<line x1="' . round($x0, 1) . '" y1="' . round($y0, 1) . '" x2="' . round($x1, 1) . '" y2="' . round($y1, 1) . '" stroke="' . score_color($cfg, $s1) . '" stroke-width="2" stroke-linecap="round"/>';
    }
    return $svg . '</svg>';
}
