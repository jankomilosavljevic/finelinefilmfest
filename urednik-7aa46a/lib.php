<?php
/* Fine Line admin — zajedničke funkcije (sesija, šifra, JSON, slike) */
declare(strict_types=1);

date_default_timezone_set('Europe/Belgrade');

const SITE_ROOT   = __DIR__ . '/..';
const PRIVATE_DIR = __DIR__ . '/_private';
const CONFIG_FILE = PRIVATE_DIR . '/config.php';
const LOCK_FILE   = PRIVATE_DIR . '/attempts.json';
const BACKUP_DIR  = SITE_ROOT . '/data/_backup';
const DATA_FILES  = [
    'site'      => SITE_ROOT . '/data/site.json',
    'selection' => SITE_ROOT . '/data/selection.json',
];

const MAX_ATTEMPTS = 5;          // pogrešnih šifri pre zaključavanja
const LOCK_SECONDS = 15 * 60;    // koliko traje zaključavanje
const IDLE_SECONDS = 8 * 3600;   // automatska odjava posle neaktivnosti
const KEEP_BACKUPS = 30;         // rezervnih kopija po fajlu
const MAX_UPLOAD   = 20 * 1024 * 1024;
const MAX_IMAGE_W  = 2000;       // veće slike se smanjuju (ako server ima GD)

function send_security_headers(): void
{
    header('X-Robots-Tag: noindex, nofollow');
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('Cache-Control: no-store');
}

function start_session(): void
{
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    session_name('fl_admin');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => rtrim(dirname($_SERVER['SCRIPT_NAME']), '/\\') . '/',
        'secure'   => $https,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}

/* ---------- Šifra ---------- */

function config(): ?array
{
    if (!is_file(CONFIG_FILE)) return null;
    $c = require CONFIG_FILE;
    return (is_array($c) && !empty($c['password_hash'])) ? $c : null;
}

function save_password(string $password): void
{
    if (!is_dir(PRIVATE_DIR)) mkdir(PRIVATE_DIR, 0755, true);
    $hash = password_hash($password, PASSWORD_DEFAULT);
    write_atomic(CONFIG_FILE, "<?php\nreturn " . var_export(['password_hash' => $hash], true) . ";\n");
}

function is_logged_in(): bool
{
    if (empty($_SESSION['auth'])) return false;
    if (($_SESSION['seen'] ?? 0) < time() - IDLE_SECONDS) {
        $_SESSION = [];
        return false;
    }
    $_SESSION['seen'] = time();
    return true;
}

function login(string $password): bool
{
    $cfg = config();
    if (!$cfg || !password_verify($password, $cfg['password_hash'])) return false;
    session_regenerate_id(true);
    $_SESSION['auth'] = true;
    $_SESSION['seen'] = time();
    return true;
}

function logout(): void
{
    $_SESSION = [];
    session_destroy();
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}

function csrf_ok(?string $token): bool
{
    return is_string($token) && !empty($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $token);
}

/* ---------- Zaštita od pogađanja šifre (po IP adresi) ---------- */

function attempts_load(): array
{
    $d = is_file(LOCK_FILE) ? json_decode((string) file_get_contents(LOCK_FILE), true) : [];
    return is_array($d) ? $d : [];
}

function client_key(): string
{
    return hash('sha256', $_SERVER['REMOTE_ADDR'] ?? '');
}

/** Koliko sekundi je još zaključano (0 = nije). */
function locked_for(): int
{
    $a = attempts_load()[client_key()] ?? null;
    return ($a && ($a['until'] ?? 0) > time()) ? $a['until'] - time() : 0;
}

function register_attempt(bool $success): void
{
    $all = attempts_load();
    $key = client_key();
    // počisti stare zapise
    foreach ($all as $k => $a) if (($a['last'] ?? 0) < time() - 86400) unset($all[$k]);
    if ($success) {
        unset($all[$key]);
    } else {
        $a = $all[$key] ?? ['count' => 0];
        $a['count'] = ($a['count'] ?? 0) + 1;
        $a['last'] = time();
        if ($a['count'] >= MAX_ATTEMPTS) { $a['until'] = time() + LOCK_SECONDS; $a['count'] = 0; }
        $all[$key] = $a;
    }
    if (!is_dir(PRIVATE_DIR)) mkdir(PRIVATE_DIR, 0755, true);
    write_atomic(LOCK_FILE, json_encode($all));
}

/* ---------- Fajlovi ---------- */

function write_atomic(string $file, string $content): void
{
    $tmp = $file . '.tmp-' . bin2hex(random_bytes(4));
    if (file_put_contents($tmp, $content, LOCK_EX) === false) throw new RuntimeException('Ne mogu da upišem fajl.');
    if (!rename($tmp, $file)) { @unlink($tmp); throw new RuntimeException('Ne mogu da sačuvam fajl.'); }
}

function read_json(string $file): array
{
    $d = json_decode((string) @file_get_contents($file), true);
    return is_array($d) ? $d : [];
}

function backup(string $name, string $file): void
{
    if (!is_file($file)) return;
    if (!is_dir(BACKUP_DIR)) mkdir(BACKUP_DIR, 0755, true);
    copy($file, BACKUP_DIR . "/$name-" . date('Y-m-d_H-i-s') . '.json');
    $old = glob(BACKUP_DIR . "/$name-*.json") ?: [];
    rsort($old);
    foreach (array_slice($old, KEEP_BACKUPS) as $f) @unlink($f);
}

function write_json(string $name, array $data): void
{
    $file = DATA_FILES[$name];
    backup($name, $file);
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    write_atomic($file, $json . "\n");
}

/* ---------- Slike ---------- */

function slugify(string $s): string
{
    $s = strtr($s, ['š'=>'s','Š'=>'s','đ'=>'dj','Đ'=>'dj','č'=>'c','Č'=>'c','ć'=>'c','Ć'=>'c','ž'=>'z','Ž'=>'z']);
    $s = strtolower(preg_replace('/[^A-Za-z0-9]+/', '-', $s));
    return trim(substr($s, 0, 50), '-') ?: 'slika';
}

/**
 * Snima otpremljenu sliku u files/images/<folder> i vraća putanju
 * kakvu sajt koristi (npr. files/images/films/2025/naziv-a1b2c3.webp).
 */
function store_image(array $upload, string $folder): string
{
    $err = $upload['error'] ?? UPLOAD_ERR_NO_FILE;
    if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) throw new RuntimeException('Slika je prevelika za server.');
    if ($err !== UPLOAD_ERR_OK) throw new RuntimeException('Slika nije stigla do servera.');
    if ($upload['size'] > MAX_UPLOAD) throw new RuntimeException('Slika je prevelika (najviše 20 MB).');
    $info = @getimagesize($upload['tmp_name']);
    $types = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'];
    if (!$info || !isset($types[$info[2]])) throw new RuntimeException('Dozvoljene su samo JPG, PNG, WEBP i GIF slike.');

    $dir = SITE_ROOT . '/files/images/' . $folder;
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $base = slugify(pathinfo((string) $upload['name'], PATHINFO_FILENAME)) . '-' . bin2hex(random_bytes(3));

    // Ako server ume, pretvori u .webp i smanji – sajt se brže učitava
    if (function_exists('imagewebp') && $info[2] !== IMAGETYPE_GIF) {
        $src = @imagecreatefromstring((string) file_get_contents($upload['tmp_name']));
        if ($src) {
            $w = imagesx($src); $h = imagesy($src);
            if ($w > MAX_IMAGE_W) {
                $nh = (int) round($h * MAX_IMAGE_W / $w);
                $dst = imagecreatetruecolor(MAX_IMAGE_W, $nh);
                imagealphablending($dst, false);
                imagesavealpha($dst, true);
                imagecopyresampled($dst, $src, 0, 0, 0, 0, MAX_IMAGE_W, $nh, $w, $h);
                imagedestroy($src);
                $src = $dst;
            }
            imagepalettetotruecolor($src);
            imagesavealpha($src, true);
            $ok = imagewebp($src, "$dir/$base.webp", 82);
            imagedestroy($src);
            if ($ok) return "files/images/$folder/$base.webp";
        }
    }

    $name = "$base." . $types[$info[2]];
    if (!move_uploaded_file($upload['tmp_name'], "$dir/$name")) throw new RuntimeException('Ne mogu da sačuvam sliku.');
    return "files/images/$folder/$name";
}
