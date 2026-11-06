// 출결관리 도우미 서비스 워커: 앱 셸 캐시, 오프라인 동작
// 배포할 때 VERSION을 올리면 이전 캐시를 지운다 (version.js의 APP_VERSION과 맞출 것).
const VERSION = '0.3.8';
const CACHE = `ah-app-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './app.css',
  './tokens.css',
  './components.css',
  './app.js',
  './ui.js',
  './form.js',
  './views.js',
  './settings.js',
  './list-sheets.js',
  './roster.js',
  './store.js',
  './drive.js',
  './ext.js',
  './config.js',
  './version.js',
  './shared/model.js',
  './shared/rules.js',
  './guide.html',
  './privacy.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
];

const NO_CACHE = /\/(extension-version\.json|[^/]+\.zip)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ah-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 같은 출처 GET만 처리. 구글 API·글꼴 CDN 등 다른 출처 요청은 건드리지 않는다.
//  - 앱 첫 화면(/ 또는 index.html): 네트워크 우선(3초 제한), 실패하면 캐시
//  - 안내 페이지(guide.html, privacy.html): 저장본을 먼저 보여 주고 뒤에서 새로 받아 둔다 (느린 학교 와이파이에서도 바로 열림)
//  - 설명서 그림(guide-img/): 저장본 우선, 없으면 받아서 저장
//  - 그 밖: 네트워크 우선(3초 제한), 실패하면 캐시
// 앱 첫 화면은 '앱 첫 화면 경로'를 요청했을 때만 대신 돌려준다 (다른 페이지 요청에 앱이 뜨던 문제 수정).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 확장프로그램 최신 버전 정보와 압축 파일은 캐시하지 않고 항상 네트워크로 (업데이트 알림이 늦지 않도록)
  if (NO_CACHE.test(url.pathname)) return;
  if (STATIC_PAGE.test(url.pathname)) {
    event.respondWith(staticPage(event, req));
  } else if (GUIDE_IMG.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
  } else {
    event.respondWith(networkFirst(req, url));
  }
});

const STATIC_PAGE = /\/(guide|privacy)\.html$/;
const GUIDE_IMG = /\/guide-img\/[^/]+$/;

function isAppRoot(url) {
  const base = new URL('./', self.registration.scope).pathname;
  return url.pathname === base || url.pathname === base + 'index.html';
}

function offlinePage() {
  const base = new URL('./', self.registration.scope).pathname;
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>연결되어 있지 않습니다</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f7fb;color:#18203a;font-family:Pretendard,system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif;line-height:1.6}
main{max-width:420px;margin:24px;padding:24px;background:#fff;border:1px solid #d9dfeb;border-radius:12px}h1{margin:0 0 8px;font-size:20px;color:#1f2d5c}p{margin:0 0 16px;color:#59627a}
a{display:inline-block;padding:10px 16px;border-radius:8px;background:#1f2d5c;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>연결되어 있지 않습니다</h1><p>지금은 인터넷에 연결되어 있지 않아 이 페이지를 열 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요.</p><a href="${base}">앱으로 돌아가기</a></main></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req), 3000);
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      if (isAppRoot(url)) {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return offlinePage();
    }
    return new Response('오프라인입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

// 안내 페이지: 저장본이 있으면 바로 보여 주고 뒤에서 갱신. 없으면 네트워크(8초), 실패하면 오프라인 안내.
async function staticPage(event, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const refresh = fetch(req).then((res) => {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => {}));
    return hit;
  }
  try {
    return await withTimeout(refresh, 8000);
  } catch {
    return offlinePage();
  }
}

// 그림: 저장본 우선, 없으면 받아서 저장 (처음 볼 때 한 번만 받음)
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('', { status: 503 });
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
