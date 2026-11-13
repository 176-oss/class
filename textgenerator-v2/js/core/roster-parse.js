// 학번 검사, 명단 파싱, NEIS 출석부 머리글 찾기. 순수 모듈.

export const TEMPLATE_ROWS = [['학번', '이름'], ['30101', '(예시) 김가온']];

const EXAMPLE = '(예: 30501)';

function cellText(v) {
  if (v == null) return '';
  return String(v).trim();
}

/** 학번 검사: 공백 제거, 숫자 5자리, 학년 1~6, 반 01 이상, 번호 01 이상 */
export function validateStudentId(raw) {
  let v = cellText(raw).replace(/\s+/g, '');
  // 엑셀에서 숫자로 읽혀 '30501.0' 처럼 오는 경우
  if (/^\d+\.0+$/.test(v)) v = v.replace(/\.0+$/, '');
  if (v === '') return { ok: false, value: '', error: '학번이 비어 있습니다.' };
  if (!/^\d+$/.test(v)) {
    return { ok: false, value: v, error: `학번 "${v}"에 숫자가 아닌 글자가 있습니다. 숫자 5자리로 적어 주세요 ${EXAMPLE}.` };
  }
  if (v.length !== 5) {
    return {
      ok: false,
      value: v,
      error: `학번 "${v}"이 ${v.length}자리입니다. 학년 1자리 + 반 2자리 + 번호 2자리로 고쳐 주세요 ${EXAMPLE}.`,
    };
  }
  const grade = Number(v[0]);
  const classNo = Number(v.slice(1, 3));
  const no = Number(v.slice(3, 5));
  if (grade < 1 || grade > 6) {
    return { ok: false, value: v, error: `학번 "${v}"의 첫 자리(학년)가 ${grade}입니다. 학년은 1~6이어야 합니다.` };
  }
  if (classNo < 1) {
    return { ok: false, value: v, error: `학번 "${v}"의 반 자리가 00입니다. 반은 01 이상이어야 합니다 ${EXAMPLE}.` };
  }
  if (no < 1) {
    return { ok: false, value: v, error: `학번 "${v}"의 번호 자리가 00입니다. 번호는 01 이상이어야 합니다 ${EXAMPLE}.` };
  }
  return { ok: true, value: v, error: null };
}

function norm(v) {
  return cellText(v).replace(/\s+/g, '');
}

const NAME_HEAD = /^(이름|성명|학생명|학생이름|학생성명)$/;
const ID_HEAD = /^학번$/;
const GRADE_HEAD = /^학년$/;
const CLASS_HEAD = /^반$/;
const NO_HEAD = /^(번호|번)$/;
const CLASS_NO_HEAD = /^반[/-]번호$/; // 나이스 교과세특 엑셀: '8/1' (반/번호)

/** 처음 20행 안에서 머리글 찾기. 없으면 null */
export function findHeader(rows) {
  const limit = Math.min(rows.length, 20);
  for (let r = 0; r < limit; r += 1) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const cols = { name: -1, id: -1, grade: -1, classNo: -1, no: -1, classNoNo: -1 };
    row.forEach((cell, c) => {
      const t = norm(cell);
      if (cols.name < 0 && NAME_HEAD.test(t)) cols.name = c;
      else if (cols.id < 0 && ID_HEAD.test(t)) cols.id = c;
      else if (cols.grade < 0 && GRADE_HEAD.test(t)) cols.grade = c;
      else if (cols.classNo < 0 && CLASS_HEAD.test(t)) cols.classNo = c;
      else if (cols.no < 0 && NO_HEAD.test(t)) cols.no = c;
      else if (cols.classNoNo < 0 && CLASS_NO_HEAD.test(t)) cols.classNoNo = c;
    });
    const split = cols.grade >= 0 && ((cols.classNo >= 0 && cols.no >= 0) || cols.classNoNo >= 0);
    if (cols.name >= 0 && (cols.id >= 0 || split)) return { row: r, ...cols };
    // 번호와 이름만 있는 표: 선택한 반의 학년·반을 붙여야 학번이 된다
    if (cols.name >= 0 && cols.no >= 0 && cols.id < 0 && cols.grade < 0 && cols.classNo < 0) return { row: r, ...cols, noOnly: true };
  }
  return null;
}

function digitsOf(v) {
  const m = cellText(v).match(/\d+/);
  return m ? m[0] : '';
}

function pad2(s) {
  return s.length === 1 ? `0${s}` : s;
}

function cleanName(v) {
  return cellText(v).replace(/\s+/g, ' ');
}

/**
 * 2차원 배열(엑셀 시트)에서 명단 읽기.
 * 행 번호는 엑셀 기준(1부터).
 */
export function parseRosterRows(rows, context = null) {
  const list = Array.isArray(rows) ? rows : [];
  const header = findHeader(list);
  if (header && header.noOnly && !validContext(context)) {
    return { students: [], errors: [{ row: header.row + 1, message: '번호와 이름만 있는 표입니다. 위에서 반을 고르고 학년·반을 확인한 뒤 올려 주세요.' }] };
  }
  const students = [];
  const errors = [];
  const seen = new Map(); // studentId -> { name, row }

  const cols = header || { row: -1, name: 1, id: 0, grade: -1, classNo: -1, no: -1, classNoNo: -1 };
  const useSplit = header && header.id < 0 && !header.noOnly;

  for (let r = cols.row + 1; r < list.length; r += 1) {
    const row = Array.isArray(list[r]) ? list[r] : [];
    const rowNo = r + 1;
    if (row.every((c) => cellText(c) === '')) continue;

    const name = cleanName(row[cols.name]);
    let rawId;
    if (header && header.noOnly) {
      const n = digitsOf(row[cols.no]);
      if (!n && !name) continue;
      rawId = n ? idFromContext(context, n) : '';
    } else if (useSplit) {
      const g = digitsOf(row[cols.grade]);
      let c = digitsOf(row[cols.classNo]);
      let n = digitsOf(row[cols.no]);
      if (cols.classNoNo >= 0) {
        const m = cellText(row[cols.classNoNo]).match(/(\d+)\s*[/-]\s*(\d+)/);
        c = m ? m[1] : '';
        n = m ? m[2] : '';
      }
      if (!g && !c && !n) {
        if (!name) continue;
        errors.push({ row: rowNo, message: `${rowNo}행: 학년, 반, 번호가 비어 있습니다.` });
        continue;
      }
      rawId = `${g}${pad2(c)}${pad2(n)}`;
    } else {
      rawId = cellText(row[cols.id]);
    }

    // 머리글 없는 표에서 다시 나오는 머리글 줄, 합계 줄 같은 것은 건너뜀
    if (!name && !/\d/.test(rawId)) continue;
    if (!header && NAME_HEAD.test(norm(name)) && ID_HEAD.test(norm(rawId))) continue;
    if (/^\(예시\)/.test(name)) continue;

    const check = validateStudentId(rawId);
    if (!check.ok) {
      errors.push({ row: rowNo, message: `${rowNo}행: ${check.error}` });
      continue;
    }
    if (!name) {
      errors.push({ row: rowNo, message: `${rowNo}행: 학번 ${check.value}의 이름이 비어 있습니다.` });
      continue;
    }
    const prev = seen.get(check.value);
    if (prev) {
      if (prev.name !== name) {
        errors.push({
          row: rowNo,
          message: `${rowNo}행: 학번 ${check.value}이 ${prev.row}행(${prev.name})과 같은데 이름(${name})이 다릅니다. 학번을 확인해 주세요.`,
        });
      }
      continue; // 같은 학번 같은 이름은 한 번만
    }
    seen.set(check.value, { name, row: rowNo });
    students.push({ studentId: check.value, name, row: rowNo });
  }
  return { students, errors };
}

const validContext = (c) => !!c && Number(c.grade) >= 1 && Number(c.grade) <= 6 && Number(c.classNo) >= 1 && Number(c.classNo) <= 99;
function idFromContext(c, no) {
  return `${Number(c.grade)}${pad2(String(Number(c.classNo)))}${pad2(String(Number(no)))}`;
}

/**
 * 선택한 반의 학년·반 알아내기. 반 학생들의 학번 앞 3자리가 모두 같으면 그것, 아니면 반 이름의
 * '3학년 8반' 또는 끝의 '3-8'. 알 수 없으면 null (화면에서 직접 적게 함)
 */
export function classContext(cls, students = []) {
  const prefixes = new Set(students.map((s) => String(s.studentId).slice(0, 3)).filter((p) => /^\d{3}$/.test(p)));
  if (prefixes.size === 1) {
    const p = [...prefixes][0];
    return { grade: Number(p[0]), classNo: Number(p.slice(1)) };
  }
  const name = String(cls?.name ?? '');
  let m = name.match(/([1-6])\s*학년\s*(\d{1,2})\s*반/);
  if (m) return { grade: Number(m[1]), classNo: Number(m[2]) };
  m = name.match(/(?:^|\s)([1-6])-(\d{1,2})$/);
  if (m) return { grade: Number(m[1]), classNo: Number(m[2]) };
  return null;
}

/** '1 김가나', '1번 김가나', '1. 김가나' 처럼 번호가 1~2자리면 선택한 반의 학번으로 바꾼다 */
function shortLine(cells, context) {
  if (!validContext(context) || cells.length < 2) return cells;
  const m = String(cells[0]).replace(/\s+/g, '').match(/^(\d{1,2})(?:번|\.|\))?$/);
  if (!m || Number(m[1]) < 1) return cells;
  return [idFromContext(context, m[1]), ...cells.slice(1)];
}

/** 붙여 넣은 글에서 명단 읽기. 줄마다 탭, 쉼표, 공백 순서로 나눔. context 가 있으면 '번호 이름'만 있는 줄도 읽는다 */
export function parsePastedRoster(text, context = null) {
  const lines = String(text ?? '').split(/\r\n|\r|\n/);
  const rows = lines.map((line) => {
    const t = line.trim();
    if (!t) return [];
    const cells = line.includes('\t') ? line.split('\t').map((x) => x.trim()) : t.includes(',') ? t.split(',').map((x) => x.trim()) : t.split(/\s+/);
    return shortLine(cells, context);
  });
  return parseRosterRows(rows);
}

/** 교과반 일괄 만들기의 반 번호: '1-5, 7' / '1~5' / '1 2 3' -> 정렬된 번호 목록 (1~99, 최대 30개) */
export function parseClassNumbers(text) {
  const parts = String(text ?? '').split(/[,\s]+/).filter(Boolean);
  if (!parts.length) return { ok: false, numbers: [], error: '반 번호를 적어 주세요 (예: 1-5, 7).' };
  const set = new Set();
  for (const p of parts) {
    const m = p.match(/^(\d{1,2})(?:[-~](\d{1,2}))?$/);
    if (!m) return { ok: false, numbers: [], error: `'${p}'을(를) 반 번호로 읽을 수 없습니다. 숫자와 -만 써 주세요 (예: 1-5, 7).` };
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < 1 || b < a) return { ok: false, numbers: [], error: `'${p}': 반 번호는 1 이상이고, 범위는 작은 수부터 적어 주세요.` };
    for (let n = a; n <= b; n += 1) set.add(n);
  }
  if (set.size > 30) return { ok: false, numbers: [], error: `한 번에 30개 반까지 만들 수 있습니다 (지금 ${set.size}개).` };
  return { ok: true, numbers: [...set].sort((x, y) => x - y), error: null };
}

/** 반 이름 끝의 '학년-반' (예: '통합과학 1-3' -> '1-3'). 없으면 null */
export function sectionOfName(name) {
  const m = String(name ?? '').trim().match(/(?:^|\s)([1-6])-(\d{1,2})$/);
  return m ? `${Number(m[1])}-${Number(m[2])}` : null;
}

/** 학번의 학년·반으로 반 나누기. classes: [{id, name}] -> { groups: [{classId, studentIds}], unmatched: [student] } */
export function splitBySection(students, classes) {
  const bySection = new Map();
  for (const c of classes) { const s = sectionOfName(c.name); if (s && !bySection.has(s)) bySection.set(s, c.id); }
  const groups = new Map();
  const unmatched = [];
  for (const st of students) {
    const id = String(st.studentId);
    const classId = bySection.get(`${Number(id.slice(0, 1))}-${Number(id.slice(1, 3))}`);
    if (!classId) { unmatched.push(st); continue; }
    if (!groups.has(classId)) groups.set(classId, []);
    groups.get(classId).push(id);
  }
  return { groups: classes.filter((c) => groups.has(c.id)).map((c) => ({ classId: c.id, studentIds: groups.get(c.id) })), unmatched };
}
