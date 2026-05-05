/*
 * Snappy Services — Tech Skills Matrix
 * Service Worker
 *
 * Strategy:
 *   - Versioned cache name tied to APP_VERSION below.
 *   - install(): skipWaiting() so a new SW activates as soon as it finishes installing.
 *   - activate(): clear ALL old caches and claim clients so the next request is served by us.
 *   - fetch(): network-first for HTML/navigation requests (so iOS Safari always pulls
 *     fresh shell + script tags), stale-while-revalidate for same-origin JS/CSS,
 *     bypass entirely for cross-origin (CDNs, fonts, etc).
 *   - message 'SKIP_WAITING': lets the page tell a waiting SW to take over immediately.
 *
 * This SW is paired with a version-check ping in index.html that fetches version.json
 * on every page load and forces a clean cache-then-refresh cycle when the version
 * advertised by the server doesn't match the version currently running in the page.
 */

const APP_VERSION = 'v218.5';
const CACHE_NAME = 'snappy-matrix-' + APP_VERSION;

// Files we proactively cache on install. Keep this list small — large media
// (mp4, big jpgs) is fine to fetch lazily through the runtime cache.
const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css?v=20260505v218.5',
  './manifest.json',
  './version.json'
];

self.addEventListener('install', (event) => {
  // Activate this SW as soon as install finishes — don't wait for old tabs to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use {cache: 'reload'} so install never picks files out of the HTTP cache.
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {
            // Don't fail install if one optional file 404s.
          })
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Nuke every cache that isn't ours — including any older SW's caches.
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      );
      // Take control of every open client tab right now.
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
    );
  } else if (event.data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: APP_VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GETs.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Bypass cross-origin requests entirely (Chart.js CDN, jsPDF, Google Fonts, etc).
  if (url.origin !== self.location.origin) return;

  // Never cache version.json — the whole point is that it must hit the network.
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(() => caches.match(req))
    );
    return;
  }

  const isNavigation =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    // NETWORK-FIRST for HTML so a redeploy is picked up on the very next load.
    event.respondWith(networkFirst(req));
    return;
  }

  // STALE-WHILE-REVALIDATE for same-origin JS/CSS/images/etc.
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req, { cache: 'no-store' });
    // Only cache successful basic responses.
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Last-ditch fallback: return cached index.html if we have it.
    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || networkPromise || fetch(req);
}
