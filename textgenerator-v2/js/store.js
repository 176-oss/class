// 메모리 상태 + 자동 저장(디바운스) + 변경 알림
// 화면은 state를 읽기만 하고, 바꿀 때는 이 파일의 함수를 부른다.
import * as db from './db.js';
import { defaultSettings, defaultStyles, newRecord, deriveStatus, recordKey, AREAS_BY_KIND, AREA_LABELS, DEVICE_SETTING_KEYS } from './core/model.js';
import { checkRecord } from './core/check.js';
import { prepareReplace } from './core/sync-merge.js';

const SAVE_DELAY = 300; // 화면 쪽 0.6초 디바운스 뒤에 한 번 더 모아서 쓴다
const KEY_STORAGE_NAME = 'sgb-v2-api-key';
const TOKEN_KEY = 'sgb-v2-token';

export const state = {
  students: new Map(),
  classes: new Map(),
  records: new Map(),
  settings: null,
  styles: null,
  deleted: [], // Tombstone[] (contract 12-2)
  secrets: null, // 드라이브 저장을 켰을 때만 (contract 18절)
  snapshot: null,
  snapshots: {},
  persistent: true, // IndexedDB를 못 열면 false (메모리에서만)
  loadError: null,
  newer: false,
  save: { status: 'idle', message: '' }, // idle | pending | saving | saved | error
};

// ---------- 변경 알림 ----------
const listeners = new Set();
/** fn(kind, detail). kind: 'records' | 'classes' | 'students' | 'settings' | 'styles' | 'secrets' | 'all' | 'save' | 'key' | 'local-change' */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(kind, detail = {}) {
  for (const fn of [...listeners]) {
    try { fn(kind, detail); } catch (e) { console.error(e); }
  }
}

// ---------- 저장 ----------
const dirty = { students: new Set(), classes: new Set(), records: new Set() };
const deleted = { students: new Set(), classes: new Set(), records: new Set() };
let settingsDirty = false;
let stylesDirty = false;
let tombsDirty = false;
let secretsDirty = false;
let userDirty = false; // 드라이브에 올릴 사용자 변경 (flush가 meta.syncPending = true)
let saveTimer = null;
let saving = null;

/** 사용자 변경: 드라이브에 올릴 것으로 친다 */
function localChange() {
  userDirty = true;
  scheduleSave();
  emit('local-change');
}

function markDirty(store, id) {
  dirty[store].add(id);
  deleted[store].delete(id);
  // 같은 id를 다시 만들면 이 브라우저의 그 삭제 기록을 지운다
  const before = state.deleted.length;
  state.deleted = state.deleted.filter((d) => !(d.store === store && d.id === id));
  if (state.deleted.length !== before) tombsDirty = true;
  localChange();
}
function markDeleted(store, id) {
  deleted[store].add(id);
  dirty[store].delete(id);
  state.deleted = [...state.deleted.filter((d) => !(d.store === store && d.id === id)), { store, id, deletedAt: now() }];
  tombsDirty = true;
  localChange();
}

function setSave(status, message = '') {
  state.save = { status, message };
  emit('save', state.save);
}

function scheduleSave() {
  setSave('pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DELAY);
}

/** 기다리는 변경을 바로 쓴다 */
export async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (saving) await saving.catch(() => {});
  const put = {};
  const del = {};
  for (const name of ['students', 'classes', 'records']) {
    const map = state[name];
    const items = [...dirty[name]].map((id) => map.get(id)).filter(Boolean);
    if (items.length) put[name] = items;
    if (deleted[name].size) del[name] = [...deleted[name]];
    dirty[name].clear();
    deleted[name].clear();
  }
  const settings = settingsDirty ? state.settings : undefined;
  const styles = stylesDirty ? state.styles : undefined;
  const meta = {};
  if (tombsDirty) meta.deleted = state.deleted;
  if (secretsDirty) meta.secrets = state.settings?.publicPC ? null : state.secrets;
  if (userDirty) meta.syncPending = true;
  const flags = { settingsDirty, stylesDirty, tombsDirty, secretsDirty, userDirty };
  settingsDirty = false; stylesDirty = false; tombsDirty = false; secretsDirty = false; userDirty = false;
  if (!Object.keys(put).length && !Object.keys(del).length && !settings && !styles && !Object.keys(meta).length) {
    if (state.save.status === 'pending') setSave('saved');
    return;
  }
  if (meta.syncPending) syncMeta.pending = true;
  if (!state.persistent) { setSave('saved', '이 창을 닫으면 사라집니다'); return; }
  setSave('saving');
  saving = db.writeChanges({ put, del, settings, styles, meta });
  try {
    await saving;
    setSave('saved');
  } catch (e) {
    console.error(e);
    // 실패한 것은 다시 쓰도록 표시
    for (const [name, items] of Object.entries(put)) {
      for (const it of items) dirty[name].add(it[name === 'students' ? 'studentId' : 'id']);
    }
    for (const [name, ids] of Object.entries(del)) for (const id of ids) deleted[name].add(id);
    if (flags.settingsDirty) settingsDirty = true;
    if (flags.stylesDirty) stylesDirty = true;
    if (flags.tombsDirty) tombsDirty = true;
    if (flags.secretsDirty) secretsDirty = true;
    if (flags.userDirty) userDirty = true;
    setSave('error', '저장하지 못했습니다. 저장 공간이 부족하거나 브라우저가 저장을 막았을 수 있습니다.');
  } finally {
    saving = null;
  }
}

// ---------- 시작 ----------
function fillSettings(s) {
  const base = defaultSettings();
  if (!s) return base;
  return { ...base, ...s, limits: { ...base.limits, ...(s.limits || {}) } };
}

/** init이 설정을 새로 만든 첫 실행이면 true (처음 연결 안내용) */
export let firstRun = false;
let syncMeta = { state: {}, pending: false }; // meta.sync, meta.syncPending 사본

export async function init() {
  try {
    const data = await db.loadAll();
    loadInto(data);
    state.deleted = data.deleted || [];
    state.secrets = data.secrets || null;
    state.snapshots = data.snapshots || {};
    state.snapshot = data.snapshot;
    state.newer = data.newer;
    syncMeta = { state: data.syncState || {}, pending: !!data.syncPending };
    if (!data.settings) { firstRun = true; settingsDirty = true; scheduleSave(); }
  } catch (e) {
    console.error(e);
    state.persistent = false;
    state.loadError = e instanceof db.DbError ? e.message : '저장 공간을 여는 중 문제가 생겼습니다. 이 창을 닫으면 입력한 내용이 사라집니다.';
    loadInto({ students: [], classes: [], records: [], settings: null });
  }
  loadKeyFromStorage();
}

function loadInto({ students = [], classes = [], records = [], settings, styles }) {
  state.students = new Map(students.map((s) => [s.studentId, s]));
  state.classes = new Map(classes.map((c) => [c.id, c]));
  state.records = new Map(records.map((r) => [r.id, r]));
  state.settings = fillSettings(settings);
  state.styles = styles && styles.areas ? styles : defaultStyles();
}

const now = () => new Date().toISOString();

// ---------- 읽기 ----------
export function listClasses() {
  return [...state.classes.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
export function getClass(id) { return state.classes.get(id) || null; }
export function getStudent(id) { return state.students.get(id) || null; }
export function studentsOf(cls) {
  if (!cls) return [];
  return cls.studentIds.map((id) => state.students.get(id)).filter(Boolean)
    .sort((a, b) => a.studentId.localeCompare(b.studentId));
}
export function classesOfStudent(studentId) {
  return listClasses().filter((c) => c.studentIds.includes(studentId));
}
/** 저장된 기록 또는 null */
export function findRecord(studentId, area, subject = null) {
  return state.records.get(recordKey(studentId, area, area === 'subject' ? subject : null)) || null;
}
/** 기록이 없으면 메모리에 새로 만든다 (첫 수정 때 저장됨) */
export function getRecord(studentId, area, subject = null) {
  const sub = area === 'subject' ? subject : null;
  const id = recordKey(studentId, area, sub);
  let r = state.records.get(id);
  if (!r) {
    // updatedAt null: 아직 저장 안 된 빈 기록. 동기화에 올리지 않고, 합치기에서 언제나 진다
    r = { ...newRecord(studentId, area, sub), updatedAt: null };
    state.records.set(id, r);
  }
  return r;
}
export function snapshotData() {
  return {
    students: [...state.students.values()],
    classes: [...state.classes.values()],
    records: [...state.records.values()].filter(hasContent),
    settings: state.settings,
    styles: state.styles,
  };
}

/** 동기화용: 저장된 기록 전부 + styles, deleted, secrets (contract 15절) */
export function getSyncData() {
  return {
    students: [...state.students.values()],
    classes: [...state.classes.values()],
    records: [...state.records.values()].filter((r) => r.updatedAt != null),
    settings: state.settings,
    styles: state.styles,
    deleted: state.deleted,
    secrets: state.secrets,
  };
}
function hasContent(r) {
  return !!(r.memo || r.draft || r.final || (r.candidates && r.candidates.length) || (r.traits && r.traits.length) || r.achievement || r.neis || r.status === 'done' || (r.length && r.length !== 'standard'));
}

// ---------- 기록 ----------
/** 기록 하나 고치기. patch.status를 주지 않으면 done이 아닐 때 상태를 다시 계산 */
export function updateRecord(id, patch, { touch = true } = {}) {
  const cur = state.records.get(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  if (!('status' in patch) && next.status !== 'done') next.status = deriveStatus(next);
  if (touch) next.updatedAt = now();
  state.records.set(id, next);
  markDirty('records', id);
  emit('records', { ids: [id] });
  return next;
}

/** 여러 기록을 통째로 바꿔 넣기 (NEIS 입력 완료 반영 등) */
export function putRecords(list) {
  if (!list.length) return;
  for (const r of list) { state.records.set(r.id, r); markDirty('records', r.id); }
  emit('records', { ids: list.map((r) => r.id) });
}

// ---------- 학생, 반 ----------
export function upsertStudents(list) {
  for (const s of list) {
    const cur = state.students.get(s.studentId);
    state.students.set(s.studentId, { ...(cur || {}), studentId: s.studentId, name: s.name, updatedAt: now() });
    markDirty('students', s.studentId);
  }
  emit('students', { ids: list.map((s) => s.studentId) });
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

export function createClass({ name, kind, subject = null, achievement = '' }) {
  const t = now();
  const cls = {
    id: `c_${randomId()}`,
    name: String(name).trim(),
    kind,
    subject: kind === 'subject' ? (String(subject || '').trim() || null) : null,
    achievement: kind === 'subject' ? String(achievement || '') : '',
    studentIds: [],
    createdAt: t,
    updatedAt: t,
  };
  state.classes.set(cls.id, cls);
  markDirty('classes', cls.id);
  emit('classes', { ids: [cls.id] });
  return cls;
}

export function updateClass(id, patch) {
  const cur = state.classes.get(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, updatedAt: now() };
  state.classes.set(id, next);
  markDirty('classes', id);
  emit('classes', { ids: [id] });
  return next;
}

export function deleteClass(id) {
  if (!state.classes.has(id)) return;
  state.classes.delete(id);
  markDeleted('classes', id);
  emit('classes', { ids: [id], deleted: true });
}

export function addStudentsToClass(classId, studentIds) {
  const cls = state.classes.get(classId);
  if (!cls) return 0;
  const set = new Set(cls.studentIds);
  let added = 0;
  for (const id of studentIds) if (!set.has(id)) { set.add(id); added += 1; }
  updateClass(classId, { studentIds: [...set].sort() });
  return added;
}

export function removeStudentFromClass(classId, studentId) {
  const cls = state.classes.get(classId);
  if (!cls) return;
  updateClass(classId, { studentIds: cls.studentIds.filter((x) => x !== studentId) });
}

/** 교과반 과목명을 바꿀 때 그 반 학생의 교과세특 기록을 새 과목명으로 옮김 (새 이름 기록이 이미 있으면 그대로 둠) */
export function renameSubjectRecords(studentIds, oldSubject, newSubject) {
  if (!oldSubject || !newSubject || oldSubject === newSubject) return 0;
  let moved = 0;
  for (const sid of studentIds) {
    const oldId = recordKey(sid, 'subject', oldSubject);
    const newId = recordKey(sid, 'subject', newSubject);
    const r = state.records.get(oldId);
    if (!r || state.records.has(newId)) continue;
    state.records.set(newId, { ...r, id: newId, subject: newSubject, neis: null, updatedAt: now() });
    state.records.delete(oldId);
    markDirty('records', newId);
    markDeleted('records', oldId);
    moved += 1;
  }
  if (moved) emit('records', { ids: [] });
  return moved;
}

// ---------- 설정 ----------
export function updateSettings(patch) {
  const shared = Object.keys(patch).some((k) => !DEVICE_SETTING_KEYS.includes(k));
  state.settings = { ...state.settings, ...patch, ...(shared ? { updatedAt: now() } : {}) };
  settingsDirty = true;
  if ('publicPC' in patch) secretsDirty = true; // 공용 PC면 secrets 사본을 지움
  emit('settings', { keys: Object.keys(patch) });
  if (shared) localChange(); else scheduleSave();
}

// ---------- 내 스타일, secrets ----------
export function getStyles() { return state.styles; }
/** 통째로 바꿈. B가 core/style.js 순수 함수로 만든 결과를 넣는다 */
export function setStyles(next) {
  state.styles = next && next.areas ? next : defaultStyles();
  stylesDirty = true;
  emit('styles');
  localChange();
}

export function getSecrets() { return state.secrets; }
/** 공용 PC면 IndexedDB에 쓰지 않고 메모리에만 */
export function setSecrets(next) {
  state.secrets = next || null;
  secretsDirty = true;
  emit('secrets');
  localChange();
}

/** 그 기록 영역(+common)의 스타일 예시 글. checkOf가 겹침 검사에 씀 */
export function styleExamplesFor(record) {
  const areas = state.styles?.areas || {};
  const key = record.area === 'subject' ? `subject:${record.subject || ''}` : record.area;
  return [areas[key], areas.common].flatMap((a) => (a?.examples || []).map((e) => e.text)).filter(Boolean);
}

// ---------- 통째로 바꾸기, 스냅숏 ----------
function resetDirty() {
  clearTimeout(saveTimer);
  for (const name of ['students', 'classes', 'records']) { dirty[name].clear(); deleted[name].clear(); }
  settingsDirty = false; stylesDirty = false; tombsDirty = false; secretsDirty = false; userDirty = false;
}

/** 메모리를 data로 바꾼다 (기기별 설정은 이 브라우저 값). 동기적으로 끝난다 */
function loadAllInto(data) {
  const device = Object.fromEntries(DEVICE_SETTING_KEYS.filter((k) => state.settings && k in state.settings).map((k) => [k, state.settings[k]]));
  loadInto(data);
  Object.assign(state.settings, device);
  state.deleted = Array.isArray(data.deleted) ? data.deleted : [];
  if ('secrets' in data) state.secrets = data.secrets || null;
}

async function writeAll(meta = {}) {
  if (!state.persistent) return;
  const d = getSyncData();
  await db.replaceAllData({ ...d, secrets: state.settings.publicPC ? null : d.secrets, meta });
}

/** 가져오기·되돌리기: prepareReplace를 거쳐 드라이브에서도 이기게 하고, 올릴 변경으로 친다 */
export async function replaceAll(data) {
  await flush();
  const next = prepareReplace(getSyncData(), data);
  resetDirty();
  loadAllInto(next);
  setSave('saving');
  try {
    await writeAll({ syncPending: true });
    syncMeta.pending = true;
    setSave('saved');
  } catch (e) {
    console.error(e);
    setSave('error', '저장하지 못했습니다.');
    throw e;
  }
  emit('all');
  emit('local-change');
}

export async function saveSnapshot(backup) {
  const snap = { id: 'before-import', createdAt: now(), data: backup };
  state.snapshot = snap;
  state.snapshots = { ...state.snapshots, [snap.id]: snap };
  if (state.persistent) await db.putSnapshot(snap);
}

export async function wipeAll() {
  clearTimeout(saveTimer);
  clearApiKey();
  try { localStorage.removeItem(KEY_STORAGE_NAME); } catch { /* 막혀 있으면 넘어감 */ }
  try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch { /* 넘어감 */ }
  if (state.persistent) await db.deleteDatabase();
}

/** IndexedDB 사본과 동기화 상태만 지움 (API 키, 가짜 드라이브 파일은 남김) */
export async function wipeLocalCopy() {
  resetDirty();
  const device = Object.fromEntries(DEVICE_SETTING_KEYS.map((k) => [k, state.settings?.[k]]));
  loadInto({ students: [], classes: [], records: [], settings: null });
  Object.assign(state.settings, device);
  state.deleted = [];
  state.secrets = null;
  state.snapshots = {};
  state.snapshot = null;
  syncMeta = { state: {}, pending: false };
  if (state.persistent) await db.clearAllStores();
  emit('all');
}

// ---------- 동기화 연결 (LocalPort, contract 14-1) ----------
let beforeSyncRead = null;
/** 화면 디바운스를 먼저 끝내는 함수 (app.js가 지금 화면의 flush를 넣음) */
export function setBeforeSyncRead(fn) { beforeSyncRead = fn; }

export const syncLocal = {
  async read() {
    try { beforeSyncRead?.(); } catch (e) { console.error(e); }
    await flush();
    return getSyncData();
  },
  /** 합친 결과 반영. 메모리는 첫 await 전에 바꾼다. 'local-change'는 내지 않는다 */
  async apply(data) {
    resetDirty();
    loadAllInto(data);
    emit('all');
    try { await writeAll(); } catch (e) { console.error(e); setSave('error', '저장하지 못했습니다.'); }
  },
  async readState() { return { ...syncMeta.state, pending: syncMeta.pending }; },
  async writeState(patch) {
    syncMeta.state = { ...syncMeta.state, ...patch };
    if (state.persistent) await db.putMeta('sync', syncMeta.state);
  },
  async setPending(b) {
    syncMeta.pending = !!b;
    if (state.persistent) await db.putMeta('syncPending', !!b);
  },
  async snapshot(id, data) {
    const snap = { id, createdAt: now(), data };
    state.snapshots = { ...state.snapshots, [id]: snap };
    if (state.persistent) await db.putSnapshot(snap);
  },
  async wipe() { await wipeLocalCopy(); },
};

// ---------- API 키 (IndexedDB와 백업에 넣지 않음) ----------
let memoryKey = '';
function loadKeyFromStorage() {
  try { memoryKey = localStorage.getItem(KEY_STORAGE_NAME) || ''; } catch { memoryKey = ''; }
}
export function getApiKey() { return memoryKey; }
/** 키가 어디에 있는지: 'local' | 'session' | null */
export function apiKeyWhere() {
  if (!memoryKey) return null;
  try { if (localStorage.getItem(KEY_STORAGE_NAME) === memoryKey) return 'local'; } catch { /* 없음 */ }
  return 'session';
}
export function setApiKey(key, mode) {
  memoryKey = String(key || '').trim();
  try {
    if (mode === 'local' && memoryKey) localStorage.setItem(KEY_STORAGE_NAME, memoryKey);
    else localStorage.removeItem(KEY_STORAGE_NAME);
  } catch { /* localStorage가 막혀 있으면 메모리에만 */ }
  emit('key');
}
export function clearApiKey() {
  memoryKey = '';
  try { localStorage.removeItem(KEY_STORAGE_NAME); } catch { /* 넘어감 */ }
  emit('key');
}

// ---------- 화면 공통 계산 ----------
/** 반의 영역 목록: [{ area, subject, label }] */
export function areasOfClass(cls) {
  if (!cls) return [];
  return (AREAS_BY_KIND[cls.kind] || []).map((area) => ({
    area,
    subject: area === 'subject' ? (cls.subject || null) : null,
    label: area === 'subject' && cls.subject ? `${AREA_LABELS.subject}(${cls.subject})` : AREA_LABELS[area],
  }));
}

export function limitOf(area) {
  const v = state.settings?.limits?.[area];
  return Number.isFinite(v) && v > 0 ? v : 1500;
}

/** 같은 영역(과목)의 다른 학생 최종본. id는 학번 */
export function othersFor(record) {
  const out = [];
  for (const r of state.records.values()) {
    if (r.area !== record.area || (r.subject || null) !== (record.subject || null)) continue;
    if (r.studentId === record.studentId || !r.final) continue;
    out.push({ id: r.studentId, text: r.final });
  }
  return out;
}

/** 기록 검사 (기본은 최종본) */
export function checkOf(record, text = record.final) {
  return checkRecord(text || '', {
    area: record.area,
    limit: limitOf(record.area),
    entries: state.settings?.forbidden || [],
    others: othersFor(record),
    styleExamples: styleExamplesFor(record),
  });
}