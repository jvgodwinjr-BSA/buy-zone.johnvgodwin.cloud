<?php
declare(strict_types=1);

// Page-view gate, included at the top of every page. Intentionally a no-op today.
// When the site needs a password, implement it here (session login or HTTP Basic) and every
// page picks it up. The n8n API endpoints use api_auth.php (bearer token) and are unaffected.
function require_page_auth(): void
{
}
