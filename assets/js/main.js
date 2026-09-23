/* Fine Line Film Fest — main.js */
(() => {
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const root = document.documentElement;
    const header = $('.site-header');
    const main = $('main');
    const sections = $$('main > section');
    const toggle = $('.menu-toggle');
    const modal = $('[data-modal]');

    let lang = 'sr';
    let site = null;          // data/site.json
    let selection = null;     // data/selection.json

    const tr = v => (v && typeof v === 'object') ? (v[lang] || v.sr || '') : (v ?? '');
    const menuOpen = () => document.body.classList.contains('menu-open');
    const modalOpen = () => modal && !modal.hidden;
    const busy = () => menuOpen() || modalOpen();

    /* ======================================================================
       Skrol po ekranima: jedan potez točkića / swipe / taster = jedna sekcija.
       Ne koristi sistemski skrol – <main> se pomera transformacijom.
       Ako neka sekcija ne staje na ekran (mali telefon), vraća se običan skrol.
       ====================================================================== */
    const DURATION = 1200;        // isto kao transition u CSS-u (.fp main)
    const WHEEL_GAP = 180;        // ms tišine = novi potez (trackpad inercija)
    let index = 0;
    let enabled = false;
    let locked = false;
    let lastWheel = 0;

    const thumb = $('.scrollbar-thumb');
    const updateScrollbar = () => {
        const n = sections.length;
        thumb.style.height = `${100 / n}%`;
        const progress = enabled ? index / Math.max(n - 1, 1)
            : scrollY / Math.max(root.scrollHeight - innerHeight, 1);
        thumb.style.transform = `translateY(${progress * (n - 1) * 100}%)`;
    };

    const updateUI = () => {
        const onHero = enabled ? index === 0 : scrollY < sections[0].offsetHeight - 80;
        header.classList.toggle('show-brand', !onHero);
        header.classList.toggle('is-solid', !enabled && !onHero);
        updateScrollbar();
    };

    const applyPosition = () => {
        main.style.transform = enabled ? `translate3d(0, ${-sections[index].offsetTop}px, 0)` : '';
    };

    const goTo = i => {
        i = Math.max(0, Math.min(sections.length - 1, i));
        if (!enabled) { sections[i].scrollIntoView({ behavior: 'smooth' }); return; }
        if (i === index || locked) return;
        index = i;
        locked = true;
        applyPosition();
        updateUI();
        setTimeout(() => { locked = false; }, DURATION);
    };

    const fits = () => sections.every(s => s.offsetHeight <= innerHeight + 2);

    const setMode = () => {
        root.classList.remove('fp');
        main.style.transform = '';
        const shouldEnable = fits();
        if (shouldEnable && !enabled) {
            index = sections.reduce((best, s, i) =>
                Math.abs(s.offsetTop - scrollY) < Math.abs(sections[best].offsetTop - scrollY) ? i : best, 0);
            scrollTo(0, 0);
        }
        enabled = shouldEnable;
        if (enabled) {
            root.classList.add('fp');
            main.style.transition = 'none';
            applyPosition();
            main.offsetHeight;
            main.style.transition = '';
        }
        updateUI();
    };

    addEventListener('wheel', e => {
        if (!enabled || busy()) return;
        e.preventDefault();
        const now = performance.now();
        const newGesture = now - lastWheel > WHEEL_GAP;
        lastWheel = now;
        if (!newGesture || locked || Math.abs(e.deltaY) < 4) return;
        goTo(index + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });

    let touchY = null;
    addEventListener('touchstart', e => { touchY = e.touches[0].clientY; }, { passive: true });
    addEventListener('touchmove', e => { if (enabled && !busy()) e.preventDefault(); }, { passive: false });
    addEventListener('touchend', e => {
        if (!enabled || touchY === null || busy()) return;
        const dy = touchY - e.changedTouches[0].clientY;
        if (Math.abs(dy) > 50) goTo(index + (dy > 0 ? 1 : -1));
        touchY = null;
    });

    addEventListener('scroll', updateUI, { passive: true });
    let resizeTimer;
    addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(setMode, 150); });

    // Klik na liniju skrola vodi na odgovarajuću stranicu
    $('.scrollbar').addEventListener('click', e => {
        const r = e.currentTarget.getBoundingClientRect();
        goTo(Math.floor((e.clientY - r.top) / r.height * sections.length));
    });

    /* ---------- Tastatura ---------- */
    addEventListener('keydown', e => {
        if (e.key === 'Escape') { setMenu(false); closeModal(); }
        if (busy() || /input|textarea|select/i.test(e.target.tagName)) return;
        if (e.key === 'ArrowLeft') stepFilm(-1);
        if (e.key === 'ArrowRight') stepFilm(1);
        if (!enabled) return;
        const map = { ArrowDown: 1, PageDown: 1, ' ': 1, ArrowUp: -1, PageUp: -1 };
        if (e.key in map) { e.preventDefault(); goTo(index + map[e.key]); }
        if (e.key === 'Home') { e.preventDefault(); goTo(0); }
        if (e.key === 'End') { e.preventDefault(); goTo(sections.length - 1); }
    });

    /* ---------- Mobilni meni ---------- */
    function setMenu(open) {
        document.body.classList.toggle('menu-open', open);
        toggle.setAttribute('aria-expanded', String(open));
    }
    toggle.addEventListener('click', () => setMenu(!menuOpen()));

    /* ======================================================================
       Hero: datum, logo lokacije, link za prijave (data/site.json)
       ====================================================================== */
    const renderEvent = () => {
        if (!site || !site.event) return;
        const ev = site.event;
        const dates = tr(ev.dates);
        const venue = ev.venue || {};
        $$('[data-field="dates"]').forEach(el => { el.textContent = dates; });
        $$('[data-field="venue"]').forEach(img => {
            img.hidden = !venue.logo;
            if (venue.logo) { img.src = venue.logo; img.alt = venue.name || ''; }
        });
        $$('[data-field="submit"]').forEach(a => { if (ev.submit_url) a.href = ev.submit_url; });
        $$('[data-event]').forEach(el => { el.hidden = !dates && !venue.logo; });
    };

    /* ======================================================================
       Dosadašnja selekcija (data/selection.json)
       ====================================================================== */
    const film = $('[data-film]');
    let yearIdx = 0;
    let filmIdx = 0;

    const currentFilms = () => (selection && selection.years[yearIdx]) ? selection.years[yearIdx].films : [];
    const pad = n => String(n).padStart(2, '0');

    const toEmbed = link => {
        if (!link) return null;
        let m = link.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
        if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1`;
        m = link.match(/vimeo\.com\/(?:video\/)?(\d+)/);
        if (m) return `https://player.vimeo.com/video/${m[1]}?autoplay=1`;
        return null;
    };

    const renderYears = () => {
        const wrap = $('[data-years]');
        wrap.innerHTML = '';
        selection.years.forEach((y, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = y.year;
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-selected', String(i === yearIdx));
            b.addEventListener('click', () => { if (i !== yearIdx) { yearIdx = i; filmIdx = 0; renderYears(); renderFilm(); } });
            wrap.appendChild(b);
        });
    };

    const fillFilm = () => {
        const films = currentFilms();
        const f = films[filmIdx];
        if (!f) return;
        const img = $('[data-film-img]');
        img.src = f.image || '';
        img.alt = f.title || '';
        $('[data-film-title]').textContent = f.title || '';
        $('[data-film-director]').textContent = f.director || '';
        $('[data-film-synopsis]').textContent = tr(f.synopsis);
        $('[data-film-meta]').textContent = [tr(f.country), f.year, f.duration ? `${f.duration}'` : ''].filter(Boolean).join('  ·  ');
        const hasTrailer = !!toEmbed(f.trailer);
        $('[data-film-play]').hidden = !hasTrailer;
        $('[data-film-trailer]').hidden = !hasTrailer;
        $('[data-film-media]').classList.toggle('has-trailer', hasTrailer);
        $('[data-film-count]').textContent = `${pad(filmIdx + 1)} / ${pad(films.length)}`;
        $('[data-film-prev]').disabled = films.length < 2;
        $('[data-film-next]').disabled = films.length < 2;
    };

    /* Slike se učitaju i dekodiraju unapred, da prelaz ne bi seckao */
    const imageCache = new Map();
    const loadImage = src => {
        if (!src) return Promise.resolve();
        if (!imageCache.has(src)) {
            const im = new Image();
            const ready = new Promise(res => {
                im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(res);
                im.onerror = res;
            });
            im.src = src;
            // nikad ne čekaj duže od 1.5s (spora mreža) – prelaz ide dalje
            imageCache.set(src, Promise.race([ready, new Promise(r => setTimeout(r, 1500))]));
        }
        return imageCache.get(src);
    };
    const preloadAround = () => {
        const films = currentFilms();
        [filmIdx + 1, filmIdx - 1].forEach(i => {
            const f = films[(i + films.length) % films.length];
            if (f) loadImage(f.image);
        });
    };

    const FADE = 300;           // isto kao transition u CSS-u (.film)
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let renderToken = 0;
    const renderFilm = async (animate = true) => {
        const token = ++renderToken;
        const f = currentFilms()[filmIdx];
        if (!animate) {
            fillFilm();
            preloadAround();
            return;
        }
        film.classList.add('is-swapping');
        // čekaj da se završi fade-out I da nova slika bude spremna
        await Promise.all([wait(FADE), loadImage(f && f.image)]);
        if (token !== renderToken) return;       // u međuvremenu kliknut drugi film
        fillFilm();
        film.classList.remove('is-swapping');
        preloadAround();
    };

    function stepFilm(d) {
        const films = currentFilms();
        if (films.length < 2 || (enabled && sections[index] !== film.closest('section'))) return;
        filmIdx = (filmIdx + d + films.length) % films.length;
        renderFilm();
    }
    $('[data-film-prev]').addEventListener('click', () => stepFilm(-1));
    $('[data-film-next]').addEventListener('click', () => stepFilm(1));

    // Swipe levo/desno po filmu (telefon)
    let fx = null;
    film.addEventListener('touchstart', e => { fx = e.touches[0].clientX; }, { passive: true });
    film.addEventListener('touchend', e => {
        if (fx === null) return;
        const dx = e.changedTouches[0].clientX - fx;
        if (Math.abs(dx) > 60) stepFilm(dx < 0 ? 1 : -1);
        fx = null;
    });

    /* ---------- Trejler ---------- */
    const openTrailer = () => {
        const f = currentFilms()[filmIdx];
        const src = f && toEmbed(f.trailer);
        if (!src) return;
        $('iframe', modal).src = src;
        modal.hidden = false;
    };
    function closeModal() {
        if (!modal || modal.hidden) return;
        modal.hidden = true;
        $('iframe', modal).src = '';
    }
    $('[data-film-media]').addEventListener('click', openTrailer);
    $('[data-film-trailer]').addEventListener('click', openTrailer);
    $('[data-modal-close]').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    /* ---------- Jezik ---------- */
    const setLang = l => {
        const dict = (window.I18N || {})[l];
        if (!dict) return;
        lang = l;
        root.lang = l;
        $$('[data-i18n]').forEach(el => { if (dict[el.dataset.i18n]) el.textContent = dict[el.dataset.i18n]; });
        $$('[data-lang]').forEach(b => b.classList.toggle('is-active', b.dataset.lang === l));
        renderEvent();
        if (selection) fillFilm();
        try { localStorage.setItem('lang', l); } catch (e) {}
    };
    $$('[data-lang]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));

    /* ---------- Start ---------- */
    let saved = 'sr';
    try { saved = localStorage.getItem('lang') || 'sr'; } catch (e) {}
    setLang(saved);

    const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => r.json());
    getJSON('data/site.json').then(d => { site = d; renderEvent(); }).catch(() => {});
    getJSON('data/selection.json').then(d => {
        selection = d;
        if (!selection.years || !selection.years.length) return;
        renderYears();
        renderFilm(false);
        setMode();
    }).catch(() => {});

    setMode();
    if (location.hash) {
        const i = sections.indexOf($(location.hash));
        if (i > 0) { index = i; setMode(); }
    }
})();
