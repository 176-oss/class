// 구글 드라이브 appDataFolder 연동 (GIS 토큰 클라이언트 + Drive REST v3). contract 13-2.
// attendance/drive.js를 바탕으로 고쳐 씀. 이름이 sgb- 로 시작하는 파일만 다룬다.
// 모듈 맨 위에서는 window·document를 건드리지 않는다 (함수 안에서만).
import { GOOGLE_CLIENT_ID } from '../config.js';
import { DRIVE_SCOPE, DATA_FILE_NAME, BACKUP_PREFIX, backupName, DriveError, kindFromStatus } from './core/drive-common.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN_KEY = 'sgb-v2-token'; // {accessToken, expiresAt}. 기본 localStorage, 공용 PC면 sessionStorage에만
const META_FIELDS = 'id,name,version,modifiedTime';

let tokenMode = 'local';
const storageOf = (mode) => { try { return mode === 'session' ? window.sessionStorage : window.localStorage; } catch { return null; } };

export const isConfigured = () => !!GOOGLE_CLIENT_ID;

let gisPromise = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    const timer = setTimeout(() => { gisPromise = null; reject(new DriveError('network')); }, 15000);
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => { clearTimeout(timer); gisPromise = null; s.remove(); reject(new DriveError('network')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

function readToken() {
  try {
    const t = JSON.parse(storageOf(tokenMode)?.getItem(TOKEN_KEY) || 'null');
    if (t && t.accessToken && t.expiresAt > Date.now() + 60000) return t.accessToken;
  } catch { /* 없음 */ }
  return null;
}
function writeToken(accessToken, expiresIn) {
  try {
    storageOf(tokenMode)?.setItem(TOKEN_KEY, JSON.stringify({ accessToken, expiresAt: Date.now() + (Number(expiresIn) || 3600) * 1000 }));
  } catch { /* 저장이 막혀 있으면 이번 요청만 */ }
}
function clearToken() {
  for (const m of ['local', 'session']) { try { storageOf(m)?.removeItem(TOKEN_KEY); } catch { /* 넘어감 */ } }
}

export const hasToken = () => !!readToken();

/** 공용 PC면 'session'. 있던 토큰을 옮기고 다른 쪽은 지운다 */
export function setTokenMode(mode) {
  const next = mode === 'session' ? 'session' : 'local';
  if (next === tokenMode) return;
  let raw = null;
  try { raw = storageOf(tokenMode)?.getItem(TOKEN_KEY) || null; } catch { /* 없음 */ }
  clearToken();
  tokenMode = next;
  if (raw) { try { storageOf(tokenMode)?.setItem(TOKEN_KEY, raw); } catch { /* 넘어감 */ } }
}

// consent: 처음 연결(동의 화면). silent: 이전에 동의한 사용자의 조용한 재요청(prompt 'none', 8초 제한).
// 조용한 재요청이 막히면 'auth'로 끝나고, 화면의 [다시 연결]이 사용자 동작 안에서 다시 요청한다.
export async function requestToken({ consent = false, silent = false } = {}) {
  if (!isConfigured()) throw new DriveError('unknown');
  await loadGis();
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => done(reject, new DriveError('auth')), silent ? 8000 : 120000);
    const oauth = window.google.accounts.oauth2;
    const client = oauth.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error) {
          const blocked = /access_denied|admin_policy|org_internal|disallowed/i.test(String(resp.error));
          done(reject, new DriveError(silent ? 'auth' : blocked ? 'blocked' : 'auth'));
          return;
        }
        if (typeof oauth.hasGrantedAllScopes === 'function' && !oauth.hasGrantedAllScopes(resp, DRIVE_SCOPE)) {
          done(reject, new DriveError('forbidden'));
          return;
        }
        writeToken(resp.access_token, resp.expires_in);
        done(resolve);
      },
      error_callback: (err) => done(reject, new DriveError(!silent && err?.type === 'popup_failed_to_open' ? 'popup' : 'auth')),
    });
    client.requestAccessToken({ prompt: consent ? 'consent' : silent ? 'none' : '' });
  });
}

export async function revoke() {
  const t = readToken();
  clearToken();
  if (t && window.google?.accounts?.oauth2) {
    try { window.google.accounts.oauth2.revoke(t, () => {}); } catch { /* 넘어감 */ }
  }
}

async function api(url, opts = {}) {
  const token = readToken();
  if (!token) throw new DriveError('auth');
  let res;
  try {
    res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  } catch {
    throw new DriveError('network');
  }
  if (!res.ok) {
    if (res.status === 401) clearToken();
    let body = '';
    if (res.status === 403) { try { body = await res.text(); } catch { /* 넘어감 */ } }
    throw new DriveError(kindFromStatus(res.status, body), { status: res.status });
  }
  return res;
}

async function listByQuery(q) {
  const url = `${API}?spaces=appDataFolder&q=${encodeURIComponent(q)}&fields=${encodeURIComponent(`files(${META_FIELDS})`)}&orderBy=${encodeURIComponent('modifiedTime desc')}&pageSize=100`;
  const json = await (await api(url)).json();
  return Array.isArray(json.files) ? json.files : [];
}

export async function findDataFile() {
  const files = await listByQuery(`name='${DATA_FILE_NAME}' and trashed=false`);
  return files[0] || null;
}

export async function getMeta(id) {
  return (await api(`${API}/${encodeURIComponent(id)}?fields=${META_FIELDS}`)).json();
}

export async function download(id) {
  const text = await (await api(`${API}/${encodeURIComponent(id)}?alt=media`)).text();
  try { return JSON.parse(text); } catch { throw new DriveError('parse'); }
}

function multipartBody(metadata, data) {
  const boundary = `sgb${Math.random().toString(16).slice(2)}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
    + `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n`
    + `--${boundary}--`;
  return { body, type: `multipart/related; boundary=${boundary}` };
}

async function put(id, name, data) {
  const fields = `fields=${META_FIELDS}`;
  if (id) {
    const { body, type } = multipartBody({}, data);
    return (await api(`${UPLOAD}/${encodeURIComponent(id)}?uploadType=multipart&${fields}`, { method: 'PATCH', headers: { 'Content-Type': type }, body })).json();
  }
  const { body, type } = multipartBody({ name, parents: ['appDataFolder'], mimeType: 'application/json' }, data);
  return (await api(`${UPLOAD}?uploadType=multipart&${fields}`, { method: 'POST', headers: { 'Content-Type': type }, body })).json();
}

/** id가 null이면 sgb-data.json을 새로 만든다 */
export async function upload(id, data) {
  return put(id, DATA_FILE_NAME, data);
}

/** 자동 백업 목록. 이름 내림차순(최근 먼저) */
export async function listBackups() {
  const files = await listByQuery(`name contains '${BACKUP_PREFIX}' and trashed=false`);
  return files.filter((f) => String(f.name).startsWith(BACKUP_PREFIX)).sort((a, b) => b.name.localeCompare(a.name));
}

export async function writeBackup(day, data) {
  const name = backupName(day);
  const found = (await listByQuery(`name='${name}' and trashed=false`))[0];
  return put(found ? found.id : null, name, data);
}

export async function deleteFile(id) {
  await api(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** sgb-data.json과 sgb-backup-*.json만 지운다 (출결 앱 파일은 두고). 지운 수 */
export async function deleteAppFiles() {
  const files = await listByQuery("name contains 'sgb-' and trashed=false");
  const mine = files.filter((f) => f.name === DATA_FILE_NAME || String(f.name).startsWith(BACKUP_PREFIX));
  for (const f of mine) await deleteFile(f.id);
  return mine.length;
}
