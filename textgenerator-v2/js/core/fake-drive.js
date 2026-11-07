// 가짜 드라이브: DriveApi와 같은 모양 + 시험 도구 (contract 13-3).
// 브라우저 개발용(storage에 저장)과 node 테스트(메모리) 공용. 구글로 아무것도 보내지 않는다.

import { DATA_FILE_NAME, BACKUP_PREFIX, backupName, DriveError } from './drive-common.js';

const STORAGE_KEY = 'sgb-v2-fake-drive';
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const isApp = (name) => name === DATA_FILE_NAME || String(name).startsWith(BACKUP_PREFIX);

export function createFakeDrive({ storage = null, now = () => new Date(), tokenOk = true } = {}) {
  let db = { seq: 0, files: [] }; // files: [{ id, name, version: number, modifiedTime, data }]
  if (storage) {
    try { const saved = JSON.parse(storage.getItem(STORAGE_KEY) || 'null'); if (saved && Array.isArray(saved.files)) db = saved; } catch { /* 새로 시작 */ }
  }
  let token = false;
  let okSilent = tokenOk;
  let offline = false;
  const fails = [];
  let afterDl = null;
  const calls = [];

  const persist = () => { if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(db)); };
  const meta = (f) => ({ id: f.id, name: f.name, version: String(f.version), modifiedTime: f.modifiedTime });
  const byId = (id) => db.files.find((f) => f.id === id);
  const stampNow = () => now().toISOString();

  function enter(name, { needToken = true } = {}) {
    calls.push(name);
    if (offline) throw new DriveError('network');
    if (fails.length) throw new DriveError(fails.shift());
    if (needToken && !token) throw new DriveError('auth', { status: 401 });
  }

  function write(id, name, data) {
    let f = id ? byId(id) : null;
    if (id && !f) throw new DriveError('notfound', { status: 404 });
    if (!f) {
      db.seq += 1;
      f = { id: `f${db.seq}`, name, version: 0, modifiedTime: null, data: null };
      db.files.push(f);
    }
    f.version += 1;
    f.modifiedTime = stampNow();
    f.data = clone(data);
    persist();
    return meta(f);
  }

  const api = {
    calls,
    isConfigured: () => true,
    hasToken: () => token,
    setTokenMode() { /* 가짜는 저장하지 않음 */ },
    async requestToken({ silent = false } = {}) {
      enter('requestToken', { needToken: false });
      if (silent && !okSilent) throw new DriveError('auth');
      token = true;
    },
    async revoke() { calls.push('revoke'); token = false; },
    async findDataFile() {
      enter('findDataFile');
      const list = db.files.filter((f) => f.name === DATA_FILE_NAME).sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
      return list[0] ? meta(list[0]) : null;
    },
    async getMeta(id) {
      enter('getMeta');
      const f = byId(id);
      if (!f) throw new DriveError('notfound', { status: 404 });
      return meta(f);
    },
    async download(id) {
      enter('download');
      const f = byId(id);
      if (!f) throw new DriveError('notfound', { status: 404 });
      const out = clone(f.data);
      if (afterDl) { const fn = afterDl; afterDl = null; await fn(api); }
      return out;
    },
    async upload(id, data) {
      enter('upload');
      return write(id, DATA_FILE_NAME, data);
    },
    async listBackups() {
      enter('listBackups');
      return db.files.filter((f) => f.name.startsWith(BACKUP_PREFIX)).map(meta).sort((a, b) => b.name.localeCompare(a.name));
    },
    async writeBackup(day, data) {
      enter('writeBackup');
      const name = backupName(day);
      const f = db.files.find((x) => x.name === name);
      return write(f ? f.id : null, name, data);
    },
    async deleteFile(id) {
      enter('deleteFile');
      db.files = db.files.filter((f) => f.id !== id);
      persist();
    },
    async deleteAppFiles() {
      enter('deleteAppFiles');
      const before = db.files.length;
      db.files = db.files.filter((f) => !isApp(f.name));
      persist();
      return before - db.files.length;
    },

    // ---------- 시험 도구 ----------
    setOffline(v) { offline = !!v; },
    failNext(kind, count = 1) { for (let i = 0; i < count; i += 1) fails.push(kind); },
    setTokenOk(v) { okSilent = !!v; if (!v) token = false; },
    afterDownload(fn) { afterDl = fn; },
    /** 바깥(확장·다른 기기)에서 바로 쓰기. version이 1 오름 */
    writeRaw(name, data) {
      const f = db.files.find((x) => x.name === name);
      return write(f ? f.id : null, name, data);
    },
    readRaw(name) {
      const f = db.files.find((x) => x.name === name);
      return f ? clone(f.data) : null;
    },
    files: () => db.files.map(meta),
  };
  return api;
}
