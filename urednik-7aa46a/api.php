<?php
/* Fine Line admin — API koje čita i čuva data/*.json i prima slike */
declare(strict_types=1);
require __DIR__ . '/lib.php';

send_security_headers();
header('Content-Type: application/json; charset=utf-8');
start_session();

function reply(array $data, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (!config() || !is_logged_in()) reply(['error' => 'Sesija je istekla. Osveži stranicu i prijavi se ponovo.'], 401);

$action = $_GET['action'] ?? '';

if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'load') {
    reply([
        'site'      => read_json(DATA_FILES['site']),
        'selection' => read_json(DATA_FILES['selection']),
        'csrf'      => csrf_token(),
    ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') reply(['error' => 'Nepoznat zahtev.'], 400);
if (!csrf_ok($_SERVER['HTTP_X_CSRF'] ?? null)) reply(['error' => 'Sigurnosni token nije ispravan. Osveži stranicu.'], 403);

try {
    switch ($action) {
        case 'save':
            $in = json_decode((string) file_get_contents('php://input'), true);
            $site = $in['site'] ?? null;
            $sel  = $in['selection'] ?? null;
            if (!is_array($site) || !is_array($sel) || !isset($sel['years']) || !is_array($sel['years'])) {
                reply(['error' => 'Podaci nisu ispravni, ništa nije sačuvano.'], 422);
            }
            $seen = [];
            foreach ($sel['years'] as $i => $y) {
                $year = (int) ($y['year'] ?? 0);
                if ($year < 1900 || $year > 2200) reply(['error' => 'Godina festivala nije ispravna.'], 422);
                if (isset($seen[$year])) reply(['error' => "Godina $year postoji dva puta."], 422);
                $seen[$year] = true;
                $sel['years'][$i]['year'] = $year;
                $sel['years'][$i]['films'] = array_values(is_array($y['films'] ?? null) ? $y['films'] : []);
            }
            // najnovija godina uvek prva (sajt je prikazuje podrazumevano)
            usort($sel['years'], fn($a, $b) => $b['year'] <=> $a['year']);
            write_json('site', $site);
            write_json('selection', $sel);
            reply(['ok' => true, 'selection' => $sel]);

        case 'upload':
            if (empty($_FILES) && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) reply(['error' => 'Slika je prevelika za server.'], 413);
            $target = (string) ($_POST['target'] ?? '');
            if (preg_match('/^film:(\d{4})$/', $target, $m)) $folder = 'films/' . $m[1];
            elseif ($target === 'venue') $folder = 'venues';
            elseif ($target === 'team')  $folder = 'team';
            else reply(['error' => 'Nepoznato mesto za sliku.'], 400);
            reply(['ok' => true, 'path' => store_image($_FILES['file'] ?? [], $folder)]);

        case 'password':
            $in = json_decode((string) file_get_contents('php://input'), true) ?: [];
            $cfg = config();
            if (!password_verify((string) ($in['current'] ?? ''), $cfg['password_hash'])) reply(['error' => 'Trenutna šifra nije tačna.'], 422);
            $new = (string) ($in['new'] ?? '');
            if (preg_match_all("/./su", $new) < 10) reply(['error' => 'Nova šifra mora imati bar 10 znakova.'], 422);
            save_password($new);
            reply(['ok' => true]);

        case 'logout':
            logout();
            reply(['ok' => true]);
    }
} catch (Throwable $e) {
    reply(['error' => $e->getMessage()], 500);
}

reply(['error' => 'Nepoznat zahtev.'], 400);
