/* =====================================================================
   Bestech catalogue — the only JavaScript on the site.

   Everything important works without it: every page is real HTML, every
   link is a real link, every specification is in the markup. This file
   adds two conveniences and nothing else.

   No framework, no bundler, no dependencies to keep current. It is
   loaded with `defer` and never blocks rendering.
   ===================================================================== */
(function () {
  'use strict';

  // -------------------------------------------------------------------
  // 1. Product gallery — swap the main image when a thumbnail is clicked.
  // -------------------------------------------------------------------
  var main = document.getElementById('pdpMain');
  var thumbs = document.querySelectorAll('.pdp__thumb');
  if (main && thumbs.length) {
    var img = main.querySelector('img');
    thumbs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!img) return;
        img.src = btn.getAttribute('data-full');
        img.srcset = btn.getAttribute('data-srcset') || '';
        thumbs.forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
      });
    });
  }

  // -------------------------------------------------------------------
  // 2. Search.
  //
  // The index is one static JSON file on the CDN, fetched once and then
  // searched in memory. There is no search API and no database behind
  // this, which is why it stays instant under any amount of traffic —
  // and why it keeps working when nothing else is running.
  //
  // Scoring is deliberately simple and tuned for how trade buyers
  // actually search: they type a model number. An exact or prefix match
  // on the SKU outranks everything else.
  // -------------------------------------------------------------------
  var box = document.getElementById('q');
  var out = document.getElementById('searchResults');
  var count = document.getElementById('searchCount');
  if (!box || !out) return;

  var index = null;
  var pending = null;

  function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  function score(item, q) {
    var sku = norm(item.s), name = norm(item.n), brand = norm(item.b), cat = norm(item.c);
    if (sku === q) return 1000;
    if (sku.indexOf(q) === 0) return 500;
    if (sku.indexOf(q) > -1) return 300;
    if (name.indexOf(q) === 0) return 200;
    if (name.indexOf(q) > -1) return 120;
    if (brand.indexOf(q) > -1) return 60;
    if (cat.indexOf(q) > -1) return 40;
    // Every word present somewhere, in any order: "hugo drill 13mm".
    var words = q.split(' ').filter(Boolean);
    var hay = sku + ' ' + name + ' ' + brand + ' ' + cat;
    if (words.length > 1 && words.every(function (w) { return hay.indexOf(w) > -1; })) return 30;
    return 0;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function card(item) {
    return '<a class="card" href="' + esc(item.u) + '">' +
      '<div class="card__media">' +
        (item.i
          ? '<img src="' + esc(item.i) + '" alt="" loading="lazy" decoding="async">'
          : '<span class="card__noimg"></span>') +
      '</div><div class="card__body">' +
        '<span class="card__sku">' + esc(item.s) + '</span>' +
        '<h3 class="card__name">' + esc(item.n) + '</h3>' +
        (item.b ? '<span class="card__brand">' + esc(item.b) + '</span>' : '') +
      '</div></a>';
  }

  function render(q) {
    if (!index) return;
    var query = norm(q);
    if (!query) {
      out.innerHTML = '';
      count.textContent = '';
      return;
    }
    var hits = [];
    for (var i = 0; i < index.length; i++) {
      var s = score(index[i], query);
      if (s > 0) hits.push({ s: s, item: index[i] });
    }
    hits.sort(function (a, b) { return b.s - a.s; });
    var top = hits.slice(0, 60);

    count.textContent = hits.length
      ? hits.length + ' result' + (hits.length === 1 ? '' : 's') + (hits.length > 60 ? ' (showing 60)' : '')
      : 'No match for "' + q + '". Try the model number, or call for help finding it.';
    out.innerHTML = top.map(function (h) { return card(h.item); }).join('');
  }

  function ensureIndex() {
    if (index || pending) return pending;
    // Relative, not absolute: the search page is always one level
    // below the site root, so this resolves correctly whether the
    // site is served from a domain root or a /project/ sub-path.
    pending = fetch('../search-index.json')
      .then(function (r) {
        if (!r.ok) throw new Error('index ' + r.status);
        return r.json();
      })
      .then(function (data) { index = data; return data; })
      .catch(function () {
        count.textContent = 'Search is temporarily unavailable. Please browse the categories above.';
      });
    return pending;
  }

  var timer = null;
  box.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      Promise.resolve(ensureIndex()).then(function () { render(box.value); });
    }, 90);
  });

  // Honour ?q= so a search result is a shareable, bookmarkable link.
  var initial = new URLSearchParams(window.location.search).get('q');
  if (initial) {
    box.value = initial;
    Promise.resolve(ensureIndex()).then(function () { render(initial); });
  } else {
    // Warm the index on focus, so the first keystroke is already instant.
    box.addEventListener('focus', ensureIndex, { once: true });
  }

  // The form submit would reload the page for no reason: results are
  // already live. Keep the URL in step so it stays shareable.
  var form = box.closest('form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = box.value.trim();
      history.replaceState(null, '', v ? '?q=' + encodeURIComponent(v) : location.pathname);
      Promise.resolve(ensureIndex()).then(function () { render(v); });
    });
  }
})();

/* =====================================================================
   Carousel rails and filter tabs.

   Both are enhancements, not requirements. The rail is a plain
   overflow-x container with scroll-snap, so it already scrolls by
   touch, trackpad and keyboard with no JavaScript; this only adds
   arrow buttons and hides them when there is nothing to scroll. The
   tabs filter cards that are all present in the markup, so a visitor
   without JavaScript sees every product rather than none.
   ===================================================================== */
(function () {
  'use strict';

  // ---- rails ----
  document.querySelectorAll('[data-rail]').forEach(function (rail) {
    var track = rail.querySelector('[data-rail-track]');
    var prev = rail.querySelector('[data-rail-prev]');
    var next = rail.querySelector('[data-rail-next]');
    if (!track || !prev || !next) return;

    function step() {
      // Scroll by one card plus its gap, so a click never leaves a
      // card sliced in half at the edge.
      var card = track.firstElementChild;
      return card ? card.getBoundingClientRect().width + 22 : track.clientWidth * 0.8;
    }

    function sync() {
      var overflow = track.scrollWidth - track.clientWidth;
      if (overflow < 8) { prev.hidden = true; next.hidden = true; return; }
      prev.hidden = false; next.hidden = false;
      prev.disabled = track.scrollLeft < 8;
      next.disabled = track.scrollLeft > overflow - 8;
    }

    prev.addEventListener('click', function () { track.scrollBy({ left: -step(), behavior: 'smooth' }); });
    next.addEventListener('click', function () { track.scrollBy({ left: step(), behavior: 'smooth' }); });
    track.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
    // Cards carry images that change the track width once decoded.
    if (window.ResizeObserver) new ResizeObserver(sync).observe(track);
  });

  // ---- tabs ----
  document.querySelectorAll('[data-tabs]').forEach(function (group) {
    var section = group.closest('section');
    if (!section) return;
    var cards = section.querySelectorAll('[data-division]');
    if (!cards.length) return;

    group.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var want = btn.getAttribute('data-tab');   // null on the "All" button

      group.querySelectorAll('button').forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');

      cards.forEach(function (c) {
        c.hidden = Boolean(want) && c.getAttribute('data-division') !== want;
      });

      // The rail's arrows depend on how much is now visible.
      var track = section.querySelector('[data-rail-track]');
      if (track) { track.scrollLeft = 0; window.dispatchEvent(new Event('resize')); }
    });
  });
})();

/* =====================================================================
   Hero carousel.

   Slide one is in the markup and visible before any of this runs, so
   a visitor without JavaScript gets a normal hero rather than an
   empty box. The controls are added here and stay hidden when there
   is only one slide.

   Autoplay stops on hover, on keyboard focus, when the tab is hidden,
   and permanently the moment anyone touches a control. It never runs
   at all for a visitor who has asked for reduced motion.
   ===================================================================== */
(function () {
  'use strict';

  var hero = document.querySelector('[data-hero]');
  if (!hero) return;

  var slides = [].slice.call(hero.querySelectorAll('[data-slide]'));
  var nav = hero.querySelector('[data-hero-nav]');
  if (slides.length < 2 || !nav) return;   // one slide needs no controls

  var dots = [].slice.call(nav.querySelectorAll('[data-hero-go]'));
  var pauseBtn = nav.querySelector('[data-hero-pause]');
  var pauseIcon = nav.querySelector('[data-hero-pause-icon]');
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var DURATION = 7000;
  var at = 0, timer = null, paused = calm, stopped = calm;

  nav.hidden = false;
  nav.style.setProperty('--hero-duration', DURATION + 'ms');

  function show(next) {
    at = (next + slides.length) % slides.length;
    slides.forEach(function (s, i) {
      s.classList.toggle('is-active', i === at);
      if (i === at) s.removeAttribute('aria-hidden');
      else s.setAttribute('aria-hidden', 'true');
    });
    dots.forEach(function (d, i) { d.classList.toggle('is-active', i === at); });
    restart();
  }

  function restart() {
    clearTimeout(timer);
    // The progress bar is pure CSS: moving .is-active restarts its
    // animation by itself, so all this has to do is say whether the
    // slideshow is running.
    nav.classList.toggle('is-paused', paused && !stopped);
    nav.classList.toggle('is-stopped', stopped);
    if (!paused && !stopped) timer = setTimeout(function () { show(at + 1); }, DURATION);
  }

  function setPaused(v, permanent) {
    paused = v;
    if (permanent) stopped = true;
    if (pauseBtn) {
      pauseBtn.setAttribute('aria-label', paused ? 'Play slideshow' : 'Pause slideshow');
      if (pauseIcon) pauseIcon.innerHTML = paused ? '&#9654;' : '&#10073;&#10073;';
    }
    restart();
  }

  dots.forEach(function (d) {
    d.addEventListener('click', function () { setPaused(true, true); show(Number(d.getAttribute('data-hero-go'))); });
  });
  var prev = nav.querySelector('[data-hero-prev]');
  var next = nav.querySelector('[data-hero-next]');
  if (prev) prev.addEventListener('click', function () { setPaused(true, true); show(at - 1); });
  if (next) next.addEventListener('click', function () { setPaused(true, true); show(at + 1); });
  if (pauseBtn) pauseBtn.addEventListener('click', function () { setPaused(!paused, !paused); });

  // Courtesy pauses: reading, tabbing through, or looking elsewhere.
  hero.addEventListener('mouseenter', function () { if (!stopped) { paused = true; restart(); } });
  hero.addEventListener('mouseleave', function () { if (!stopped) { paused = false; restart(); } });
  hero.addEventListener('focusin', function () { setPaused(true, true); });
  document.addEventListener('visibilitychange', function () {
    if (!stopped) { paused = document.hidden; restart(); }
  });

  // Left and right arrows, once a control has focus.
  nav.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { setPaused(true, true); show(at - 1); }
    if (e.key === 'ArrowRight') { setPaused(true, true); show(at + 1); }
  });

  show(0);
})();
