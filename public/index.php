<?php
$path = (string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$base = rtrim((string)preg_replace('#/index\.php$#', '', $path), '/');
header('Location: ' . $base . '/investing/', true, 302);
exit;
