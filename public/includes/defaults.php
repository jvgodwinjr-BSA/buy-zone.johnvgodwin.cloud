<?php
// Non-secret defaults. Secrets and DB credentials live in config.local.php (git-ignored),
// which is merged over this array by bootstrap.php.
return [
    'site' => [
        'name' => 'Buy Zone',
    ],

    // How often each collector runs, in seconds. A page flags data as STALE when the newest row
    // is older than 2x this value.
    'cadence_seconds' => [
        'crypto'    => 4 * 3600,   // crypto long-term collector
        'stock'     => 24 * 3600,  // stocks & commodities collector (once per trading day)
        'commodity' => 24 * 3600,
        '15m' => 900, '1h' => 3600, '4h' => 4 * 3600, '1d' => 24 * 3600, '3d' => 3 * 24 * 3600,
    ],

    // Trade-setup alert scopes: which timeframes belong to each, and which pair must both show
    // SETUP for a max-priority alert (the framework's "Daily + 4H aligned = full size" rule).
    // Any other timeframe in the scope is shown as context and gets a lower-priority alert.
    'setup_scopes' => [
        'setup_ltf'   => ['timeframes' => ['4h', '1d', '3d'], 'max_pair' => ['1d', '4h']],
        'setup_swing' => ['timeframes' => ['15m', '1h'],      'max_pair' => ['15m', '1h']],
    ],

    // Mute an alert scope by setting it to false. Storage and pages are unaffected.
    'alerts_enabled' => [
        'accumulation' => true,
        'fng_extreme'  => true,
        'setup_ltf'    => true,
        'setup_swing'  => true,
    ],

    'fng_extreme_threshold' => 10,
    'chart_points' => 48,   // swing strips and overview sparklines (candles / days)
    // Score-trend chart on the Investing asset page: selectable window in days ('all' = everything stored).
    'score_chart' => ['default' => '180', 'options' => ['48', '90', '180', '365', '730', 'all']],
];
