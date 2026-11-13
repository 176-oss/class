// 시작, 라우팅(#roster 등), 머리 메뉴, 드라이브 동기화 연결, 전역 상태 연결
import { h, clear, icon, focusEl } from './dom.js';
import { toast, alertBox, badge, openDialog } from './ui.js';
import * as store from './store.js';
import * as realDrive from './drive.js';
import { createFakeDrive } from './core/fake-drive.js';
import { createSync } from './sync.js';
import { startBridge, requestDone, onDoneList } from './ext-bridge.js';
import { applyNeisDone } from './core/neis-export.js';
import { rosterView } from './views/roster.js';
import { writeView } from './views/write.js';
import { gridView } from './views/grid.js';
import { styleView } from './views/style.js';
import { statusView } from './views/status.js';
import { neisView } from './views/neis.js';
import { backupView } from './views/backup.js';
import { settingsView } from './views/settings.js';
import { watchChecker } from './handoff-ui.js';

const ROUTES = [
  { name: 'roster', label: '명단', icon: 'users', view: rosterView },
  { name: 'write', label: '작성', icon: 'pen', view: gridView },
  { name: 'write-detail', label: '작성(자세히)', icon: 'pen', view: writeView, hidden: true },
  { name: 'style', label: '내 스타일', icon: 'brush', view: styleView },
  { name: 'status', label: '현황', icon: 'grid', view: statusView },
  { name: 'neis', label: 'NEIS 옮기기', icon: 'send', view: neisView },
  { name: 'backup', label: '백업', icon: 'archive', view: backupView },
  { name: 'settings', label: '설정', icon: 'gear', view: settingsView },
];
const BY_NAME = Object.fromEntries(ROUTES.map((r) => [r.name, r]));

const devMode = new URLSearchParams(location.search).get('dev') === '1';
const FAKE_DRIVE_FLAG = 'sgb-v2-dev-fake-drive';
const INTRO_FLAG = 'sgb-v2-drive-intro';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 막혀 있으면 넘어감 */ } };

// 가짜 드라이브는 ?dev=1 이고 개발용 표시가 켜져 있을 때만. 구글로 아무것도 보내지 않는다
const fakeDrive = devMode && lsGet(FAKE_DRIVE_FLAG) === '1';
const drive = fakeDrive ? createFakeDrive({ storage: localStorage }) : realDrive;

const main = document.getElementById('main');
const navEl = document.getElementById('navtabs');
const badgesEl = document.getElementById('appbar-badges');
const bannerRoot = document.getElementById('banner-root');
const syncStatusEl = document.getElementById('sync-status');
const syncSaveBtn = document.getElementById('sync-save');

let current = null; // { name, view }
let firstRender = true;
let sync = null;
let saving = false;

function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  const [name, query = ''] = raw.split('?');
  return { name, params: new URLSearchParams(query) };
}

function buildHash(name, params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return `#${name}${s ? `?${s}` : ''}`;
}

const hhmm = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const ctx = {
  devMode,
  fakeDrive,
  drive,
  /** 다른 화면으로 이동 */
  go(name, params) { location.hash = buildHash(name, params); },
  /** 같은 화면 안에서 주소만 바꿈 (화면을 다시 그리지 않음) */
  setParams(name, params) { history.replaceState(null, '', buildHash(name, params) + ''); },
  // 가짜 AI는 주소에 ?dev=1 이 있고 설정이 켜져 있을 때만. 일반 주소에서는 언제나 실제 AI
  isFakeAI() { return devMode && !!store.state.settings?.devFakeAI; },
  hasKey() { return !!store.getApiKey(); },
  sync: () => sync,
  syncConnected: () => !!sync?.status.connected,
  hhmm,
  saveToDrive,
  connectDrive,
};

function renderNav(active) {
  clear(navEl, ROUTES.filter((r) => !r.hidden).map((r) => h('a', {
    class: 'navtab', href: `#${r.name}`, 'aria-current': (r.name === active || (active === 'write-detail' && r.name === 'write')) ? 'page' : null,
  }, icon(r.icon), r.label)));
}

function renderBadges() {
  clear(badgesEl,
    ctx.isFakeAI() ? badge('가짜 AI 모드', 'warn') : null,
    fakeDrive ? badge('가짜 드라이브 모드', 'warn') : null,
    !store.state.persistent ? badge('저장 안 됨', 'danger') : null);
}

// ---------- 머리 줄 저장 상태와 [구글 드라이브에 저장] ----------
const STATUS_TEXT = {
  idle: (s) => `구글 드라이브에 저장됨 ${hhmm(s.lastSyncAt)}`.trim(),
  pending: () => '저장 중',
  saving: () => '저장 중',
  offline: () => '연결되면 올립니다',
  off: () => '드라이브 연결 안 됨: 이 브라우저에만 저장',
  auth: () => '구글 연결 확인 필요',
  error: () => '드라이브 저장 실패',
};

function renderSync() {
  if (!drive.isConfigured()) { clear(syncStatusEl); syncSaveBtn.hidden = true; return; }
  const s = sync?.status || { state: 'off', connected: false };
  const text = (STATUS_TEXT[s.state] || STATUS_TEXT.off)(s);
  const warn = s.state === 'off' || s.state === 'auth' || s.state === 'error';
  clear(syncStatusEl, s.state === 'off'
    ? h('a', { class: 'sync-status-text is-warn', href: '#settings?card=drive' }, text)
    : h('span', { class: ['sync-status-text', warn && 'is-warn'] }, text));
  const busy = saving || s.state === 'saving';
  const label = busy ? '저장 중' : s.connected ? '구글 드라이브에 저장' : '구글 드라이브 연결';
  syncSaveBtn.hidden = false;
  syncSaveBtn.disabled = busy;
  syncSaveBtn.setAttribute('aria-label', label);
  clear(syncSaveBtn, icon('drive'), h('span', { class: 'sync-save-text' }, label));
}

function failToast(res, retry) {
  const msg = res?.error?.userMessage || '구글 드라이브에 저장하지 못했습니다';
  toast(msg, { danger: true, action: res?.error?.kind === 'auth' ? '다시 연결' : '다시 시도', onAction: retry });
}

/** [구글 드라이브에 저장]: 연결됐으면 바로 올리고, 아니면 연결한 뒤 저장 */
async function saveToDrive() {
  if (!sync || saving) return null;
  if (!sync.status.connected) return connectDrive();
  saving = true;
  renderSync();
  try {
    try { current?.view.flush?.(); } catch (e) { console.error(e); }
    const res = await sync.syncNow({ reason: 'button' });
    if (res.ok) toast(res.unchanged ? '이미 저장되어 있습니다' : `구글 드라이브에 저장했습니다 ${hhmm(sync.status.lastSyncAt)}`);
    else failToast(res, saveToDrive);
    return res;
  } finally {
    saving = false;
    renderSync();
  }
}

async function connectDrive() {
  if (!sync || saving) return null;
  saving = true;
  renderSync();
  try {
    const res = await sync.connect();
    if (res.ok && res.restored) toast(`드라이브에서 학생 ${res.restored.students}명, 기록 ${res.restored.records}건을 불러왔습니다`);
    else if (res.ok) toast(`구글 드라이브에 연결했습니다. 저장됨 ${hhmm(sync.status.lastSyncAt)}`);
    else if (!res.cancelled) failToast(res, connectDrive);
    return res;
  } finally {
    saving = false;
    renderSync();
  }
}

/** 처음 연결에 양쪽 데이터가 있을 때 고르기. null이면 연결 안 함 */
function chooseFirstSync({ local, remote }) {
  const row = (label, s) => h('tr', {},
    h('th', { scope: 'row' }, label),
    h('td', { class: 'num' }, `${s.students}명`),
    h('td', { class: 'num' }, `${s.records}건`),
    h('td', {}, s.updatedAt ? new Date(s.updatedAt).toLocaleString('ko-KR') : '모름'));
  const dlg = openDialog({
    title: '어느 데이터를 쓸까요?',
    wide: true,
    body: [
      h('p', {}, '이 브라우저와 구글 드라이브 양쪽에 데이터가 있습니다. 고르기 전에 양쪽을 자동으로 백업해 두었습니다.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('caption', { class: 'sr-only' }, '양쪽 데이터 요약'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '위치'), h('th', { scope: 'col' }, '학생'), h('th', { scope: 'col' }, '기록'), h('th', { scope: 'col' }, '마지막 수정'))),
        h('tbody', {}, row('이 브라우저', local), row('구글 드라이브', remote)))),
      h('p', { class: 'small' }, '합치기: 같은 기록은 더 늦게 고친 쪽을 씁니다. 닫으면 연결하지 않습니다.'),
    ],
    actions: [
      { label: '이 브라우저 것으로 드라이브 바꾸기', variant: 'secondary', value: 'local' },
      { label: '드라이브 것만 쓰기', variant: 'secondary', value: 'remote' },
      { label: '합치기', variant: 'primary', value: 'merge', autofocus: true },
    ],
  });
  return dlg.closed.then((v) => v || null);
}

function renderBanner() {
  const items = [];
  if (store.state.loadError) items.push(alertBox('danger', store.state.loadError, { title: '저장 공간을 열 수 없습니다' }));
  if (store.state.newer) items.push(alertBox('warn', '이 브라우저에 더 새 버전의 앱이 저장한 데이터가 있습니다. 새로고침해서 최신 버전으로 열어 주세요.'));
  if (store.state.save.status === 'error') items.push(alertBox('danger', store.state.save.message || '저장하지 못했습니다.', { role: 'alert' }));
  const s = sync?.status;
  if (s && drive.isConfigured()) {
    if (s.state === 'off') {
      items.push(alertBox('warn', h('div', { class: 'stack gap-1' },
        h('p', {}, '구글 드라이브에 연결하지 않아 이 브라우저에만 저장됩니다. 사이트 데이터를 지우거나 PC를 바꾸면 사라질 수 있습니다.'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: connectDrive }, icon('drive'), '구글 드라이브 연결'))),
      { title: '드라이브 연결 안 됨' }));
    } else if (s.state === 'auth') {
      items.push(alertBox('warn', h('div', { class: 'stack gap-1' },
        h('p', {}, `${s.message || '구글 연결 확인이 필요합니다'}. 바뀐 내용은 이 브라우저에 남아 있고, 다시 연결하면 올립니다.`),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: saveToDrive }, '다시 연결'))),
      { title: '구글 연결 확인' }));
    } else if (s.state === 'error') {
      items.push(alertBox('danger', h('div', { class: 'stack gap-1' },
        h('p', {}, s.message || '구글 드라이브에 저장하지 못했습니다'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-secondary', onclick: saveToDrive }, '다시 시도'))),
      { title: '드라이브 저장 실패', role: 'alert' }));
    }
  }
  clear(bannerRoot, items.length ? h('div', { class: 'banner stack' }, items) : null);
}

function route() {
  let { name, params } = parseHash();
  if (!BY_NAME[name]) {
    name = store.listClasses().length ? 'write' : 'roster';
    history.replaceState(null, '', `#${name}`);
    params = new URLSearchParams();
  }
  if (current) {
    try { current.view.unmount?.(); } catch (e) { console.error(e); }
  }
  const r = BY_NAME[name];
  current = { name, view: r.view };
  renderNav(name);
  clear(main);
  try {
    r.view.mount(main, params, ctx);
  } catch (e) {
    console.error(e);
    clear(main, alertBox('danger', '화면을 그리는 중 문제가 생겼습니다. 새로고침해 주세요.', { role: 'alert' }));
  }
  document.title = `${r.label} - 생기부 작성 도우미`;
  if (!firstRender) {
    window.scrollTo(0, 0);
    focusEl(main.querySelector('h1') || main);
  }
  firstRender = false;
}

async function handleDoneList(items) {
  try {
    const { updated } = await applyNeisDone([...store.state.records.values()], items);
    // 이미 같은 표시가 있는 기록은 빼고 바뀐 것만 저장
    const changed = (updated || []).filter((r) => {
      const cur = store.state.records.get(r.id);
      return !cur?.neis || cur.neis.hash !== r.neis.hash || cur.neis.doneAt !== r.neis.doneAt;
    });
    if (changed.length) {
      store.putRecords(changed);
      toast(`나이스 입력 완료 ${changed.length}건을 반영했습니다`);
    }
  } catch (e) {
    console.error(e);
  }
}

function onSyncEvent(e) {
  if (e.type === 'status') {
    renderSync();
    renderBanner();
    try { current?.view.update?.('sync', e.status); } catch (err) { console.error(err); }
  } else if (e.type === 'restored') {
    toast(`드라이브에서 학생 ${e.students}명, 기록 ${e.records}건을 불러왔습니다`);
  } else if (e.type === 'merged' && e.fromRemote && !['start', 'button'].includes(e.reason)) {
    const n = e.changes.added + e.changes.updated + e.changes.removed;
    toast(`드라이브에서 바뀐 내용 ${n}건을 반영했습니다`);
  } else if (e.type === 'secrets-offer') {
    offerSecrets(e);
  }
}

async function offerSecrets(e) {
  if (store.state.settings.publicPC) return; // 공용 PC에는 드라이브의 키를 내려받지 않는다
  if (e.geminiKey === store.getApiKey()) { await sync.answerSecrets(e.updatedAt); return; }
  const dlg = openDialog({
    title: '드라이브에 저장된 API 키를 쓸까요?',
    body: h('p', {}, '다른 PC에서 구글 드라이브에 저장한 Gemini API 키가 있습니다. 이 PC에서도 쓰면 다시 입력하지 않아도 됩니다.'),
    actions: [
      { label: '이 PC에서는 쓰지 않기', variant: 'secondary', value: false },
      { label: '쓰기', variant: 'primary', value: true, autofocus: true },
    ],
  });
  const use = await dlg.closed;
  if (use === undefined) return; // 닫기만 하면 다음에 다시 묻는다
  if (use) { store.setApiKey(e.geminiKey, store.state.settings.keyStorage || 'local'); toast('드라이브에 저장된 API 키를 씁니다'); }
  await sync.answerSecrets(e.updatedAt);
}

function firstRunIntro() {
  if (!store.firstRun || lsGet(INTRO_FLAG) || !drive.isConfigured()) return;
  lsSet(INTRO_FLAG, '1');
  const dlg = openDialog({
    title: '구글 드라이브에 연결 (추천)',
    body: [
      h('p', {}, '쓴 글을 선생님의 구글 드라이브(앱 전용 폴더)에 저장합니다. 브라우저의 사이트 데이터가 지워지거나 학교 PC가 초기화되어도 다시 연결하면 되살아나고, 다른 PC에서도 이어서 쓸 수 있습니다.'),
      h('p', { class: 'small' }, '학교 계정은 막혀 있을 수 있으니 개인 구글 계정을 권합니다. 앱 전용 폴더는 드라이브 목록에 보이지 않고 공유되지 않습니다.'),
    ],
    actions: [
      { label: '나중에', variant: 'secondary', value: false },
      { label: '구글 드라이브에 연결', variant: 'primary', value: true, autofocus: true },
    ],
  });
  dlg.closed.then((v) => { if (v) connectDrive(); });
}

// 가짜 드라이브로 연결한 상태는 가짜 드라이브 모드에서만 쓴다. 모드가 다르면 '연결 안 됨'으로 다뤄 진짜 드라이브를 부르지 않는다
function syncLocalFor(mode) {
  const base = store.syncLocal;
  // driveMode가 없던 예전 상태: 가짜 드라이브 파일 id는 'f1' 꼴
  const modeOf = (s) => s.driveMode || (/^f\d+$/.test(String(s.fileId || '')) ? 'fake' : 'real');
  return {
    ...base,
    async readState() {
      const s = await base.readState();
      if (!s.connected || modeOf(s) === mode) return s;
      return { ...s, connected: false, fileId: null, stamp: null, lastSyncAt: null };
    },
    writeState: (patch) => base.writeState({ ...patch, driveMode: mode }),
  };
}

async function start() {
  await store.init();
  document.getElementById('boot-msg')?.remove();
  drive.setTokenMode(store.state.settings.publicPC ? 'session' : 'local');
  sync = createSync({ drive, local: syncLocalFor(fakeDrive ? 'fake' : 'real'), isOnline: () => navigator.onLine !== false, choose: chooseFirstSync });
  sync.on(onSyncEvent);
  store.setBeforeSyncRead(() => current?.view.flush?.());
  syncSaveBtn.addEventListener('click', saveToDrive);
  renderBadges();
  renderBanner();
  renderSync();
  store.subscribe((kind, detail) => {
    if (kind === 'local-change') { sync.notifyChange(); return; }
    if (kind === 'settings' || kind === 'all') renderBadges();
    if (kind === 'settings' && detail?.keys?.includes('publicPC')) drive.setTokenMode(store.state.settings.publicPC ? 'session' : 'local');
    if (kind === 'save') { renderBanner(); }
    if (current) {
      try { current.view.update?.(kind, detail); } catch (e) { console.error(e); }
    }
  });
  window.addEventListener('hashchange', route);
  route();

  watchChecker();
  startBridge();
  onDoneList(handleDoneList);
  requestDone();

  sync.start().catch(() => console.warn('동기화를 시작하지 못했습니다'));
  firstRunIntro();

  const flushAll = () => {
    try { current?.view.flush?.(); } catch (e) { console.error(e); }
    store.flush();
  };
  window.addEventListener('pagehide', () => { flushAll(); sync.flushNow(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flushAll(); sync.flushNow(); } else sync.check();
  });
  window.addEventListener('online', () => sync.syncNow({ reason: 'online' }));
  setInterval(() => { if (document.visibilityState === 'visible') sync.check(); }, 5 * 60 * 1000);
  window.addEventListener('beforeunload', (e) => {
    try { current?.view.flush?.(); } catch { /* 넘어감 */ }
    if (store.state.save.status === 'pending' || store.state.save.status === 'saving') {
      store.flush();
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

start().catch((e) => {
  console.error(e);
  clear(main, alertBox('danger', '앱을 시작하지 못했습니다. 새로고침해 주세요.', { role: 'alert' }));
});
