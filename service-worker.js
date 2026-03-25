// service-worker.js
const CACHE_NAME = 'ck-admin-pwa-v2';
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/admin.js',
    '/pwa-setup.js',
    '/manifest.json',
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
];

// Install event
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Cache opened v2');
                return cache.addAll(urlsToCache).catch(error => {
                    console.log('Cache addAll error:', error);
                });
            })
    );
});

// Activate event
self.addEventListener('activate', event => {
    event.waitUntil(
        Promise.all([
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            self.clients.claim()
        ])
    );
});

// Fetch event
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    // For HTML pages - network first
    if (event.request.headers.get('accept')?.includes('text/html')) {
        event.respondWith(
            fetch(event.request)
                .then(networkResponse => {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                    return networkResponse;
                })
                .catch(() => {
                    return caches.match(event.request)
                        .then(cachedResponse => {
                            return cachedResponse || caches.match('/index.html');
                        });
                })
        );
        return;
    }

    // For other resources - cache first
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(event.request)
                    .then(networkResponse => {
                        if (!networkResponse || networkResponse.status !== 200) {
                            return networkResponse;
                        }
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseToCache);
                        });
                        return networkResponse;
                    });
            })
    );
});

// Handle messages
self.addEventListener('message', event => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
        self.clients.claim();
    }
});
