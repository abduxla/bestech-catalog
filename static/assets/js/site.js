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
    pending = fetch('/search-index.json')
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
