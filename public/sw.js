// Trading Journal service worker.
// Goal: fast cold opens on repeat visits without ever serving stale data.
//  - Hashed build assets (/_next/static), icons and images: cache-first.
//    These URLs are content-hashed by Next.js, so a cached entry can never
//    be an outdated version of the same URL.
//  - Page navigations: network-first (live server-rendered data wins);
//    the last cached copy is only a fallback for offline / failed loads.
//  - /api/* and all non-GET requests: never intercepted (auth, sync,
//    version checks and market data always go straight to the network).
// Served with Cache-Control: no-cache via next.config headers so a new
// sw.js is picked up on the next visit after a deploy; the app's version
// checker then reloads open clients onto the new build as usual.
const STATIC_CACHE = 'tj-static-v1'
const PAGE_CACHE = 'tj-pages-v1'
const KNOWN_CACHES = [STATIC_CACHE, PAGE_CACHE]

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KNOWN_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/icon.png' ||
    url.pathname === '/apple-icon.png' ||
    /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => caches.match(request, { ignoreSearch: true }))
    )
    return
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          })
      )
    )
  }
})
