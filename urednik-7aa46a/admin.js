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

    // Otpremanje jednog fajla, uz procenat (za velike video fajlove)
    const upload = (file, target, onProgress) => new Promise((resolve, reject) => {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('target', target);
        const x = new XMLHttpRequest();
        x.open('POST', 'api.php?action=upload');
        x.setRequestHeader('X-CSRF', csrf);
        x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
        x.onload = () => {
            let out = {};
            try { out = JSON.parse(x.responseText); } catch (e) {}
            if (x.status === 401) { dirty = false; location.reload(); }
            if (x.status < 300 && out.ok) resolve(out);
            else reject(new Error(out.error || (x.status === 413 ? 'Fajl je prevelik za server.' : 'Greška pri otpremanju.')));
        };
        x.onerror = () => reject(new Error('Veza je prekinuta.'));
        x.send(fd);
    });

    /* ---------- Mediji: spisak fajlova i gde se koriste ---------- */

    let media = null;                         // { folders, files } sa servera
    let mediaFolder = 'all';

    const loadMedia = async () => (media = await api('media', { body: '1' }));
    const fmtSize = b => b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

    // Sva mesta u podacima gde stoji tačno ova putanja
    const findRefs = path => {
        const refs = [];
        const walk = (o, p) => {
            if (o === path) refs.push(p);
            else if (o && typeof o === 'object') Object.keys(o).forEach(k => walk(o[k], [...p, Array.isArray(o) ? Number(k) : k]));
        };
        walk(data, []);
        return refs;
    };

    const refLabel = p => {
        const k = p.join('.');
        if (/^site\.hero\.images\.\d+$/.test(k)) return 'Karusel na početnoj';
        if (/^site\.gallery\.images\.\d+$/.test(k)) return 'Galerija';
        if (k === 'site.event.venue.logo') return 'Logo mesta';
        if (k === 'site.logo') return 'Logo festivala';
        if (/^site\.team\.\d+\.photo$/.test(k)) return `Tim · ${get(data, p.slice(0, -1)).name || 'bez imena'}`;
        if (/^selection\.years\.\d+\.films\.\d+\.image$/.test(k)) {
            return `Selekcija ${get(data, p.slice(0, 3)).year} · ${get(data, p.slice(0, -1)).title || 'film bez naziva'}`;
        }
        return k;
    };

    // Ukloni putanju svuda: iz lista se izbacuje, u poljima ostaje prazno
    const removeRefs = refs => {
        [...refs].reverse().forEach(p => {
            const parent = get(data, p.slice(0, -1));
            const key = p[p.length - 1];
            if (Array.isArray(parent)) parent.splice(key, 1);
            else parent[key] = '';
        });
    };

    // Prozor sa svim slikama iz Medija; klik bira sliku
    const openPicker = ({ title, isSelected, onPick, multiple }) => {
        const close = () => { overlay.remove(); removeEventListener('keydown', onKey); render(); };
        const onKey = e => { if (e.key === 'Escape') close(); };
        const body = h('div', { class: 'picker-body' }, h('p', { class: 'empty' }, 'Učitavam slike…'));
        const overlay = h('div', { class: 'picker', onclick: e => { if (e.target === overlay) close(); } },
            h('div', { class: 'picker-box' },
                h('div', { class: 'picker-head' },
                    h('h2', {}, title),
                    h('button', { type: 'button', class: 'btn btn-primary', onclick: close }, multiple ? 'Gotovo' : 'Zatvori')),
                body));
        addEventListener('keydown', onKey);
        document.body.append(overlay);

        const fill = () => {
            const images = media.files.filter(f => f.kind === 'image');
            if (!images.length) return body.replaceChildren(h('p', { class: 'empty' }, 'Nema slika. Otpremi ih u „Mediji“.'));
            const groups = [...new Set(images.map(f => f.folder))];
            body.replaceChildren(...groups.map(g => h('div', { class: 'media-group' },
                h('h3', {}, g),
                h('div', { class: 'picker-grid' }, images.filter(f => f.folder === g).map(f => {
                    const tile = h('button', { type: 'button', class: 'pick' + (isSelected(f.path) ? ' is-selected' : ''), title: f.name },
                        h('img', { src: BASE + f.path, alt: '', loading: 'lazy' }),
                        h('span', { class: 'pick-check' }, '✓'));
                    tile.addEventListener('click', () => {
                        onPick(f.path);
                        if (!multiple) return close();
                        tile.classList.toggle('is-selected', isSelected(f.path));
                    });
                    return tile;
                })))));
        };
        (media ? Promise.resolve() : loadMedia()).then(fill).catch(e => { toast(e.message, true); close(); });
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
        const fromMedia = h('button', {
            type: 'button', class: 'btn',
            onclick: () => openPicker({
                title: label,
                isSelected: p => get(data, path) === p,
                onPick: p => { set(data, path, p); markDirty(); },
            }),
        }, 'Iz medija');
        const remove = current && h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { set(data, path, ''); markDirty(); render(); } }, 'Ukloni');
        file.addEventListener('change', async () => {
            if (!file.files[0]) return;
            pick.disabled = true;
            pick.textContent = 'Otpremam…';
            try {
                const out = await upload(file.files[0], typeof target === 'function' ? target() : target);
                set(data, path, out.path);
                media = null;                 // spisak medija je zastareo
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
            h('div', { class: 'img-field' }, preview, h('div', { class: 'img-actions' }, pick, fromMedia, remove, file)),
            hint && h('span', { class: 'field-hint' }, hint));
    };

    // Dugme za brisanje koje traži potvrdu (bez iskačućih prozora)
    const confirmDelete = (text, onYes, question = 'Sigurno?') => {
        const wrap = h('span', { class: 'confirm' });
        const idle = () => {
            wrap.replaceChildren(h('button', { type: 'button', class: 'btn btn-ghost btn-danger', onclick: ask }, text));
        };
        const ask = () => {
            wrap.replaceChildren(
                h('span', { class: 'confirm-q' }, typeof question === 'function' ? question() : question),
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
        if (!Array.isArray(y.categories)) y.categories = [];
        const cats = y.categories;
        const catName = c => (c.name && (c.name.sr || c.name.en)) || 'Kategorija bez naziva';

        // Kategorija filma: padajuća lista (samo ako godina ima kategorije)
        const catSelect = (f, compact) => {
            const sel = h('select', { class: compact ? 'cat-select' : null, title: 'Kategorija' },
                h('option', { value: '' }, '— bez kategorije —'),
                cats.map(c => h('option', { value: c.id }, catName(c))));
            sel.value = cats.some(c => c.id === f.category) ? f.category : '';
            sel.addEventListener('change', () => {
                if (sel.value) f.category = sel.value; else delete f.category;
                markDirty();
                render();
            });
            return sel;
        };

        const newCatId = () => {
            let id;
            do id = 'k' + Math.random().toString(36).slice(2, 8); while (cats.some(c => c.id === id));
            return id;
        };

        const catsBlock = h('div', { class: 'cats' },
            h('h3', {}, 'Kategorije'),
            h('p', { class: 'field-hint' }, cats.length
                ? 'Na sajtu se ova godina deli na kategorije, redom kao ovde. Svakom filmu izaberi kategoriju. Filmovi bez kategorije idu na kraj, pod „Ostalo“.'
                : 'Ova godina nema kategorije – filmovi se prikazuju svi zajedno. Dodaj kategoriju ako selekciju treba podeliti (npr. Beyond Borders, Made in Balkan).'),
            cats.length > 0 && h('div', { class: 'list' }, cats.map((c, i) => {
                const n = films.filter(f => f.category === c.id).length;
                return h('div', { class: 'card cat-card' },
                    h('div', { class: 'card-head' },
                        h('span', { class: 'card-num' }, String(i + 1).padStart(2, '0')),
                        h('span', { class: 'card-title' }, catName(c), h('small', {}, ` · ${filmsLabel(n)}`)),
                        h('span', { class: 'card-tools' },
                            h('button', { type: 'button', class: 'btn btn-icon', title: 'Pomeri gore', disabled: i === 0, onclick: () => move(cats, i, -1) && render() }, '↑'),
                            h('button', { type: 'button', class: 'btn btn-icon', title: 'Pomeri dole', disabled: i === cats.length - 1, onclick: () => move(cats, i, 1) && render() }, '↓'),
                            confirmDelete('Obriši', () => {
                                films.forEach(f => { if (f.category === c.id) delete f.category; });
                                cats.splice(i, 1);
                                markDirty();
                                render();
                            }, n ? `${filmsLabel(n)} ostaje bez kategorije. Obrisati?` : 'Sigurno?'))),
                    h('div', { class: 'card-body' }, bi('Naziv kategorije', [...yearPath, 'categories', i, 'name'])));
            })),
            h('button', {
                type: 'button', class: 'btn btn-add',
                onclick: () => { cats.push({ id: newCatId(), name: { sr: '', en: '' } }); markDirty(); render(); },
            }, '+ Dodaj kategoriju'));

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
                        cats.length > 0 && catSelect(f, true),
                        h('button', { type: 'button', class: 'btn btn-icon', title: 'Pomeri gore', disabled: i === 0, onclick: () => { if (move(films, i, -1)) { openFilm = -1; render(); } } }, '↑'),
                        h('button', { type: 'button', class: 'btn btn-icon', title: 'Pomeri dole', disabled: i === films.length - 1, onclick: () => { if (move(films, i, 1)) { openFilm = -1; render(); } } }, '↓'),
                        h('button', { type: 'button', class: 'btn', onclick: () => { openFilm = open ? -1 : i; render(); } }, open ? 'Zatvori' : 'Izmeni'))),
                open && h('div', { class: 'card-body' },
                    h('div', { class: 'grid-2' },
                        field('Naziv filma', [...p, 'title']),
                        field('Režija', [...p, 'director'])),
                    cats.length > 0 && h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Kategorija'), catSelect(f, false)),
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
                catsBlock,
                h('h3', { class: 'films-title' }, 'Filmovi'),
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

    // Karusel na početnoj: izabrane slike + koliko dugo stoji svaka
    const heroSection = () => {
        if (!data.site.hero || typeof data.site.hero !== 'object') data.site.hero = { interval: 6, images: [] };
        if (!Array.isArray(data.site.hero.images)) data.site.hero.images = [];
        const imgs = data.site.hero.images;
        const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', multiple: true, hidden: true });
        const up = h('button', { type: 'button', class: 'btn', onclick: () => file.click() }, 'Otpremi nove');
        file.addEventListener('change', async () => {
            const list = [...file.files];
            up.disabled = true;
            for (const [i, f] of list.entries()) {
                up.textContent = `Otpremam ${i + 1}/${list.length}…`;
                try { imgs.push((await upload(f, 'hero')).path); markDirty(); } catch (e) { toast(`${f.name}: ${e.message}`, true); }
            }
            media = null;
            render();
        });
        return section('Karusel na početnoj',
            h('p', { class: 'field-hint' }, 'Slike se smenjuju same. Na svakom ulasku na sajt redosled je nasumičan.'),
            field('Koliko sekundi stoji svaka slika', ['site', 'hero', 'interval'], { type: 'number', hint: 'Najmanje 2 sekunde. Preporuka: 5–8.' }),
            h('div', { class: 'field' },
                h('span', { class: 'field-label' }, `Slike u karuselu (${imgs.length})`),
                imgs.length
                    ? h('div', { class: 'hero-grid' }, imgs.map((p, i) => h('div', { class: 'hero-tile' },
                        h('img', { src: BASE + p, alt: '', loading: 'lazy' }),
                        h('button', { type: 'button', class: 'hero-remove', title: 'Izbaci iz karusela', onclick: () => { imgs.splice(i, 1); markDirty(); render(); } }, '×'))))
                    : h('p', { class: 'empty' }, 'Nijedna slika nije izabrana – početna je crna.'),
                h('div', { class: 'img-actions' },
                    h('button', {
                        type: 'button', class: 'btn btn-primary',
                        onclick: () => openPicker({
                            title: 'Izaberi slike za karusel',
                            multiple: true,
                            isSelected: p => imgs.includes(p),
                            onPick: p => { const i = imgs.indexOf(p); if (i < 0) imgs.push(p); else imgs.splice(i, 1); markDirty(); },
                        }),
                    }, 'Izaberi iz medija'),
                    up, file)));
    };

    views.event = () => [
        h('div', { class: 'view-head' },
            h('h1', {}, 'Početna'),
            h('p', { class: 'lead' }, 'Prvi ekran sajta: slike u pozadini, datum, mesto i prijave.')),
        heroSection(),
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

    // Galerija na dnu početne: izabrane slike, redosled je isti kao ovde
    views.gallery = () => {
        if (!data.site.gallery || typeof data.site.gallery !== 'object') data.site.gallery = { images: [] };
        if (!Array.isArray(data.site.gallery.images)) data.site.gallery.images = [];
        const imgs = data.site.gallery.images;

        const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', multiple: true, hidden: true });
        const up = h('button', { type: 'button', class: 'btn', onclick: () => file.click() }, 'Otpremi nove');
        file.addEventListener('change', async () => {
            const list = [...file.files];
            up.disabled = true;
            for (const [i, f] of list.entries()) {
                up.textContent = `Otpremam ${i + 1}/${list.length}…`;
                try { imgs.push((await upload(f, 'gallery')).path); markDirty(); } catch (e) { toast(`${f.name}: ${e.message}`, true); }
            }
            media = null;
            render();
        });

        // Prevlačenje mišem menja redosled; strelice rade i na telefonu
        let dragFrom = -1;
        const moveTo = (from, to) => {
            if (from === to || from < 0 || to < 0 || to >= imgs.length) return;
            imgs.splice(to, 0, imgs.splice(from, 1)[0]);
            markDirty();
            render();
        };
        const tile = (p, i) => {
            const el = h('div', { class: 'hero-tile gallery-tile', draggable: 'true' },
                h('img', { src: BASE + p, alt: '', loading: 'lazy', draggable: 'false' }),
                h('span', { class: 'gallery-num' }, String(i + 1)),
                h('button', { type: 'button', class: 'hero-remove', title: 'Izbaci iz galerije', onclick: () => { imgs.splice(i, 1); markDirty(); render(); } }, '×'),
                h('span', { class: 'gallery-move' },
                    h('button', { type: 'button', title: 'Pomeri levo', disabled: i === 0, onclick: () => moveTo(i, i - 1) }, '←'),
                    h('button', { type: 'button', title: 'Pomeri desno', disabled: i === imgs.length - 1, onclick: () => moveTo(i, i + 1) }, '→')));
            el.addEventListener('dragstart', e => { dragFrom = i; el.classList.add('is-drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
            el.addEventListener('dragend', () => el.classList.remove('is-drag'));
            el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('is-over'); });
            el.addEventListener('dragleave', () => el.classList.remove('is-over'));
            el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('is-over'); moveTo(dragFrom, i); });
            return el;
        };

        return [
            h('div', { class: 'view-head' },
                h('h1', {}, 'Galerija'),
                h('p', { class: 'lead' }, 'Traka sa fotografijama na dnu početne strane. Vrti se sama, redom kao ovde.')),
            section(`Slike u galeriji (${imgs.length})`,
                h('p', { class: 'field-hint' }, 'Redosled menjaš prevlačenjem slike mišem ili strelicama ← →.'),
                imgs.length
                    ? h('div', { class: 'hero-grid' }, imgs.map(tile))
                    : h('p', { class: 'empty' }, 'Galerija je prazna – na sajtu se ne prikazuje.'),
                h('div', { class: 'img-actions' },
                    h('button', {
                        type: 'button', class: 'btn btn-primary',
                        onclick: () => openPicker({
                            title: 'Izaberi slike za galeriju',
                            multiple: true,
                            isSelected: p => imgs.includes(p),
                            onPick: p => { const i = imgs.indexOf(p); if (i < 0) imgs.push(p); else imgs.splice(i, 1); markDirty(); },
                        }),
                    }, 'Izaberi iz medija'),
                    up, file,
                    imgs.length > 0 && confirmDelete('Isprazni galeriju', () => { imgs.length = 0; markDirty(); render(); }))),
        ];
    };

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

    views.media = () => {
        const head = h('div', { class: 'view-head' },
            h('h1', {}, 'Mediji'),
            h('p', { class: 'lead' }, 'Sve slike i video snimci na sajtu. Za svaki fajl piše gde se koristi.'));
        if (!media) {
            loadMedia().then(() => { if (view === 'media') render(); }).catch(e => toast(e.message, true));
            return [head, h('p', { class: 'empty' }, 'Učitavam…')];
        }
        const files = media.files;
        if (mediaFolder !== 'all' && !media.folders.includes(mediaFolder)) mediaFolder = 'all';

        /* --- Otpremanje --- */
        const folderSel = h('select', {}, media.folders.map(f => h('option', { value: f }, f)));
        folderSel.value = mediaFolder === 'all' ? 'images' : mediaFolder;
        const sub = h('input', { type: 'text', placeholder: 'nova podfascikla (nije obavezno)' });
        const file = h('input', { type: 'file', multiple: true, hidden: true, accept: 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.mov' });
        const progress = h('p', { class: 'field-hint' }, 'Slike: JPG, PNG, WEBP, GIF. Video: MP4, WEBM, MOV.');
        const pickBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => file.click() }, 'Izaberi fajlove');

        const send = async list => {
            if (!list.length) return;
            const name = sub.value.trim().toLowerCase()
                .replace(/[šđčćž]/g, c => ({ š: 's', đ: 'dj', č: 'c', ć: 'c', ž: 'z' }[c]))
                .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            const target = folderSel.value + (name ? `/${name}` : '');
            pickBtn.disabled = true;
            let ok = 0;
            for (const [i, f] of list.entries()) {
                try {
                    await upload(f, `folder:${target}`, p => { progress.textContent = `Otpremam ${i + 1}/${list.length} · ${f.name} · ${Math.round(p * 100)}%`; });
                    ok++;
                } catch (e) { toast(`${f.name}: ${e.message}`, true); }
            }
            mediaFolder = target;
            await loadMedia().catch(() => {});
            if (ok) toast(`Otpremljeno: ${ok}`);
            render();
        };
        file.addEventListener('change', () => send([...file.files]));

        const drop = h('div', { class: 'drop' },
            h('p', { class: 'drop-title' }, 'Prevuci fajlove ovde'),
            h('div', { class: 'drop-row' },
                h('label', { class: 'inline' }, 'U fascikli ', folderSel),
                h('span', { class: 'inline' }, '/'),
                sub),
            h('div', { class: 'img-actions' }, pickBtn, file),
            progress);
        drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('is-over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
        drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('is-over'); send([...e.dataTransfer.files]); });

        /* --- Filter po fasciklama --- */
        const count = f => files.filter(x => x.folder === f || x.folder.startsWith(f + '/')).length;
        const chips = h('div', { class: 'chips' },
            [['all', `Sve (${files.length})`], ...media.folders.map(f => [f, `${f} (${count(f)})`])].map(([v, t]) =>
                h('button', { type: 'button', class: 'chip' + (mediaFolder === v ? ' is-active' : ''), onclick: () => { mediaFolder = v; render(); } }, t)));

        /* --- Fajlovi --- */
        const shown = mediaFolder === 'all' ? files : files.filter(x => x.folder === mediaFolder || x.folder.startsWith(mediaFolder + '/'));
        const groups = [...new Set(shown.map(f => f.folder))];

        const item = f => {
            const refs = findRefs(f.path);
            const uses = [...new Set(refs.map(refLabel))];
            const thumb = f.kind === 'video'
                ? h('video', { src: BASE + f.path + '#t=0.5', muted: true, preload: 'metadata', playsinline: true })
                : h('img', { src: BASE + f.path, alt: '', loading: 'lazy' });
            const question = () => {
                const all = [...uses, ...f.code.map(c => `${c} (kod sajta)`)];
                return all.length ? `Koristi se: ${all.join(', ')}. Obrisati svejedno${uses.length ? ' i ukloniti odatle' : ''}?` : 'Obrisati ovaj fajl?';
            };
            const del = async () => {
                if (dirty) return toast('Prvo sačuvaj izmene, pa onda briši.', true);
                try {
                    await api('media-delete', { json: true, body: JSON.stringify({ path: f.path }) });
                    media.files = media.files.filter(x => x !== f);
                    const now = findRefs(f.path);
                    if (now.length) { removeRefs(now); markDirty(); await save(); }
                    toast('Obrisano.');
                    render();
                } catch (e) { toast(e.message, true); }
            };
            return h('div', { class: 'media-item' },
                h('a', { class: 'media-thumb', href: BASE + f.path, target: '_blank', rel: 'noopener', title: 'Otvori u punoj veličini' },
                    thumb, f.kind === 'video' && h('span', { class: 'media-badge' }, '▶ video')),
                h('div', { class: 'media-info' },
                    h('p', { class: 'media-name', title: f.name }, f.name),
                    h('p', { class: 'media-meta' }, fmtSize(f.size)),
                    uses.length
                        ? h('p', { class: 'media-uses' }, uses.join(' · '))
                        : h('p', { class: 'media-unused' }, 'Ne koristi se u adminu'),
                    f.code.length > 0 && h('p', { class: 'media-code' }, `U kodu sajta: ${f.code.join(', ')}`)),
                h('div', { class: 'media-actions' }, confirmDelete('Obriši', del, question)));
        };

        return [head, drop, chips,
            ...(shown.length
                ? groups.map(g => h('div', { class: 'media-group' },
                    h('h3', {}, g, h('small', {}, ` · ${shown.filter(f => f.folder === g).length}`)),
                    h('div', { class: 'media-grid' }, shown.filter(f => f.folder === g).map(item))))
                : [h('p', { class: 'empty' }, 'U ovoj fascikli nema fajlova.')])];
    };

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
