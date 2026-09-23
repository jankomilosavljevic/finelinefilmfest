/* Fine Line Film Fest — main.js */
(() => {
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const root = document.documentElement;
    const header = $('.site-header');
    const main = $('main');
    const sections = $$('main > section');
    const toggle = $('.menu-toggle');

    /* ======================================================================
       Skrol po ekranima: jedan potez točkića / swipe / taster = jedna sekcija.
       Ne koristi sistemski skrol (Windows podešavanja nemaju uticaja) –
       <main> se pomera transformacijom.
       Ako neka sekcija ne staje na ekran (npr. mali telefon), vraća se
       običan skrol da se sadržaj ne bi odsekao.
       ====================================================================== */
    const DURATION = 1200;       // mora da odgovara transition-u u CSS-u (.fp main)
    const WHEEL_GAP = 180;       // ms tišine koja označava novi potez (trackpad inercija)
    let index = 0;
    let enabled = false;
    let locked = false;
    let lastWheel = 0;

    const menuOpen = () => document.body.classList.contains('menu-open');

    const updateHeader = () => {
        const onHero = enabled ? index === 0 : scrollY < sections[0].offsetHeight - 80;
        header.classList.toggle('show-brand', !onHero);
        header.classList.toggle('is-solid', !enabled && !onHero);
    };

    const applyPosition = () => {
        main.style.transform = enabled ? `translate3d(0, ${-sections[index].offsetTop}px, 0)` : '';
    };

    const goTo = i => {
        i = Math.max(0, Math.min(sections.length - 1, i));
        if (!enabled) {
            sections[i].scrollIntoView({ behavior: 'smooth' });
            return;
        }
        if (i === index || locked) return;
        index = i;
        locked = true;
        applyPosition();
        updateHeader();
        setTimeout(() => { locked = false; }, DURATION);
    };

    const fits = () => sections.every(s => s.offsetHeight <= innerHeight + 2);

    const setMode = () => {
        root.classList.remove('fp');
        main.style.transform = '';
        const shouldEnable = fits();
        if (shouldEnable && !enabled) {
            // pređi sa običnog skrola na skrol po ekranima – zadrži najbližu sekciju
            index = sections.reduce((best, s, i) => Math.abs(s.offsetTop - scrollY) < Math.abs(sections[best].offsetTop - scrollY) ? i : best, 0);
            scrollTo(0, 0);
        }
        enabled = shouldEnable;
        if (enabled) {
            root.classList.add('fp');
            main.style.transition = 'none';         // bez animacije pri promeni veličine
            applyPosition();
            main.offsetHeight;                       // primeni odmah
            main.style.transition = '';
        }
        updateHeader();
    };

    addEventListener('wheel', e => {
        if (!enabled || menuOpen()) return;
        e.preventDefault();
        const now = performance.now();
        const newGesture = now - lastWheel > WHEEL_GAP;
        lastWheel = now;
        if (!newGesture || locked || Math.abs(e.deltaY) < 4) return;
        goTo(index + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });

    addEventListener('keydown', e => {
        if (e.key === 'Escape') setMenu(false);
        if (!enabled || menuOpen() || /input|textarea|select/i.test(e.target.tagName)) return;
        const map = { ArrowDown: 1, PageDown: 1, ' ': 1, ArrowUp: -1, PageUp: -1 };
        if (e.key in map) { e.preventDefault(); goTo(index + map[e.key]); }
        if (e.key === 'Home') { e.preventDefault(); goTo(0); }
        if (e.key === 'End') { e.preventDefault(); goTo(sections.length - 1); }
    });

    let touchY = null;
    addEventListener('touchstart', e => { touchY = e.touches[0].clientY; }, { passive: true });
    addEventListener('touchmove', e => { if (enabled && !menuOpen()) e.preventDefault(); }, { passive: false });
    addEventListener('touchend', e => {
        if (!enabled || touchY === null || menuOpen()) return;
        const dy = touchY - e.changedTouches[0].clientY;
        if (Math.abs(dy) > 50) goTo(index + (dy > 0 ? 1 : -1));
        touchY = null;
    });

    addEventListener('scroll', updateHeader, { passive: true });
    let resizeTimer;
    addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(setMode, 150); });

    // Linkovi ka sekcijama (#split, #kontakt)
    $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
        const target = a.getAttribute('href').length > 1 && $(a.getAttribute('href'));
        const i = sections.indexOf(target);
        if (i < 0) return;
        e.preventDefault();
        setMenu(false);
        goTo(i);
    }));

    /* ---------- Mobilni meni ---------- */
    function setMenu(open) {
        document.body.classList.toggle('menu-open', open);
        toggle.setAttribute('aria-expanded', String(open));
    }
    toggle.addEventListener('click', () => setMenu(!menuOpen()));

    /* ---------- Jezik ---------- */
    const setLang = lang => {
        const dict = (window.I18N || {})[lang];
        if (!dict) return;
        root.lang = lang;
        $$('[data-i18n]').forEach(el => { if (dict[el.dataset.i18n]) el.textContent = dict[el.dataset.i18n]; });
        $$('[data-lang]').forEach(b => b.classList.toggle('is-active', b.dataset.lang === lang));
        try { localStorage.setItem('lang', lang); } catch (e) {}
    };
    $$('[data-lang]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
    let saved = 'sr';
    try { saved = localStorage.getItem('lang') || 'sr'; } catch (e) {}
    setLang(saved);

    /* ---------- Videi: učitaj i pusti tek kad su na ekranu ---------- */
    const videoIO = new IntersectionObserver(entries => entries.forEach(({ target: v, isIntersecting }) => {
        if (isIntersecting) {
            if (!v.src && v.dataset.src) v.src = v.dataset.src;
            v.play().catch(() => {});
        } else {
            v.pause();
        }
    }), { rootMargin: '200px 0px' });
    $$('video[data-src], .hero-video').forEach(v => videoIO.observe(v));

    /* ---------- Logo partnera koji još ne postoji ---------- */
    $$('.partner-grid img').forEach(img => {
        const mark = () => img.parentElement.classList.add('is-empty');
        if (img.complete && !img.naturalWidth) mark();
        img.addEventListener('error', mark);
    });

    /* ---------- Reveal ---------- */
    const revealIO = new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const i = $$(':scope > .reveal', el.parentElement).indexOf(el);
        el.style.transitionDelay = `${Math.max(i, 0) * 90 + (enabled ? 500 : 0)}ms`;
        el.classList.add('is-visible');
        revealIO.unobserve(el);
    }), { threshold: 0.15 });
    $$('.reveal').forEach(el => revealIO.observe(el));

    $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

    /* ---------- Start ---------- */
    setMode();
    if (location.hash) {
        const i = sections.indexOf($(location.hash));
        if (i > 0) { index = i; setMode(); }
    }
})();
