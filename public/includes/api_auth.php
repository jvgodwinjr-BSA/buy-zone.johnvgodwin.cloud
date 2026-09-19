<?php
declare(strict_types=1);

// Bearer-token check for /api/*. Accepts "Authorization: Bearer <token>" or, because some shared
// hosts strip the Authorization header before PHP sees it, "X-Api-Token: <token>".
function require_api_token(): void
{
    $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($hdr === '' && function_exists('apache_request_headers')) {
        $all = array_change_key_case(apache_request_headers(), CASE_LOWER);
        $hdr = $all['authorization'] ?? '';
    }
    $token = '';
    if (preg_match('/^Bearer\s+(.+)$/i', trim((string)$hdr), $m)) {
        $token = trim($m[1]);
    } elseif (!empty($_SERVER['HTTP_X_API_TOKEN'])) {
        $token = trim((string)$_SERVER['HTTP_X_API_TOKEN']);
    }
    $expected = (string)cfg('api_token', '');
    if ($expected === '' || $expected === 'CHANGE_ME_64_HEX_CHARS' || $token === '' || !hash_equals($expected, $token)) {
        json_out(['error' => 'unauthorized'], 401);
    }
}
