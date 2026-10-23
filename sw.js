// オフラインで使うため、Web版のファイルをすべて端末に保存する。
// VERSION と FILES は tools/build_web.py がビルドのたびに書き込む（新しい版を置くと、次に開いたときに入れ替わる）
const VERSION = "ef84b1c3319129f0";
const FILES = [
  "./",
  "assets/AssetManifest.bin",
  "assets/AssetManifest.bin.json",
  "assets/FontManifest.json",
  "assets/assets/fonts/NotoSansJP-KB.ttf",
  "assets/assets/web/vendor/LICENSE.get-east-asian-width",
  "assets/assets/web/vendor/LICENSE.markdown-it",
  "assets/assets/web/vendor/LICENSE.markdown-it-cjk-friendly",
  "assets/assets/web/vendor/LICENSE.mermaid",
  "assets/assets/web/vendor/markdown-it-cjk-friendly.min.js",
  "assets/assets/web/vendor/markdown-it.min.js",
  "assets/assets/web/vendor/mermaid.min.js",
  "assets/assets/web/viewer.css",
  "assets/assets/web/viewer.html",
  "assets/assets/web/viewer.js",
  "assets/fonts/MaterialIcons-Regular.otf",
  "assets/shaders/ink_sparkle.frag",
  "assets/shaders/stretch_effect.frag",
  "canvaskit/canvaskit.js",
  "canvaskit/canvaskit.wasm",
  "canvaskit/chromium/canvaskit.js",
  "canvaskit/chromium/canvaskit.wasm",
  "data/board.enc",
  "data/kb_bundle.enc",
  "favicon.png",
  "flutter.js",
  "flutter_bootstrap.js",
  "icons/Icon-192.png",
  "icons/Icon-512.png",
  "icons/Icon-maskable-192.png",
  "icons/Icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "index.html",
  "kb_crypto.js",
  "main.dart.js",
  "manifest.json",
  "version.json"
];
const CACHE = 'kb-viewer-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kb-viewer-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 保存したものを先に使う（電波がなくても開ける）。保存していないものだけ通信する
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') c.put(req, res.clone());
        return res;
      }).catch(() => (req.mode === 'navigate' ? c.match('./') : Response.error())))),
  );
});
