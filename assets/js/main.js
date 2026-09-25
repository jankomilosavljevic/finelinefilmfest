/* Fine Line Film Fest — main.js */
(() => {
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const root = document.documentElement;
    const header = $('.site-header');
    const main = $('main');
    // sekcije koje se vide (galerija se sakriva ako nema slika)
    let sections = $$('main > section:not([hidden])');
    const toggle = $('.menu-toggle');
    const modal = $('[data-modal]');
    const lightbox = $('[data-lightbox]');

    let lang = 'en';
    let site = null;          // data/site.json
    let selection = null;     // data/selection.json

    // ako prevod fali (npr. sinopsis samo na engleskom), prikaži drugi jezik
    const tr = v => (v && typeof v === 'object') ? (v[lang] || v.sr || v.en || '') : (v ?? '');
    const menuOpen = () => document.body.classList.contains('menu-open');
    const modalOpen = () => modal && !modal.hidden;
    const lightboxOpen = () => lightbox && !lightbox.hidden;
    const busy = () => menuOpen() || modalOpen() || lightboxOpen();

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
    // Telefon/tablet: običan skrol telefona, bez ikakvog „magneta“
    const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;

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
        sections = $$('main > section:not([hidden])');
        index = Math.min(index, sections.length - 1);
        if (isTouch) {
            enabled = false;
            updateUI();
            return;
        }
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
        // vodoravni potez (trackpad) nad galerijom pomera traku, ne stranicu
        if (e.target.closest('[data-gallery]') && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
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
    // Na telefonu se visina menja dok se adresna traka sakriva – tada ne diramo režim
    if (!isTouch) addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(setMode, 150); });

    // Klik na liniju skrola vodi na odgovarajuću stranicu
    $('.scrollbar').addEventListener('click', e => {
        const r = e.currentTarget.getBoundingClientRect();
        goTo(Math.floor((e.clientY - r.top) / r.height * sections.length));
    });

    /* ---------- Tastatura ---------- */
    addEventListener('keydown', e => {
        if (e.key === 'Escape') { setMenu(false); closeModal(); closeLightbox(); }
        if (lightboxOpen()) {
            if (e.key === 'ArrowLeft') stepLightbox(-1);
            if (e.key === 'ArrowRight') stepLightbox(1);
            return;
        }
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
        root.classList.toggle('menu-lock', open);
        toggle.setAttribute('aria-expanded', String(open));
    }
    toggle.addEventListener('click', () => setMenu(!menuOpen()));

    /* ======================================================================
       Hero karusel (data/site.json → hero): svaki ulazak počinje drugom
       slikom, redosled je nasumičan, svaka stoji hero.interval sekundi
       ====================================================================== */
    const HERO_FADE = 1600;       // isto kao transition u CSS-u (.hero-bg)
    const renderHero = () => {
        const wrap = $('[data-hero]');
        const cfg = (site && site.hero) || {};
        const list = (cfg.images || []).filter(Boolean);
        if (!wrap || !list.length) return;
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
        const hold = Math.max(2, Number(cfg.interval) || 6) * 1000;

        const slides = list.map(src => {
            const img = new Image();
            img.className = 'hero-bg';
            img.alt = '';
            img.dataset.src = src;
            wrap.appendChild(img);
            return img;
        });
        const load = img => {
            if (!img.getAttribute('src')) img.src = img.dataset.src;
            return img.decode ? img.decode().catch(() => {}) : Promise.resolve();
        };

        let cur = -1;
        const show = i => load(slides[i]).then(() => {
            const prev = slides[cur];
            if (prev) {
                prev.classList.replace('is-on', 'is-off');
                setTimeout(() => prev.classList.remove('is-off'), HERO_FADE);
            }
            slides[i].classList.add('is-on');
            cur = i;
        });
        const next = () => {
            if (slides.length < 2) return;
            const n = (cur + 1) % slides.length;
            load(slides[n]);                      // učitaj sledeću dok ova stoji
            setTimeout(() => {
                // sakriven tab: ne vrti u prazno, nastavi kad se korisnik vrati
                if (document.hidden) { document.addEventListener('visibilitychange', next, { once: true }); return; }
                show(n).then(next);
            }, hold);
        };
        show(0).then(next);
    };

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
    let catIdx = 0;
    let filmIdx = 0;

    /* Godina može biti podeljena na kategorije (year.categories, film.category).
       Bez kategorija: jedna grupa sa svim filmovima, kao i do sad.
       Filmovi bez kategorije idu u poslednju grupu „Ostalo“. */
    const groups = y => {
        const films = (y && y.films) || [];
        const cats = (y && Array.isArray(y.categories)) ? y.categories : [];
        const ids = new Set(cats.map(c => c.id));
        const out = cats.map(c => ({ name: c.name, films: films.filter(f => f.category === c.id) }))
            .filter(g => g.films.length);
        if (!out.length) return [{ name: null, films }];
        const rest = films.filter(f => !ids.has(f.category));
        if (rest.length) out.push({ name: null, other: true, films: rest });
        return out;
    };
    const currentGroups = () => groups(selection && selection.years[yearIdx]);
    const currentFilms = () => (currentGroups()[catIdx] || { films: [] }).films;
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
            b.addEventListener('click', () => { if (i !== yearIdx) { yearIdx = i; catIdx = 0; filmIdx = 0; renderYears(); renderCats(); renderFilm(); } });
            wrap.appendChild(b);
        });
    };

    const renderCats = () => {
        const wrap = $('[data-cats]');
        const list = currentGroups();
        wrap.innerHTML = '';
        wrap.hidden = list.length < 2;
        if (list.length < 2) return;
        const dict = (window.I18N || {})[lang] || {};
        list.forEach((g, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = g.other ? (dict['selection.other'] || 'Other') : tr(g.name);
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-selected', String(i === catIdx));
            b.addEventListener('click', () => { if (i !== catIdx) { catIdx = i; filmIdx = 0; renderCats(); renderFilm(); } });
            wrap.appendChild(b);
        });
    };

    const fillFilm = () => {
        const films = currentFilms();
        const f = films[filmIdx];
        if (!f) return;
        const img = $('[data-film-img]');
        img.hidden = !f.image;
        if (f.image) img.src = f.image; else img.removeAttribute('src');
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
        fitSynopsis();
    };

    /* Telefon: sinopsis dobija onoliko redova koliko staje (završava se sa „…“),
       umesto da ga ivica ekrana preseče po sredini reda */
    const fitSynopsis = () => {
        const syn = $('[data-film-synopsis]');
        syn.style.removeProperty('-webkit-line-clamp');
        if (!matchMedia('(max-width: 860px)').matches) return;
        const body = syn.parentElement;
        const limit = () => film.getBoundingClientRect().bottom + 0.5;
        const bottom = () => Math.max(...[...body.children].filter(el => !el.hidden).map(el => el.getBoundingClientRect().bottom));
        let lines = 8;
        syn.style.setProperty('-webkit-line-clamp', lines);
        while (lines > 1 && bottom() > limit()) syn.style.setProperty('-webkit-line-clamp', --lines);
    };
    addEventListener('resize', () => { if (selection) fitSynopsis(); });
    if (document.fonts) document.fonts.ready.then(() => { if (selection) fitSynopsis(); });

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
    let fx = null, fy = null;
    film.addEventListener('touchstart', e => { fx = e.touches[0].clientX; fy = e.touches[0].clientY; }, { passive: true });
    film.addEventListener('touchend', e => {
        if (fx === null) return;
        const dx = e.changedTouches[0].clientX - fx;
        const dy = e.changedTouches[0].clientY - fy;
        // samo jasan horizontalni swipe menja film (vertikalni je skrol stranice)
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepFilm(dx < 0 ? 1 : -1);
        fx = fy = null;
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

    /* ======================================================================
       Galerija (data/site.json → gallery.images): traka koja se sama vrti,
       može da se povuče mišem / prstom; klik otvara sliku preko ekrana
       ====================================================================== */
    const GALLERY_SPEED = 40;     // px u sekundi
    let galleryList = [];
    let lbIdx = 0;

    const renderGallery = () => {
        const sec = $('[data-gallery-section]');
        galleryList = ((site && site.gallery && site.gallery.images) || []).filter(Boolean);
        sec.hidden = !galleryList.length;
        setMode();
        if (!galleryList.length) return;

        const strip = $('[data-gallery]');
        const track = $('[data-gallery-track]');
        let period = 0;           // širina jednog kruga slika
        let offset = 0;
        let velocity = 0;         // zalet posle povlačenja
        let hover = false;
        let visible = false;
        let drag = null;
        let suppressClick = false;

        const item = (src, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'gallery-item';
            b.dataset.i = i;
            const img = new Image();
            img.src = src;
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.draggable = false;
            b.appendChild(img);
            return b;
        };

        // Jedan krug se ponavlja dok ne bude širi od ekrana, pa se sve udvostruči –
        // kad traka pređe jedan krug, vraća se na početak bez vidljivog skoka
        const build = () => {
            track.innerHTML = '';
            const one = () => galleryList.forEach((src, i) => track.appendChild(item(src, i)));
            one();
            const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
            const w = track.children[galleryList.length - 1].getBoundingClientRect().right
                - track.children[0].getBoundingClientRect().left + gap;
            const reps = Math.max(1, Math.ceil(strip.clientWidth / Math.max(w, 1)));
            for (let r = 1; r < reps * 2; r++) one();
            period = w * reps;
        };
        build();

        const wrap = () => { if (period) offset = ((offset % period) + period) % period; };
        const paint = () => { track.style.transform = `translate3d(${-offset}px, 0, 0)`; };

        let last = performance.now();
        const tick = now => {
            const dt = Math.min(now - last, 64) / 1000;
            last = now;
            if (!drag && visible && !lightboxOpen()) {
                offset += ((hover ? 0 : GALLERY_SPEED) + velocity) * dt;
                velocity *= Math.pow(0.04, dt);           // zalet se brzo gasi
                if (Math.abs(velocity) < 2) velocity = 0;
                wrap();
                paint();
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);

        if ('IntersectionObserver' in window) {
            new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(strip);
        } else visible = true;

        strip.addEventListener('mouseenter', () => { hover = true; });
        strip.addEventListener('mouseleave', () => { hover = false; });

        strip.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            drag = { x: e.clientX, start: offset, lastX: e.clientX, lastT: performance.now(), v: 0, moved: false, id: e.pointerId };
            velocity = 0;
        });
        strip.addEventListener('pointermove', e => {
            if (!drag || e.pointerId !== drag.id) return;
            const dx = e.clientX - drag.x;
            if (!drag.moved && Math.abs(dx) > 6) {
                drag.moved = true;
                strip.setPointerCapture(e.pointerId);
                strip.classList.add('is-dragging');
            }
            if (!drag.moved) return;
            const now = performance.now();
            drag.v = -(e.clientX - drag.lastX) / Math.max(now - drag.lastT, 1) * 1000;
            drag.lastX = e.clientX;
            drag.lastT = now;
            offset = drag.start - dx;
            wrap();
            paint();
        });
        const endDrag = e => {
            if (!drag || e.pointerId !== drag.id) return;
            if (drag.moved) {
                velocity = Math.max(-2500, Math.min(2500, drag.v));
                suppressClick = true;
                setTimeout(() => { suppressClick = false; }, 0);
            }
            strip.classList.remove('is-dragging');
            drag = null;
            last = performance.now();
        };
        strip.addEventListener('pointerup', endDrag);
        strip.addEventListener('pointercancel', endDrag);   // vertikalni skrol na telefonu

        // trackpad: vodoravni potez pomera traku
        strip.addEventListener('wheel', e => {
            if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
            e.preventDefault();
            offset += e.deltaX;
            wrap();
            paint();
        }, { passive: false });

        track.addEventListener('click', e => {
            const b = e.target.closest('.gallery-item');
            if (!b || suppressClick) return;
            openLightbox(Number(b.dataset.i));
        });

        let rt;
        addEventListener('resize', () => {
            clearTimeout(rt);
            rt = setTimeout(() => { const f = period ? offset / period : 0; build(); offset = f * period; paint(); }, 200);
        });
    };

    /* ---------- Slika preko celog ekrana ---------- */
    const showLightbox = () => {
        $('[data-lightbox-img]', lightbox).src = galleryList[lbIdx];
        $('[data-lightbox-count]', lightbox).textContent = `${pad(lbIdx + 1)} / ${pad(galleryList.length)}`;
        const one = galleryList.length < 2;
        $('[data-lightbox-prev]', lightbox).hidden = one;
        $('[data-lightbox-next]', lightbox).hidden = one;
        loadImage(galleryList[(lbIdx + 1) % galleryList.length]);
    };
    function openLightbox(i) {
        lbIdx = i;
        showLightbox();
        lightbox.hidden = false;
        root.classList.add('menu-lock');
    }
    function closeLightbox() {
        if (!lightboxOpen()) return;
        lightbox.hidden = true;
        if (!menuOpen()) root.classList.remove('menu-lock');
    }
    function stepLightbox(d) {
        if (galleryList.length < 2) return;
        lbIdx = (lbIdx + d + galleryList.length) % galleryList.length;
        showLightbox();
    }
    $('[data-lightbox-close]').addEventListener('click', closeLightbox);
    $('[data-lightbox-prev]').addEventListener('click', () => stepLightbox(-1));
    $('[data-lightbox-next]').addEventListener('click', () => stepLightbox(1));
    lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
    let lx = null;
    lightbox.addEventListener('touchstart', e => { lx = e.touches[0].clientX; }, { passive: true });
    lightbox.addEventListener('touchend', e => {
        if (lx === null) return;
        const dx = e.changedTouches[0].clientX - lx;
        if (Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
        lx = null;
    });

    /* ---------- Jezik ---------- */
    const setLang = l => {
        const dict = (window.I18N || {})[l];
        if (!dict) return;
        lang = l;
        root.lang = l;
        $$('[data-i18n]').forEach(el => { if (dict[el.dataset.i18n]) el.textContent = dict[el.dataset.i18n]; });
        $$('[data-lang]').forEach(b => b.classList.toggle('is-active', b.dataset.lang === l));
        renderEvent();
        if (selection && selection.years && selection.years.length) { renderCats(); fillFilm(); }
    };
    // Pamti se samo jezik koji je posetilac sam izabrao
    $$('[data-lang]').forEach(b => b.addEventListener('click', () => {
        setLang(b.dataset.lang);
        try { localStorage.setItem('fl-lang', b.dataset.lang); } catch (e) {}
    }));

    /* ---------- Start: podrazumevano engleski ---------- */
    let saved = 'en';
    try { saved = localStorage.getItem('fl-lang') || 'en'; } catch (e) {}
    setLang(saved);

    const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => r.json());
    getJSON('data/site.json').then(d => { site = d; renderHero(); renderEvent(); renderGallery(); }).catch(() => {});
    getJSON('data/selection.json').then(d => {
        selection = d;
        if (!selection.years || !selection.years.length) return;
        renderYears();
        renderCats();
        renderFilm(false);
        setMode();
    }).catch(() => {});

    setMode();
    if (location.hash) {
        const i = sections.indexOf($(location.hash));
        if (i > 0) { index = i; setMode(); }
    }
})();
