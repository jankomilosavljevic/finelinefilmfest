<?php
/*
 * Postavljanje šifre za admin (samo iz komandne linije):
 *   php urednik-7aa46a/set-password.php "nova šifra"
 * Pravi _private/config.php. Taj fajl se ne šalje na GitHub,
 * nego se jednom ručno otpremi na server (Hostinger → File Manager).
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/lib.php';

$pw = $argv[1] ?? '';
if (strlen($pw) < 10) { fwrite(STDERR, "Šifra mora imati bar 10 znakova.\n"); exit(1); }
save_password($pw);
echo "Šifra je postavljena: " . realpath(CONFIG_FILE) . "\n";
