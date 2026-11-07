// 백업 만들기, 검사, 미리보기 통계, 병합. 순수 모듈.
// 백업에는 API 키, secrets, 기기별 설정, 삭제 기록을 넣지 않는다.

import { SCHEMA_VERSION, AREAS, AREAS_BY_KIND, STATUS_LABELS, DEVICE_SETTING_KEYS, migrate, defaultSettings, defaultStyles, recordKey } from './model.js';
import { byteLength } from './bytes.js';

export const BACKUP_KIND = 'sgb-v2-backup';
export const APP_NAME = 'textgenerator-v2';

// 키 관련 값과 이 PC에서만 쓰는 값은 백업에 넣지 않고, 가져올 때도 무시한다.
const KEY_FIELDS = ['apiKey', 'geminiApiKey', 'geminiKey', 'secrets', 'key', 'apikey', 'api_key', ...DEVICE_SETTING_KEYS];

function stripKeys(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = { ...settings };
  for (const k of KEY_FIELDS) delete out[k];
  return out;
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function cleanStyles(styles) {
  return styles && typeof styles === 'object' && styles.areas && typeof styles.areas === 'object'
    ? JSON.parse(JSON.stringify(styles)) : defaultStyles();
}

export function makeBackup({ students = [], classes = [], records = [], settings = {}, styles = null, now = new Date() } = {}) {
  const created = now instanceof Date ? now : new Date(now);
  return {
    kind: BACKUP_KIND,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: created.toISOString(),
    app: APP_NAME,
    students: arr(students).map((s) => ({ ...s })),
    classes: arr(classes).map((c) => ({ ...c, studentIds: arr(c.studentIds).slice() })),
    records: arr(records).map((r) => ({ ...r })),
    settings: stripKeys(settings),
    styles: cleanStyles(styles),
  };
}

function fail(error) {
  return { ok: false, error, backup: null };
}

/** 백업 파일 검사. 문자열이면 JSON 으로 읽는다. 낮은 버전이면 migrate */
export function validateBackup(obj) {
  let data = obj;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return fail('백업 파일을 읽을 수 없습니다. JSON 형식이 아닙니다.');
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('백업 파일 형식이 아닙니다.');
  if (data.kind !== BACKUP_KIND) return fail('생기부 작성 도우미 v2의 백업 파일이 아닙니다.');
  const v = data.schemaVersion;
  if (!Number.isInteger(v) || v < 1) return fail('백업 파일의 버전 정보가 없습니다.');
  if (v > SCHEMA_VERSION) return fail('더 새 버전의 앱에서 만든 백업입니다. 페이지를 새로 고친 뒤 다시 해 보세요.');
  for (const field of ['students', 'classes', 'records']) {
    if (!Array.isArray(data[field])) return fail(`백업 파일에 ${field} 목록이 없습니다.`);
  }
  if (data.settings != null && (typeof data.settings !== 'object' || Array.isArray(data.settings))) {
    return fail('백업 파일의 설정 형식이 맞지 않습니다.');
  }
  for (const [i, s] of data.students.entries()) {
    if (!s || !/^\d{5}$/.test(String(s.studentId ?? ''))) return fail(`학생 ${i + 1}번째의 학번 형식이 맞지 않습니다.`);
  }
  for (const [i, c] of data.classes.entries()) {
    if (!c || typeof c.id !== 'string' || !c.id) return fail(`반 ${i + 1}번째에 id 가 없습니다.`);
  }
  for (const [i, r] of data.records.entries()) {
    if (!r || typeof r.id !== 'string' || !r.id) return fail(`기록 ${i + 1}번째에 id 가 없습니다.`);
    if (!/^\d{5}$/.test(String(r.studentId ?? ''))) return fail(`기록 ${i + 1}번째의 학번 형식이 맞지 않습니다.`);
    if (!AREAS.includes(r.area)) return fail(`기록 ${i + 1}번째의 영역(${r.area})을 알 수 없습니다.`);
  }
  let backup = v < SCHEMA_VERSION ? migrate(data, v) : { ...data };
  const { secrets, deleted, ...rest } = backup;
  void secrets; void deleted;
  backup = { ...rest, settings: stripKeys(backup.settings ?? null), styles: cleanStyles(backup.styles) };
  return { ok: true, error: null, backup };
}

function byKey(list, key) {
  const map = new Map();
  for (const x of arr(list)) if (x && x[key] != null) map.set(String(x[key]), x);
  return map;
}

const CONTENT_FIELDS = ['memo', 'traits', 'length', 'achievement', 'candidates', 'draft', 'final', 'status'];

function sameContent(a, b) {
  return CONTENT_FIELDS.every((f) => JSON.stringify(a?.[f] ?? null) === JSON.stringify(b?.[f] ?? null));
}

/**
 * 가져오기 미리보기 통계.
 *  students/classes/records: 들어오는 개수
 *  newStudents: 지금 없는 학생 수
 *  doneKept: 지금 완료라서 그대로 두는 기록 수
 *  overwritten: 지금 있는 기록 중 들어온 것으로 바뀌는 수 (내용이 같으면 세지 않음)
 */
export function previewImport(current, incoming) {
  const cur = current || {};
  const inc = incoming || {};
  const curStudents = byKey(cur.students, 'studentId');
  const curRecords = byKey(cur.records, 'id');
  let newStudents = 0;
  for (const s of arr(inc.students)) if (!curStudents.has(String(s.studentId))) newStudents += 1;
  let doneKept = 0;
  let overwritten = 0;
  for (const r of arr(inc.records)) {
    const c = curRecords.get(r.id);
    if (!c) continue;
    if (c.status === 'done') doneKept += 1;
    else if (!sameContent(c, r)) overwritten += 1;
  }
  return {
    students: arr(inc.students).length,
    classes: arr(inc.classes).length,
    records: arr(inc.records).length,
    doneKept,
    newStudents,
    overwritten,
  };
}

/**
 * 병합. 학생·반은 id 로 합침(들어온 것이 우선).
 * 기록은 지금 것이 done 이면 그대로, 아니면 들어온 것으로.
 * 설정은 들어온 것을 쓰되 지금의 키 보관 방식은 유지.
 */
export function mergeBackup(current, incoming) {
  const cur = current || {};
  const inc = incoming || {};

  const students = byKey(cur.students, 'studentId');
  for (const s of arr(inc.students)) students.set(String(s.studentId), { ...s });

  const classes = byKey(cur.classes, 'id');
  for (const c of arr(inc.classes)) classes.set(String(c.id), { ...c });

  const records = byKey(cur.records, 'id');
  for (const r of arr(inc.records)) {
    const c = records.get(r.id);
    if (c && c.status === 'done') continue;
    records.set(r.id, { ...r });
  }

  let settings;
  if (inc.settings && typeof inc.settings === 'object') {
    const base = cur.settings && typeof cur.settings === 'object' ? cur.settings : defaultSettings();
    settings = stripKeys({ ...base, ...inc.settings });
  } else {
    settings = stripKeys(cur.settings ?? defaultSettings());
  }
  const def = defaultSettings();
  for (const k of DEVICE_SETTING_KEYS) settings[k] = cur.settings && k in cur.settings ? cur.settings[k] : def[k];
  settings.devFakeAI = Boolean(settings.devFakeAI);

  // 스타일: 영역 키별로 들어온 것이 우선. 들어온 백업에 없으면 지금 것
  const styles = cleanStyles(cur.styles);
  if (inc.styles && typeof inc.styles === 'object' && inc.styles.areas) {
    Object.assign(styles.areas, cleanStyles(inc.styles).areas);
    const times = Object.values(styles.areas).map((a) => a?.updatedAt).filter(Boolean).sort();
    styles.updatedAt = times.length ? times[times.length - 1] : (inc.styles.updatedAt || styles.updatedAt || null);
  }

  return {
    students: [...students.values()],
    classes: [...classes.values()],
    records: [...records.values()],
    settings,
    styles,
  };
}

/**
 * 영역별 엑셀 내보내기 행. 첫 행은 머리글. 키·비밀 정보는 넣지 않는다.
 * 반은 만든 순서, 학생은 학번 순. 같은 학생이 여러 반에 있으면 반 이름을 합침
 */
export function excelRows({ classes = [], students = [], records = [], area } = {}) {
  const rows = [['학번', '이름', '반', '과목', '최종본', '바이트', '상태']];
  const studentMap = byKey(students, 'studentId');
  const recordMap = byKey(records, 'id');
  const byRecord = new Map();
  const sorted = arr(classes).slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const c of sorted) {
    if (!(AREAS_BY_KIND[c.kind] || []).includes(area)) continue;
    const subject = area === 'subject' ? (c.subject || null) : null;
    const list = arr(c.studentIds).map((id) => studentMap.get(String(id))).filter(Boolean)
      .sort((a, b) => a.studentId.localeCompare(b.studentId));
    for (const s of list) {
      const key = `${s.studentId}|${subject || ''}`;
      if (byRecord.has(key)) { byRecord.get(key).classes.push(c.name); continue; }
      byRecord.set(key, { s, rec: recordMap.get(recordKey(s.studentId, area, subject)) || null, subject, classes: [c.name] });
    }
  }
  const list = [...byRecord.values()].sort((a, b) => a.s.studentId.localeCompare(b.s.studentId) || String(a.subject).localeCompare(String(b.subject)));
  for (const { s, rec, subject, classes: names } of list) {
    const text = rec?.final || '';
    rows.push([s.studentId, s.name, names.join(', '), subject || '', text, byteLength(text), STATUS_LABELS[rec?.status || 'empty']]);
  }
  return rows;
}
