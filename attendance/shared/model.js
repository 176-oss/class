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
  // 미정: 앱에서만 쓰는 임시 구분. 나이스에 없으므로 입력 전에 정해야 함 (spec 13.1)
  undecided: { ko: '미정', neis: null },
};
export const DIV_ORDER = ['ill', 'sago', 'etc', 'injung', 'undecided'];
// 나이스에 그대로 넣을 수 있는 구분
export const NEIS_DIVS = ['ill', 'sago', 'etc', 'injung'];

// 교시 칸 값: 0 = 조회, 1~N = N교시, 99 = 종례 (나이스 표의 jo / gyo1~ / jong 칸)
export const PERIOD_JO = 0;
export const PERIOD_JONG = 99;
export function periodLabel(p) {
  const n = Number(p);
  if (n === PERIOD_JO) return '조회';
  if (n === PERIOD_JONG) return '종례';
  return `${n}교시`;
}
// 그 종류에서 고를 수 있는 교시 값 목록 (지각: 조회~N교시, 조퇴: 1~종례, 결과: 조회~종례)
export function periodChoices(kind, per = 7) {
  const n = Number(per) || 7;
  const nums = Array.from({ length: n }, (_, i) => i + 1);
  if (kind === 'late') return [PERIOD_JO, ...nums];
  if (kind === 'early') return [...nums, PERIOD_JONG];
  if (kind === 'result') return [PERIOD_JO, ...nums, PERIOD_JONG];
  return [];
}
export function isValidPeriod(kind, p, per = 7) {
  return Number.isInteger(p) && periodChoices(kind, per).includes(p);
}

// 설정의 구분 순서 (settings.divOrder, spec 14.3). 잘못된 값이면 기본 순서
export function sanitizeDivOrder(order) {
  const out = [];
  if (Array.isArray(order)) for (const d of order) if (DIVS[d] && !out.includes(d)) out.push(d);
  for (const d of DIV_ORDER) if (!out.includes(d)) out.push(d); // 빠진 구분은 기본 순서대로 뒤에
  return out;
}
// 화면에 보일 구분 5개 (설정 순서)
export function orderedDivs(settings) {
  return sanitizeDivOrder(settings && settings.divOrder);
}
// 나이스에 넣을 수 있는 구분 4개 (설정 순서, 미정 제외)
export function orderedNeisDivs(settings) {
  return orderedDivs(settings).filter((d) => NEIS_DIVS.includes(d));
}

// 나이스 일괄 콤보 cmbAtteScCd 코드 (참고용, neis-structure.md 7절)
const DIV_CODE = { ill: 0, sago: 1, etc: 2, injung: 3 };
const KIND_CODE = { absent: 0, late: 1, early: 2, result: 3 };
export function neisComboCode(div, kind) {
  if (!(div in DIV_CODE) || !(kind in KIND_CODE)) return '';
  return String(KIND_CODE[kind]) + String(DIV_CODE[div] + 1);
}

// 나이스 표 chulgyulGb 기대 문자열 (예: "질병결과"). 구분 미정이면 null
export function chulgyulGb(div, kind) {
  if (!DIVS[div]?.neis || !KINDS[kind]) return null;
  return DIVS[div].ko + KINDS[kind].ko;
}

// 나이스 자동 입력을 막는 이유 (없으면 null)
//  - 구분 미정: 나이스에 없는 구분
//  - 기타인데 사유 없음: 나이스가 기타결석 등은 사유 없이 저장하지 않음 (neis-structure 10절)
export function neisBlockReason(record) {
  if (!record) return '기록이 없습니다.';
  if (!DIVS[record.div]?.neis) return '구분이 정해지지 않았습니다.';
  if (record.div === 'etc' && !String(record.reason || '').trim()) return '기타는 사유가 필요합니다.';
  return null;
}
export function isNeisReady(record) {
  return neisBlockReason(record) === null;
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
// div가 없는 사유(미정)는 사유 칸만 채우고 구분은 바꾸지 않음
export const DEFAULT_QUICK_REASONS = [
  { label: '미정' },
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
    periodPainCountsParentNote: false, // 생리통 학부모확인서도 학부모확인서 월 한도에 포함 (기본 끔)
    divOrder: DIV_ORDER.slice(), // 구분 버튼 순서 (spec 14.3)
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
    const p = record.period == null || record.period === '' ? NaN : Number(record.period);
    if (!isValidPeriod(record.kind, p, per)) errs.push('교시를 고르세요.');
  }
  if (record.kind === 'result') {
    const ps = record.periods || [];
    if (!ps.length) errs.push('빠진 교시를 하나 이상 고르세요.');
    else if (ps.some((p) => !isValidPeriod('result', p, per))) errs.push(`교시는 조회, 1~${per}교시, 종례 중에서 고르세요.`);
  }
  if (Array.isArray(record.docs)) {
    for (const d of record.docs) {
      if (!DOC_TYPES[d.type]) errs.push('증빙서류 종류를 확인하세요.');
    }
  }
  return errs;
}

// 결과 교시 목록 -> "조회, 2, 3교시, 종례"
export function periodsText(periods) {
  const ps = [...(periods || [])].map(Number).sort((a, b) => a - b);
  const lab = [];
  const nums = ps.filter((p) => p >= 1 && p < PERIOD_JONG);
  if (ps.includes(PERIOD_JO)) lab.push('조회');
  if (nums.length) lab.push(`${nums.join(', ')}교시`);
  if (ps.includes(PERIOD_JONG)) lab.push('종례');
  return lab.join(', ');
}

// 목록 한 줄 요약: 구분 + 종류 + 교시
export function describeKind(record) {
  const divKo = record.tag === 'fieldTrip' ? '체험학습' : (DIVS[record.div]?.ko || '');
  const kindKo = KINDS[record.kind]?.ko || '';
  let s = `${divKo} ${kindKo}`;
  // 지각 N = N교시까지 없음 (지각 조회 = 조회만), 조퇴 N = N교시부터 없음 (조퇴 종례 = 종례만)
  const has = record.period != null && record.period !== '';
  if (record.kind === 'late' && has) s += Number(record.period) === PERIOD_JO ? ' 조회만' : ` ${record.period}교시까지`;
  if (record.kind === 'early' && has) s += Number(record.period) === PERIOD_JONG ? ' 종례만' : ` ${record.period}교시부터`;
  if (record.kind === 'result' && record.periods?.length) s += ` ${periodsText(record.periods)}`;
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

// ---------- 학생 명단 (roster, spec 14.4) ----------
// 기록(records)에는 이름을 넣지 않는다. 이름은 최상위 선택 필드 roster 에만 있다.
//   roster = { students: [{no, name}], updatedAt: ISO, source: 'neis' | 'manual' }
// 명단 비우기는 students: [] + 새 updatedAt 으로 표현한다 (다른 기기에서도 비워짐).
export const ROSTER_MAX = 80;
export const ROSTER_NAME_MAX = 20;
export const ROSTER_NO_MAX = 99;

// 이름 정리: 제어문자 제거, 공백 정리. 비었거나 20자 초과면 null (잘라서 틀린 이름을 만들지 않는다)
const isBlockedChar = (c) => c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff;
export function cleanStudentName(name) {
  if (typeof name !== 'string') return null;
  // 제어문자·보이지 않는 글자(너비 0 공백, 방향 표시 등)는 지우고, 줄바꿈·탭은 공백으로
  const s = [...name].map((c) => (isBlockedChar(c.codePointAt(0)) ? (/\s/.test(c) ? ' ' : '') : c)).join('').replace(/\s+/g, ' ').trim();
  if (!s || [...s].length > ROSTER_NAME_MAX) return null;
  return s;
}

// 학생 한 명: no/name 두 키만 남김 (생년월일 등 다른 키는 모두 제거). 올바르지 않으면 null
export function sanitizeStudent(st) {
  if (!st || typeof st !== 'object') return null;
  const no = typeof st.no === 'string' && /^\d+$/.test(st.no.trim()) ? Number(st.no) : st.no;
  if (!Number.isInteger(no) || no < 1 || no > ROSTER_NO_MAX) return null;
  const name = cleanStudentName(st.name);
  return name ? { no, name } : null;
}

// 명단 정리. 번호 중복은 마지막 것, 최대 80명, 번호 오름차순.
// roster 가 없거나 형식이 아니면 null. students 가 비어도 updatedAt 이 있으면 '비움' 표시로 남긴다.
export function sanitizeRoster(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const map = new Map();
  if (Array.isArray(r.students)) for (const st of r.students) { const s = sanitizeStudent(st); if (s) map.set(s.no, s); }
  const students = [...map.values()].sort((a, b) => a.no - b.no).slice(0, ROSTER_MAX);
  const updatedAt = Number.isFinite(Date.parse(r.updatedAt || '')) ? new Date(Date.parse(r.updatedAt)).toISOString() : null;
  if (!students.length && !updatedAt) return null;
  return { students, updatedAt, source: r.source === 'neis' ? 'neis' : 'manual' };
}

// 새 명단 만들기 (updatedAt = now). students 를 비우면 '명단 비우기' 표시
export function makeRoster(students, source = 'manual', now = new Date().toISOString()) {
  return sanitizeRoster({ students, updatedAt: now, source }) || { students: [], updatedAt: now, source: 'manual' };
}

// 두 명단 병합: updatedAt 이 늦은 쪽을 통째로. 한쪽만 있으면 그쪽. 같으면 a(이 기기)
export function mergeRoster(a, b) {
  const A = sanitizeRoster(a), B = sanitizeRoster(b);
  if (!A) return B;
  if (!B) return A;
  return ts(B.updatedAt) > ts(A.updatedAt) ? B : A;
}

export const hasRoster = (roster) => !!(roster && Array.isArray(roster.students) && roster.students.length);

// 번호로 이름 찾기 (없으면 ''). 모든 화면의 이름 표시는 이 함수를 통한다.
export function nameOf(roster, no) {
  if (!hasRoster(roster)) return '';
  const n = Number(no);
  const st = roster.students.find((s) => Number(s.no) === n);
  return st ? st.name : '';
}

// ---- 한글 초성 검색 ----
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const CHO_SET = new Set(CHO);
// 완성형 한글 글자의 초성 (한글 음절이 아니면 null)
function choOf(ch) {
  const c = ch.charCodeAt(0) - 0xac00;
  return c >= 0 && c <= 11171 ? CHO[Math.floor(c / 588)] : null;
}
// 질의 글자 q 가 이름 글자 n 과 맞는가 (질의가 초성이면 n 의 초성과, 아니면 같은 글자)
function charMatch(q, n) {
  if (CHO_SET.has(q)) return choOf(n) === q || n === q;
  return q === n;
}
// 이름 안에서 질의가 처음 맞는 위치 (없으면 -1)
function indexOfQuery(name, q) {
  const nc = [...name.toLowerCase().replace(/\s+/g, '')];
  const qc = [...q];
  for (let i = 0; i + qc.length <= nc.length; i++) {
    let ok = true;
    for (let j = 0; j < qc.length; j++) if (!charMatch(qc[j], nc[i + j])) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}
const cleanQuery = (q) => String(q == null ? '' : q).normalize('NFC').toLowerCase().replace(/\s+/g, '');
// '7', '07', '7번' → 7 (숫자 질의가 아니면 null)
function numberQuery(q) {
  const m = /^(\d{1,3})번?$/.exec(q);
  return m ? Number(m[1]) : null;
}

// 번호 또는 이름으로 학생 찾기 (순수 함수).
//  - 숫자 질의: 번호 일치가 먼저, 그다음 번호 접두 일치(예 '1' → 1, 10~19)
//  - 문자 질의: 이름 부분 일치 + 한글 초성 검색('ㄱㅅㅇ' → 구세인, '구ㅅㅇ'도 됨). 이름 앞부분 일치가 먼저
//  - 동명이인은 모두 나옴. 결과 각 항목은 {no, name}. 빈 질의는 []
export function searchStudents(roster, query, limit = 8) {
  if (!hasRoster(roster)) return [];
  const q = cleanQuery(query);
  if (!q) return [];
  const list = [...roster.students].sort((a, b) => a.no - b.no);
  const out = [];
  const n = numberQuery(q);
  if (n !== null) {
    const exact = list.filter((s) => s.no === n);
    const prefix = n > 0 ? list.filter((s) => s.no !== n && String(s.no).startsWith(String(n))) : [];
    out.push(...exact, ...prefix);
  } else {
    const ranked = [];
    for (const s of list) {
      const i = indexOfQuery(s.name, q);
      if (i >= 0) ranked.push({ s, rank: i === 0 ? 0 : 1 });
    }
    ranked.sort((a, b) => a.rank - b.rank || a.s.no - b.s.no);
    out.push(...ranked.map((x) => x.s));
  }
  return out.slice(0, Math.max(0, limit)).map((s) => ({ no: s.no, name: s.name }));
}

// 목록 필터용: 질의에 맞는 번호인지 판단하는 함수. 빈 질의면 null (거르지 않음).
//  숫자 질의는 그 번호만(접두 아님), 문자 질의는 이름 부분 일치·초성. 명단에 없는 번호도 숫자로는 맞음.
export function makeStudentFilter(roster, query) {
  const q = cleanQuery(query);
  if (!q) return null;
  const n = numberQuery(q);
  if (n !== null) return (no) => Number(no) === n;
  const nos = new Set(hasRoster(roster) ? roster.students.filter((s) => indexOfQuery(s.name, q) >= 0).map((s) => s.no) : []);
  return (no) => nos.has(Number(no));
}

// 붙여넣은 명단 글 읽기. 한 줄에 한 명: "7 홍길동", "7. 홍길동", "7)홍길동", "7번 홍길동", "7\t홍길동" 등.
// 탭이 있으면 둘째 칸만 이름으로 읽는다(셋째 칸 이후 생년월일 등은 버림). 이름에 숫자가 있으면 오류.
// 반환 {students (정리됨), errors:[{line, text, reason}], duplicates:[번호]}
export function parseRosterText(text) {
  const students = new Map();
  const errors = [];
  const duplicates = [];
  const lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    const t = raw.trim();
    if (!t) return;
    const fail = (reason) => errors.push({ line, text: t.length > 30 ? `${t.slice(0, 30)}...` : t, reason });
    let noPart, namePart;
    if (t.includes('\t')) {
      const cols = t.split('\t').map((c) => c.trim()).filter((c, i) => i < 2 || c);
      noPart = cols[0];
      namePart = cols[1];
      const m = /^(\d{1,3})\s*(?:번|[.)\]:,])?$/.exec(noPart || '');
      if (!m || !namePart) return fail(!m ? '번호를 읽을 수 없습니다' : '이름이 없습니다');
      noPart = m[1];
    } else {
      const m = /^(\d{1,3})\s*(?:번|[.)\]:,])?\s*(.*)$/.exec(t);
      if (!m) return fail('번호로 시작해야 합니다');
      noPart = m[1];
      namePart = m[2];
    }
    const no = Number(noPart);
    if (!(no >= 1 && no <= ROSTER_NO_MAX)) return fail(`번호는 1~${ROSTER_NO_MAX} 사이여야 합니다`);
    if (/\d/.test(namePart || '')) return fail('이름에 숫자가 있습니다');
    const name = cleanStudentName(namePart);
    if (!name) return fail(!String(namePart || '').trim() ? '이름이 없습니다' : `이름은 ${ROSTER_NAME_MAX}자 이하여야 합니다`);
    if (students.has(no) && !duplicates.includes(no)) duplicates.push(no);
    students.set(no, { no, name });
  });
  const list = [...students.values()].sort((a, b) => a.no - b.no);
  if (list.length > ROSTER_MAX) {
    for (const s of list.slice(ROSTER_MAX)) errors.push({ line: 0, text: `${s.no}번`, reason: `최대 ${ROSTER_MAX}명까지 등록합니다` });
  }
  return { students: list.slice(0, ROSTER_MAX), errors, duplicates };
}

const SETTINGS_KEYS = ['schoolYear', 'grade', 'classNo', 'studentCount', 'periodsPerDay', 'parentNoteLimit', 'periodPainLimit', 'updatedAt'];
const SETTINGS_BOOL_KEYS = ['periodPainCountsParentNote'];
export function sanitizeSettings(s, base = defaultSettings()) {
  const out = { ...base };
  delete out.updatedAt;
  if (s && typeof s === 'object') {
    for (const k of SETTINGS_KEYS) if (s[k] !== undefined && s[k] !== null && s[k] !== '') out[k] = k === 'updatedAt' ? s[k] : Number(s[k]);
    for (const k of SETTINGS_BOOL_KEYS) if (typeof s[k] === 'boolean') out[k] = s[k];
    if (Array.isArray(s.divOrder)) out.divOrder = s.divOrder;
    if (Array.isArray(s.quickReasons)) {
      out.quickReasons = s.quickReasons.filter((q) => q && q.label).map((q) => {
        const o = { label: String(q.label) };
        if (RECORD_DIVS.has(q.div)) o.div = q.div; // div 없음 = 구분은 그대로
        if (RECORD_KINDS.has(q.kind)) o.kind = q.kind;
        if (q.tag === 'periodPain' || q.tag === 'fieldTrip') o.tag = q.tag;
        return o;
      });
    }
  }
  out.divOrder = sanitizeDivOrder(out.divOrder);
  return out;
}

export function normalizeData(data) {
  const base = createEmptyData();
  if (!data || typeof data !== 'object') return base;
  const out = {
    schema: data.schema || SCHEMA_VERSION,
    updatedAt: data.updatedAt || base.updatedAt,
    settings: sanitizeSettings(data.settings),
    records: Array.isArray(data.records) ? data.records.map(sanitizeRecord).filter(Boolean) : [],
    deleted: Array.isArray(data.deleted) ? data.deleted.filter((d) => d && d.id).map((d) => ({ id: String(d.id), deletedAt: d.deletedAt || null })) : [],
  };
  const roster = sanitizeRoster(data.roster); // 선택 필드: 없으면 키 자체를 두지 않음
  if (roster) out.roster = roster;
  return out;
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

  const out = {
    schema: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    settings: { ...settings, quickReasons: (settings.quickReasons || []).map((q) => ({ ...q })), divOrder: sanitizeDivOrder(settings.divOrder) },
    records,
    deleted: [...deletedMap.values()],
  };
  const roster = mergeRoster(L.roster, R.roster); // updatedAt 이 늦은 쪽을 통째로
  if (roster) out.roster = roster;
  return out;
}

// 원격 반영 전후 비교 (자동 확인, 계약 5절). 화면 안내용: 무엇이 몇 건 바뀌었는지.
//  - kinds[id]: 'added' | 'removed' | 'body'(본문) | 'docs'(서류 제출만) | 'neis'(나이스 입력 완료만)
//  - neisOnly: 바뀐 기록이 모두 나이스 입력 완료만 바뀐 경우
//  - 시각 값(updatedAt 등)만 다르고 내용이 같으면 바뀐 것으로 보지 않는다
//  - roster: 학생 명단이 바뀌었는가 (기록 변경 건수 changed 에는 들어가지 않음)
const DIFF_BODY_KEYS = ['date', 'no', 'kind', 'div', 'period', 'periods', 'reason', 'tag', 'groupId'];
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const docsShape = (r) => (r.docs || []).map((d) => [d.type, d.name || '']);
const docsState = (r) => (r.docs || []).map((d) => !!d.submitted);
const neisState = (r) => [!!(r.neis && r.neis.done), (r.neis && r.neis.doneAt) || null];
export function diffRemoteChanges(before, after) {
  const B = new Map(((before && before.records) || []).map((r) => [r.id, r]));
  const A = new Map(((after && after.records) || []).map((r) => [r.id, r]));
  const kinds = {};
  for (const [id, a] of A) {
    const b = B.get(id);
    if (!b) { kinds[id] = 'added'; continue; }
    if (DIFF_BODY_KEYS.some((k) => !sameJson(a[k], b[k])) || !sameJson(docsShape(a), docsShape(b))) kinds[id] = 'body';
    else if (!sameJson(docsState(a), docsState(b))) kinds[id] = 'docs';
    else if (!sameJson(neisState(a), neisState(b))) kinds[id] = 'neis';
  }
  for (const id of B.keys()) if (!A.has(id)) kinds[id] = 'removed';
  const ids = Object.keys(kinds);
  // 명단(roster)은 기록 변경으로 세지 않고 roster 표시만 따로 알림
  const roster = !sameJson(sanitizeRoster(before && before.roster), sanitizeRoster(after && after.roster));
  return { changed: ids.length, neisOnly: ids.length > 0 && ids.every((id) => kinds[id] === 'neis'), ids, kinds, roster };
}

// ---------- 버전 ----------
// '0.4.10' 같은 점 구분 숫자 버전 비교. a<b → -1, 같으면 0, a>b → 1. 숫자가 아닌 조각은 0으로 본다.
export function compareVersions(a, b) {
  const pa = String(a == null ? '' : a).trim().split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b == null ? '' : b).trim().split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
