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
    $cookie = [
        'expires'  => 0,
        // bez kose crte na kraju, da važi i za adresu /urednik-… i za /urednik-…/
        'path'     => rtrim(dirname($_SERVER['SCRIPT_NAME']), '/\\'),
        'secure'   => $https,
        'httponly' => true,
        'samesite' => 'Strict',
    ];
    $params = $cookie;
    unset($params['expires']);
    session_name('fl_admin');
    session_set_cookie_params(['lifetime' => 0] + $params);
    session_start();

    // Stari kolačić (putanja sa „/“ na kraju) bi imao prednost nad novim i kvario prijavu:
    // briše se, a ista sesija se prepisuje na ispravnu putanju.
    if (isset($_COOKIE['fl_admin'])) {
        setcookie('fl_admin', '', ['expires' => 1, 'path' => $cookie['path'] . '/']);
        setcookie('fl_admin', session_id(), $cookie);
    }
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


/* ---------- Mediji (slike i video u files/) ---------- */

const MEDIA_DIR  = SITE_ROOT . '/files';
const IMAGE_EXT  = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const VIDEO_EXT  = ['mp4', 'webm', 'mov'];
const MAX_VIDEO  = 500 * 1024 * 1024;
// fajlovi u kojima se putanje mogu pojaviti mimo JSON-a (kod sajta)
const CODE_GLOBS = ['/*.html', '/assets/css/*.css', '/assets/js/*.js'];

function slugify(string $s): string
{
    $s = strtr($s, ['š'=>'s','Š'=>'s','đ'=>'dj','Đ'=>'dj','č'=>'c','Č'=>'c','ć'=>'c','Ć'=>'c','ž'=>'z','Ž'=>'z']);
    $s = strtolower(preg_replace('/[^A-Za-z0-9]+/', '-', $s));
    return trim(substr($s, 0, 50), '-') ?: 'fajl';
}

/** 'images/editions/2026' → apsolutna putanja; odbija sve van files/images i files/videos. */
function media_dir(string $folder): string
{
    if (!preg_match('~^(images|videos)(/[a-z0-9][a-z0-9_-]{0,40}){0,4}$~i', $folder)) {
        throw new RuntimeException('Neispravan naziv fascikle.');
    }
    $dir = MEDIA_DIR . '/' . $folder;
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    return $dir;
}

/** Ime fajla bez sudara: naziv.jpg, pa naziv-2.jpg… */
function free_name(string $dir, string $base, string $ext): string
{
    $name = "$base.$ext";
    for ($i = 2; file_exists("$dir/$name"); $i++) $name = "$base-$i.$ext";
    return $name;
}

function upload_error(array $upload, int $max, string $what): void
{
    $err = $upload['error'] ?? UPLOAD_ERR_NO_FILE;
    if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) throw new RuntimeException("$what je prevelik(a) za server.");
    if ($err !== UPLOAD_ERR_OK) throw new RuntimeException("$what nije stigao/la do servera.");
    if ($upload['size'] > $max) throw new RuntimeException("$what je prevelik(a) (najviše " . round($max / 1048576) . ' MB).');
}

function is_video_upload(array $upload): bool
{
    return in_array(strtolower(pathinfo((string) ($upload['name'] ?? ''), PATHINFO_EXTENSION)), VIDEO_EXT, true);
}

/**
 * Snima otpremljenu sliku u files/<folder> i vraća putanju kakvu sajt
 * koristi (npr. files/images/films/2025/naziv.webp).
 */
function store_image(array $upload, string $folder): string
{
    upload_error($upload, MAX_UPLOAD, 'Slika');
    $info = @getimagesize($upload['tmp_name']);
    $types = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'];
    if (!$info || !isset($types[$info[2]])) throw new RuntimeException('Dozvoljene su JPG, PNG, WEBP i GIF slike i MP4, WEBM i MOV video.');

    $dir = media_dir($folder);
    $base = slugify(pathinfo((string) $upload['name'], PATHINFO_FILENAME));

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
            $name = free_name($dir, $base, 'webp');
            $ok = imagewebp($src, "$dir/$name", 82);
            imagedestroy($src);
            if ($ok) return "files/$folder/$name";
        }
    }

    $name = free_name($dir, $base, $types[$info[2]]);
    if (!move_uploaded_file($upload['tmp_name'], "$dir/$name")) throw new RuntimeException('Ne mogu da sačuvam sliku.');
    return "files/$folder/$name";
}

function store_video(array $upload, string $folder): string
{
    upload_error($upload, MAX_VIDEO, 'Video');
    $ext = strtolower(pathinfo((string) $upload['name'], PATHINFO_EXTENSION));
    $head = (string) file_get_contents($upload['tmp_name'], false, null, 0, 12);
    $ok = ($ext === 'webm') ? str_starts_with($head, "\x1A\x45\xDF\xA3") : substr($head, 4, 4) === 'ftyp';
    if (!$ok) throw new RuntimeException('Ovo nije ispravan MP4, WEBM ili MOV video.');

    $dir = media_dir($folder);
    $name = free_name($dir, slugify(pathinfo((string) $upload['name'], PATHINFO_FILENAME)), $ext);
    if (!move_uploaded_file($upload['tmp_name'], "$dir/$name")) throw new RuntimeException('Ne mogu da sačuvam video.');
    return "files/$folder/$name";
}

/** Sve fascikle i fajlovi u files/images i files/videos. */
function media_list(): array
{
    $code = [];
    foreach (CODE_GLOBS as $g) foreach (glob(SITE_ROOT . $g) ?: [] as $f) $code[basename($f)] = (string) file_get_contents($f);

    $folders = [];
    $files = [];
    foreach (['images', 'videos'] as $root) {
        $dir = media_dir($root);
        $folders[] = $root;
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
        foreach ($it as $f) {
            if ($f->getFilename()[0] === '.') continue;
            $rel = $root . '/' . str_replace(DIRECTORY_SEPARATOR, '/', substr($f->getPathname(), strlen($dir) + 1));
            if ($f->isDir()) { $folders[] = $rel; continue; }
            $ext = strtolower($f->getExtension());
            $kind = in_array($ext, IMAGE_EXT, true) ? 'image' : (in_array($ext, VIDEO_EXT, true) ? 'video' : null);
            if (!$kind) continue;
            $path = 'files/' . $rel;
            $files[] = [
                'path'   => $path,
                'folder' => dirname($rel),
                'name'   => $f->getFilename(),
                'kind'   => $kind,
                'size'   => $f->getSize(),
                'mtime'  => $f->getMTime(),
                'code'   => array_keys(array_filter($code, fn($txt) => str_contains($txt, $path))),
            ];
        }
    }
    sort($folders);
    usort($files, fn($a, $b) => [$a['folder'], $a['name']] <=> [$b['folder'], $b['name']]);
    return ['folders' => $folders, 'files' => $files];
}

function media_delete(string $path): void
{
    $real = realpath(SITE_ROOT . '/' . $path);
    $base = realpath(MEDIA_DIR);
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if (!preg_match('~^files/(images|videos)/~', $path) || !$real || !$base
        || !str_starts_with($real, $base . DIRECTORY_SEPARATOR) || !is_file($real)
        || !in_array($ext, array_merge(IMAGE_EXT, VIDEO_EXT), true)) {
        throw new RuntimeException('Taj fajl ne postoji ili ne sme da se briše.');
    }
    if (!unlink($real)) throw new RuntimeException('Ne mogu da obrišem fajl.');
}
