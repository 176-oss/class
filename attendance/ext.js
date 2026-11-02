// 학교 PC 확장프로그램: 최신 버전 확인, 설치된 버전 감지, 업데이트 알림
// - 최신 버전: 같은 폴더의 extension-version.json (서비스 워커가 캐시하지 않음, 항상 네트워크)
// - 설치된 버전: 확장의 content/version.js 가 <html data-ah-ext-version> 과 postMessage로 버전만 알려 줌
// - 개인정보: 페이지와 확장 사이에는 버전 문자열 하나만 오간다.
import { compareVersions, todayStr } from './shared/model.js';
import { esc, icon, openSheet, closeSheet } from './ui.js';

export const VERSION_FILE = './extension-version.json';
const SKIP_KEY = 'ah.ext.skip';    // [이 버전은 알리지 않기]: 그 버전 문자열
const LATER_KEY = 'ah.ext.later';  // [나중에]: 그 날짜 (YYYY-MM-DD). 다음 날 다시 알림
const CHECK_KEY = 'ah.ext.checked'; // 화면 복귀 때 하루 1회 확인: 마지막 확인 날짜

export const ext = {
  installed: null,   // 이 PC에 설치된 버전 (감지 못하면 null)
  detected: false,   // 감지 시도를 마쳤는지
  latest: null,      // {version, date, zip, notes}
  failed: false,     // 최신 버전 정보를 받지 못함
};

const listeners = new Set();
export function onExtChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(); } catch (e) { console.warn(e); } } }

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 무시 */ } };

function readDataset() {
  const v = document.documentElement.dataset.ahExtVersion;
  return v && /^\d+(\.\d+)*$/.test(v) ? v : null;
}

// 확장이 알려 준 버전 받기. 확장이 없으면 timeout 뒤 null.
window.addEventListener('message', (ev) => {
  if (ev.source !== window) return;
  const d = ev.data;
  if (!d || d.source !== 'ah-ext' || d.type !== 'version' || typeof d.version !== 'string') return;
  if (!/^\d+(\.\d+)*$/.test(d.version)) return;
  if (ext.installed !== d.version) {
    ext.installed = d.version;
    ext.detected = true;
    emit();
    // 감지 대기 시간이 지난 뒤 늦게 알려 온 경우에도 알림
    if (ext.latest && !checking) showUpdatePopup();
  }
});

export function detectInstalled(timeout = 1500) {
  const now = readDataset();
  if (now) { ext.installed = now; ext.detected = true; return Promise.resolve(now); }
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMsg);
      clearTimeout(timer);
      ext.installed = v || ext.installed;
      ext.detected = true;
      resolve(ext.installed);
    };
    const onMsg = (ev) => {
      if (ev.source === window && ev.data && ev.data.source === 'ah-ext' && ev.data.type === 'version') finish(ev.data.version);
    };
    window.addEventListener('message', onMsg);
    const timer = setTimeout(() => finish(readDataset()), timeout);
    // 콘텐츠 스크립트가 늦게 들어왔으면 다시 알려 달라고 요청
    try { window.postMessage({ source: 'ah-app', type: 'ping' }, location.origin); } catch { /* 무시 */ }
  });
}

export async function fetchLatest() {
  // 오프라인이면 받지 않음 (온라인 복귀 때 다시 확인)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { ext.failed = !ext.latest; return ext.latest; }
  try {
    const res = await fetch(VERSION_FILE, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    if (!j || typeof j.version !== 'string' || !/^\d+(\.\d+)*$/.test(j.version)) throw new Error('형식');
    ext.latest = {
      version: j.version,
      date: typeof j.date === 'string' ? j.date : '',
      zip: typeof j.zip === 'string' && /^[\w.-]+\.zip$/.test(j.zip) ? j.zip : 'attendance-extension.zip',
      notes: Array.isArray(j.notes) ? j.notes.filter((n) => typeof n === 'string').slice(0, 8) : [],
    };
    ext.failed = false;
  } catch {
    ext.failed = !ext.latest;
  }
  return ext.latest;
}

export const zipUrl = () => `./${ext.latest?.zip || 'attendance-extension.zip'}`;
export const needsUpdate = () => !!(ext.installed && ext.latest && compareVersions(ext.installed, ext.latest.version) < 0);

export function downloadZip() {
  const a = document.createElement('a');
  a.href = zipUrl();
  a.download = ext.latest?.zip || 'attendance-extension.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 설치·업데이트 순서 (팝업 안 안내, 설정 카드에서도 씀)
export const UPDATE_STEPS = [
  '내려받은 압축 파일을 풀어 기존 확장프로그램 폴더에 덮어씁니다.',
  '크롬 주소창에 chrome://extensions 를 열고 출결관리 도우미의 새로고침 버튼을 누릅니다.',
  '나이스 화면에서 F5를 눌러 새로고침합니다.',
];

let popupOpen = false;
let retryTimer = null;

function shouldPopup() {
  if (!needsUpdate()) return false;
  const v = ext.latest.version;
  if (lsGet(SKIP_KEY) === v) return false;
  if (lsGet(LATER_KEY) === todayStr()) return false;
  return true;
}

// 다른 시트·모달이 열려 있거나 처음 설정 중이면 잠시 뒤 다시
function canShowNow() {
  const root = document.getElementById('overlay-root');
  return !(root && root.firstElementChild) && !document.body.classList.contains('is-setup') && document.visibilityState === 'visible';
}

export function showUpdatePopup() {
  if (popupOpen || !shouldPopup()) return false;
  if (!canShowNow()) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(showUpdatePopup, 5000);
    return false;
  }
  const v = ext.latest.version;
  const notes = ext.latest.notes || [];
  popupOpen = true;
  const el = openSheet(`
    <div class="modal-head"><h2 class="modal-title" id="ext-update-title">확장프로그램 새 버전이 있습니다</h2></div>
    <div id="ext-update-body" class="stack-sm">
      <p class="small num" style="margin:0" id="ext-update-versions">설치됨 <strong>${esc(ext.installed)}</strong> → 최신 <strong>${esc(v)}</strong></p>
      ${notes.length ? `<div><div class="label">업데이트 내용</div><ul class="guide-list small" id="ext-update-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-primary" data-ext="download">내려받기</button></div>
    <div class="modal-actions" style="margin-top: var(--sp-2)">
      <button type="button" class="btn btn-secondary" data-ext="later">나중에</button>
      <button type="button" class="btn btn-ghost" data-ext="skip">이 버전은 알리지 않기</button>
    </div>`, { center: true, labelledby: 'ext-update-title', onClose: () => { popupOpen = false; } });
  el.setAttribute('data-testid', 'ext-update');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ext]');
    if (!b) return;
    const act = b.dataset.ext;
    if (act === 'later') {
      lsSet(LATER_KEY, todayStr());
      closeSheet();
    } else if (act === 'skip') {
      lsSet(SKIP_KEY, v);
      closeSheet();
    } else if (act === 'download') {
      downloadZip();
      lsSet(LATER_KEY, todayStr()); // 받았으면 오늘은 다시 묻지 않음
      el.querySelector('#ext-update-body').innerHTML = `
        <p class="small" style="margin:0"><strong>내려받기를 시작했습니다.</strong> 다음 순서로 업데이트하세요.</p>
        <ol class="guide-list small" id="ext-update-steps">${UPDATE_STEPS.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <div class="alert alert-block" role="note">${icon('alert')}<div class="alert-body">확장프로그램 [제거]는 누르지 마세요. 제거하면 이 PC의 학생 명단이 지워집니다.</div></div>`;
      el.querySelectorAll('.modal-actions').forEach((x) => x.remove());
      const foot = document.createElement('div');
      foot.className = 'modal-actions';
      foot.innerHTML = '<a class="btn btn-secondary" href="guide.html#ext" target="_blank" rel="noopener">자세한 방법</a><button type="button" class="btn btn-primary" data-ext="close">확인</button>';
      el.appendChild(foot);
    } else if (act === 'close') {
      closeSheet();
    }
  });
  return true;
}

// 앱 시작 때 1회, 화면 복귀 때 하루 1회
let checking = null;
export function checkExtension({ force = false } = {}) {
  if (checking) return checking;
  if (!force && lsGet(CHECK_KEY) === todayStr() && ext.detected && ext.latest) return Promise.resolve(ext);
  checking = (async () => {
    try {
      const [installed] = await Promise.all([detectInstalled(), fetchLatest()]);
      lsSet(CHECK_KEY, todayStr());
      emit();
      if (installed) showUpdatePopup();
    } finally {
      checking = null;
    }
    return ext;
  })();
  return checking;
}

export function startExtensionWatch() {
  checkExtension({ force: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkExtension();
  });
  window.addEventListener('online', () => { if (!ext.latest) checkExtension({ force: true }); });
}
