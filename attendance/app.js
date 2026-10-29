// 출결관리 도우미 앱 진입점: 화면 전환, 헤더, 탭바
import { todayStr } from './shared/model.js';
import { missingDocs } from './shared/rules.js';
import { store, loadLocal, subscribe, syncNow, refreshSyncStatus, pendingCount } from './store.js';
import { driveConfigured } from './drive.js';
import { todayView, recordsView, docsView, studentsView, storageText } from './views.js';
import { settingsView, setupView } from './settings.js';
import { esc, icon, toast } from './ui.js';

const VIEWS = { today: todayView, records: recordsView, docs: docsView, students: studentsView, settings: settingsView };
const TABS = [
  ['today', '오늘', 'today'],
  ['records', '기록', 'list'],
  ['docs', '서류', 'doc'],
  ['students', '학생', 'user'],
];

const mainRef = { el: document.getElementById('main') };
const appbar = document.getElementById('appbar');
const tabbar = document.getElementById('tabbar');
const banner = document.getElementById('sync-banner');
let current = null;
let lastTab = 'today';

function route() {
  const r = location.hash.replace('#', '');
  return VIEWS[r] ? r : 'today';
}

function classLabel() {
  const s = store.data?.settings;
  return s ? `${s.grade}학년 ${s.classNo}반` : '';
}

function renderAppbar(name) {
  const view = VIEWS[name];
  const sub = view?.sub ? view.sub() : classLabel();
  const connected = driveConfigured() && store.local.driveConnected;
  const st = store.sync.status;
  const syncBtn = connected
    ? `<button type="button" class="icon-btn${st === 'syncing' ? ' is-spinning' : ''}${st === 'auth' || st === 'error' ? ' has-alert' : ''}" id="btn-sync" aria-label="지금 동기화. ${esc(storageText())}">${icon('sync')}</button>`
    : '';
  if (name === 'settings') {
    appbar.innerHTML = `<div class="row">
        <button type="button" class="icon-btn" id="btn-back" aria-label="뒤로">${icon('back')}</button>
        <h1 class="appbar-title">설정</h1></div>
      <div class="row">${syncBtn}</div>`;
  } else {
    appbar.innerHTML = `<h1 class="appbar-title">${esc(view.title)}<span class="appbar-sub">${esc(sub)}</span></h1>
      <div class="row">${syncBtn}<a class="icon-btn" href="#settings" id="btn-settings" aria-label="설정">${icon('gear')}</a></div>`;
  }
}

// 구글 연결이 끊겨 자동 동기화가 안 될 때 한 번 탭으로 해결하는 배너
function renderBanner() {
  const connected = driveConfigured() && store.local.driveConnected && store.data && current !== 'setup';
  const st = store.sync.status;
  if (!connected || !['auth', 'error', 'offline'].includes(st)) { banner.hidden = true; banner.innerHTML = ''; return; }
  const n = pendingCount();
  const count = n ? ` · 올리지 않은 변경 ${n}건` : '';
  banner.hidden = false;
  if (st === 'offline') {
    banner.innerHTML = `<div class="sync-banner is-quiet" role="status">${icon('sync')}<span>오프라인입니다${count}. 인터넷이 연결되면 동기화합니다.</span></div>`;
  } else {
    const what = st === 'auth' ? '동기화하려면 누르세요' : '동기화하지 못했습니다. 다시 시도하려면 누르세요';
    banner.innerHTML = `<button type="button" class="sync-banner" id="btn-banner-sync">${icon('sync')}<span><strong>${what}</strong>${count}</span>${icon('chev')}</button>`;
  }
}

function renderTabbar(name) {
  const missing = store.data ? missingDocs(store.data.records, todayStr()).length : 0;
  tabbar.innerHTML = TABS.map(([key, label, ic]) => `
    <a class="tab" href="#${key}"${key === name ? ' aria-current="page"' : ''}>${icon(ic)}${label}${key === 'docs' && missing ? `<span class="dot num" aria-label="미제출 ${missing}건">${missing}</span>` : ''}</a>`).join('');
}

function show() {
  if (!store.data) return showSetup();
  const name = route();
  document.body.classList.remove('is-setup');
  tabbar.hidden = false;
  renderAppbar(name);
  renderTabbar(name);
  renderBanner();
  if (current !== name || !mainRef.el.firstElementChild) {
    current = name;
    if (name !== 'settings') lastTab = name;
    const fresh = mainRef.el.cloneNode(false); // 이전 화면의 이벤트 정리
    mainRef.el.replaceWith(fresh);
    mainRef.el = fresh;
    VIEWS[name].mount(fresh);
    window.scrollTo(0, 0);
  }
  document.title = `${VIEWS[name].title} - 출결관리 도우미`;
}

function showSetup() {
  current = 'setup';
  document.body.classList.add('is-setup');
  tabbar.hidden = true;
  banner.hidden = true;
  appbar.innerHTML = `<h1 class="appbar-title">${setupView.title}</h1>`;
  const fresh = mainRef.el.cloneNode(false);
  mainRef.el.replaceWith(fresh);
  mainRef.el = fresh;
  setupView.mount(fresh, () => {
    current = null;
    if (location.hash && location.hash !== '#today') location.hash = '#today';
    show();
    if (store.local.driveConnected) syncNow({ silent: true });
  });
}

appbar.addEventListener('click', async (e) => {
  if (e.target.closest('#btn-back')) {
    location.hash = '#' + lastTab;
  } else if (e.target.closest('#btn-sync')) {
    const ok = await syncNow({ interactive: true });
    toast(ok ? '동기화했습니다' : (store.sync.message || '동기화하지 못했습니다'), { danger: !ok });
  }
});

banner.addEventListener('click', async (e) => {
  if (!e.target.closest('#btn-banner-sync')) return;
  const ok = await syncNow({ interactive: true });
  toast(ok ? '동기화했습니다' : (store.sync.message || '동기화하지 못했습니다'), { danger: !ok });
});

window.addEventListener('hashchange', show);

subscribe((kind) => {
  if (!store.data || current === 'setup') return;
  const name = route();
  renderAppbar(name);
  renderTabbar(name);
  renderBanner();
  VIEWS[current]?.update?.(kind);
});

// ---------- 시작 ----------
loadLocal();
show();
if (store.data && store.local.driveConnected) {
  refreshSyncStatus();
  renderBanner();
  // 토큰이 남아 있으면 바로 동기화, 없으면 조용한 재요청 시도. 막히면 배너 표시
  syncNow({ silent: true });
}

// 서비스 워커 (오프라인)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('서비스 워커 등록 실패', e));
  });
}
