/* Fine Line admin — uređivanje data/site.json i data/selection.json */
(() => {
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const app = $('.app');
    const root = $('[data-view-root]');
    const saveBtn = $('[data-save]');
    const statusEl = $('[data-status]');
    const BASE = '../';                       // slike su putanje od korena sajta

    let csrf = app.dataset.csrf;
    let data = null;                          // { site, selection }
    let dirty = false;
    let view = 'selection';
    let yearIdx = 0;
    let openFilm = -1;

    /* ---------- Pomoćne ---------- */

    const h = (tag, attrs = {}, ...kids) => {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false) continue;
            if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else if (k === 'class') el.className = v;
            else el.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
        return el;
    };

    const get = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
    const set = (obj, path, val) => {
        let o = obj;
        path.slice(0, -1).forEach((k, i) => {
            if (o[k] == null || typeof o[k] !== 'object') o[k] = typeof path[i + 1] === 'number' ? [] : {};
            o = o[k];
        });
        o[path[path.length - 1]] = val;
    };

    const markDirty = () => {
        dirty = true;
        saveBtn.disabled = false;
        statusEl.textContent = 'Imaš nesačuvane izmene';
        statusEl.className = 'bar-status is-dirty';
    };

    const toast = (msg, bad = false) => {
        const t = $('[data-toast]');
        t.textContent = msg;
        t.classList.toggle('is-bad', bad);
        t.hidden = false;
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 2500);
    };

    const api = async (action, opts = {}) => {
        const res = await fetch(`api.php?action=${action}`, {
            method: opts.body ? 'POST' : 'GET',
            headers: { 'X-CSRF': csrf, ...(opts.json ? { 'Content-Type': 'application/json' } : {}) },
            body: opts.body,
            credentials: 'same-origin',
        });
        let out = {};
        try { out = await res.json(); } catch (e) {}
        if (res.status === 401) { dirty = false; location.reload(); }
        if (!res.ok) throw new Error(out.error || 'Greška na serveru.');
        return out;
    };

    /* ---------- Polja ---------- */

    // Jedno polje (tekst, broj, link, dugačak tekst)
    const field = (label, path, { type = 'text', long = false, hint, placeholder, onChange } = {}) => {
        const val = get(data, path);
        const input = long
            ? h('textarea', { rows: long === true ? 4 : long, placeholder })
            : h('input', { type, placeholder, inputmode: type === 'number' ? 'numeric' : null });
        input.value = val ?? '';
        input.addEventListener('input', () => {
            const v = type === 'number' ? (input.value === '' ? '' : Number(input.value)) : input.value;
            set(data, path, v);
            markDirty();
            if (onChange) onChange(v);
        });
        return h('label', { class: 'field' },
            h('span', { class: 'field-label' }, label),
            input,
            hint && h('span', { class: 'field-hint' }, hint));
    };

    // Isto polje na srpskom i engleskom, jedno pored drugog
    const bi = (label, path, { hint, ...opts } = {}) => {
        if (!get(data, path) || typeof get(data, path) !== 'object') set(data, path, { sr: '', en: '' });
        return h('div', { class: 'bi' },
            h('p', { class: 'field-label' }, label),
            h('div', { class: 'bi-row' },
                field('Srpski', [...path, 'sr'], opts),
                field('English', [...path, 'en'], opts)),
            hint && h('p', { class: 'field-hint' }, hint));
    };

    // Slika: pregled + dugme za biranje fajla
    const image = (label, path, target, hint) => {
        const current = get(data, path);
        const preview = h('div', { class: 'img-preview' },
            current ? h('img', { src: BASE + current, alt: '' }) : h('span', {}, 'Nema slike'));
        const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
        const pick = h('button', { type: 'button', class: 'btn', onclick: () => file.click() }, current ? 'Zameni sliku' : 'Izaberi sliku');
        const remove = current && h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { set(data, path, ''); markDirty(); render(); } }, 'Ukloni');
        file.addEventListener('change', async () => {
            if (!file.files[0]) return;
            const fd = new FormData();
            fd.append('file', file.files[0]);
            fd.append('target', typeof target === 'function' ? target() : target);
            pick.disabled = true;
            pick.textContent = 'Otpremam…';
            try {
                const out = await api('upload', { body: fd });
                set(data, path, out.path);
                markDirty();
                render();
            } catch (e) {
                toast(e.message, true);
                pick.disabled = false;
                pick.textContent = current ? 'Zameni sliku' : 'Izaberi sliku';
            }
        });
        return h('div', { class: 'field' },
            h('span', { class: 'field-label' }, label),
            h('div', { class: 'img-field' }, preview, h('div', { class: 'img-actions' }, pick, remove, file)),
            hint && h('span', { class: 'field-hint' }, hint));
    };

    // Dugme za brisanje koje traži potvrdu (bez iskačućih prozora)
    const confirmDelete = (text, onYes) => {
        const wrap = h('span', { class: 'confirm' });
        const idle = () => {
            wrap.replaceChildren(h('button', { type: 'button', class: 'btn btn-ghost btn-danger', onclick: ask }, text));
        };
        const ask = () => {
            wrap.replaceChildren(
                h('span', { class: 'confirm-q' }, 'Sigurno?'),
                h('button', { type: 'button', class: 'btn btn-danger-solid', onclick: onYes }, 'Da, obriši'),
                h('button', { type: 'button', class: 'btn btn-ghost', onclick: idle }, 'Ne'));
        };
        idle();
        return wrap;
    };

    const move = (arr, i, d) => {
        const j = i + d;
        if (j < 0 || j >= arr.length) return false;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        markDirty();
        return true;
    };

    // Lista stavki (stubovi, kategorije, tim) sa dodaj / gore / dole / obriši
    const list = (path, { itemTitle, itemBody, addLabel, blank }) => {
        const arr = get(data, path) || (set(data, path, []), get(data, path));
        return h('div', { class: 'list' },
            arr.map((item, i) => h('div', { class: 'card' },
                h('div', { class: 'card-head' },
                    h('span', { class: 'card-num' }, String(i + 1).padStart(2, '0')),
                    h('span', { class: 'card-title' }, itemTitle(item) || 'Bez naziva'),
                    h('span', { class: 'card-tools' },
                        h('button', { type: 'button', class: 'btn btn-icon', title: 'Pomeri gore', disabled: i === 0, onclick: () => move(arr, i, -1) && render() }, '↑'),
                        h('button', { type: 'button', class: 'btn btn-icon', title: 'Pomeri dole', disabled: i === arr.length - 1, onclick: () => move(arr, i, 1) && render() }, '↓'),
                        confirmDelete('Obriši', () => { arr.splice(i, 1); markDirty(); render(); }))),
                h('div', { class: 'card-body' }, itemBody([...path, i])))),
            h('button', { type: 'button', class: 'btn btn-add', onclick: () => { arr.push(blank()); markDirty(); render(); } }, '+ ' + addLabel));
    };

    // 1 film, 2 filma, 5 filmova, 21 film…
    const filmsLabel = n => {
        const d = n % 10, dd = n % 100;
        return `${n} ${d === 1 && dd !== 11 ? 'film' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'filma' : 'filmova'}`;
    };

    const section = (title, ...kids) => h('section', { class: 'block' }, h('h2', {}, title), ...kids);

    /* ---------- Ekrani ---------- */

    const views = {};

    views.selection = () => {
        const years = data.selection.years;
        if (yearIdx >= years.length) yearIdx = Math.max(0, years.length - 1);

        // Dodavanje nove godine
        const newYear = h('input', { type: 'number', min: 1990, max: 2200, placeholder: String(new Date().getFullYear()), class: 'year-input' });
        const addYear = () => {
            const y = Number(newYear.value || newYear.placeholder);
            if (!Number.isInteger(y) || y < 1990 || y > 2200) return toast('Upiši godinu, npr. 2026.', true);
            if (years.some(x => Number(x.year) === y)) return toast(`Godina ${y} već postoji.`, true);
            years.push({ year: y, films: [] });
            years.sort((a, b) => b.year - a.year);
            yearIdx = years.findIndex(x => x.year === y);
            openFilm = -1;
            markDirty();
            render();
        };
        newYear.addEventListener('keydown', e => { if (e.key === 'Enter') addYear(); });

        const tabs = h('div', { class: 'years' },
            years.map((y, i) => h('button', {
                type: 'button', class: 'year' + (i === yearIdx ? ' is-active' : ''),
                onclick: () => { yearIdx = i; openFilm = -1; render(); },
            }, String(y.year), h('small', {}, filmsLabel(y.films.length)))),
            h('div', { class: 'year-new' }, newYear, h('button', { type: 'button', class: 'btn btn-primary', onclick: addYear }, '+ Nova godina')));

        const intro = h('div', { class: 'view-head' },
            h('h1', {}, 'Selekcija po godinama'),
            h('p', { class: 'lead' }, 'Svaka godina festivala ima svoju listu filmova. Na sajtu se najnovija godina prikazuje prva.'));

        if (!years.length) return [intro, tabs, h('p', { class: 'empty' }, 'Još nema nijedne godine. Dodaj prvu gore desno.')];

        const y = years[yearIdx];
        const films = y.films;
        const yearPath = ['selection', 'years', yearIdx];

        const filmCard = (f, i) => {
            const open = i === openFilm;
            const p = [...yearPath, 'films', i];
            const thumb = f.image ? h('img', { src: BASE + f.image, alt: '' }) : h('span', {}, '—');
            return h('div', { class: 'card film' + (open ? ' is-open' : '') },
                h('div', { class: 'card-head' },
                    h('button', { type: 'button', class: 'film-toggle', onclick: () => { openFilm = open ? -1 : i; render(); } },
                        h('span', { class: 'card-num' }, String(i + 1).padStart(2, '0')),
                        h('span', { class: 'film-thumb' }, thumb),
                        h('span', { class: 'film-text' },
                            h('strong', {}, f.title || 'Novi film'),
                            h('span', {}, f.director || 'Režija nije upisana'))),
                    h('span', { class: 'card-tools' },
                        h('button', { type: 'button', class: 'btn btn-icon', title: 'Pomeri gore', disabled: i === 0, onclick: () => { if (move(films, i, -1)) { openFilm = -1; render(); } } }, '↑'),
                        h('button', { type: 'button', class: 'btn btn-icon', title: 'Pomeri dole', disabled: i === films.length - 1, onclick: () => { if (move(films, i, 1)) { openFilm = -1; render(); } } }, '↓'),
                        h('button', { type: 'button', class: 'btn', onclick: () => { openFilm = open ? -1 : i; render(); } }, open ? 'Zatvori' : 'Izmeni'))),
                open && h('div', { class: 'card-body' },
                    h('div', { class: 'grid-2' },
                        field('Naziv filma', [...p, 'title']),
                        field('Režija', [...p, 'director'])),
                    bi('Zemlja', [...p, 'country']),
                    h('div', { class: 'grid-2' },
                        field('Godina filma', [...p, 'year'], { type: 'number' }),
                        field('Trajanje (u minutima)', [...p, 'duration'], { type: 'number' })),
                    bi('Sinopsis', [...p, 'synopsis'], { long: 5 }),
                    image('Fotografija iz filma', [...p, 'image'], () => `film:${y.year}`, 'Najbolje položena (šira nego viša) fotografija.'),
                    field('Trejler', [...p, 'trailer'], { type: 'url', placeholder: 'https://youtube.com/watch?v=…', hint: 'Link sa YouTube-a ili Vimeo-a. Ako je prazno, dugme za trejler se ne prikazuje.' }),
                    h('div', { class: 'card-foot' },
                        confirmDelete('Obriši ovaj film', () => { films.splice(i, 1); openFilm = -1; markDirty(); render(); }))));
        };

        const yearInput = h('input', { type: 'number', class: 'year-input', value: y.year });
        yearInput.addEventListener('change', () => {
            const v = Number(yearInput.value);
            if (!Number.isInteger(v) || v < 1990 || v > 2200 || years.some((x, i) => i !== yearIdx && Number(x.year) === v)) {
                yearInput.value = y.year;
                return toast('Ta godina nije ispravna ili već postoji.', true);
            }
            y.year = v;
            years.sort((a, b) => b.year - a.year);
            yearIdx = years.indexOf(y);
            markDirty();
            render();
        });

        return [intro, tabs,
            h('section', { class: 'block' },
                h('div', { class: 'year-head' },
                    h('h2', {}, `Festival ${y.year}`),
                    h('div', { class: 'year-tools' },
                        h('label', { class: 'inline' }, 'Promeni godinu ', yearInput),
                        confirmDelete(`Obriši ${y.year}. godinu`, () => { years.splice(yearIdx, 1); yearIdx = 0; markDirty(); render(); }))),
                films.length ? h('div', { class: 'list' }, films.map(filmCard)) : h('p', { class: 'empty' }, 'Ova godina još nema filmova.'),
                h('button', {
                    type: 'button', class: 'btn btn-add',
                    onclick: () => {
                        films.push({ title: '', director: '', country: { sr: '', en: '' }, year: y.year, duration: '', synopsis: { sr: '', en: '' }, image: '', trailer: '' });
                        openFilm = films.length - 1;
                        markDirty();
                        render();
                    },
                }, `+ Dodaj film u ${y.year}`))];
    };

    views.event = () => [
        h('div', { class: 'view-head' },
            h('h1', {}, 'Početna: datum i prijave'),
            h('p', { class: 'lead' }, 'Ono što se vidi na prvom ekranu sajta, ispod slogana.')),
        section('Datum festivala',
            bi('Datum', ['site', 'event', 'dates'], { placeholder: 'npr. 12–14. jun 2026', hint: 'Piši tačno kako želiš da piše na sajtu.' })),
        section('Mesto održavanja',
            field('Naziv mesta', ['site', 'event', 'venue', 'name'], { placeholder: 'npr. Dom omladine Beograda' }),
            image('Logo mesta', ['site', 'event', 'venue', 'logo'], 'venue', 'Najbolje beli logo na providnoj pozadini (PNG ili WEBP).')),
        section('Prijave filmova',
            field('Link za prijave', ['site', 'event', 'submit_url'], { type: 'url', placeholder: 'https://filmfreeway.com/…', hint: 'Kuda vodi dugme „Pošalji prijavu“.' })),
        section('Slogan',
            bi('Slogan', ['site', 'tagline'])),
    ];

    views.contact = () => [
        h('div', { class: 'view-head' }, h('h1', {}, 'Kontakt i mreže')),
        section('Kontakt',
            h('div', { class: 'grid-2' },
                field('Email', ['site', 'contact', 'email'], { type: 'email' }),
                field('Telefon', ['site', 'contact', 'phone'], { type: 'tel' })),
            bi('Adresa', ['site', 'contact', 'address'])),
        section('Društvene mreže',
            field('Instagram', ['site', 'social', 'instagram'], { type: 'url', placeholder: 'https://www.instagram.com/…' }),
            field('Facebook', ['site', 'social', 'facebook'], { type: 'url', placeholder: 'https://www.facebook.com/…' })),
    ];

    views.festival = () => [
        h('div', { class: 'view-head' }, h('h1', {}, 'O festivalu')),
        section('Tekst o festivalu',
            bi('Tekst', ['site', 'festival', 'intro'], { long: 12, hint: 'Prazan red = novi pasus.' })),
        section('Stubovi festivala',
            list(['site', 'festival', 'pillars'], {
                itemTitle: it => it.title && (it.title.sr || it.title.en),
                itemBody: p => [bi('Naslov', [...p, 'title']), bi('Tekst', [...p, 'text'], { long: 3 })],
                addLabel: 'Dodaj stub',
                blank: () => ({ title: { sr: '', en: '' }, text: { sr: '', en: '' } }),
            })),
        section('Kategorije',
            list(['site', 'festival', 'categories'], {
                itemTitle: it => it.sr || it.en,
                itemBody: p => bi('Naziv kategorije', p),
                addLabel: 'Dodaj kategoriju',
                blank: () => ({ sr: '', en: '' }),
            })),
    ];

    views.about = () => [
        h('div', { class: 'view-head' }, h('h1', {}, 'O nama i tim')),
        section('Tekst o nama',
            bi('Tekst', ['site', 'about', 'intro'], { long: 6, hint: 'Prazan red = novi pasus.' })),
        section('Tim',
            list(['site', 'team'], {
                itemTitle: it => it.name,
                itemBody: p => [
                    field('Ime i prezime', [...p, 'name']),
                    bi('Uloga', [...p, 'role']),
                    image('Fotografija', [...p, 'photo'], 'team', 'Najbolje uspravna fotografija.'),
                ],
                addLabel: 'Dodaj člana tima',
                blank: () => ({ name: '', role: { sr: '', en: '' }, photo: '' }),
            })),
    ];

    views.settings = () => {
        const cur = h('input', { type: 'password', autocomplete: 'current-password' });
        const nw = h('input', { type: 'password', autocomplete: 'new-password' });
        const rep = h('input', { type: 'password', autocomplete: 'new-password' });
        const change = async () => {
            if (nw.value.length < 10) return toast('Nova šifra mora imati bar 10 znakova.', true);
            if (nw.value !== rep.value) return toast('Nove šifre se ne poklapaju.', true);
            try {
                await api('password', { json: true, body: JSON.stringify({ current: cur.value, new: nw.value }) });
                cur.value = nw.value = rep.value = '';
                toast('Šifra je promenjena.');
            } catch (e) { toast(e.message, true); }
        };
        return [
            h('div', { class: 'view-head' }, h('h1', {}, 'Promena šifre')),
            section('Nova šifra',
                h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Trenutna šifra'), cur),
                h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Nova šifra'), nw, h('span', { class: 'field-hint' }, 'Bar 10 znakova.')),
                h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Ponovi novu šifru'), rep),
                h('button', { type: 'button', class: 'btn btn-primary', onclick: change }, 'Promeni šifru')),
        ];
    };

    /* ---------- Prikaz ---------- */

    function render() {
        const y = scrollY;
        root.replaceChildren(...[views[view]()].flat());
        $$('[data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
        scrollTo(0, y);
    }

    $$('[data-view]').forEach(b => b.addEventListener('click', () => {
        view = b.dataset.view;
        openFilm = -1;
        render();
        scrollTo(0, 0);
    }));

    /* ---------- Čuvanje ---------- */

    const save = async () => {
        if (!dirty || saveBtn.disabled) return;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Čuvam…';
        try {
            const out = await api('save', { json: true, body: JSON.stringify(data) });
            data.selection = out.selection;
            dirty = false;
            statusEl.textContent = 'Sve je sačuvano · izmene su odmah na sajtu';
            statusEl.className = 'bar-status is-saved';
            toast('Sačuvano.');
            render();
        } catch (e) {
            saveBtn.disabled = false;
            toast(e.message, true);
        }
        saveBtn.textContent = 'Sačuvaj izmene';
    };

    saveBtn.addEventListener('click', save);
    addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    });
    addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    $('[data-logout]').addEventListener('click', async () => {
        if (dirty) return toast('Prvo sačuvaj izmene (ili osveži stranicu da ih odbaciš).', true);
        try { await api('logout', { body: '1' }); } catch (e) {}
        location.reload();
    });

    /* ---------- Start ---------- */

    api('load').then(out => {
        csrf = out.csrf;
        data = { site: out.site || {}, selection: out.selection || {} };
        if (!Array.isArray(data.selection.years)) data.selection.years = [];
        statusEl.textContent = 'Sve je sačuvano';
        statusEl.className = 'bar-status is-saved';
        render();
        // polja koja su sama napravljena (npr. prazan {sr,en}) ne računaju se kao izmena
        dirty = false;
        saveBtn.disabled = true;
    }).catch(e => { statusEl.textContent = e.message; });
})();
