<?php
/* Fine Line admin — prijava i panel */
declare(strict_types=1);
require __DIR__ . '/lib.php';

send_security_headers();
header('Content-Type: text/html; charset=utf-8');
start_session();

$configured = config() !== null;
$error = '';

if ($configured && $_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['password'])) {
    if (!csrf_ok($_POST['csrf'] ?? null)) {
        $error = 'Stranica je bila otvorena predugo. Pokušaj ponovo.';
    } elseif ($wait = locked_for()) {
        $error = 'Previše pogrešnih pokušaja. Pokušaj ponovo za ' . ceil($wait / 60) . ' min.';
    } elseif (login((string) $_POST['password'])) {
        register_attempt(true);
        header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'), true, 303);
        exit;
    } else {
        register_attempt(false);
        usleep(600000);
        $error = 'Pogrešna šifra.';
    }
}

$logged = $configured && is_logged_in();
$csrf = csrf_token();
?>
<!DOCTYPE html>
<html lang="sr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Fine Line · Admin</title>
    <link rel="icon" href="../files/images/logo/logo.webp" type="image/webp">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="admin.css?v=1">
</head>
<body>

<?php if (!$configured): ?>
<main class="gate">
    <img class="gate-logo" src="../files/images/logo/logo.webp" alt="Fine Line Film Fest">
    <h1>Admin još nije podešen</h1>
    <p>Na serveru nedostaje fajl sa šifrom:<br><code>_private/config.php</code></p>
</main>

<?php elseif (!$logged): ?>
<main class="gate">
    <img class="gate-logo" src="../files/images/logo/logo.webp" alt="Fine Line Film Fest">
    <form method="post" class="gate-form" autocomplete="off">
        <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrf) ?>">
        <label for="pw">Šifra</label>
        <input id="pw" type="password" name="password" required autofocus autocomplete="current-password">
        <?php if ($error): ?><p class="gate-error"><?= htmlspecialchars($error) ?></p><?php endif; ?>
        <button type="submit" class="btn btn-primary">Uđi</button>
    </form>
</main>

<?php else: ?>
<div class="app" data-csrf="<?= htmlspecialchars($csrf) ?>">
    <aside class="side">
        <a class="side-logo" href="../" target="_blank" rel="noopener" title="Otvori sajt">
            <img src="../files/images/logo/logo.webp" alt="Fine Line Film Fest">
        </a>
        <nav class="side-nav" data-nav>
            <button type="button" data-view="selection">Selekcija po godinama</button>
            <button type="button" data-view="event">Početna: datum i prijave</button>
            <button type="button" data-view="contact">Kontakt i mreže</button>
            <button type="button" data-view="festival">O festivalu</button>
            <button type="button" data-view="about">O nama i tim</button>
            <button type="button" data-view="settings">Šifra</button>
        </nav>
        <div class="side-foot">
            <a href="../" target="_blank" rel="noopener">Pogledaj sajt ↗</a>
            <button type="button" data-logout>Odjavi se</button>
        </div>
    </aside>

    <div class="main">
        <header class="bar">
            <p class="bar-status" data-status>Učitavam…</p>
            <button type="button" class="btn btn-primary" data-save disabled>Sačuvaj izmene</button>
        </header>
        <div class="view" data-view-root></div>
    </div>
</div>
<div class="toast" data-toast hidden></div>
<script src="admin.js?v=1"></script>
<?php endif; ?>

</body>
</html>
