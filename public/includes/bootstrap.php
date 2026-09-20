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

// Uncaught exceptions become a short plain-text (or JSON, under /api/) 500 with a hint; the real
// message goes to the server error log, never to the browser.
set_exception_handler(function (Throwable $e): void {
    error_log('[buyzone] ' . get_class($e) . ': ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    $hint = $e instanceof PDOException
        ? 'Database error. Check the db settings in config.local.php and that db/schema.sql and db/seed.sql were imported. Details are in the server error log.'
        : 'Server error. Details are in the server error log.';
    http_response_code(500);
    if (str_contains((string)($_SERVER['SCRIPT_NAME'] ?? ''), '/api/')) {
        header('Content-Type: application/json');
        echo json_encode(['error' => $hint]);
    } else {
        header('Content-Type: text/plain');
        echo $hint, "\n";
    }
});

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
