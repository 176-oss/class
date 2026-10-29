// 로컬 저장 + 구글 드라이브 동기화
import { STORAGE_KEY, LOCAL_SETTINGS_KEY, normalizeData, mergeData, createRecord } from './shared/model.js';
import * as drive from './drive.js';

const listeners = new Set();
export const store = {
  data: null,          // 전체 데이터 (contract 2절)
  local: { driveConnected: false, fileId: null, lastSyncAt: null },
  sync: { status: 'local', message: '' }, // local | idle | syncing | error | auth | offline
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(kind) { for (const fn of listeners) { try { fn(kind); } catch (e) { console.warn(e); } } }

// ---------- 로컬 ----------
export function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    store.data = raw ? normalizeData(JSON.parse(raw)) : null;
  } catch {
    store.data = null;
  }
  try {
    store.local = { ...store.local, ...(JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY) || '{}') || {}) };
  } catch { /* 무시 */ }
  refreshSyncStatus();
  return store.data;
}

function writeLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.data));
    return true;
  } catch (e) {
    console.warn('로컬 저장 실패', e);
    return false;
  }
}
function writeLocalSettings() {
  try { localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(store.local)); } catch { /* 무시 */ }
}

let dirtySinceSync = false;
// 데이터를 바꾸고 저장. 로컬 저장은 동기, 동기화는 2초 뒤.
export function commit(mutator, { sync = true } = {}) {
  const draft = structuredClone(store.data);
  mutator(draft);
  draft.updatedAt = new Date().toISOString();
  store.data = draft;
  const ok = writeLocal();
  dirtySinceSync = true;
  emit('data');
  if (sync) scheduleSync();
  return ok;
}

export function initData(data) {
  store.data = normalizeData(data);
  writeLocal();
  emit('data');
}

// ---------- 기록 조작 ----------
export function addRecords(records) {
  return commit((d) => { d.records.push(...records); });
}
// 본문 수정: record.updatedAt 갱신. 바뀐 서류 항목만 docs[i].updatedAt 갱신 (계약 5절)
export function updateRecord(id, fields) {
  const now = new Date().toISOString();
  return commit((d) => {
    const i = d.records.findIndex((r) => r.id === id);
    if (i < 0) return;
    const prev = d.records[i];
    const docs = (fields.docs || prev.docs || []).map((doc, k) => {
      const old = (prev.docs || [])[k];
      const same = old && old.type === doc.type && !!old.submitted === !!doc.submitted && (old.name || '') === (doc.name || '');
      return same ? { ...doc, submittedAt: old.submittedAt, updatedAt: old.updatedAt || null } : { ...doc, updatedAt: now };
    });
    d.records[i] = createRecord({ ...prev, ...fields, docs, id, createdAt: prev.createdAt, groupId: prev.groupId, neis: prev.neis, updatedAt: now });
  });
}
export function deleteRecord(id) {
  return commit((d) => {
    d.records = d.records.filter((r) => r.id !== id);
    d.deleted.push({ id, deletedAt: new Date().toISOString() });
  });
}
export function restoreRecord(record) {
  return commit((d) => {
    d.deleted = d.deleted.filter((x) => x.id !== record.id);
    d.records.push({ ...record, updatedAt: new Date().toISOString() });
  });
}
// refs: [{recordId, docIndex}]
export function setDocsSubmitted(refs, submitted) {
  const now = new Date().toISOString();
  return commit((d) => {
    for (const { recordId, docIndex } of refs) {
      const r = d.records.find((x) => x.id === recordId);
      if (!r || !r.docs[docIndex]) continue;
      // 서류만 바꿈: record.updatedAt은 그대로 (계약 5절)
      r.docs[docIndex].submitted = submitted;
      r.docs[docIndex].submittedAt = submitted ? now : null;
      r.docs[docIndex].updatedAt = now;
    }
  });
}
export function updateSettings(settings) {
  return commit((d) => { d.settings = { ...d.settings, ...settings, updatedAt: new Date().toISOString() }; });
}
// 백업 파일 합치기. 계약 외 필드(이름 등)는 mergeData가 제거. 반환: 새로 들어온 기록 수
export function importData(incoming) {
  const before = new Set(store.data.records.map((r) => r.id));
  const merged = mergeData(store.data, incoming);
  store.data = merged;
  const ok = writeLocal();
  dirtySinceSync = true;
  emit('data');
  scheduleSync();
  if (!ok) throw new Error('이 기기에 저장하지 못했습니다. 저장 공간을 확인하세요.');
  return merged.records.filter((r) => !before.has(r.id)).length;
}

// 드라이브에 아직 올리지 않은 변경 수 (기록·서류·나이스·삭제·설정)
export function pendingCount() {
  if (!store.data) return 0;
  const last = Date.parse(store.local.lastSyncAt || '') || 0;
  const after = (t) => (Date.parse(t || '') || 0) > last;
  let n = 0;
  for (const r of store.data.records) {
    if (!last || after(r.updatedAt) || after(r.neis?.updatedAt) || (r.docs || []).some((d) => after(d.updatedAt))) n++;
  }
  n += store.data.deleted.filter((d) => !last || after(d.deletedAt)).length;
  if (store.data.settings.updatedAt && after(store.data.settings.updatedAt)) n++;
  return n;
}

// ---------- 동기화 ----------
function setSync(status, message = '') {
  store.sync = { status, message };
  emit('sync');
}
export function refreshSyncStatus() {
  if (!drive.driveConfigured() || !store.local.driveConnected) store.sync = { status: 'local', message: '' };
  else if (!navigator.onLine) store.sync = { status: 'offline', message: '' };
  else if (!drive.hasToken()) store.sync = { status: 'auth', message: '' };
  else if (store.sync.status === 'local' || store.sync.status === 'auth') store.sync = { status: 'idle', message: '' };
}

let syncTimer = null;
export function scheduleSync(delay = 2000) {
  if (!store.local.driveConnected || !drive.driveConfigured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncNow().catch(() => {}); }, delay);
}

let syncing = null;
// interactive: 버튼 클릭 안(팝업 허용). silent: 앱 열 때·화면 복귀 때 조용한 토큰 재요청 시도
export async function syncNow({ interactive = false, silent = false } = {}) {
  if (!drive.driveConfigured() || !store.local.driveConnected || !store.data) return false;
  if (!navigator.onLine) { setSync('offline'); return false; }
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      if (!drive.hasToken()) {
        if (interactive) await drive.requestToken();
        else if (silent) await drive.requestToken({ silent: true });
        else { setSync('auth'); return false; }
      }
      setSync('syncing');
      dirtySinceSync = false;
      const file = store.local.fileId ? { id: store.local.fileId } : await drive.findFile();
      let remote = null;
      let fileId = file?.id || null;
      if (fileId) {
        try { remote = await drive.downloadFile(fileId); } catch (e) {
          if (e instanceof drive.AuthError) throw e;
          // 저장된 id가 사라졌으면 다시 찾기
          const again = await drive.findFile();
          fileId = again?.id || null;
          remote = fileId ? await drive.downloadFile(fileId) : null;
        }
      }
      const firstSync = !store.local.lastSyncAt;
      const merged = mergeData(store.data, remote);
      // 이 기기에서 설정을 한 번도 저장하지 않았으면(첫 설정만 함) 처음 연결할 때 드라이브 설정을 따름
      if (firstSync && remote && !store.data.settings.updatedAt) merged.settings = normalizeData(remote).settings;
      // 동기화 중 로컬이 바뀌었으면 그 변경도 합침
      if (dirtySinceSync) Object.assign(merged, mergeData(merged, store.data));
      store.data = merged;
      writeLocal();
      emit('data');
      fileId = await drive.uploadFile(fileId, merged);
      store.local = { ...store.local, fileId, lastSyncAt: new Date().toISOString() };
      writeLocalSettings();
      setSync('idle');
      if (dirtySinceSync) scheduleSync(500);
      return true;
    } catch (e) {
      if (e instanceof drive.AuthError) setSync('auth', e.message);
      else setSync('error', e.message || '동기화하지 못했습니다.');
      return false;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

// 연결 (버튼 클릭 안에서 호출)
export async function connectDrive() {
  await drive.requestToken({ consent: true });
  store.local = { ...store.local, driveConnected: true, fileId: null, lastSyncAt: null };
  writeLocalSettings();
  setSync('idle');
  return syncNow({ interactive: true });
}

export async function disconnectDrive() {
  await drive.revoke();
  store.local = { ...store.local, driveConnected: false, fileId: null, lastSyncAt: null };
  writeLocalSettings();
  setSync('local');
}

window.addEventListener('online', () => { refreshSyncStatus(); emit('sync'); syncNow({ silent: true }); });
// 화면이 다시 보일 때 (휴대폰에서 앱으로 돌아옴)
let lastVisibleSync = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !store.local.driveConnected || !store.data) return;
  if (Date.now() - lastVisibleSync < 30000) return;
  lastVisibleSync = Date.now();
  syncNow({ silent: true });
});
window.addEventListener('offline', () => { if (store.local.driveConnected) setSync('offline'); });
