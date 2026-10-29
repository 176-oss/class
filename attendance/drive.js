// 구글 드라이브 appDataFolder 연동 (Google Identity Services token client + Drive REST v3)
import { GOOGLE_CLIENT_ID } from './config.js';
import { DATA_FILE_NAME, DRIVE_SCOPE } from './shared/model.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN_KEY = 'ah.token'; // localStorage: {accessToken, expiresAt}. 앱을 닫았다 열어도 만료 전(약 1시간)까지 사용
const tokenStore = () => { try { return window.localStorage; } catch { return null; } };

export const driveConfigured = () => !!GOOGLE_CLIENT_ID;

export class AuthError extends Error {}

let gisPromise = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    const timer = setTimeout(() => { gisPromise = null; reject(new Error('구글 로그인 스크립트를 불러오지 못했습니다.')); }, 15000);
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => { clearTimeout(timer); gisPromise = null; s.remove(); reject(new Error('구글 로그인 스크립트를 불러오지 못했습니다. 인터넷 연결을 확인하세요.')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

function readToken() {
  try {
    const t = JSON.parse(tokenStore()?.getItem(TOKEN_KEY) || 'null');
    if (t && t.accessToken && t.expiresAt > Date.now() + 60000) return t.accessToken;
  } catch { /* 무시 */ }
  return null;
}
function writeToken(accessToken, expiresIn) {
  try {
    tokenStore()?.setItem(TOKEN_KEY, JSON.stringify({ accessToken, expiresAt: Date.now() + (Number(expiresIn) || 3600) * 1000 }));
  } catch { /* 무시 */ }
}
export function clearToken() {
  try { tokenStore()?.removeItem(TOKEN_KEY); } catch { /* 무시 */ }
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* 이전 버전 */ }
}
export const hasToken = () => !!readToken();

// consent: 처음 연결(동의 화면). silent: 이전에 동의한 사용자의 조용한 재요청(prompt 'none').
// 브라우저는 사용자 동작(탭·클릭) 없이 연 팝업을 막을 수 있다. silent가 막히면 AuthError로 끝나고
// 화면에 '동기화하려면 누르세요' 배너를 띄워 사용자 탭 안에서 다시 요청한다.
export async function requestToken({ consent = false, silent = false } = {}) {
  if (!driveConfigured()) throw new Error('관리자 설정이 필요합니다.');
  await loadGis();
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    // 팝업이 막혀 아무 콜백도 오지 않는 브라우저 대비
    const timer = setTimeout(() => done(reject, new AuthError('구글 연결 확인이 필요합니다.')), silent ? 8000 : 120000);
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error) { done(reject, new AuthError(silent ? '구글 연결 확인이 필요합니다.' : (resp.error_description || '구글 연결이 취소되었습니다.'))); return; }
        writeToken(resp.access_token, resp.expires_in);
        done(resolve, resp.access_token);
      },
      error_callback: (err) => done(reject, new AuthError(silent ? '구글 연결 확인이 필요합니다.'
        : err?.type === 'popup_closed' ? '구글 연결 창이 닫혔습니다.' : '구글 연결 창을 열지 못했습니다. 팝업 차단을 확인하세요.')),
    });
    client.requestAccessToken({ prompt: consent ? 'consent' : silent ? 'none' : '' });
  });
}

export async function revoke() {
  const t = readToken();
  clearToken();
  if (t && window.google?.accounts?.oauth2) {
    try { window.google.accounts.oauth2.revoke(t, () => {}); } catch { /* 무시 */ }
  }
}

async function api(url, opts = {}) {
  const token = readToken();
  if (!token) throw new AuthError('구글 연결이 만료되었습니다.');
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) {
    if (res.status === 401) clearToken();
    throw new AuthError(res.status === 401 ? '구글 연결이 만료되었습니다.' : '구글 드라이브 접근 권한이 없습니다.');
  }
  if (!res.ok) throw new Error(`구글 드라이브 오류 (${res.status})`);
  return res;
}

export async function findFile() {
  const q = encodeURIComponent(`name='${DATA_FILE_NAME}' and trashed=false`);
  const res = await api(`${API}?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc&pageSize=10`);
  const json = await res.json();
  return json.files?.[0] || null;
}

export async function downloadFile(id) {
  const res = await api(`${API}/${encodeURIComponent(id)}?alt=media`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error('드라이브의 기록 파일을 읽을 수 없습니다.'); }
}

function multipartBody(metadata, data) {
  const boundary = 'ah' + Math.random().toString(16).slice(2);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;
  return { body, type: `multipart/related; boundary=${boundary}` };
}

export async function uploadFile(id, data) {
  if (id) {
    const { body, type } = multipartBody({}, data);
    const res = await api(`${UPLOAD}/${encodeURIComponent(id)}?uploadType=multipart&fields=id`, { method: 'PATCH', headers: { 'Content-Type': type }, body });
    return (await res.json()).id;
  }
  const { body, type } = multipartBody({ name: DATA_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' }, data);
  const res = await api(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': type }, body });
  return (await res.json()).id;
}
