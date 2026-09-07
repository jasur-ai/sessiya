/**
 * Deborah — Service Worker v2.0.0
 * Cache-first strategy for static assets, network-first for pages & API
 * 
 * Cache Strategy:
 *   Static Assets  -> Cache-First    (CSS, JS, Images, Fonts)
 *   Pages          -> Network-First  (HTML navigations with offline fallback)
 *   API            -> Network-Only   (never cache dynamic data)
 *   Google Fonts   -> Cache-First    (stylesheet + font files)
 */

// S34.07: cache version — design asset hash bilan boshqariladi.
// Tokens.css o'zgarganda version avtomatik yangilanadi (stale CSS/new HTML mismatch oldini oladi).
const CACHE_VERSION = 'v2.2.0-f55da49b';  // landing.css/js o'zgardi — eski statik kesh yangilanadi
const STATIC_CACHE  = 'deborah-static-' + CACHE_VERSION;
const PAGE_CACHE    = 'deborah-pages-' + CACHE_VERSION;
const FONT_CACHE    = 'deborah-fonts-' + CACHE_VERSION;
const CURRENT_CACHES = [STATIC_CACHE, PAGE_CACHE, FONT_CACHE];

// Assets to precache on install
const PRECACHE_URLS = [
  '/',
  '/css/style.css',
  '/css/landing.css',
  '/js/main.js',
  '/js/theme-core.js',
  '/js/theme.js',
  '/js/landing.js',
  '/js/landing-demo.js',
  '/design/generated/tokens.css',
  '/images/favicon-vintage.png',
  '/images/logo-vintage.png',
  '/images/logo-text.svg',
  '/images/og-image.svg',
  '/images/product/poster.webp',
  '/images/pwa-icon-192.png',
  '/images/pwa-icon-512.png',
  '/manifest.json',
  // S34.06: offline sahifa offline'da ham ochilishi uchun precache
  '/offline',
  '/images/brand/evidence-mark.svg',
];

// Google Fonts origins (legacy — STEP 08 dan buyon self-hosted, xavfsizlik uchun qolgan)
const FONT_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// Minimal offline fallback HTML
const OFFLINE_HTML = '<!DOCTYPE html><html lang="uz"><head>' +
  '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Deborah — Offline</title>' +
  '<style>body{background:#0A0F1F;color:#E8EDF7;font-family:"Nunito",sans-serif;' +
  'display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px;margin:0}' +
  'h1{font-family:"Righteous",cursive;font-size:2.2rem;margin-bottom:8px;color:#38BDF8}' +
  'p{color:#8B96B3;font-size:.95rem;line-height:1.6}' +
  '.dot{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#3B82F6,#38BDF8);' +
  'margin:0 auto 20px;box-shadow:0 0 30px rgba(59,130,246,.4)}</style></head>' +
  '<body><div><div class="dot"></div><h1>Offline</h1>' +
  '<p>Deborah ishlashi uchun internet kerak<br>Iltimos, tarmoqqa ulaning</p></div></body></html>';


// S34.08: client "Yangilash" bosganida waiting SW'ni aktivlashtiradi (manual reload)
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ═══════════════════════════════════════════════════════════════
// AUTH B-23: Web Push (PWA)
// Payload minimal: { title, body, url, tag } — preview sensitive YO'Q
// ═══════════════════════════════════════════════════════════════

self.addEventListener('push', function(event) {
  var data = {};
  try {
    if (event.data) data = event.data.json() || {};
  } catch (e) {
    data = {};
  }
  var title = data.title || 'Deborah';
  var options = {
    body: data.body || '',
    icon: '/images/pwa-icon-192.png',
    badge: '/images/pwa-icon-192.png',
    tag: data.tag || 'general',
    renotify: true,
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ('focus' in client) return client.focus().then(function(focused) { return focused.navigate(target); });
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

// ═══════════════════════════════════════════════════════════════
// INSTALL — Precache core assets
// ═══════════════════════════════════════════════════════════════

self.addEventListener('install', function(event) {
  self.skipWaiting();

  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(PRECACHE_URLS);
    }).catch(function(err) {
      console.warn('[SW] Precache failed:', err.message);
    })
  );

  // S34.08: yangi SW o'rnatildi — controllerchange bilan banner chiqarish uchun
  // barcha client'larga xabar yuboramiz (nonblocking, forced reload YO'Q)
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
    clients.forEach(function(client) {
      client.postMessage({ type: 'DEBORAH_UPDATE_AVAILABLE' });
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// ACTIVATE — Clean old caches, take control
// ═══════════════════════════════════════════════════════════════

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());

  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(key) {
            return key.startsWith('deborah-') && CURRENT_CACHES.indexOf(key) === -1;
          })
          .map(function(key) {
            return caches.delete(key);
          })
      );
    })
  );
});

// ═══════════════════════════════════════════════════════════════
// FETCH — Route requests
// ═══════════════════════════════════════════════════════════════

self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip non-http protocols (e.g. chrome-extension://)
  if (!url.protocol.startsWith('http')) return;

  // Skip socket.io
  if (url.pathname.indexOf('/socket.io/') !== -1 || url.hostname === 'cdn.socket.io') return;

  // ── Google Fonts -> Cache-First ──
  if (FONT_ORIGINS.indexOf(url.hostname) !== -1) {
    event.respondWith(fontCacheFirst(request));
    return;
  }

  // ── Static Assets -> Cache-First ──
  if (
    url.pathname.indexOf('/css/') === 0 ||
    url.pathname.indexOf('/js/') === 0 ||
    url.pathname.indexOf('/images/') === 0 ||
    url.pathname.indexOf('/characters/') === 0 ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/favicon.ico'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ── Page Navigations -> Network-First ──
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // ── Everything else -> Network-First fallback ──
  event.respondWith(
    fetch(request).catch(function() {
      return caches.match(request);
    })
  );
});

// ═══════════════════════════════════════════════════════════════
// STRATEGY: Cache-First (for static assets)
// ═══════════════════════════════════════════════════════════════

function cacheFirst(request) {
  return caches.match(request).then(function(cached) {
    if (cached) return cached;

    return fetch(request).then(function(response) {
      if (response && response.ok) {
        var clone = response.clone();
        caches.open(STATIC_CACHE).then(function(cache) {
          cache.put(request, clone);
        });
      }
      return response;
    }).catch(function() {
      // Offline image fallback
      if (request.destination === 'image') {
        return new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">' +
          '<rect width="200" height="200" fill="#0E1428"/>' +
          '<text x="100" y="110" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#8B96B3">Offline</text></svg>',
          { headers: { 'Content-Type': 'image/svg+xml' } }
        );
      }
      return new Response('Offline', { status: 503 });
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY: Network-First (for page navigations)
// ═══════════════════════════════════════════════════════════════

function networkFirst(request) {
  return fetch(request).then(function(response) {
    if (response && response.ok) {
      var clone = response.clone();
      caches.open(PAGE_CACHE).then(function(cache) {
        cache.put(request, clone);
      });
    }
    return response;
  }).catch(function() {
    return caches.match(request).then(function(cached) {
      if (cached) return cached;
      // S34.06: offline fallback — cached /offline sahifasiga (birinchi navbatda), aks holda inline
      return caches.match('/offline').then(function(offlinePage) {
        if (offlinePage) return offlinePage;
        return new Response(OFFLINE_HTML, {
          status: 503,
          headers: { 'Content-Type': 'text/html;charset=UTF-8' }
        });
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY: Font Cache-First (separate cache for Google Fonts)
// ═══════════════════════════════════════════════════════════════

function fontCacheFirst(request) {
  return caches.open(FONT_CACHE).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) return cached;
      return fetch(request).then(function(response) {
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      });
    });
  });
}
