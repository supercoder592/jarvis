// Service Worker：讓 JARVIS 可以離線啟動。
// 外殼（HTML/CSS/JS）預先快取；6MB 的辨識模型第一次用到才抓，之後永久留在快取。
const VERSION = 'jarvis-v10';
const SHELL = `${VERSION}-shell`;
// 模型快取刻意不帶版本號，改版時才不會又要重抓 6MB
const MODELS = 'jarvis-models';
const LEGACY_MODELS = ['jarvis-v1-assets'];

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/face.js',
  './js/voice.js',
  './js/hud.js',
  './js/claude.js',
  './js/gemini.js',
  './js/prompt.js',
  './js/memory.js',
  './js/sync.js',
  './js/crypto.js',
  './js/qr.js',
  './vendor/qr.esm.js',
  './js/ai.js',
  './vendor/face-api.js',
  './vendor/anthropic-sdk.esm.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await migrateLegacyModels();
    const keep = new Set([SHELL, MODELS]);
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 舊版把模型放在帶版本號的快取裡，搬過來就不用重新下載
async function migrateLegacyModels() {
  for (const name of LEGACY_MODELS) {
    if (!(await caches.has(name))) continue;
    const [from, to] = [await caches.open(name), await caches.open(MODELS)];
    const requests = await from.keys();
    await Promise.all(requests.map(async (req) => {
      if (await to.match(req)) return;
      const res = await from.match(req);
      if (res) await to.put(req, res);
    }));
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 跨網域（Anthropic API 等）一律直接走網路，不碰快取
  if (url.origin !== self.location.origin) return;

  // 模型權重：先快取，沒有才下載並存起來
  if (url.pathname.includes('/models/')) {
    event.respondWith(cacheFirst(request, MODELS));
    return;
  }

  // 其他同網域資源：先給快取版本，同時在背景更新
  event.respondWith(staleWhileRevalidate(request, SHELL));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) return hit;
  const res = await network;
  if (res) return res;
  // 離線且沒快取：導頁請求就退回首頁
  if (request.mode === 'navigate') {
    const shell = await cache.match('./index.html');
    if (shell) return shell;
  }
  return new Response('離線中，且這個資源尚未快取。', { status: 503, statusText: 'Offline' });
}
