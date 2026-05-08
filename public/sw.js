/* Denver Engineering — Service Worker v4.31.0
 *
 * Responsibilities:
 *   1. Offline app shell — cache the HTML/JS/CSS needed to boot the SPA
 *      so field users can open the app with no network and see something
 *      other than the browser's "no internet" page.
 *   2. Background sync trigger — when the browser regains connectivity,
 *      post a message to open clients asking them to flush the offline
 *      queue. The actual IndexedDB work happens in the page (see
 *      src/modules/offlineQueue/index.ts); the SW is just a nudger.
 *
 * Intentionally minimal. No runtime caching strategies, no Workbox.
 * Those are follow-ons.
 */

const CACHE_VERSION = 'jarvis-v4.31.0'
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {}),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    await self.clients.claim()
  })())
})

// Network-first for API; cache-first for the shell.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Never intercept API calls — we need real responses for data, and
  // the offline queue in the page handles replay when offline.
  if (url.pathname.startsWith('/api/')) return

  // Only handle GET shell requests; anything else falls through.
  if (event.request.method !== 'GET') return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION)
    try {
      const fresh = await fetch(event.request)
      if (fresh && fresh.ok) cache.put(event.request, fresh.clone())
      return fresh
    } catch {
      const cached = await cache.match(event.request)
      if (cached) return cached
      // Last resort: serve the cached root so SPA routing can take over
      const root = await cache.match('/')
      if (root) return root
      return new Response('Offline', { status: 503, statusText: 'Offline' })
    }
  })())
})

// Nudge open tabs to flush their offline queue when we get online
// hints from the browser. The page owns the IndexedDB flush.
self.addEventListener('online', () => {
  notifyClients({ type: 'jarvis-online' })
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting()
})

async function notifyClients(message) {
  const all = await self.clients.matchAll({ includeUncontrolled: true })
  for (const c of all) c.postMessage(message)
}
