// 구글 드라이브 appDataFolder (출결 확장 sidepanel/drive.js 복사: 파일 이름·토큰 키만 다름)
import { GOOGLE_CLIENT_ID } from '../config.js';
import { DRIVE_SCOPE, DATA_FILE_NAME } from '../shared/sgb-model.js';

const TOKEN_KEY = 'sgb.driveToken';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export class DriveError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const hasClientId = () => !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID.trim());
export const redirectUrl = () => chrome.identity.getRedirectURL();

async function cachedToken() {
  const area = chrome.storage.session || chrome.storage.local;
  const o = await area.get(TOKEN_KEY);
  const t = o[TOKEN_KEY];
  return t && t.expiresAt > Date.now() + 60000 ? t.token : null;
}
async function storeToken(token, expiresIn) {
  const area = chrome.storage.session || chrome.storage.local;
  await area.set({ [TOKEN_KEY]: { token, expiresAt: Date.now() + (Number(expiresIn) || 3600) * 1000 } });
}
export async function forgetToken() {
  const area = chrome.storage.session || chrome.storage.local;
  await area.remove(TOKEN_KEY);
}

// 저장된 토큰만 확인 (없거나 만료면 null). 자동 확인은 이것만 쓰고 로그인 창·조용한 재요청을 하지 않는다
export const peekToken = () => cachedToken();

export async function getToken(interactive) {
  if (!hasClientId()) throw new DriveError('no_client', '구글 Client ID가 설정되지 않았습니다. README의 구글 연결 설정을 참고하세요.');
  const cached = await cachedToken();
  if (cached) return cached;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID.trim(),
    response_type: 'token',
    redirect_uri: redirectUrl(),
    scope: DRIVE_SCOPE,
    include_granted_scopes: 'true',
  });
  if (!interactive) params.set('prompt', 'none');
  let resultUrl;
  try {
    resultUrl = await chrome.identity.launchWebAuthFlow({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, interactive: !!interactive });
  } catch (e) {
    throw new DriveError('auth', interactive ? `구글 로그인이 완료되지 않았습니다. (${e.message || e})` : '구글 연결이 만료되었습니다. [구글 연결]을 다시 눌러 주세요.');
  }
  const hash = new URLSearchParams(String(resultUrl || '').split('#')[1] || '');
  if (hash.get('error')) throw new DriveError('auth', `구글 로그인 오류: ${hash.get('error')}`);
  const token = hash.get('access_token');
  if (!token) throw new DriveError('auth', '구글 로그인 결과에서 토큰을 받지 못했습니다.');
  await storeToken(token, hash.get('expires_in'));
  return token;
}

async function api(token, url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (res.status === 401) { await forgetToken(); throw new DriveError('auth', '구글 연결이 만료되었습니다. [구글 연결]을 다시 눌러 주세요.'); }
  if (!res.ok) throw new DriveError('http', `구글 드라이브 오류 (${res.status})`);
  return res;
}

// 파일이 바뀌었는지 판단하는 값 (version|modifiedTime)
export const metaStamp = (m) => (m && (m.version || m.modifiedTime) ? `${m.version || ''}|${m.modifiedTime || ''}` : null);
export async function getMeta(token, fileId) {
  const res = await api(token, `${API}/files/${fileId}?fields=id,modifiedTime,version`);
  return res.json();
}

async function findFile(token) {
  const q = encodeURIComponent(`name='${DATA_FILE_NAME}' and trashed=false`);
  const res = await api(token, `${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime,version)&pageSize=10`);
  const j = await res.json();
  const files = (j.files || []).sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1));
  return files[0] || null;
}

export async function download(token) {
  const f = await findFile(token);
  if (!f) return { fileId: null, data: null, stamp: null };
  const res = await api(token, `${API}/files/${f.id}?alt=media`);
  return { fileId: f.id, data: await res.json(), stamp: metaStamp(f), name: DATA_FILE_NAME, modifiedTime: f.modifiedTime || null };
}
// 파일 id를 알 때 본문만 받기 (자동 확인에서 바뀐 것을 안 뒤)
export async function downloadById(token, fileId) {
  const res = await api(token, `${API}/files/${fileId}?alt=media`);
  return res.json();
}

// 반환: {fileId, stamp} (stamp: 올린 뒤 파일의 version|modifiedTime, 자동 확인의 기준)
export async function upload(token, fileId, data) {
  const body = JSON.stringify(data);
  if (fileId) {
    const res = await api(token, `${UPLOAD}/files/${fileId}?uploadType=media&fields=id,modifiedTime,version`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    return { fileId, stamp: metaStamp(await res.json().catch(() => null)) };
  }
  const boundary = `sgb${Date.now()}`;
  const meta = JSON.stringify({ name: DATA_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const res = await api(token, `${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime,version`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
  const j = await res.json();
  return { fileId: j.id, stamp: metaStamp(j) };
}
