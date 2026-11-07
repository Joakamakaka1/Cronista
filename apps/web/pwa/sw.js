// Cronista's service worker: it makes the app installable and quick to open, and shows the pushes
// the notifier sends. The build writes the precache list and the cache name in place of the two
// placeholders (pwa/service-worker-plugin.ts).
const PRECACHE = self.__CRONISTA_PRECACHE__;
const CACHE = self.__CRONISTA_CACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

// A new build takes over at once and drops the old caches: index.html is never cached for long, so
// an open page reloads into the new build at its next navigation.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('cronista-') && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Supabase and the APIs always go to the network: the game's state is never served from a cache.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // The network first, so a deploy shows at once; offline, the cached page, which routes itself.
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  // Hashed assets never change, and the rest only with a new build, which brings a new cache.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && url.pathname.startsWith('/assets/')) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

// Safari takes away the subscription of a site that receives a push and shows nothing, so a push
// whose payload cannot be read still shows a notice.
self.addEventListener('push', (event) => {
  let message = { title: 'Cronista', body: 'Hay novedades en el periódico.', url: '/', tag: '' };
  try {
    const data = event.data?.json();
    if (data && typeof data.title === 'string' && typeof data.body === 'string') {
      message = {
        title: data.title,
        body: data.body,
        url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/',
        tag: typeof data.tag === 'string' ? data.tag : '',
      };
    }
  } catch {
    // The default message stands.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'es',
      data: { url: message.url },
      ...(message.tag === '' ? {} : { tag: message.tag }),
    }),
  );
});

// A tap opens the app on the push's page: in a window already open if there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open === undefined) return self.clients.openWindow(url);
      return open.navigate(url).then((client) => (client ?? open).focus());
    }),
  );
});
