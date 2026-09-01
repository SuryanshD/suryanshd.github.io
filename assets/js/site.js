/* =========================================================================
   site.js — theme, palette, scroll orchestration
   Everything here is additive. With JS off the page is a complete, readable
   document; nothing below is required to understand or navigate it.
   ========================================================================= */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var viz = window.SDViz || null;

  /* ---------------------------------------------------------------- theme */
  var themeBtn = document.getElementById('theme-btn');

  function currentTheme() {
    var set = root.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function applyTheme(next) {
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('sd-theme', next); } catch (e) {}
    /* Rewrite the two media-qualified metas rather than appending a third:
       browsers disagree about which duplicate wins. */
    var color = next === 'light' ? '#fbfaf8' : '#08090b';
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    if (metas.length) {
      Array.prototype.forEach.call(metas, function (m) {
        m.removeAttribute('media');
        m.setAttribute('content', color);
      });
    } else {
      var m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      m.setAttribute('content', color);
      document.head.appendChild(m);
    }
    if (viz && viz.refreshColors) requestAnimationFrame(viz.refreshColors);
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    });
  }
  /* follow the OS while the visitor hasn't chosen for themselves */
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
    if (!root.getAttribute('data-theme') && viz && viz.refreshColors) viz.refreshColors();
  });

  /* A visitor who turns reduce-motion on mid-session, often for vestibular
     reasons, should not keep getting a full-screen particle field until reload. */
  if (reduced.addEventListener) {
    reduced.addEventListener('change', function (e) {
      if (e.matches && viz && viz.stop) viz.stop();
    });
  }

  /* --------------------------------------------------------------- header */
  var hdr = document.getElementById('hdr');
  if (hdr) {
    var onScroll = function () {
      hdr.setAttribute('data-scrolled', window.scrollY > 12 ? 'true' : 'false');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ------------------------------------------------------- reveal on view */
  /* Reveal by position rather than by IntersectionObserver. An observer only
     reports what it happens to catch, so a fast scroll or a jump to an anchor
     can skip an element and leave it hidden for good. A position test is
     deterministic: anything whose top is above the threshold has been reached,
     including everything already scrolled past. */
  var revealables = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
  if (revealables.length && !reduced.matches) {
    root.classList.add('reveal-ready');
    var pending = revealables.slice();
    var revealTick = function () {
      var limit = window.innerHeight * 0.9;
      for (var i = pending.length - 1; i >= 0; i--) {
        if (pending[i].getBoundingClientRect().top < limit) {
          pending[i].classList.add('is-in');
          pending.splice(i, 1);
        }
      }
      if (!pending.length) {
        window.removeEventListener('scroll', onRevealScroll);
        window.removeEventListener('resize', revealTick);
      }
    };
    var revealQueued = false;
    var onRevealScroll = function () {
      if (revealQueued) return;
      revealQueued = true;
      requestAnimationFrame(function () { revealQueued = false; revealTick(); });
    };
    window.addEventListener('scroll', onRevealScroll, { passive: true });
    window.addEventListener('resize', revealTick, { passive: true });
    window.addEventListener('load', revealTick);
    revealTick();
  }

  /* ------------------------------------------------------ command palette */
  var pal = document.getElementById('pal');
  var palInput = document.getElementById('pal-input');
  var palList = document.getElementById('pal-list');
  var palOpen = document.getElementById('pal-open');
  var lastFocus = null;
  var sel = 0;
  var shown = [];

  var onHome = !!document.getElementById('pipeline');
  /* Depth comes from the path, not from whether this is the home page:
     resume.html sits at the root but has no #pipeline. */
  var base = /\/work\//.test(location.pathname) ? '../' : '';

  var ITEMS = [
    { label: 'The path a request takes', kind: 'section', href: onHome ? '#pipeline' : base + 'index.html#pipeline' },
    { label: 'Stage 01 — Generate', kind: 'stage', href: onHome ? '#stage-generate' : base + 'index.html#stage-generate' },
    { label: 'Stage 02 — Launch', kind: 'stage', href: onHome ? '#stage-launch' : base + 'index.html#stage-launch' },
    { label: 'Stage 03 — Gate', kind: 'stage', href: onHome ? '#stage-gate' : base + 'index.html#stage-gate' },
    { label: 'Try the gate', kind: 'demo', href: onHome ? '#gate' : base + 'index.html#gate' },
    { label: 'The substrate under all of it', kind: 'section', href: onHome ? '#foundation' : base + 'index.html#foundation' },
    { label: 'Built in public', kind: 'section', href: onHome ? '#projects' : base + 'index.html#projects' },
    { label: 'Before InMobi', kind: 'section', href: onHome ? '#before' : base + 'index.html#before' },
    { label: 'Where I have worked', kind: 'section', href: onHome ? '#experience' : base + 'index.html#experience' },
    { label: 'What I build with', kind: 'section', href: onHome ? '#stack' : base + 'index.html#stack' },
    { label: 'The compliance gate', kind: 'deep dive', href: base + 'work/compliance-gate.html' },
    { label: 'Identity, rebuilt from scratch', kind: 'deep dive', href: base + 'work/identity.html' },
    { label: 'The generation surface', kind: 'deep dive', href: base + 'work/generation-surface.html' },
    { label: 'The Meta Ads bulk uploader', kind: 'deep dive', href: base + 'work/bulk-uploader.html' },
    { label: 'Mercury Works', kind: 'deep dive', href: base + 'work/mercury-works.html' },
    { label: 'Munshi', kind: 'deep dive', href: base + 'work/munshi.html' },
    { label: 'Earlier research and ML', kind: 'deep dive', href: base + 'work/earlier-research.html' },
    { label: 'Résumé', kind: 'page', href: base + 'resume.html' },
    { label: 'GitHub', kind: 'link', href: 'https://github.com/SuryanshD', ext: true },
    { label: 'LinkedIn', kind: 'link', href: 'https://www.linkedin.com/in/suryansh-deoli-22746b212', ext: true },
    { label: 'Email suryanshdeoliofficial@gmail.com', kind: 'action', href: 'mailto:suryanshdeoliofficial@gmail.com' },
    { label: 'Copy email address', kind: 'action', act: 'copy' },
    { label: 'Switch colour theme', kind: 'action', act: 'theme' }
  ];

  function score(item, q) {
    var l = item.label.toLowerCase();
    if (!q) return 1;
    if (l.indexOf(q) === 0) return 3;
    if (l.indexOf(q) > -1) return 2;
    if (item.kind.indexOf(q) > -1) return 1.5;
    return 0;
  }

  function paint() {
    var q = (palInput.value || '').trim().toLowerCase();
    shown = ITEMS
      .map(function (it) { return { it: it, s: score(it, q) }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .map(function (r) { return r.it; })
      .slice(0, 9);

    if (!shown.length) {
      palList.innerHTML = '<p class="pal__empty">Nothing matches that.</p>';
      return;
    }
    sel = Math.min(sel, shown.length - 1);
    palList.innerHTML = shown.map(function (it, i) {
      return '<button class="pal__item" type="button" role="option" data-i="' + i + '"' +
        ' aria-selected="' + (i === sel ? 'true' : 'false') + '">' +
        '<span class="pal__label">' + it.label + (it.ext ? ' ↗' : '') + '</span>' +
        '<span class="pal__kind">' + it.kind + '</span></button>';
    }).join('');
  }

  function openPal() {
    if (!pal) return;
    lastFocus = document.activeElement;
    pal.setAttribute('data-open', 'true');
    palInput.value = '';
    sel = 0;
    paint();
    palInput.focus();
  }
  function closePal() {
    if (!pal) return;
    pal.setAttribute('data-open', 'false');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function run(item) {
    if (!item) return;
    if (item.act === 'theme') {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      closePal();
      return;
    }
    if (item.act === 'copy') {
      var addr = 'suryanshdeoliofficial@gmail.com';
      if (navigator.clipboard) navigator.clipboard.writeText(addr).catch(function () {});
      closePal();
      return;
    }
    closePal();
    if (item.ext) window.open(item.href, '_blank', 'noopener');
    else window.location.href = item.href;
  }

  if (pal && palInput && palList) {
    if (palOpen) palOpen.addEventListener('click', openPal);

    palInput.addEventListener('input', function () { sel = 0; paint(); });

    palInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, shown.length); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + shown.length) % Math.max(1, shown.length); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(shown[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); closePal(); }
      else if (e.key === 'Tab') { e.preventDefault(); }   /* keep focus inside */
    });

    palList.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-i]');
      if (btn) run(shown[+btn.getAttribute('data-i')]);
    });

    pal.addEventListener('mousedown', function (e) {
      if (e.target === pal) closePal();
    });

    document.addEventListener('keydown', function (e) {
      var isOpen = pal.getAttribute('data-open') === 'true';
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        isOpen ? closePal() : openPal();
        return;
      }
      if (e.key === 'Escape' && isOpen) closePal();
      /* "/" opens it too, as long as you aren't typing somewhere */
      if (e.key === '/' && !isOpen) {
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
        e.preventDefault();
        openPal();
      }
    });
  }

  /* ------------------------------------------- hero headline, split reveal */
  var gsap = window.gsap;
  var ST = window.ScrollTrigger;

  if (gsap) {
    if (ST) gsap.registerPlugin(ST);
    if (window.SplitText) gsap.registerPlugin(window.SplitText);
  }

  if (gsap && !reduced.matches) {
    /* split after the webfont resolves, or the glyph metrics are measured
       against the fallback and every character lands a pixel or two off */
    var splitHero = function () {
      var h1 = document.querySelector('[data-split]');
      if (!h1 || !window.SplitText) return;
      try {
        var split = new window.SplitText(h1, { type: 'chars', charsClass: 'char' });
        gsap.from(split.chars, {
          yPercent: 108, opacity: 0, duration: 0.9,
          ease: 'power3.out', stagger: 0.026
        });
      } catch (e) { /* the headline is already in the DOM, nothing to recover */ }
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(splitHero);
    else splitHero();

    gsap.from('.hero__eyebrow, .hero__role, .hero__lede, .hero__cta, .hero__scroll', {
      y: 16, opacity: 0, duration: 0.85, ease: 'power2.out', stagger: 0.08, delay: 0.25
    });
  }

  /* ------------------------------------------------ scroll → viz + rail */
  var railSegs = Array.prototype.slice.call(document.querySelectorAll('[data-rail]'));
  var figs = Array.prototype.slice.call(document.querySelectorAll('[data-fig]'));
  var schemName = document.getElementById('schem-name');
  var schemCap = document.getElementById('schem-cap');

  var STAGE_META = [
    { name: 'Generate', cap: 'The generation surface: one concept in, an article, headline set, imagery and ad spec out.' },
    { name: 'Launch', cap: 'One spreadsheet becomes up to 5,000 ads. Every one of them created paused.' },
    { name: 'Gate', cap: 'Policy rules, then an LLM. Approved traffic passes, blocked traffic never leaves.' }
  ];

  function setStage(i) {
    railSegs.forEach(function (s) {
      s.setAttribute('data-live', String(+s.getAttribute('data-rail') === i));
    });
    figs.forEach(function (f) {
      f.setAttribute('data-live', String(+f.getAttribute('data-fig') === i));
    });
    if (schemName && STAGE_META[i]) schemName.textContent = STAGE_META[i].name;
    if (schemCap && STAGE_META[i]) schemCap.textContent = STAGE_META[i].cap;
  }

  /* The sticky schematic panel is desktop-only, so on a phone the four topology
     figures would never be seen at all. Mirror each one under its own stage
     heading. Cloned rather than duplicated in the markup so there is one
     source of truth for each diagram. */
  (function mirrorStageFigures() {
    var figs = document.querySelectorAll('.schem__fig');
    if (!figs.length) return;
    var caps = [
      'The generation surface: one concept in, an article, headline set, imagery and ad spec out.',
      'One spreadsheet becomes up to 5,000 ads. Every one of them created paused.',
      'Policy rules, then an LLM. Approved traffic passes, blocked traffic never leaves.'
    ];
    Array.prototype.forEach.call(figs, function (fig, i) {
      var svg = fig.querySelector('svg');
      var stage = document.querySelector('[data-stage="' + i + '"]');
      if (!svg || !stage) return;
      var head = stage.querySelector('.stage__head');
      if (!head) return;
      var wrap = document.createElement('figure');
      wrap.className = 'stage__fig';
      wrap.setAttribute('aria-hidden', 'true');
      wrap.appendChild(svg.cloneNode(true));
      var cap = document.createElement('figcaption');
      cap.textContent = caps[i] || '';
      wrap.appendChild(cap);
      head.insertAdjacentElement('afterend', wrap);
    });
  })();

  /* Inside the schematic panel the field competes with 8px labels; full-bleed
     it sits directly behind body copy. Both want a different intensity. */
  var ALPHA = {
    hero: 0.95, generate: 0.7, launch: 0.7, gate: 0.8,
    foundation: 0.5, quiet: 0.16
  };
  var STAGE_MODES = ['generate', 'launch', 'gate'];
  var curMode = 'hero';
  var panelActive = false;

  function applyAlpha() {
    if (!viz || !viz.setAlpha) return;
    var a = ALPHA[curMode] != null ? ALPHA[curMode] : 0.7;
    /* No panel means the stage field is full-bleed behind paragraphs, which
       happens on narrow viewports. Pull it well back so text stays first. */
    if (STAGE_MODES.indexOf(curMode) > -1 && !panelActive) a *= 0.14;
    viz.setAlpha(a);
  }

  /* Aim the particle field at the schematic panel, but only while that panel
     is genuinely on screen. offsetParent alone isn't enough: the panel is
     "displayed" at wide viewports even when it's a full page below the fold,
     and aiming at it there parks every particle out of sight. */
  var vizPanel = document.querySelector('.pipe__viz');
  function aim() {
    if (!viz || !viz.setRect) return;
    var active = false;
    if (vizPanel && vizPanel.offsetParent !== null) {
      var r = vizPanel.getBoundingClientRect();
      var vh = window.innerHeight;
      var overlap = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (r.width > 40 && r.height > 40 && overlap > r.height * 0.5) {
        viz.setRect(r);
        active = true;
      }
    }
    if (!active) viz.setRect(null);
    if (active !== panelActive) { panelActive = active; applyAlpha(); }
  }

  if (ST && gsap && !reduced.matches) {
    document.querySelectorAll('[data-viz-mode]').forEach(function (el) {
      var mode = el.getAttribute('data-viz-mode');
      ST.create({
        trigger: el,
        start: 'top 62%',
        end: 'bottom 38%',
        onToggle: function (self) {
          if (!self.isActive) return;
          curMode = mode;
          if (viz) viz.setMode(mode, 1.1);
          var st = el.getAttribute('data-stage');
          if (st !== null) setStage(+st);
          aim();
          applyAlpha();
        }
      });
    });

    ST.create({
      trigger: '.pipe',
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: aim,
      onToggle: aim
    });

    /* Deliberately no extra GSAP reveal on .found__card. Those carry
       [data-reveal], which the position-based reveal above already handles.
       Animating opacity from both places leaves GSAP's inline opacity:0 on
       screen whenever its ScrollTrigger doesn't fire, which hides the cards. */

    window.addEventListener('resize', function () { ST.refresh(); aim(); }, { passive: true });
    window.addEventListener('load', function () { ST.refresh(); aim(); });
  } else {
    /* No GSAP, or motion turned off. The schematic still has to label itself
       correctly, so an observer does the stage switching without animation. */
    setStage(0);
    if ('IntersectionObserver' in window) {
      var stageObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var st = en.target.getAttribute('data-stage');
          if (st !== null) setStage(+st);
          curMode = en.target.getAttribute('data-viz-mode');
          if (viz && viz.setMode) viz.setMode(curMode, 0.8);
          aim();
          applyAlpha();
        });
      }, { rootMargin: '-30% 0px -50% 0px' });
      document.querySelectorAll('[data-viz-mode]').forEach(function (el) { stageObs.observe(el); });
    }
  }

  /* re-aim on scroll, at most once per frame */
  aim();
  applyAlpha();
  if (vizPanel) {
    var queued = false;
    window.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; aim(); });
    }, { passive: true });
  }
})();
