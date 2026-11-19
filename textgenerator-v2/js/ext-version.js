// 학교 PC 생기부 확장 업데이트 알림 (출결관리 도우미 ext.js 와 같은 방식)
// - 최신 버전: 같은 폴더의 sgb-extension-version.json (항상 네트워크에서)
// - 설치된 버전: 확장의 content/sgb-version.js 가 <html data-sgb-ext-version> 과 postMessage 로 버전만 알려 줌
// - 개인정보: 페이지와 확장 사이에는 버전 문자열 하나만 오간다.
import { h } from './dom.js';
import { openDialog } from './ui.js';
import { compareVersions, shouldNotify } from './core/ext-version.js';

export { compareVersions };

export const VERSION_FILE = 'sgb-extension-version.json';
const SKIP_KEY = 'sgb-ext.skip';     // [이 버전은 알리지 않기]: 그 버전
const LATER_KEY = 'sgb-ext.later';   // [나중에]: 그 날짜. 다음 날 다시 알림
const CHECK_KEY = 'sgb-ext.checked'; // 화면 복귀 때 하루 1회 확인

export const extInfo = { installed: null, latest: null };

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 무시 */ } };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const VER = /^\d+(\.\d+)*$/;

function readDataset() {
  const v = document.documentElement.dataset.sgbExtVersion;
  return v && VER.test(v) ? v : null;
}

function detectInstalled(timeout = 1500) {
  const now = readDataset();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; window.removeEventListener('message', onMsg); clearTimeout(timer); resolve(v || readDataset()); };
    const onMsg = (ev) => {
      const d = ev.data;
      if (ev.source === window && d && d.source === 'sgb-ext' && d.type === 'version' && VER.test(String(d.version))) finish(d.version);
    };
    window.addEventListener('message', onMsg);
    const timer = setTimeout(() => finish(null), timeout);
    try { window.postMessage({ source: 'sgb-app', type: 'ping' }, location.origin); } catch { /* 무시 */ }
  });
}

async function fetchLatest() {
  if (navigator.onLine === false) return null;
  try {
    const res = await fetch(VERSION_FILE, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || typeof j.version !== 'string' || !VER.test(j.version)) return null;
    return {
      version: j.version,
      date: typeof j.date === 'string' ? j.date : '',
      zip: typeof j.zip === 'string' && /^[\w.-]+\.zip$/.test(j.zip) ? j.zip : 'sgb-extension.zip',
      notes: Array.isArray(j.notes) ? j.notes.filter((n) => typeof n === 'string').slice(0, 8) : [],
    };
  } catch { return null; }
}

let open = false;
function showPopup() {
  const { installed, latest } = extInfo;
  if (open || document.querySelector('dialog[open]')) return;
  if (!shouldNotify({ installed, latest, skip: lsGet(SKIP_KEY), later: lsGet(LATER_KEY), todayStr: today() })) return;
  open = true;
  const body = h('div', { class: 'stack' },
    h('p', { class: 'num' }, '설치됨 ', h('strong', {}, installed), ' → 최신 ', h('strong', {}, latest.version)),
    latest.notes.length ? h('div', {}, h('p', { class: 'label' }, '업데이트 내용'), h('ul', { class: 'small' }, latest.notes.map((n) => h('li', {}, n)))) : null);
  const steps = () => h('div', { class: 'stack' },
    h('p', {}, h('strong', {}, '내려받기를 시작했습니다.'), ' 다음 순서로 업데이트하세요.'),
    h('ol', { class: 'small' },
      h('li', {}, '내려받은 압축 파일을 풀어 기존 sgb-extension 폴더에 덮어씁니다.'),
      h('li', {}, '크롬 주소창에 chrome://extensions 를 열고 생기부 도우미의 새로고침 버튼을 누릅니다.'),
      h('li', {}, '나이스 화면에서 F5를 눌러 새로고침합니다.')),
    h('p', { class: 'small muted' }, '확장프로그램 [제거]는 누르지 마세요. 이 PC에 불러 둔 글과 입력 기록이 지워집니다.'),
    h('a', { href: 'guide.html#update', target: '_blank', rel: 'noopener' }, '그림으로 보는 방법'));
  const dlg = openDialog({
    title: '생기부 확장프로그램 새 버전이 있습니다',
    body: [body],
    actions: [
      { label: '이 버전은 알리지 않기', variant: 'ghost', onClick: () => { lsSet(SKIP_KEY, latest.version); } },
      { label: '나중에', variant: 'secondary', onClick: () => { lsSet(LATER_KEY, today()); } },
      {
        label: '내려받기', variant: 'primary', icon: 'download',
        onClick: () => {
          const a = document.createElement('a');
          a.href = latest.zip; a.download = latest.zip;
          document.body.appendChild(a); a.click(); a.remove();
          lsSet(LATER_KEY, today()); // 받았으면 오늘은 다시 묻지 않음
          body.replaceChildren(steps());
          dlg.setActions([{ label: '확인', variant: 'primary' }]);
          return false; // 창을 닫지 않고 순서를 보여 준다
        },
      },
    ],
    onClose: () => { open = false; },
  });
}

let checking = null;
export function checkExtension({ force = false } = {}) {
  if (checking) return checking;
  if (!force && lsGet(CHECK_KEY) === today()) return Promise.resolve(extInfo);
  checking = (async () => {
    try {
      const [installed, latest] = await Promise.all([detectInstalled(), fetchLatest()]);
      extInfo.installed = installed; extInfo.latest = latest;
      lsSet(CHECK_KEY, today());
      if (installed && latest) showPopup();
    } finally { checking = null; }
    return extInfo;
  })();
  return checking;
}

/** 앱 시작 때 1회, 화면으로 돌아올 때 하루 1회. 확장이 늦게 버전을 알려 오면 그때도 */
export function startExtensionWatch() {
  checkExtension({ force: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkExtension(); });
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (ev.source !== window || !d || d.source !== 'sgb-ext' || d.type !== 'version' || !VER.test(String(d.version))) return;
    if (extInfo.installed !== d.version) { extInfo.installed = d.version; if (extInfo.latest) showPopup(); }
  });
}
