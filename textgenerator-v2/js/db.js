// IndexedDB 'sgb-v2' 열기, 읽기, 쓰기, 마이그레이션 실행
import { SCHEMA_VERSION, migrate } from './core/model.js';

const DB_NAME = 'sgb-v2';
const DB_VERSION = 1;
export const STORES = {
  meta: 'key',
  students: 'studentId',
  classes: 'id',
  records: 'id',
  settings: 'key',
  snapshots: 'id',
};

export class DbError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DbError';
    this.cause = cause;
  }
}

const OPEN_FAIL_TEXT = '이 브라우저에서는 데이터를 저장할 수 없습니다. 시크릿(사생활 보호) 창이거나 사이트 데이터 저장이 막혀 있을 수 있습니다. 일반 창에서 다시 열어 주세요.';

let dbPromise = null;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('저장이 취소되었습니다.'));
  });
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) { reject(new DbError(OPEN_FAIL_TEXT)); return; }
    let r;
    try { r = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(new DbError(OPEN_FAIL_TEXT, e)); return; }
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    r.onerror = () => reject(new DbError(OPEN_FAIL_TEXT, r.error));
    r.onblocked = () => reject(new DbError('다른 탭에서 이 앱이 열려 있어 저장소를 열지 못했습니다. 다른 탭을 닫고 새로고침해 주세요.'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/** 모든 저장소를 읽고, 스키마 버전이 낮으면 migrate 후 다시 쓴다 */
export async function loadAll() {
  const db = await openDB();
  const tx = db.transaction(Object.keys(STORES), 'readonly');
  const [meta, students, classes, records, settings, snapshots] = await Promise.all(
    Object.keys(STORES).map((name) => req(tx.objectStore(name).getAll())),
  );
  const metaOf = (key) => meta.find((m) => m.key === key)?.value;
  const ver = metaOf('schemaVersion');
  let data = {
    students,
    classes,
    records,
    settings: settings.find((s) => s.key === 'app')?.value || null,
    styles: settings.find((s) => s.key === 'styles')?.value || null,
  };
  const snaps = Object.fromEntries(snapshots.map((s) => [s.id, s]));
  let newer = false;
  if (ver === undefined) {
    await putMeta('schemaVersion', SCHEMA_VERSION);
  } else if (ver < SCHEMA_VERSION) {
    data = migrate(data, ver);
    await replaceAllData(data);
    await putMeta('schemaVersion', SCHEMA_VERSION);
  } else if (ver > SCHEMA_VERSION) {
    newer = true;
  }
  return {
    ...data,
    deleted: Array.isArray(metaOf('deleted')) ? metaOf('deleted') : [],
    secrets: metaOf('secrets') || null,
    syncState: metaOf('sync') || {},
    syncPending: !!metaOf('syncPending'),
    snapshots: snaps,
    snapshot: snaps['before-import'] || null,
    newer,
  };
}

export async function putMeta(key, value) {
  const db = await openDB();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key, value });
  await txDone(tx);
}

/**
 * 바뀐 것만 한 번에 쓴다.
 * changes = { put: { records: [..] }, del: { classes: [id, ..] }, settings, styles, meta: { key: value } }
 */
export async function writeChanges({ put = {}, del = {}, settings, styles, meta = {} } = {}) {
  const names = new Set([...Object.keys(put), ...Object.keys(del)]);
  if (settings || styles) names.add('settings');
  if (Object.keys(meta).length) names.add('meta');
  if (!names.size) return;
  const db = await openDB();
  const tx = db.transaction([...names], 'readwrite');
  for (const [name, items] of Object.entries(put)) {
    const os = tx.objectStore(name);
    for (const it of items) os.put(it);
  }
  for (const [name, keys] of Object.entries(del)) {
    const os = tx.objectStore(name);
    for (const k of keys) os.delete(k);
  }
  if (settings) tx.objectStore('settings').put({ key: 'app', value: settings });
  if (styles) tx.objectStore('settings').put({ key: 'styles', value: styles });
  for (const [key, value] of Object.entries(meta)) tx.objectStore('meta').put({ key, value });
  await txDone(tx);
}

/** 학생·반·기록·설정·스타일(+삭제 기록, secrets)을 통째로 바꾼다 (가져오기, 되돌리기, 동기화 반영) */
export async function replaceAllData({ students = [], classes = [], records = [], settings, styles, deleted, secrets, meta = {} }) {
  const db = await openDB();
  const tx = db.transaction(['students', 'classes', 'records', 'settings', 'meta'], 'readwrite');
  for (const [name, items] of [['students', students], ['classes', classes], ['records', records]]) {
    const os = tx.objectStore(name);
    os.clear();
    for (const it of items) os.put(it);
  }
  if (settings) tx.objectStore('settings').put({ key: 'app', value: settings });
  if (styles) tx.objectStore('settings').put({ key: 'styles', value: styles });
  const m = { ...meta };
  if (deleted !== undefined) m.deleted = deleted;
  if (secrets !== undefined) m.secrets = secrets;
  for (const [key, value] of Object.entries(m)) tx.objectStore('meta').put({ key, value });
  await txDone(tx);
}

/** 같은 id의 스냅숏만 바꾼다 */
export async function putSnapshot(snapshot) {
  const db = await openDB();
  const tx = db.transaction('snapshots', 'readwrite');
  tx.objectStore('snapshots').put(snapshot);
  await txDone(tx);
}

export async function deleteSnapshot(id) {
  const db = await openDB();
  const tx = db.transaction('snapshots', 'readwrite');
  tx.objectStore('snapshots').delete(id);
  await txDone(tx);
}

/** 사본만 비운다 (열린 채로). 스키마 버전은 다시 적는다 */
export async function clearAllStores() {
  const db = await openDB();
  const tx = db.transaction(Object.keys(STORES), 'readwrite');
  for (const name of Object.keys(STORES)) tx.objectStore(name).clear();
  tx.objectStore('meta').put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  await txDone(tx);
}

/** 데이터베이스 전체 삭제 */
export async function deleteDatabase() {
  try { (await dbPromise)?.close(); } catch { /* 열리지 않았으면 그냥 지움 */ }
  dbPromise = null;
  await new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => resolve();
  });
}
