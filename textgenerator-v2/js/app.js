// 시작, 라우팅(#roster 등), 머리 메뉴, 전역 상태 연결
import { h, clear, icon, focusEl } from './dom.js';
import { toast, alertBox, badge } from './ui.js';
import * as store from './store.js';
import { startBridge, requestDone, onDoneList } from './ext-bridge.js';
import { applyNeisDone } from './core/neis-export.js';
import { rosterView } from './views/roster.js';
import { writeView } from './views/write.js';
import { statusView } from './views/status.js';
import { neisView } from './views/neis.js';
import { backupView } from './views/backup.js';
import { settingsView } from './views/settings.js';

const ROUTES = [
  { name: 'roster', label: '명단', icon: 'users', view: rosterView },
  { name: 'write', label: '작성', icon: 'pen', view: writeView },
  { name: 'status', label: '현황', icon: 'grid', view: statusView },
  { name: 'neis', label: 'NEIS 옮기기', icon: 'send', view: neisView },
  { name: 'backup', label: '백업', icon: 'archive', view: backupView },
  { name: 'settings', label: '설정', icon: 'gear', view: settingsView },
];
const BY_NAME = Object.fromEntries(ROUTES.map((r) => [r.name, r]));

const devMode = new URLSearchParams(location.search).get('dev') === '1';
const main = document.getElementById('main');
const navEl = document.getElementById('navtabs');
const badgesEl = document.getElementById('appbar-badges');
const bannerRoot = document.getElementById('banner-root');

let current = null; // { name, view }
let firstRender = true;

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

const ctx = {
  devMode,
  /** 다른 화면으로 이동 */
  go(name, params) { location.hash = buildHash(name, params); },
  /** 같은 화면 안에서 주소만 바꿈 (화면을 다시 그리지 않음) */
  setParams(name, params) { history.replaceState(null, '', buildHash(name, params) + ''); },
  // 가짜 AI는 주소에 ?dev=1 이 있고 설정이 켜져 있을 때만. 일반 주소에서는 언제나 실제 AI
  isFakeAI() { return devMode && !!store.state.settings?.devFakeAI; },
  hasKey() { return !!store.getApiKey(); },
};

function renderNav(active) {
  clear(navEl, ROUTES.map((r) => h('a', {
    class: 'navtab', href: `#${r.name}`, 'aria-current': r.name === active ? 'page' : null,
  }, icon(r.icon), r.label)));
}

function renderBadges() {
  clear(badgesEl,
    ctx.isFakeAI() ? badge('가짜 AI 모드', 'warn') : null,
    !store.state.persistent ? badge('저장 안 됨', 'danger') : null);
}

function renderBanner() {
  const items = [];
  if (store.state.loadError) items.push(alertBox('danger', store.state.loadError, { title: '저장 공간을 열 수 없습니다' }));
  if (store.state.newer) items.push(alertBox('warn', '이 브라우저에 더 새 버전의 앱이 저장한 데이터가 있습니다. 새로고침해서 최신 버전으로 열어 주세요.'));
  if (store.state.save.status === 'error') items.push(alertBox('danger', store.state.save.message || '저장하지 못했습니다.', { role: 'alert' }));
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

async function start() {
  await store.init();
  document.getElementById('boot-msg')?.remove();
  renderBadges();
  renderBanner();
  store.subscribe((kind, detail) => {
    if (kind === 'settings' || kind === 'all') renderBadges();
    if (kind === 'save') { renderBanner(); }
    if (current) {
      try { current.view.update?.(kind, detail); } catch (e) { console.error(e); }
    }
  });
  window.addEventListener('hashchange', route);
  route();

  startBridge();
  onDoneList(handleDoneList);
  requestDone();

  const flushAll = () => {
    try { current?.view.flush?.(); } catch (e) { console.error(e); }
    store.flush();
  };
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
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
