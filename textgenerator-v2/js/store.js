// 메모리 상태 + 자동 저장(디바운스) + 변경 알림
// 화면은 state를 읽기만 하고, 바꿀 때는 이 파일의 함수를 부른다.
import * as db from './db.js';
import { defaultSettings, newRecord, deriveStatus, recordKey, AREAS_BY_KIND, AREA_LABELS } from './core/model.js';
import { checkRecord } from './core/check.js';

const SAVE_DELAY = 300; // 화면 쪽 0.6초 디바운스 뒤에 한 번 더 모아서 쓴다
const KEY_STORAGE_NAME = 'sgb-v2-api-key';

export const state = {
  students: new Map(),
  classes: new Map(),
  records: new Map(),
  settings: null,
  snapshot: null,
  persistent: true, // IndexedDB를 못 열면 false (메모리에서만)
  loadError: null,
  newer: false,
  save: { status: 'idle', message: '' }, // idle | pending | saving | saved | error
};

// ---------- 변경 알림 ----------
const listeners = new Set();
/** fn(kind, detail). kind: 'records' | 'classes' | 'students' | 'settings' | 'all' | 'save' | 'key' */
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
let saveTimer = null;
let saving = null;

function markDirty(store, id) { dirty[store].add(id); deleted[store].delete(id); scheduleSave(); }
function markDeleted(store, id) { deleted[store].add(id); dirty[store].delete(id); scheduleSave(); }

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
  settingsDirty = false;
  if (!Object.keys(put).length && !Object.keys(del).length && !settings) {
    if (state.save.status === 'pending') setSave('saved');
    return;
  }
  if (!state.persistent) { setSave('saved', '이 창을 닫으면 사라집니다'); return; }
  setSave('saving');
  saving = db.writeChanges({ put, del, settings });
  try {
    await saving;
    setSave('saved');
  } catch (e) {
    console.error(e);
    // 실패한 것은 다시 쓰도록 표시
    for (const [name, items] of Object.entries(put)) {
      for (const it of items) dirty[name].add(it[name === 'students' ? 'studentId' : 'id']);
    }
    if (settings) settingsDirty = true;
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

export async function init() {
  try {
    const data = await db.loadAll();
    loadInto(data);
    state.snapshot = data.snapshot;
    state.newer = data.newer;
    if (!data.settings) { settingsDirty = true; scheduleSave(); }
  } catch (e) {
    console.error(e);
    state.persistent = false;
    state.loadError = e instanceof db.DbError ? e.message : '저장 공간을 여는 중 문제가 생겼습니다. 이 창을 닫으면 입력한 내용이 사라집니다.';
    loadInto({ students: [], classes: [], records: [], settings: null });
  }
  loadKeyFromStorage();
}

function loadInto({ students = [], classes = [], records = [], settings }) {
  state.students = new Map(students.map((s) => [s.studentId, s]));
  state.classes = new Map(classes.map((c) => [c.id, c]));
  state.records = new Map(records.map((r) => [r.id, r]));
  state.settings = fillSettings(settings);
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
    r = newRecord(studentId, area, sub);
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
  state.settings = { ...state.settings, ...patch };
  settingsDirty = true;
  scheduleSave();
  emit('settings', { keys: Object.keys(patch) });
}

// ---------- 통째로 바꾸기, 스냅숏 ----------
export async function replaceAll(data) {
  clearTimeout(saveTimer);
  for (const name of ['students', 'classes', 'records']) { dirty[name].clear(); deleted[name].clear(); }
  settingsDirty = false;
  const keyStorage = state.settings?.keyStorage;
  loadInto(data);
  if (keyStorage) state.settings.keyStorage = keyStorage;
  if (state.persistent) {
    setSave('saving');
    try {
      await db.replaceAllData(snapshotData());
      setSave('saved');
    } catch (e) {
      console.error(e);
      setSave('error', '저장하지 못했습니다.');
      throw e;
    }
  }
  emit('all');
}

export async function saveSnapshot(backup) {
  const snap = { id: 'before-import', createdAt: now(), data: backup };
  state.snapshot = snap;
  if (state.persistent) await db.putSnapshot(snap);
}

export async function wipeAll() {
  clearTimeout(saveTimer);
  clearApiKey();
  try { localStorage.removeItem(KEY_STORAGE_NAME); } catch { /* 막혀 있으면 넘어감 */ }
  if (state.persistent) await db.deleteDatabase();
}

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
  });
}