/* Kārumnieki v1: measurement (GTM behind consent) and the cookie banner, drawer, sticky bar, gallery lightbox, the
   map, map share, the thank-you dialog, the language switch. No dependencies. One script for every page (index.html,
   en/index.html and the policy pages). */
(function () {
  'use strict';
  var body = document.body;

  /* Every word this script writes, in both languages, picked by <html lang>. The words in the
     page itself live in index.html and en/index.html; tools/parity.py checks that both sets hold the same keys. */
  var STRINGS = {
    lv: { gallery: 'Galerijas attēls', close: 'Aizvērt', prev: 'Iepriekšējais attēls', next: 'Nākamais attēls', copied: 'Saite nokopēta', map: 'Kārumnieki kartē', sending: 'Sūta…', sendError: 'Neizdevās nosūtīt. Lūdzu, mēģiniet vēlreiz vai zvaniet', reviewOne: 'atsauksme', reviewMany: 'atsauksmes', outOf: 'no 5', readAll: 'Lasīt visu', readLess: 'Rādīt mazāk', googleReview: 'Google atsauksme', byGoogle: 'tulkojis Google', openQ: '„', closeQ: '”', openPhoto: 'Atvērt bildi', guestPhoto: 'Viesa bilde', guestPhotos: 'Viesu bildes', carousel: 'karuselis', slide: 'atsauksme', googleReviews: 'Google atsauksmes', prevReview: 'Iepriekšējā atsauksme', nextReview: 'Nākamā atsauksme' },
    en: { gallery: 'Gallery image', close: 'Close', prev: 'Previous image', next: 'Next image', copied: 'Link copied', map: 'Kārumnieki on the map', sending: 'Sending…', sendError: 'Sending failed. Please try again or call', reviewOne: 'review', reviewMany: 'reviews', outOf: 'out of 5', readAll: 'Read all', readLess: 'Show less', googleReview: 'Google review', byGoogle: 'translated by Google', openQ: '“', closeQ: '”', openPhoto: 'Open photo', guestPhoto: 'Guest photo', guestPhotos: 'Guests’ photos', carousel: 'carousel', slide: 'review', googleReviews: 'Google reviews', prevReview: 'Previous review', nextReview: 'Next review' }
  };
  var T = STRINGS[document.documentElement.lang === 'en' ? 'en' : 'lv'];

  /* Measurement: Google Tag Manager, loaded only after the visitor has agreed to analytics. Until then nothing is
     requested from Google at all (Consent Mode stays at its denied defaults, and gtm.js is never fetched).
     GTM_ID is the container's public ID (GTM-XXXXXXX); while it is empty nothing loads, even with consent.
     The visitor's choice lives in localStorage under CONSENT_KEY as {"v":1,"analytics":true|false,"at":"<ISO date>"}
     and counts for CONSENT_DAYS; with no valid choice the banner (.js-consent) shows and nothing loads. "v" is the
     version of what the banner asks: when the purposes change (ads, say), raise it and every visitor is asked again.
     A no after a yes (Sīkdatņu iestatījumi in the footer) denies analytics again and deletes GA4's _ga cookies.
     Ads are not on the site yet, so only analytics_storage is ever granted; the ad signals stay denied.
     The four events the GA4 tags in the container listen for, each with page_language and link_location:
       phone_click     any tel: link
       whatsapp_click  a WhatsApp link to the owner's number (not the map share's wa.me/?text link)
       share           the map's Dalīties button, content_type "map"
       generate_lead   the enquiry form, once the form Worker says it was delivered
     tools/tag-test.mjs checks all of it. */
  var GTM_ID = 'GTM-K3334MP7';
  var CONSENT_KEY = 'karumnieki-consent';
  var CONSENT_DAYS = 180; /* six months; neither DVI nor the EDPB sets a period */
  var LANG = document.documentElement.lang === 'en' ? 'en' : 'lv';
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });

  function storedConsent() {
    var c = null;
    try { c = JSON.parse(localStorage.getItem(CONSENT_KEY)); } catch (e) { c = null; }
    if (!c || c.v !== 1 || typeof c.analytics !== 'boolean') { return null; }
    var days = (new Date().getTime() - new Date(c.at).getTime()) / 864e5;
    return days >= 0 && days < CONSENT_DAYS ? c : null;
  }
  var analyticsOn = false;
  function loadGtm() {
    if (!GTM_ID || loadGtm.done) { return; }
    loadGtm.done = true;
    window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(GTM_ID);
    document.head.appendChild(s);
  }
  function grantAnalytics() {
    analyticsOn = true;
    gtag('consent', 'update', { analytics_storage: 'granted' });
    loadGtm();
  }
  function denyAnalytics() {
    if (analyticsOn) { gtag('consent', 'update', { analytics_storage: 'denied' }); }
    analyticsOn = false;
    var host = location.hostname.replace(/^www\./, '');
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (name === '_ga' || name.indexOf('_ga_') === 0) {
        ['', '; domain=' + host, '; domain=.' + host].forEach(function (d) {
          document.cookie = name + '=; Max-Age=0; path=/' + d;
        });
      }
    });
  }
  var saved = storedConsent();
  if (saved && saved.analytics === true) { grantAnalytics(); }

  /* The banner: two equal buttons, never a pre-ticked choice. It does not take focus when it appears; it sits right
     after the skip link, so Tab reaches it first. Sīkdatņu iestatījumi (.js-consent-open) brings it back, and focus
     returns there after the choice. */
  var consentBox = document.querySelector('.js-consent');
  var consentOpener = null;
  function choose(analytics) {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, analytics: analytics, at: new Date().toISOString() })); } catch (e) {}
    if (analytics) { grantAnalytics(); } else { denyAnalytics(); }
    if (consentBox) { consentBox.hidden = true; }
    if (consentOpener) { consentOpener.focus(); consentOpener = null; }
  }
  if (consentBox) {
    consentBox.querySelector('.js-consent-yes').addEventListener('click', function () { choose(true); });
    consentBox.querySelector('.js-consent-no').addEventListener('click', function () { choose(false); });
    if (!saved) { consentBox.hidden = false; }
    Array.prototype.forEach.call(document.querySelectorAll('.js-consent-open'), function (b) {
      b.addEventListener('click', function () {
        consentOpener = b;
        consentBox.hidden = false;
        consentBox.querySelector('button').focus();
      });
    });
  }

  /* Which part of the page a link sits in. Section ids are Latvian on both pages, so the values match across languages. */
  function placeOf(el) {
    if (el.closest('.site-nav')) { return 'menu'; }
    if (el.closest('.site-header')) { return 'header'; }
    if (el.closest('.sticky-bar')) { return 'sticky_bar'; }
    if (el.closest('.js-thanks')) { return 'thanks'; }
    if (el.closest('.js-form')) { return 'form'; }
    if (el.closest('.policy')) { return 'policy'; }
    var section = el.closest('section[id]');
    if (section) { return section.id; }
    if (el.closest('footer')) { return 'footer'; }
    return 'other';
  }
  function track(name, params) {
    if (!analyticsOn) { return; }
    var e = { event: name, page_language: LANG };
    for (var k in params) { if (Object.prototype.hasOwnProperty.call(params, k)) { e[k] = params[k]; } }
    window.dataLayer.push(e);
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) { return; }
    var href = a.getAttribute('href');
    if (href.indexOf('tel:') === 0) { track('phone_click', { link_location: placeOf(a) }); }
    else if (href.indexOf('wa.me/37129338444') !== -1) { track('whatsapp_click', { link_location: placeOf(a) }); }
  });

  /* Drawer */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  function closeNav() {
    body.classList.remove('nav-open');
    if (toggle) { toggle.setAttribute('aria-expanded', 'false'); }
  }
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) { closeNav(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && body.classList.contains('nav-open')) { closeNav(); toggle.focus(); }
    });
  }

  /* Sticky bar: shown once the hero button row has scrolled above the viewport */
  var ctaRow = document.querySelector('.js-cta-row');
  if (ctaRow && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      var e = entries[0];
      var passed = !e.isIntersecting && e.boundingClientRect.bottom < 0;
      body.classList.toggle('bar-on', passed);
    }, { threshold: 0 });
    io.observe(ctaRow);
  } else if (ctaRow) {
    window.addEventListener('scroll', function () {
      body.classList.toggle('bar-on', ctaRow.getBoundingClientRect().bottom < 0);
    }, { passive: true });
  }

  /* Gallery lightbox. The tiles are links to the image file, which stays the no-js fallback; with js
     the click opens a <dialog> instead, so nothing navigates away and nothing re-scrolls on Back.
     A tile carrying data-crop-top, data-crop-bottom or data-crop-right keeps that crop here too: a floor
     is a floor everywhere the image is seen, not only in the tile. */
  var tiles = Array.prototype.slice.call(document.querySelectorAll('.tile'));
  var openLightbox = null; /* the live reviews (end of this file) open their guests' photos in the same viewer */
  if ((tiles.length || document.querySelector('.js-reviews')) && typeof HTMLDialogElement === 'function' && HTMLDialogElement.prototype.showModal) {
    var ICON = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
    var lb = document.createElement('dialog');
    lb.className = 'lb';
    lb.setAttribute('aria-label', T.gallery);
    lb.innerHTML =
      '<div class="lb-inner">' +
        '<button class="lb-btn lb-close" type="button" aria-label="' + T.close + '"><svg ' + ICON + '><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '<button class="lb-btn lb-prev" type="button" aria-label="' + T.prev + '"><svg ' + ICON + '><path d="M15 5l-7 7 7 7"/></svg></button>' +
        '<button class="lb-btn lb-next" type="button" aria-label="' + T.next + '"><svg ' + ICON + '><path d="M9 5l7 7-7 7"/></svg></button>' +
        '<div class="lb-stage"><div class="lb-frame"><img alt=""></div></div>' +
        '<div class="lb-foot"><p class="lb-caption"></p><p class="lb-count"></p></div>' +
      '</div>';
    body.appendChild(lb);
    body.classList.add('lb-ready');

    var lbStage = lb.querySelector('.lb-stage');
    var lbFrame = lb.querySelector('.lb-frame');
    var lbImg = lb.querySelector('.lb-frame img');
    var lbCaption = lb.querySelector('.lb-caption');
    var lbCount = lb.querySelector('.lb-count');
    var items = [];
    var index = 0;
    var opener = null;
    var arW = 3, arH = 2;
    var cut = { t: 0, r: 0, b: 0 };

    /* Size in pixels rather than leaving it to aspect-ratio plus two max constraints, which browsers resolve
       inconsistently: whichever max binds first wins and the other is ignored, so the crop silently disappeared
       at one width and doubled at another. The frame is the visible window, contain-fitted to the stage; the
       image inside it is drawn larger by the crop share and pinned so the cut edges fall outside the frame.
       Until 2026-09-15 the crop was object-fit on a box of the cropped ratio, which clips one axis only: K09's
       floor (right 6 AND bottom 4) came out as right 2 and bottom 0 that way, so the window replaced it. */
    function fitStage() {
      var sw = lbStage.clientWidth, sh = lbStage.clientHeight;
      if (!sw || !sh || !arW || !arH) { return; }
      var ar = arW / arH;
      var w = sw, h = sw / ar;
      if (h > sh) { h = sh; w = sh * ar; }
      var iw = w / (1 - cut.r / 100), ih = h / (1 - (cut.t + cut.b) / 100);
      lbFrame.style.width = Math.round(w) + 'px';
      lbFrame.style.height = Math.round(h) + 'px';
      lbImg.style.width = Math.round(iw) + 'px';
      lbImg.style.height = Math.round(ih) + 'px';
      lbImg.style.top = -Math.round(ih * cut.t / 100) + 'px';
    }

    /* What the viewer shows: {src, alt, caption, w, h, t, r, b}, a gallery tile or a guest's photo (2026-10-12). */
    function tileItem(tile) {
      var img = tile.querySelector('img');
      var caption = tile.getAttribute('data-caption') || '';
      /* a crop floor holds everywhere the image is seen, the lightbox included (2026-09-11: K30 top 15;
         zale_3, K23, pirts_4 bottom; zale_10's binding bottom 22; 2026-09-15: K09's binding right 6 and
         bottom 4, the first right crop, so the image is pinned to its left edge) */
      return {
        src: tile.getAttribute('href'), alt: img.getAttribute('alt') || caption, caption: caption,
        w: parseFloat(img.getAttribute('width')) || 3, h: parseFloat(img.getAttribute('height')) || 2,
        t: parseFloat(tile.getAttribute('data-crop-top')) || 0,
        r: parseFloat(tile.getAttribute('data-crop-right')) || 0,
        b: parseFloat(tile.getAttribute('data-crop-bottom')) || 0
      };
    }

    function show(i) {
      index = (i + items.length) % items.length;
      var it = items[index];
      cut = { t: it.t || 0, r: it.r || 0, b: it.b || 0 };
      arW = (it.w || 3) * (1 - cut.r / 100);
      arH = (it.h || 2) * (1 - (cut.t + cut.b) / 100);
      lbImg.src = it.src;
      lbImg.alt = it.alt;
      lbCaption.textContent = it.caption;
      lbCount.textContent = (index + 1) + ' / ' + items.length;
      fitStage();
    }

    window.addEventListener('resize', function () { if (lb.open) { fitStage(); } });

    function open(list, i, from, label) {
      items = list;
      opener = from || null;
      lb.setAttribute('aria-label', label || T.gallery);
      lb.classList.toggle('lb-single', list.length < 2);
      body.classList.add('lb-open');
      lb.showModal();
      show(i); /* after showModal: the stage has no measurable size until the dialog is in the top layer */
    }
    openLightbox = open;

    tiles.forEach(function (tile, i) {
      tile.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) { return; }
        e.preventDefault();
        open(tiles.map(tileItem), i, tile);
      });
    });

    lb.querySelector('.lb-close').addEventListener('click', function () { lb.close(); });
    lb.querySelector('.lb-prev').addEventListener('click', function () { show(index - 1); });
    lb.querySelector('.lb-next').addEventListener('click', function () { show(index + 1); });

    /* a click on the ink around the photo closes, the way every photo viewer behaves */
    lb.addEventListener('click', function (e) {
      if (e.target === lb || e.target.classList.contains('lb-inner') || e.target.classList.contains('lb-stage')) {
        lb.close();
      }
    });

    lb.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
    });

    /* swipe */
    var tx = 0, ty = 0;
    lb.addEventListener('touchstart', function (e) {
      tx = e.changedTouches[0].clientX;
      ty = e.changedTouches[0].clientY;
    }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - tx;
      var dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { show(index + (dx < 0 ? 1 : -1)); }
    }, { passive: true });

    /* Escape fires close on its own; both routes unlock the page and hand focus back to the tile */
    lb.addEventListener('close', function () {
      body.classList.remove('lb-open');
      lbImg.removeAttribute('src');
      if (opener) { opener.focus(); opener = null; }
    });
  }

  /* The map: a still OpenStreetMap picture shows at once; Google's embed loads only on Rādīt Google karti, because
     loading it sends the visitor's IP address to Google and may set Google's cookies. The embed address waits in
     data-src; the iframe's title is T.map. Without js the picture stays and Skatīt Google Maps below opens the place. */
  var mapBox = document.querySelector('.js-map');
  var mapBtn = mapBox && mapBox.querySelector('.js-map-load');
  if (mapBtn) {
    mapBtn.addEventListener('click', function () {
      var f = document.createElement('iframe');
      f.src = mapBox.getAttribute('data-src');
      f.title = T.map;
      f.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      f.setAttribute('allowfullscreen', '');
      mapBox.textContent = '';
      mapBox.classList.remove('map-static');
      mapBox.appendChild(f);
      f.focus();
    });
  }

  /* Map share: the phone's own share sheet where it exists, copy + WhatsApp where it does not */
  var share = document.querySelector('.js-share');
  var fallback = document.querySelector('.js-share-fallback');
  if (share) {
    var url = share.getAttribute('data-url');
    var text = share.getAttribute('data-text') || '';
    share.addEventListener('click', function () {
      track('share', { method: navigator.share ? 'native' : 'fallback', content_type: 'map', link_location: placeOf(share) });
      if (navigator.share) {
        navigator.share({ title: 'Kārumnieki', text: text, url: url }).catch(function () {});
        return;
      }
      if (fallback) { fallback.hidden = !fallback.hidden; }
    });
    var copy = document.querySelector('.js-copy');
    if (copy) {
      var copyLabel = copy.textContent; /* the page's own words, so the label comes back in the page's language */
      copy.addEventListener('click', function () {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function () {
            copy.textContent = T.copied;
            setTimeout(function () { copy.textContent = copyLabel; }, 2000);
          });
        }
      });
    }
  }

  /* Language switch: the other page, at the section being read. Both pages share every section
     id (tools/parity.py checks it), so the id of the section under the reading line (the header's bottom plus a
     quarter of the screen below it) goes along as the hash; at the very bottom of the page, the last section. The
     page you are on (aria-current) does nothing. Without js the link opens the other page at its top. */
  var siteHeader = document.querySelector('.site-header');
  var sections = Array.prototype.slice.call(document.querySelectorAll('main > section[id]'));
  function readingSection() {
    var de = document.documentElement;
    if (window.scrollY > 0 && window.scrollY + window.innerHeight >= de.scrollHeight - 2) {
      return sections.length ? sections[sections.length - 1].id : '';
    }
    var top = siteHeader ? siteHeader.getBoundingClientRect().bottom : 0;
    var line = top + (window.innerHeight - top) / 4;
    var id = '';
    sections.forEach(function (s) { if (s.getBoundingClientRect().top <= line) { id = s.id; } });
    return id === 'sakums' ? '' : id;
  }
  Array.prototype.forEach.call(document.querySelectorAll('.lang-switch a[hreflang]'), function (a) {
    a.addEventListener('click', function (e) {
      if (a.hasAttribute('aria-current')) { e.preventDefault(); return; }
      var id = readingSection();
      a.setAttribute('href', a.getAttribute('href').split('#')[0] + (id ? '#' + id : ''));
    });
  });

  /* Smooth scrolling for the menu links and the Pieprasījums buttons starts once the page has loaded (the rule is
     html.smooth-scroll in site.css). While loading, it made the browser glide from the top to a #section. */
  window.addEventListener('load', function () {
    requestAnimationFrame(function () { document.documentElement.classList.add('smooth-scroll'); });
  });

  /* Landing on a section (#pirts from the other language, or any link to a section): the browser jumps with the
     fallback fonts, and when the web fonts swap in the text above re-wraps shorter, which left the section up to
     555px off on a phone (traced 2026-09-29). Once the fonts are in, and two frames later, when the swap has reached
     the layout, the section goes back under the header, unless the visitor has already started scrolling. */
  /* a hash that is not valid percent-encoding (#%E0, from a mangled link) made decodeURIComponent throw, which stopped
     this whole script, so Nosūtīt then posted the form to the host; such a hash lands at the top */
  var landing = null;
  try {
    landing = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  } catch (err) { landing = null; }
  if (landing && document.fonts && document.fonts.ready) {
    var moved = false;
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (type) {
      window.addEventListener(type, function () { moved = true; }, { once: true, passive: true });
    });
    window.addEventListener('load', function () {
      document.fonts.ready.then(function () {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (moved) { return; }
            var de = document.documentElement;
            var behaviour = de.style.scrollBehavior;
            de.style.scrollBehavior = 'auto';
            landing.scrollIntoView();
            de.style.scrollBehavior = behaviour;
          });
        });
      });
    });
  }

  /* The enquiry form and the thank-you dialog (the owner's own words).
     FORM_ENDPOINT is the form Worker's address (form-worker/, README there). Empty, as on the preview, Nosūtīt only
     opens the thank-you, whose note says nothing is sent. Set, the form goes to the Worker as JSON and the thank-you
     opens only when the Worker answers that at least one channel (e-mail, WhatsApp) delivered; otherwise a line
     under the buttons says so with the phone number, and everything typed stays. generate_lead fires only then.
     TURNSTILE_SITEKEY switches on Cloudflare's bot check; its script loads only when the visitor first reaches the
     form, so a visitor who never does sends nothing to Cloudflare. The Worker also drops a filled honeypot
     ("vietne") and a send sooner than 2.5 s after the visitor first reached the form ("t").
     Escape closes the modal dialog on its own; the X, Aizvērt and a click on the backdrop close it here; focus
     lands on Aizvērt and returns to Nosūtīt. tools/form-fit.mjs checks all of it. */
  var FORM_ENDPOINT = '';
  var TURNSTILE_SITEKEY = '';
  var form = document.querySelector('.js-form');
  var thanks = document.querySelector('.js-thanks');
  if (form && thanks && typeof HTMLDialogElement === 'function' && HTMLDialogElement.prototype.showModal) {
    var submitBtn = form.querySelector('.btn-submit');
    var errorLine = form.querySelector('.js-form-error');
    var startedAt = 0;
    var sending = false;
    var tsWidget = null;
    if (FORM_ENDPOINT) {
      var note = thanks.querySelector('.form-note');
      if (note) { note.parentNode.removeChild(note); }
    }
    function loadTurnstile() {
      if (!TURNSTILE_SITEKEY || loadTurnstile.done) { return; }
      loadTurnstile.done = true;
      window.karumniekiTurnstile = function () {
        tsWidget = window.turnstile.render(form.querySelector('.js-turnstile'), {
          sitekey: TURNSTILE_SITEKEY, action: 'enquiry', appearance: 'interaction-only', language: LANG
        });
      };
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=karumniekiTurnstile';
      s.async = true;
      document.head.appendChild(s);
    }
    form.addEventListener('focusin', function () {
      if (!startedAt) { startedAt = new Date().getTime(); }
      loadTurnstile();
    });
    /* Turnstile gives its token a moment after it loads; a quick visitor waits for it up to 5 s */
    function turnstileToken() {
      if (!TURNSTILE_SITEKEY) { return Promise.resolve(''); }
      return new Promise(function (resolve) {
        var tries = 0;
        (function poll() {
          var t = window.turnstile && tsWidget !== null ? window.turnstile.getResponse(tsWidget) : '';
          if (t || tries++ >= 20) { resolve(t || ''); } else { setTimeout(poll, 250); }
        })();
      });
    }
    function enquiry(token) {
      var d = {};
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.disabled || el.type === 'submit' || el.type === 'button') { return; }
        if (el.type === 'checkbox') { if (el.checked) { d[el.name] = true; } } else { d[el.name] = el.value; }
      });
      if (token) { d['cf-turnstile-response'] = token; }
      d.t = new Date().getTime() - (startedAt || new Date().getTime());
      return d;
    }
    function send(d) {
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
      return fetch(FORM_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d),
        credentials: 'omit', signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        return r.json().then(function (j) { return r.ok && j && j.ok === true; }, function () { return false; });
      }, function () { return false; }).then(function (ok) {
        if (timer) { clearTimeout(timer); }
        return ok;
      });
    }
    function showError() {
      errorLine.textContent = T.sendError + ' ';
      var a = document.createElement('a');
      a.href = 'tel:+37129338444';
      a.textContent = '+371 29338444';
      errorLine.appendChild(a);
      errorLine.appendChild(document.createTextNode('.'));
      errorLine.hidden = false;
    }
    function openThanks() {
      thanks.showModal();
      var first = thanks.querySelector('.js-thanks-first');
      if (first) { first.focus(); }
      form.reset();
      startedAt = 0;
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (sending) { return; }
      /* Name and phone are required before the thank-you says a quote is coming, and an e-mail address, which is
         optional (most guests are answered by phone or WhatsApp), must be a real address when one
         is typed. An empty form once opened the thank-you and then wiped whatever had been typed.
         Only these are checked: the form keeps novalidate so the browser does not refuse a guest count over 45 or a
         date on its own, because an enquiry for 50 is still a lead. The browser shows its own message at the first
         empty or wrong field. */
      var missing = Array.prototype.filter.call(form.querySelectorAll('[required], input[type=email]'), function (f) { return !f.checkValidity(); })[0];
      if (missing) { missing.focus(); missing.reportValidity(); return; }
      if (errorLine) { errorLine.hidden = true; }
      if (!FORM_ENDPOINT) { openThanks(); return; }
      sending = true;
      var label = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
      submitBtn.textContent = T.sending;
      turnstileToken().then(function (token) { return send(enquiry(token)); }).then(function (ok) {
        sending = false;
        submitBtn.disabled = false;
        submitBtn.removeAttribute('aria-busy');
        submitBtn.textContent = label;
        if (window.turnstile && tsWidget !== null) { window.turnstile.reset(tsWidget); }
        if (ok) {
          track('generate_lead', { link_location: 'form' });
          openThanks();
        } else {
          showError();
          submitBtn.focus();
        }
      });
    });
    Array.prototype.forEach.call(thanks.querySelectorAll('.js-thanks-close'), function (b) {
      b.addEventListener('click', function () { thanks.close(); });
    });
    thanks.addEventListener('click', function (e) { if (e.target === thanks) { thanks.close(); } });
    thanks.addEventListener('close', function () { if (submitBtn) { submitBtn.focus(); } });
  } else if (form) {
    form.addEventListener('submit', function (e) { e.preventDefault(); });
  }

  /* Atsauksmes, live since 2026-10-12. Both rating numbers (the hero line and the Google row) follow Google, and the
     block under them becomes a carousel of the reviews: the page reads REVIEWS_ENDPOINT + "lv" or "en" from the form
     Worker (form-worker/, GET /atsauksmes/<lang>) once the block nears the screen, which a nightly job outside this
     repo refills from the Business Profile API,
     keeping nothing longer than Google allows (30 days). Nothing is asked of Google from this page.
     One review per slide (a grid of them looked ragged):
     stars, the text folded to eight lines with Lasīt visu, the guest's initials, name and month; up to four photos
     on the right, "+N" on the fourth, a click opens them all in the gallery's viewer (photos come from the Worker
     too, foto/<id>-s and -l). The first slide is the lead quote, word for word as the owner approved it, with that
     guest's photos; then the reviews with photos, then the rest, newest first in each. Arrows and "3 / 38" under it,
     a swipe or a trackpad pages natively (scroll snap), the arrow keys too; the height follows the slide in view.
     English shows Google's translation, said so under each one. With REVIEWS_ENDPOINT empty (the preview), an error
     or an odd answer, the page keeps its own quotes and numbers. tools/reviews-test.mjs checks it. */
  var REVIEWS_ENDPOINT = '';
  var reviewRow = document.querySelector('.js-reviews');
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17.3l-6 3.3 1.3-6.6L2.4 9.4l6.7-.8z"/></svg>';
  var CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';
  function isOne(n) { return LANG === 'lv' ? n % 10 === 1 && n % 100 !== 11 : n === 1; }
  function showRating(meta) {
    var rating = Number(meta.rating);
    var count = Number(meta.count);
    if (!(rating > 0 && rating <= 5) || !(count > 0 && count % 1 === 0)) { return; }
    var r = rating.toFixed(1);
    if (LANG === 'lv') { r = r.replace('.', ','); }
    var c = count + ' ' + (isOne(count) ? T.reviewOne : T.reviewMany);
    Array.prototype.forEach.call(document.querySelectorAll('.js-g-rating'), function (el) { el.textContent = r; });
    Array.prototype.forEach.call(document.querySelectorAll('.js-g-count'), function (el) { el.textContent = c; });
  }
  function photoUrl(id, size) { return REVIEWS_ENDPOINT + 'foto/' + id + '-' + size; }
  function initials(name) {
    var words = name.replace(/[^\s\wÀ-ɏ]/g, '').split(/\s+/).filter(Boolean);
    return ((words[0] || '').charAt(0) + (words.length > 1 ? words[1].charAt(0) : '')).toUpperCase();
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined) { e.textContent = text; }
    return e;
  }
  function addThumb(box, rv, k, shownN) {
    var b = el('button', 'rv-shot');
    b.type = 'button';
    b.setAttribute('aria-label', T.openPhoto + ' ' + (k + 1) + ' / ' + rv.photos.length + ' (' + rv.author + ')');
    var img = el('img');
    img.src = photoUrl(rv.photos[k].id, 's');
    img.alt = '';
    img.width = 140;
    img.height = 140;
    img.loading = 'lazy';
    img.decoding = 'async';
    /* a photo past its 30 days before the next refresh: no broken image, the thumbnail just goes */
    img.addEventListener('error', function () { b.hidden = true; });
    b.appendChild(img);
    if (k === shownN - 1 && rv.photos.length > shownN) {
      var more = el('span', 'rv-shot-more', '+' + (rv.photos.length - shownN));
      more.setAttribute('aria-hidden', 'true');
      b.appendChild(more);
    }
    b.addEventListener('click', function () {
      if (!openLightbox) { return; }
      openLightbox(rv.photos.map(function (ph) {
        return { src: photoUrl(ph.id, 'l'), alt: T.guestPhoto + ' (' + rv.author + ')', caption: rv.author + ' · ' + rv.date, w: ph.w || 3, h: ph.h || 2 };
      }), k, b, T.guestPhotos);
    });
    box.appendChild(b);
  }
  function slide(rv, n, total) {
    var s = el('div', 'rv-slide');
    s.setAttribute('role', 'group');
    s.setAttribute('aria-roledescription', T.slide);
    s.setAttribute('aria-label', n + ' / ' + total);
    var main = el('div', 'rv-main');
    var stars = el('span', 'rv-stars');
    stars.setAttribute('role', 'img');
    stars.setAttribute('aria-label', rv.rating + ' ' + T.outOf);
    for (var i = 1; i <= 5; i++) {
      var st = el('span', i <= rv.rating ? 'rv-star' : 'rv-star rv-star-off');
      st.innerHTML = STAR;
      stars.appendChild(st);
    }
    main.appendChild(stars);
    if (rv.text) { main.appendChild(el('p', 'rv-text', T.openQ + rv.text + T.closeQ)); }
    var who = el('div', 'rv-who');
    var avatar = el('span', 'rv-avatar', initials(rv.author));
    avatar.setAttribute('aria-hidden', 'true');
    var meta = el('span', 'rv-meta');
    meta.appendChild(el('span', 'rv-name', rv.author));
    var parts = [rv.date, rv.note, rv.translated ? T.byGoogle : ''].filter(Boolean);
    var line = el('span', 'rv-date', parts.join(' · ') + (parts.length ? ' · ' : ''));
    var a = el('a', '', T.googleReview);
    a.href = rv.link;
    a.rel = 'noopener';
    line.appendChild(a);
    meta.appendChild(line);
    who.appendChild(avatar);
    who.appendChild(meta);
    main.appendChild(who);
    s.appendChild(main);
    if (rv.photos.length) {
      var shots = el('div', 'rv-shots');
      var shownN = Math.min(4, rv.photos.length);
      for (var k = 0; k < shownN; k++) { addThumb(shots, rv, k, shownN); }
      s.appendChild(shots);
    }
    return s;
  }
  /* Lasīt visu only where the text is cut; measured with the carousel laid out, and again on resize */
  function foldLong(s) {
    var p = s.querySelector('.rv-text');
    var b = s.querySelector('.rv-toggle');
    if (!p || s.classList.contains('is-open')) { return; }
    var cut = p.scrollHeight > p.clientHeight + 4;
    if (cut && !b) {
      b = el('button', 'rv-toggle', T.readAll);
      b.type = 'button';
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', function () {
        var open = s.classList.toggle('is-open');
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        b.textContent = open ? T.readLess : T.readAll;
        if (s.rvFit) { s.rvFit(); }
      });
      p.parentNode.insertBefore(b, p.nextSibling);
    } else if (!cut && b) {
      b.parentNode.removeChild(b);
    }
  }
  function carousel(list, at) {
    var root = el('div', 'rv');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-roledescription', T.carousel);
    root.setAttribute('aria-label', T.googleReviews);
    var viewport = el('div', 'rv-viewport');
    viewport.tabIndex = 0;
    var track = el('div', 'rv-track');
    var slides = list.map(function (rv, i) { return slide(rv, i + 1, list.length); });
    slides.forEach(function (s) { track.appendChild(s); });
    viewport.appendChild(track);
    var bar = el('div', 'rv-bar');
    var count = el('p', 'rv-count', '1 / ' + list.length);
    count.setAttribute('aria-live', 'polite');
    var prev = el('button', 'rv-nav rv-prev');
    var next = el('button', 'rv-nav rv-next');
    prev.type = next.type = 'button';
    prev.setAttribute('aria-label', T.prevReview);
    next.setAttribute('aria-label', T.nextReview);
    prev.innerHTML = next.innerHTML = CHEVRON;
    bar.appendChild(count);
    bar.appendChild(prev);
    bar.appendChild(next);
    root.appendChild(viewport);
    root.appendChild(bar);
    at.parentNode.insertBefore(root, at);

    var index = 0;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function fit() { viewport.style.height = slides[index].offsetHeight + 'px'; }
    slides.forEach(function (s) { s.rvFit = function () { if (slides[index] === s) { fit(); } }; });
    /* the slide the reader is on: set at once by an arrow or a key (so quick presses all count while the strip is
       still gliding), or by where a swipe came to rest */
    function show(i) {
      index = i;
      count.textContent = (index + 1) + ' / ' + slides.length;
      slides.forEach(function (s, j) { s.setAttribute('aria-hidden', j === index ? 'false' : 'true'); s.inert = j !== index; });
      prev.disabled = index === 0;
      next.disabled = index === slides.length - 1;
      fit();
    }
    /* while an arrow's glide is under way (a slow phone can pause it between frames) the strip's position says
       nothing about where the reader is going; a swipe that interrupts it takes over once the glide time is up */
    var gliding = 0;
    function go(i) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      if (i !== index) { show(i); }
      gliding = reduce ? 0 : Date.now() + 1200;
      viewport.scrollTo({ left: i * viewport.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
    }
    var tick = null;
    viewport.addEventListener('scroll', function () {
      clearTimeout(tick);
      tick = setTimeout(function () {
        var w = viewport.clientWidth || 1;
        if (Date.now() < gliding && Math.abs(viewport.scrollLeft - index * w) > 2) { return; }
        gliding = 0;
        var i = Math.max(0, Math.min(slides.length - 1, Math.round(viewport.scrollLeft / w)));
        if (i !== index) { show(i); }
      }, 100);
    }, { passive: true });
    prev.addEventListener('click', function () { go(index - 1); });
    next.addEventListener('click', function () { go(index + 1); });
    root.addEventListener('keydown', function (e) {
      if (e.target.closest && e.target.closest('.rv-shot, .rv-toggle, a')) { return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
    });
    var refold = null;
    window.addEventListener('resize', function () {
      clearTimeout(refold);
      refold = setTimeout(function () {
        slides.forEach(foldLong);
        viewport.scrollLeft = index * viewport.clientWidth;
        fit();
      }, 150);
    });
    slides.forEach(foldLong);
    show(0);
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(function () { slides.forEach(foldLong); fit(); }); }
    return root;
  }
  function showReviews(data) {
    var meta = data && data.meta;
    if (!meta || !Array.isArray(data.reviews)) { return; }
    showRating(meta);
    var url = typeof meta.url === 'string' && /^https:\/\/(search|www)\.google\.com\//.test(meta.url) ? meta.url : null;
    var leadQuote = document.querySelector('.review-lead');
    var leadBy = leadQuote && leadQuote.querySelector('.review-by');
    var lead = leadBy ? leadBy.textContent.split(' · ')[0].trim() : '';
    var leadLive = null;
    var list = data.reviews.map(function (rv) {
      if (!rv || typeof rv !== 'object') { return null; }
      var photos = Array.isArray(rv.photos) ? rv.photos.filter(function (ph) {
        return ph && typeof ph.id === 'string' && /^[0-9a-f]{16}$/.test(ph.id);
      }) : [];
      var text = typeof rv.text === 'string' ? rv.text.trim() : '';
      if ((!text && !photos.length) || typeof rv.author !== 'string' || typeof rv.date !== 'string' ||
        !(rv.rating % 1 === 0 && rv.rating >= 1 && rv.rating <= 5)) { return null; }
      var r = { author: rv.author, date: rv.date, rating: rv.rating, text: text, translated: !!rv.translated, photos: photos, link: url };
      if (rv.author === lead) { leadLive = r; return null; }
      return r;
    }).filter(Boolean);
    if (!url || !list.length) { return; }
    /* the guests' photos first, each group in the order the data gives (newest first) */
    list = list.filter(function (rv) { return rv.photos.length; }).concat(list.filter(function (rv) { return !rv.photos.length; }));
    if (leadQuote && lead) {
      var leadLink = leadBy.querySelector('a');
      /* the owner's approved words, and on the English page their translation, said so as the page says it */
      list.unshift({
        author: lead, date: leadLive ? leadLive.date : '', rating: leadLive ? leadLive.rating : 5,
        text: leadQuote.querySelector('p').textContent.replace(/^[„“"]\s*/, '').replace(/\s*[”"“]$/, ''),
        note: leadBy.textContent.split(' · ').slice(1, -1).join(' · '),
        translated: false, photos: leadLive ? leadLive.photos : [], link: leadLink ? leadLink.href : url
      });
    }
    carousel(list, leadQuote || reviewRow);
    if (leadQuote) { leadQuote.hidden = true; }
    reviewRow.hidden = true;
  }
  /* asked for only when the block comes within a screen or so of view (2026-10-13: loading it with the page cost the
     phone's Speed Index for a block most visitors reach late or never; and who never gets there asks nothing) */
  if (REVIEWS_ENDPOINT && reviewRow && window.fetch) {
    var reviewsAsked = false;
    var loadReviews = function () {
      if (reviewsAsked) { return; }
      reviewsAsked = true;
      fetch(REVIEWS_ENDPOINT + LANG, { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(showReviews)
        .catch(function () {});
    };
    var reviewsBlock = document.getElementById('atsauksmes');
    if ('IntersectionObserver' in window && reviewsBlock) {
      var reviewsNear = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { reviewsNear.disconnect(); loadReviews(); }
      }, { rootMargin: '1200px 0px' });
      reviewsNear.observe(reviewsBlock);
    } else if (document.readyState === 'complete') { loadReviews(); } else { window.addEventListener('load', loadReviews); }
  }
})();
