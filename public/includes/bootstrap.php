<?php
declare(strict_types=1);

date_default_timezone_set('UTC');

$__local = __DIR__ . '/../config.local.php';
if (!is_file($__local)) {
    http_response_code(500);
    header('Content-Type: text/plain');
    exit("config.local.php is missing. Copy config.local.php.example next to it and fill in the values.\n");
}
$CONFIG = array_replace_recursive(require __DIR__ . '/defaults.php', require $__local);

function cfg(string $key, $default = null)
{
    global $CONFIG;
    return $CONFIG[$key] ?? $default;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    $d = cfg('db');
    $dsn = sprintf('mysql:host=%s;%sdbname=%s;charset=%s', $d['host'], isset($d['port']) ? 'port=' . (int)$d['port'] . ';' : '', $d['name'], $d['charset'] ?? 'utf8mb4');
    $pdo = new PDO($dsn, $d['user'], $d['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

function h($s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

function json_out($data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

// Accepts ISO-8601 ("2026-09-19T04:00:00Z"), epoch milliseconds, or epoch seconds; returns UTC "Y-m-d H:i:s".
function to_utc_datetime($v): ?string
{
    if ($v === null || $v === '') {
        return null;
    }
    if (is_numeric($v)) {
        $n = (float)$v;
        $sec = $n > 1e11 ? (int)floor($n / 1000) : (int)$n;
        return gmdate('Y-m-d H:i:s', $sec);
    }
    $ts = strtotime((string)$v);
    return $ts === false ? null : gmdate('Y-m-d H:i:s', $ts);
}
