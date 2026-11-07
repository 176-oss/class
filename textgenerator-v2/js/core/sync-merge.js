// 드라이브 데이터 파일 형식과 합치기. 순수 모듈 (contract 12절).
// 이 브라우저 사본(local)과 드라이브 파일(remote)을 updatedAt 기준으로 합친다.

import { SCHEMA_VERSION, DEVICE_SETTING_KEYS, defaultSettings, defaultStyles, migrate } from './model.js';

export const DATA_KIND = 'sgb-v2-data';
export const TOMBSTONE_DAYS = 90;
const APP_NAME = 'textgenerator-v2';
const STORES = { students: 'studentId', classes: 'id', records: 'id' };
const DAY_MS = 24 * 60 * 60 * 1000;

const arr = (v) => (Array.isArray(v) ? v : []);
/** ISO 시각을 숫자로. 없거나 잘못되면 가장 이른 값 */
const t = (iso) => {
  const n = Date.parse(iso ?? '');
  return Number.isNaN(n) ? -Infinity : n;
};
const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString();

/** 키 순서와 상관없이 같은 문자열 (내용 비교용) */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
const same = (a, b) => stable(a) === stable(b);

function withoutKeys(obj, keys) {
  if (!obj || typeof obj !== 'object') return obj ?? null;
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}
const sharedSettings = (s) => withoutKeys(s, DEVICE_SETTING_KEYS);

function byId(list, key) {
  const m = new Map();
  for (const x of arr(list)) if (x && x[key] != null) m.set(String(x[key]), x);
  return m;
}

function recordHasContent(r) {
  return !!(r && ((r.memo || '').trim() || (r.draft || '').trim() || (r.final || '').trim()
    || arr(r.candidates).length || r.status === 'done'));
}

export function emptyData() {
  return {
    students: [], classes: [], records: [],
    settings: defaultSettings(), styles: defaultStyles(), secrets: null, deleted: [],
  };
}

/** 드라이브에서 받은 파일 검사. 낮은 버전이면 migrate, 빠진 목록은 빈 배열 */
export function checkDataFile(obj) {
  let data = obj;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return { ok: false, error: 'parse', data: null, newer: false }; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.kind !== DATA_KIND) {
    return { ok: false, error: 'parse', data: null, newer: false };
  }
  const v = Number(data.schemaVersion) || 1;
  if (v > SCHEMA_VERSION) return { ok: false, error: 'newer', data: null, newer: true };
  const m = v < SCHEMA_VERSION ? migrate(data, v) : data;
  return {
    ok: true, error: null, newer: false,
    data: {
      ...m,
      students: arr(m.students), classes: arr(m.classes), records: arr(m.records), deleted: arr(m.deleted),
      settings: m.settings && typeof m.settings === 'object' ? m.settings : null,
      styles: m.styles && typeof m.styles === 'object' && m.styles.areas ? m.styles : defaultStyles(),
      secrets: m.secrets && typeof m.secrets === 'object' ? m.secrets : null,
    },
  };
}

/** 머리 필드를 붙이고 기기별 설정을 뺀 드라이브 파일 */
export function toDriveFile(data, now = new Date()) {
  const d = data || {};
  return {
    kind: DATA_KIND, schemaVersion: SCHEMA_VERSION, app: APP_NAME, updatedAt: iso(now),
    students: arr(d.students), classes: arr(d.classes), records: arr(d.records),
    settings: sharedSettings(d.settings),
    styles: d.styles && d.styles.areas ? d.styles : defaultStyles(),
    secrets: d.secrets && typeof d.secrets === 'object' ? { geminiKey: String(d.secrets.geminiKey || ''), updatedAt: d.secrets.updatedAt || null } : null,
    deleted: arr(d.deleted),
  };
}

/** 자동 백업용: secrets를 뺀 파일 */
export function withoutSecrets(file) {
  return { ...file, secrets: null };
}

const laterNeis = (a, b) => {
  if (!a) return b || null;
  if (!b) return a;
  return t(b.doneAt) > t(a.doneAt) ? b : a;
};

function emptyCounts() {
  return { added: 0, updated: 0, removed: 0 };
}

/**
 * 합치기. 결과와 바뀐 수(local 기준)를 돌려준다.
 * remote가 null이면 local 그대로.
 */
export function mergeData(local, remote, { now = new Date() } = {}) {
  const L = local || emptyData();
  const byStore = { students: emptyCounts(), classes: emptyCounts(), records: emptyCounts() };
  if (!remote) {
    return { data: { ...L }, changes: { added: 0, updated: 0, removed: 0, byStore } };
  }
  const R = remote;

  // 1. 항목: updatedAt이 늦은 쪽, 같으면 원격. 기록의 neis는 doneAt이 늦은 쪽
  const maps = {};
  for (const [name, key] of Object.entries(STORES)) {
    const lm = byId(L[name], key);
    const rm = byId(R[name], key);
    const out = new Map(lm);
    for (const [id, r] of rm) {
      const l = lm.get(id);
      let win = !l || t(r.updatedAt) >= t(l.updatedAt) ? r : l;
      if (name === 'records' && l) {
        const neis = laterNeis(l.neis, r.neis);
        if ((win.neis || null) !== neis) win = { ...win, neis };
      }
      out.set(id, win);
    }
    maps[name] = out;
  }

  // 2. 삭제 기록: 같은 (store, id)는 늦은 것 하나. 항목이 더 늦게 고쳐졌으면 항목이 산다
  const tombs = new Map();
  for (const d of [...arr(L.deleted), ...arr(R.deleted)]) {
    if (!d || !STORES[d.store] || d.id == null) continue;
    const k = `${d.store}|${d.id}`;
    const cur = tombs.get(k);
    if (!cur || t(d.deletedAt) > t(cur.deletedAt)) tombs.set(k, d);
  }
  const limit = t(iso(now)) - TOMBSTONE_DAYS * DAY_MS;
  const deleted = [];
  for (const d of tombs.values()) {
    const m = maps[d.store];
    const item = m.get(String(d.id));
    if (item && t(item.updatedAt) > t(d.deletedAt)) continue;
    m.delete(String(d.id));
    if (t(d.deletedAt) >= limit) deleted.push(d); // 7. 90일 넘은 삭제 기록은 정리
  }

  // 바뀐 수 (local 기준)
  for (const [name, key] of Object.entries(STORES)) {
    const lm = byId(L[name], key);
    const c = byStore[name];
    for (const [id, x] of maps[name]) {
      if (!lm.has(id)) c.added += 1;
      else if (!same(lm.get(id), x)) c.updated += 1;
    }
    for (const id of lm.keys()) if (!maps[name].has(id)) c.removed += 1;
  }

  // 4. 설정: updatedAt이 늦은 쪽(같으면 원격). 기기별 값은 언제나 로컬
  let settings = L.settings || null;
  if (R.settings && (!settings || (R.settings.updatedAt && t(R.settings.updatedAt) >= t(settings.updatedAt)))) {
    settings = { ...R.settings };
  }
  if (settings) {
    const def = defaultSettings();
    settings = { ...settings };
    for (const k of DEVICE_SETTING_KEYS) settings[k] = L.settings && k in L.settings ? L.settings[k] : def[k];
  }

  // 5. secrets: updatedAt이 늦은 쪽 (null은 가장 이름)
  const ls = L.secrets || null;
  const rs = R.secrets || null;
  let secrets = ls;
  if (rs && (!ls || t(rs.updatedAt) >= t(ls.updatedAt))) secrets = rs;

  // 6. styles: 영역별로 늦은 쪽 (같으면 원격)
  const la = L.styles?.areas || {};
  const ra = R.styles?.areas || {};
  const areas = { ...la };
  for (const [k, v] of Object.entries(ra)) {
    if (!la[k] || t(v?.updatedAt) >= t(la[k]?.updatedAt)) areas[k] = v;
  }
  const times = Object.values(areas).map((a) => a?.updatedAt).filter(Boolean)
    .concat([L.styles?.updatedAt, R.styles?.updatedAt].filter(Boolean));
  const styles = { updatedAt: times.length ? times.reduce((a, b) => (t(b) > t(a) ? b : a)) : null, areas };

  const data = {
    ...L,
    students: [...maps.students.values()],
    classes: [...maps.classes.values()],
    records: [...maps.records.values()],
    settings, styles, secrets, deleted,
  };
  const sum = (f) => byStore.students[f] + byStore.classes[f] + byStore.records[f];
  return { data, changes: { added: sum('added'), updated: sum('updated'), removed: sum('removed'), byStore } };
}

function contentOf(d) {
  const x = d || {};
  const sorted = (name) => arr(x[name]).slice().sort((a, b) => String(a[STORES[name]]).localeCompare(String(b[STORES[name]])));
  return {
    students: sorted('students'), classes: sorted('classes'), records: sorted('records'),
    settings: sharedSettings(x.settings), styles: x.styles || defaultStyles(), secrets: x.secrets || null,
    deleted: arr(x.deleted).slice().sort((a, b) => `${a.store}|${a.id}`.localeCompare(`${b.store}|${b.id}`)),
  };
}

/** 머리 필드와 기기별 설정을 빼고 내용이 같은지 (올릴 필요 판단) */
export function sameData(a, b) {
  return same(contentOf(a), contentOf(b));
}

/**
 * '통째로 바꾸기': next를 쓰되, current와 다르거나 새로 생긴 항목의 updatedAt을 now로 올리고,
 * current에만 있는 항목은 삭제 기록을 남긴다. 그래야 다음 합치기에서 옛것에 지지 않는다.
 */
export function prepareReplace(current, next, now = new Date()) {
  const C = current || emptyData();
  const N = next || emptyData();
  const at = iso(now);
  const out = { ...N };
  const tombs = new Map();
  for (const d of [...arr(C.deleted), ...arr(N.deleted)]) if (d && STORES[d.store]) tombs.set(`${d.store}|${d.id}`, d);

  for (const [name, key] of Object.entries(STORES)) {
    const cm = byId(C[name], key);
    const nm = byId(N[name], key);
    out[name] = [...nm.values()].map((x) => {
      tombs.delete(`${name}|${x[key]}`);
      const c = cm.get(String(x[key]));
      if (c && same(withoutKeys(c, ['updatedAt']), withoutKeys(x, ['updatedAt']))) return { ...x, updatedAt: c.updatedAt };
      return { ...x, updatedAt: at };
    });
    for (const id of cm.keys()) if (!nm.has(id)) tombs.set(`${name}|${id}`, { store: name, id, deletedAt: at });
  }
  out.deleted = [...tombs.values()];

  // 설정: 기기별 값이 없으면 current 것. 내용이 다르면 updatedAt = now
  if (N.settings || C.settings) {
    const s = { ...(N.settings || C.settings) };
    for (const k of DEVICE_SETTING_KEYS) if (!(k in s) && C.settings && k in C.settings) s[k] = C.settings[k];
    const cmp = (x) => withoutKeys(sharedSettings(x), ['updatedAt']);
    s.updatedAt = C.settings && same(cmp(C.settings), cmp(s)) ? (C.settings.updatedAt ?? null) : at;
    out.settings = s;
  }

  // 스타일: 영역별로 다르면 updatedAt = now. next에 없는 영역은 빈 영역으로 (지운 것이 되살아나지 않게)
  const ca = C.styles?.areas || {};
  const na = N.styles?.areas || {};
  const areas = {};
  let changed = false;
  for (const k of new Set([...Object.keys(ca), ...Object.keys(na)])) {
    const n = na[k] || { examples: [], rules: '', aiRules: '' };
    const c = ca[k];
    if (c && same(withoutKeys(c, ['updatedAt']), withoutKeys(n, ['updatedAt']))) areas[k] = { ...n, updatedAt: c.updatedAt };
    else { areas[k] = { ...n, updatedAt: at }; changed = true; }
  }
  out.styles = { updatedAt: changed ? at : (C.styles?.updatedAt ?? N.styles?.updatedAt ?? null), areas };

  out.secrets = 'secrets' in N ? N.secrets : (C.secrets ?? null);
  return out;
}

/** 처음 연결 고르기 화면용 요약 */
export function summarize(data) {
  const d = data || {};
  const records = arr(d.records).filter(recordHasContent);
  const times = [...arr(d.students), ...arr(d.classes), ...records].map((x) => x.updatedAt).filter((x) => t(x) > -Infinity);
  const last = times.length ? times.reduce((a, b) => (t(b) > t(a) ? b : a)) : (d.updatedAt || null);
  return { students: arr(d.students).length, records: records.length, updatedAt: last };
}

/** 학생 또는 반 또는 내용 있는 기록이 있음 */
export function hasData(data) {
  const d = data || {};
  return arr(d.students).length > 0 || arr(d.classes).length > 0 || arr(d.records).some(recordHasContent);
}
