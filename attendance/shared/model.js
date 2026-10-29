// 출결관리 도우미 데이터 모델 (앱·확장 공통)
// 순수 ES 모듈: DOM, 네트워크, 저장소 접근 없음.
// 원본은 shared/model.js. app/shared/, extension/shared/ 는 scripts/sync-shared.sh 로 복사한 사본.

export const SCHEMA_VERSION = 1;
export const DATA_FILE_NAME = 'attendance-data.json';
export const STORAGE_KEY = 'ah.data';
export const LOCAL_SETTINGS_KEY = 'ah.settings.local';
export const ROSTER_KEY = 'ah.roster';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// ---------- 매핑 ----------
// 종류: 앱 kind → 한글, 나이스 출결마감구분 팝업 rdbSort 값
export const KINDS = {
  absent: { ko: '결석', neis: 'gyulsuk' },
  late:   { ko: '지각', neis: 'late' },
  early:  { ko: '조퇴', neis: 'chotoe' },
  result: { ko: '결과', neis: 'gyulgwa' },
};
export const KIND_ORDER = ['absent', 'late', 'early', 'result'];

// 구분: 앱 div → 한글, 나이스 rdbDiv 값
export const DIVS = {
  ill:    { ko: '질병',     neis: 'ill' },
  sago:   { ko: '미인정',   neis: 'sago' },
  etc:    { ko: '기타',     neis: 'etc' },
  injung: { ko: '출석인정', neis: 'injung' },
};
export const DIV_ORDER = ['ill', 'sago', 'etc', 'injung'];

// 나이스 일괄 콤보 cmbAtteScCd 코드 (참고용, neis-structure.md 7절)
const DIV_CODE = { ill: 0, sago: 1, etc: 2, injung: 3 };
const KIND_CODE = { absent: 0, late: 1, early: 2, result: 3 };
export function neisComboCode(div, kind) {
  if (!(div in DIV_CODE) || !(kind in KIND_CODE)) return '';
  return String(KIND_CODE[kind]) + String(DIV_CODE[div] + 1);
}

// 나이스 표 chulgyulGb 기대 문자열 (예: "질병결과")
export function chulgyulGb(div, kind) {
  return (DIVS[div]?.ko || '') + (KINDS[kind]?.ko || '');
}

export const TAGS = {
  periodPain: { ko: '생리통' },
  fieldTrip:  { ko: '교외체험학습' },
};

export const DOC_TYPES = {
  prescription: { ko: '처방전' },
  medicalNote:  { ko: '진료확인서' },
  parentNote:   { ko: '학부모확인서' },
  tripApply:    { ko: '체험학습 신청서', short: '신청서' },
  tripReport:   { ko: '체험학습 보고서', short: '보고서' },
  other:        { ko: '기타 서류' },
};
export const ILL_DOC_TYPES = ['parentNote', 'prescription', 'medicalNote'];

// short=true면 목록용 짧은 이름 (체험학습 서류는 '신청서', '보고서')
export function docLabel(doc, short = false) {
  if (!doc) return '';
  if (doc.type === 'other') return (doc.name || '').trim() || '기타 서류';
  const t = DOC_TYPES[doc.type];
  if (!t) return doc.type;
  return short && t.short ? t.short : t.ko;
}

// ---------- 기본 설정 ----------
export const DEFAULT_QUICK_REASONS = [
  { label: '복통', div: 'ill' },
  { label: '감기', div: 'ill' },
  { label: '몸살', div: 'ill' },
  { label: '생리통', div: 'injung', tag: 'periodPain' },
  { label: '교외체험학습', div: 'injung', kind: 'absent', tag: 'fieldTrip' },
];

export function defaultSettings(today = new Date()) {
  // 학년도: 3월 시작. 1~2월은 전년도 학년도.
  const y = today.getFullYear();
  const schoolYear = today.getMonth() < 2 ? y - 1 : y;
  return {
    schoolYear,
    grade: 1,
    classNo: 1,
    studentCount: 30,
    periodsPerDay: 7,
    parentNoteLimit: 2,
    periodPainLimit: 1,
    quickReasons: DEFAULT_QUICK_REASONS.map((q) => ({ ...q })),
  };
}

export function createEmptyData(settings) {
  return {
    schema: SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    settings: settings ? { ...settings } : defaultSettings(),
    records: [],
    deleted: [],
  };
}

// ---------- id ----------
export function newId(prefix = 'r') {
  const t = Date.now().toString(36);
  let rand = '';
  for (let i = 0; i < 4; i++) rand += Math.floor(Math.random() * 16).toString(16);
  return `${prefix}_${t}_${rand}`;
}

// ---------- 날짜 유틸 (로컬 시간대 기준) ----------
const pad2 = (n) => String(n).padStart(2, '0');
export const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function toDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export const todayStr = () => toDateStr(new Date());

export function isDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseDate(s);
  return toDateStr(d) === s;
}
export function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
export function isWeekend(s) {
  const w = parseDate(s).getDay();
  return w === 0 || w === 6;
}
export function weekdayKo(s) {
  return WEEKDAYS_KO[parseDate(s).getDay()];
}
export function yearMonthOf(s) {
  return String(s).slice(0, 7);
}
// 날짜 차이 (b - a, 일)
export function daysBetween(a, b) {
  const ms = parseDate(b) - parseDate(a);
  return Math.round(ms / 86400000);
}
// "10월 29일 (목)"
export function formatDateKo(s, withWeekday = true) {
  const d = parseDate(s);
  const base = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return withWeekday ? `${base} (${WEEKDAYS_KO[d.getDay()]})` : base;
}
// "10월 20~22일" 또는 "10월 30일~11월 2일"
export function formatRangeKo(start, end) {
  if (!end || start === end) return formatDateKo(start, false);
  const a = parseDate(start), b = parseDate(end);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.getMonth() + 1}월 ${a.getDate()}~${b.getDate()}일`;
  }
  return `${formatDateKo(start, false)}~${formatDateKo(end, false)}`;
}
// "20261029"
export function compactDate(s) {
  return String(s).replace(/-/g, '');
}

// ---------- 기록 ----------
export function createRecord(fields = {}) {
  const now = new Date().toISOString();
  const kind = fields.kind || 'absent';
  const rec = {
    id: fields.id || newId('r'),
    date: fields.date || todayStr(),
    no: Number(fields.no) || 0,
    kind,
    div: fields.div || 'ill',
    period: null,
    periods: [],
    reason: (fields.reason || '').trim(),
    tag: fields.tag || null,
    docs: Array.isArray(fields.docs) ? fields.docs.map(normalizeDoc) : [],
    groupId: fields.groupId || null,
    neis: normalizeNeis(fields.neis),
    createdAt: fields.createdAt || now,
    updatedAt: fields.updatedAt || now,
  };
  if (kind === 'late' || kind === 'early') {
    rec.period = fields.period == null || fields.period === '' ? null : Number(fields.period);
  }
  if (kind === 'result') {
    rec.periods = [...new Set((fields.periods || []).map(Number))].sort((a, b) => a - b);
  }
  return rec;
}

// 서류 항목. updatedAt은 이 항목(제출 여부·종류·이름)을 마지막으로 바꾼 시각 (병합 기준).
function normalizeDoc(d) {
  const doc = {
    type: d.type || 'other',
    submitted: !!d.submitted,
    submittedAt: d.submitted ? (d.submittedAt || new Date().toISOString()) : null,
    updatedAt: d.updatedAt || null,
  };
  if (doc.type === 'other') doc.name = (d.name || '').trim();
  return doc;
}

// 나이스 입력 상태. updatedAt은 done/doneAt을 마지막으로 바꾼 시각 (병합 기준).
function normalizeNeis(n) {
  if (!n || typeof n !== 'object') return { done: false, doneAt: null, updatedAt: null };
  return { done: !!n.done, doneAt: n.doneAt || null, updatedAt: n.updatedAt || null };
}

// 기록 검증 → 오류 메시지 배열 (빈 배열이면 통과)
export function validate(record, settings = {}) {
  const errs = [];
  const count = Number(settings.studentCount) || 0;
  const per = Number(settings.periodsPerDay) || 7;
  if (!record || typeof record !== 'object') return ['기록 형식이 올바르지 않습니다.'];
  if (!isDateStr(record.date)) errs.push('날짜를 확인하세요.');
  const no = Number(record.no);
  if (!Number.isInteger(no) || no < 1 || (count && no > count)) {
    errs.push(count ? `번호는 1~${count} 사이로 입력하세요.` : '번호를 확인하세요.');
  }
  if (!KINDS[record.kind]) errs.push('종류를 고르세요.');
  if (!DIVS[record.div]) errs.push('구분을 고르세요.');
  if (record.kind === 'late' || record.kind === 'early') {
    const p = Number(record.period);
    if (!Number.isInteger(p) || p < 1 || p > per) errs.push('교시를 고르세요.');
  }
  if (record.kind === 'result') {
    const ps = record.periods || [];
    if (!ps.length) errs.push('빠진 교시를 하나 이상 고르세요.');
    else if (ps.some((p) => !Number.isInteger(p) || p < 1 || p > per)) errs.push(`교시는 1~${per} 사이여야 합니다.`);
  }
  if (Array.isArray(record.docs)) {
    for (const d of record.docs) {
      if (!DOC_TYPES[d.type]) errs.push('증빙서류 종류를 확인하세요.');
    }
  }
  return errs;
}

// 목록 한 줄 요약: 구분 + 종류 + 교시
export function describeKind(record) {
  const divKo = record.tag === 'fieldTrip' ? '체험학습' : (DIVS[record.div]?.ko || '');
  const kindKo = KINDS[record.kind]?.ko || '';
  let s = `${divKo} ${kindKo}`;
  // 지각 N = N교시까지 없음, 조퇴 N = N교시부터 없음
  if (record.kind === 'late' && record.period) s += ` ${record.period}교시까지`;
  if (record.kind === 'early' && record.period) s += ` ${record.period}교시부터`;
  if (record.kind === 'result' && record.periods?.length) s += ` ${record.periods.join(', ')}교시`;
  return s;
}
// "질병 조퇴 2교시부터 · 학부모확인서"
export function describeRecord(record) {
  const parts = [describeKind(record)];
  if (record.docs?.length) parts.push(record.docs.map((d) => docLabel(d, true)).join('·'));
  else if (record.reason) parts.push(record.reason);
  return parts.join(' · ');
}

// ---------- 정리·병합 ----------
const ts = (s) => {
  const t = Date.parse(s || '');
  return Number.isFinite(t) ? t : 0;
};

const RECORD_KINDS = new Set(Object.keys(KINDS));
const RECORD_DIVS = new Set(Object.keys(DIVS));

// 계약 2절의 필드만 남긴 기록 (이름 등 계약 외 필드 제거). 시각 값은 새로 만들지 않는다.
export function sanitizeRecord(r) {
  if (!r || typeof r !== 'object' || !r.id) return null;
  const kind = RECORD_KINDS.has(r.kind) ? r.kind : 'absent';
  const out = {
    id: String(r.id),
    date: String(r.date || ''),
    no: Number(r.no) || 0,
    kind,
    div: RECORD_DIVS.has(r.div) ? r.div : 'ill',
    period: (kind === 'late' || kind === 'early') && r.period != null && r.period !== '' ? Number(r.period) : null,
    periods: kind === 'result' && Array.isArray(r.periods) ? [...new Set(r.periods.map(Number))].sort((a, b) => a - b) : [],
    reason: typeof r.reason === 'string' ? r.reason : '',
    tag: r.tag === 'periodPain' || r.tag === 'fieldTrip' ? r.tag : null,
    docs: Array.isArray(r.docs) ? r.docs.filter((d) => d && typeof d === 'object').map((d) => {
      const doc = {
        type: DOC_TYPES[d.type] ? d.type : 'other',
        submitted: !!d.submitted,
        submittedAt: d.submitted ? (d.submittedAt || null) : null,
        updatedAt: d.updatedAt || null,
      };
      if (doc.type === 'other') doc.name = typeof d.name === 'string' ? d.name : '';
      return doc;
    }) : [],
    groupId: r.groupId ? String(r.groupId) : null,
    neis: normalizeNeis(r.neis),
    createdAt: r.createdAt || null,
    updatedAt: r.updatedAt || null,
  };
  return out;
}

const SETTINGS_KEYS = ['schoolYear', 'grade', 'classNo', 'studentCount', 'periodsPerDay', 'parentNoteLimit', 'periodPainLimit', 'updatedAt'];
export function sanitizeSettings(s, base = defaultSettings()) {
  const out = { ...base };
  delete out.updatedAt;
  if (s && typeof s === 'object') {
    for (const k of SETTINGS_KEYS) if (s[k] !== undefined && s[k] !== null && s[k] !== '') out[k] = k === 'updatedAt' ? s[k] : Number(s[k]);
    if (Array.isArray(s.quickReasons)) {
      out.quickReasons = s.quickReasons.filter((q) => q && q.label).map((q) => {
        const o = { label: String(q.label), div: RECORD_DIVS.has(q.div) ? q.div : 'ill' };
        if (RECORD_KINDS.has(q.kind)) o.kind = q.kind;
        if (q.tag === 'periodPain' || q.tag === 'fieldTrip') o.tag = q.tag;
        return o;
      });
    }
  }
  return out;
}

export function normalizeData(data) {
  const base = createEmptyData();
  if (!data || typeof data !== 'object') return base;
  return {
    schema: data.schema || SCHEMA_VERSION,
    updatedAt: data.updatedAt || base.updatedAt,
    settings: sanitizeSettings(data.settings),
    records: Array.isArray(data.records) ? data.records.map(sanitizeRecord).filter(Boolean) : [],
    deleted: Array.isArray(data.deleted) ? data.deleted.filter((d) => d && d.id).map((d) => ({ id: String(d.id), deletedAt: d.deletedAt || null })) : [],
  };
}

// 서류 한 항목의 병합 기준 시각: updatedAt, 없으면(옛 데이터) submittedAt
const docStamp = (d) => ts(d?.updatedAt || d?.submittedAt);
const neisStamp = (n) => ts(n?.updatedAt || n?.doneAt);

// 같은 id 기록 두 개를 필드 묶음 단위로 병합 (계약 5절)
//  - 본문(date,no,kind,div,period,periods,reason,tag,groupId, 서류 목록의 구성): record.updatedAt이 늦은 쪽
//  - docs[i]: 같은 인덱스·같은 type이면 docs[i].updatedAt(없으면 submittedAt)이 늦은 쪽
//  - neis: neis.updatedAt(없으면 doneAt)이 늦은 쪽. 같으면 done=true 쪽
export function mergeRecord(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aWins = ts(a.updatedAt) >= ts(b.updatedAt);
  const body = aWins ? a : b;
  const other = aWins ? b : a;
  const docs = (body.docs || []).map((d, i) => {
    const o = (other.docs || [])[i];
    if (!o || o.type !== d.type) return { ...d };
    return docStamp(o) > docStamp(d) ? { ...o } : { ...d };
  });
  const na = body.neis || {}, nb = other.neis || {};
  let neis;
  if (neisStamp(nb) > neisStamp(na)) neis = { ...nb };
  else if (neisStamp(nb) === neisStamp(na) && nb.done && !na.done) neis = { ...nb };
  else neis = { ...na };
  return {
    ...body,
    docs,
    neis: normalizeNeis(neis),
    createdAt: [a.createdAt, b.createdAt].filter(Boolean).sort()[0] || body.createdAt,
  };
}

// 병합 규칙 (계약 5절)
//  - 기록: 같은 id는 mergeRecord로 필드 묶음 단위 병합
//  - 삭제: deleted에 있는 id는 제거. 단, 기록의 updatedAt이 deletedAt보다 늦으면(삭제 후 되돌리기) 기록을 살리고 삭제 표시를 지움
//  - settings: settings.updatedAt이 늦은 쪽. 한쪽에만 있으면 그쪽. 둘 다 없으면 파일 updatedAt이 늦은 쪽
//  - 결과 updatedAt은 지금 시각. 계약 외 필드(이름 등)는 제거
export function mergeData(local, remote) {
  const L = normalizeData(local);
  if (!remote) return { ...L, updatedAt: new Date().toISOString() };
  const R = normalizeData(remote);

  const recMap = new Map();
  for (const r of [...L.records, ...R.records]) recMap.set(r.id, mergeRecord(recMap.get(r.id), r));

  const deletedMap = new Map();
  for (const d of [...L.deleted, ...R.deleted]) {
    const prev = deletedMap.get(d.id);
    if (!prev || ts(d.deletedAt) > ts(prev.deletedAt)) deletedMap.set(d.id, { id: d.id, deletedAt: d.deletedAt || new Date().toISOString() });
  }
  for (const [id, d] of [...deletedMap]) {
    const r = recMap.get(id);
    if (!r) continue;
    if (ts(r.updatedAt) > ts(d.deletedAt)) deletedMap.delete(id); // 되돌린 기록
    else recMap.delete(id);
  }
  const records = [...recMap.values()]
    .sort((a, b) => (a.date === b.date ? a.no - b.no : a.date < b.date ? -1 : 1));

  let settings;
  const ls = L.settings.updatedAt, rs = R.settings.updatedAt;
  if (ls && rs) settings = ts(rs) > ts(ls) ? R.settings : L.settings;
  else if (ls || rs) settings = ls ? L.settings : R.settings;
  else settings = ts(R.updatedAt) > ts(L.updatedAt) ? R.settings : L.settings;

  return {
    schema: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    settings: { ...settings, quickReasons: (settings.quickReasons || []).map((q) => ({ ...q })) },
    records,
    deleted: [...deletedMap.values()],
  };
}
