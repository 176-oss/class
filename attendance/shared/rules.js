// 출결관리 도우미 규칙 엔진 (앱·확장 공통)
// 순수 함수만. DOM, 네트워크, 저장소 접근 없음.
import {
  validate, yearMonthOf, isDateStr, isWeekend, addDays,
  daysBetween, chulgyulGb, docLabel,
} from './model.js';

const hasDoc = (r, type) => Array.isArray(r.docs) && r.docs.some((d) => d.type === type);
// today(YYYY-MM-DD)를 주면 같은 달은 '이번 달', 아니면 '10월'
const monthWordOf = (ym, today) => (today && yearMonthOf(today) === ym ? '이번 달' : `${Number(ym.slice(5, 7))}월`);

// ---------- 학부모확인서 ----------
// 그 달 학부모확인서 사용 횟수. 결석 1일 = 1회 (기간 결석은 날짜별 기록이므로 기록 1건 = 1회),
// 지각·조퇴·결과 1건 = 1회.
export function countParentNotes(records, no, yearMonth, excludeId) {
  return parentNoteRecords(records, no, yearMonth, excludeId).length;
}

export function parentNoteRecords(records, no, yearMonth, excludeId) {
  const ex = toSet(excludeId);
  return (records || []).filter((r) =>
    Number(r.no) === Number(no) &&
    yearMonthOf(r.date) === yearMonth &&
    !ex.has(r.id) &&
    hasDoc(r, 'parentNote'),
  ).sort((a, b) => (a.date < b.date ? -1 : 1));
}

function toSet(x) {
  if (x == null) return new Set();
  if (x instanceof Set) return x;
  return new Set(Array.isArray(x) ? x : [x]);
}

// 저장하려는 기록들(draftRecords)이 한도를 넘는지. 수정 중인 기록(같은 id)은 기존 사용에서 제외.
// 반환 {ok, used, adding, limit, remaining, no, yearMonth, dates, blocking:true, message}
// today(선택): 문구의 '이번 달' 판단용
export function checkParentNoteLimit(records, draftRecords, settings = {}, today = null) {
  const limit = Number(settings.parentNoteLimit ?? 2);
  return checkLimit({
    records, draftRecords, limit, today,
    match: (r) => hasDoc(r, 'parentNote'),
    blocking: true,
    message: (ctx) => ctx.used >= ctx.limit
      ? `${ctx.monthWord} 학부모확인서 ${ctx.limit}회를 모두 사용했습니다. 처방전·진료확인서를 받거나 미인정으로 처리하세요.`
      : `${ctx.monthWord} 학부모확인서는 ${ctx.limit - ctx.used}회만 남았습니다. ${ctx.adding}일을 모두 학부모확인서로 처리할 수 없습니다. 처방전·진료확인서를 받거나 미인정으로 처리하세요.`,
  });
}

// ---------- 생리통 ----------
export function countPeriodPain(records, no, yearMonth, excludeId) {
  const ex = toSet(excludeId);
  return (records || []).filter((r) =>
    Number(r.no) === Number(no) && yearMonthOf(r.date) === yearMonth && !ex.has(r.id) && r.tag === 'periodPain',
  ).length;
}

// 초과해도 저장은 가능 (blocking:false). 확인 후 저장.
export function checkPeriodPainLimit(records, draftRecords, settings = {}, today = null) {
  const limit = Number(settings.periodPainLimit ?? 1);
  return checkLimit({
    records, draftRecords, limit, today,
    match: (r) => r.tag === 'periodPain',
    blocking: false,
    message: (ctx) => `${ctx.monthWord} 생리통 출석인정 ${ctx.limit}회를 이미 사용했습니다.`,
  });
}

function checkLimit({ records, draftRecords, limit, today, match, blocking, message }) {
  const drafts = (draftRecords || []).filter(match);
  const draftIds = new Set((draftRecords || []).map((d) => d.id).filter(Boolean));
  const existing = (records || []).filter((r) => !draftIds.has(r.id) && match(r));

  // 번호·월별로 묶어 검사
  const groups = new Map();
  for (const d of drafts) {
    const key = `${Number(d.no)}|${yearMonthOf(d.date)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  let first = null;
  for (const [key, list] of groups) {
    const [no, ym] = key.split('|');
    const used = existing.filter((r) => Number(r.no) === Number(no) && yearMonthOf(r.date) === ym);
    const res = {
      ok: used.length + list.length <= limit,
      blocking,
      used: used.length,
      adding: list.length,
      limit,
      remaining: Math.max(0, limit - used.length),
      no: Number(no),
      yearMonth: ym,
      dates: used.map((r) => r.date).sort(),
      message: '',
    };
    if (!res.ok) {
      res.message = message({ ...res, monthWord: monthWordOf(ym, today) });
      return res;
    }
    if (!first) first = res;
  }
  return first || { ok: true, blocking, used: 0, adding: 0, limit, remaining: limit, no: null, yearMonth: null, dates: [], message: '' };
}

// ---------- 서류 ----------
// 구분·태그별 기본 서류 배열
export function requiredDocs(div, tag) {
  if (tag === 'fieldTrip') {
    return [
      { type: 'tripApply', submitted: false, submittedAt: null },
      { type: 'tripReport', submitted: false, submittedAt: null },
    ];
  }
  if (tag === 'periodPain') return [];
  if (div === 'ill') return [{ type: 'parentNote', submitted: false, submittedAt: null }];
  if (div === 'etc' || div === 'injung') return [{ type: 'other', name: '', submitted: false, submittedAt: null }];
  return []; // 미인정
}

// 미제출 목록. 같은 groupId(기간 입력)는 서류 종류별로 한 항목으로 묶음.
// 체험학습 보고서는 그 묶음의 마지막 날짜 다음 날부터 미제출로 표시.
// 반환 항목: {key, no, docType, docLabel, docShort, recordIds, refs:[{recordId, docIndex}], record,
//            startDate, endDate, baseDate, daysPassed}
export function missingDocs(records, today) {
  const groupRange = new Map();
  for (const r of records || []) {
    if (!r.groupId) continue;
    const g = groupRange.get(r.groupId) || { start: r.date, end: r.date };
    if (r.date < g.start) g.start = r.date;
    if (r.date > g.end) g.end = r.date;
    groupRange.set(r.groupId, g);
  }

  const items = new Map();
  for (const r of records || []) {
    (r.docs || []).forEach((d, i) => {
      if (d.submitted) return;
      const range = r.groupId ? groupRange.get(r.groupId) : { start: r.date, end: r.date };
      if (d.type === 'tripReport' && !(today > range.end)) return;
      const key = r.groupId ? `g:${r.groupId}:${d.type}:${d.type === 'other' ? (d.name || '') : ''}` : `r:${r.id}:${i}`;
      let item = items.get(key);
      if (!item) {
        const baseDate = d.type === 'tripReport' ? range.end : range.start;
        item = {
          key,
          no: Number(r.no),
          docType: d.type,
          docLabel: docLabel(d),
          docShort: docLabel(d, true),
          recordIds: [],
          refs: [],
          record: r,
          groupId: r.groupId || null,
          startDate: range.start,
          endDate: range.end,
          baseDate,
          daysPassed: Math.max(0, daysBetween(baseDate, today)),
        };
        items.set(key, item);
      }
      item.recordIds.push(r.id);
      item.refs.push({ recordId: r.id, docIndex: i });
      if (r.date < item.record.date) item.record = r;
    });
  }
  return [...items.values()].sort((a, b) => b.daysPassed - a.daysPassed || a.no - b.no);
}

// ---------- 날짜 ----------
// 시작~끝(포함) 중 주말을 뺀 날짜 배열
export function expandRange(startDate, endDate) {
  if (!isDateStr(startDate)) return [];
  const end = isDateStr(endDate) ? endDate : startDate;
  if (end < startDate) return [];
  const out = [];
  let cur = startDate;
  for (let i = 0; i < 400 && cur <= end; i++) {
    if (!isWeekend(cur)) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

// ---------- 나이스 기대값 ----------
// 결석: 조회+전 교시+종례 "/" (실제 자동 표시 형태 미확인 — 비교 시 chulgyulGb만 엄격, 교시는 경고)
// 지각 N: 조회 + 1~N교시 / 조퇴 N: N~마지막 교시 + 종례 / 결과: 고른 교시만
export function expectedNeisMarks(record, totMax = 7) {
  const tot = Number(totMax) || 7;
  const gyo = {};
  for (let i = 1; i <= tot; i++) gyo[i] = '';
  let jo = '', jong = '';
  const k = record.kind;
  if (k === 'absent') {
    jo = '/'; jong = '/';
    for (let i = 1; i <= tot; i++) gyo[i] = '/';
  } else if (k === 'late') {
    jo = '/';
    for (let i = 1; i <= Math.min(Number(record.period) || 0, tot); i++) gyo[i] = '/';
  } else if (k === 'early') {
    jong = '/';
    for (let i = Math.max(1, Number(record.period) || tot + 1); i <= tot; i++) gyo[i] = '/';
  } else if (k === 'result') {
    for (const p of record.periods || []) if (p >= 1 && p <= tot) gyo[p] = '/';
  }
  return { chulgyulGb: chulgyulGb(record.div, record.kind), jo, gyo, jong };
}

// ---------- 검증 ----------
export function validateRecord(record, settings = {}) {
  const errs = validate(record, settings);
  if (record && record.tag === 'fieldTrip' && record.div !== 'injung') errs.push('교외체험학습은 출석인정으로 입력하세요.');
  if (record && record.div === 'sago' && (record.docs || []).length) errs.push('미인정은 증빙서류가 없습니다.');
  return errs;
}
