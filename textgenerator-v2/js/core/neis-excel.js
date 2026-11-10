// NEIS 엑셀 양식에 최종본 채우기 (순수 모듈, 엑셀을 읽고 쓰는 일은 xlsx-io.js 가 한다).
// 나이스에서 내려받은 특기사항 엑셀(2026-11-10 확인)의 열 모양:
//  자율·진로·행동특성: 영역 구분, 학년도, 학년, 반, 번호, (성명, 학생개인번호 순서는 파일마다 다름), 특기사항 | 행동특성 및 종합의견 (진로는 희망분야가 더 있음)
//  동아리: 영역 구분, 학년도, 학년, 반, 번호, 동아리활동 부서명, 학생개인번호, 성명, 특기사항
//  교과세특: 학년도, 학기, 학년, 반/번호('8/1'), 학생개인번호, 성명, 과목명, 세부능력 및 특기사항
// 파일의 다른 칸(학생개인번호 등)은 건드리지 않고, 본문 칸에만 작성기의 최종본을 넣는다.
import { recordKey } from './model.js';
import { byteLength } from './bytes.js';

const squash = (s) => String(s ?? '').replace(/[\s()（）·ㆍ,./_-]/g, '');
const ALIASES = {
  grade: ['학년'],
  classNo: ['반'],
  no: ['번호', '번'],
  classNoNo: ['반번호'],
  name: ['이름', '성명'],
  area: ['영역구분', '영역'],
  subject: ['과목명', '과목'],
  text: ['특기사항', '세부능력및특기사항', '행동특성및종합의견'],
};

export function areaOf(label) {
  const t = squash(label);
  if (!t) return null;
  if (t.includes('자율')) return 'autonomy';
  if (t.includes('진로')) return 'career';
  if (t.includes('동아리')) return 'club';
  if (t.includes('행동특성') || t.includes('행특') || t.includes('종합의견')) return 'behavior';
  if (t.includes('교과') || t.includes('세특') || t.includes('세부능력')) return 'subject';
  return null;
}

export function findNeisHeader(rows) {
  const limit = Math.min(rows.length, 10);
  for (let r = 0; r < limit; r += 1) {
    const cols = {};
    (rows[r] || []).forEach((cell, c) => {
      const t = squash(cell);
      if (!t) return;
      for (const [key, names] of Object.entries(ALIASES)) if (cols[key] === undefined && names.includes(t)) cols[key] = c;
    });
    const who = cols.classNoNo !== undefined || (cols.classNo !== undefined && cols.no !== undefined);
    if (cols.text !== undefined && cols.name !== undefined && cols.grade !== undefined && who) return { row: r, cols, textLabel: squash(rows[r][cols.text]) };
  }
  return null;
}

const cellText = (v) => (v == null ? '' : String(v));
const normText = (s) => String(s ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
const normName = (s) => String(s ?? '').replace(/\s+/g, '');
const pad2 = (n) => String(n).padStart(2, '0');

export const FILL_MODES = {
  empty: '비어 있는 칸만 채우기 (나이스에 이미 있는 글은 그대로 둠)',
  append: '이미 있는 글 뒤에 이어쓰기',
  overwrite: '이미 있는 글을 덮어쓰기',
};

/**
 * 한 시트에 최종본을 채울 칸을 계획한다. 시트는 고치지 않고 edits 만 돌려준다.
 * rows: 시트의 문자열 2차원 배열 (rows[0] 이 엑셀 rowOffset+1 행). 반환 row·col 은 rows 기준 0부터.
 * students: [{ studentId, name }], records: [{ id, final, status }], limits: { area: bytes }
 */
export function planNeisFill({ sheetName = '', rows = [], rowOffset = 0, students = [], records = [], limits = {}, mode = 'empty', includeNotDone = false, separator = ' ' } = {}) {
  const head = findNeisHeader(rows);
  const out = { found: !!head, edits: [], issues: [], summary: { filled: 0, appended: 0, overwritten: 0, same: 0, kept: 0, noRecord: 0, notDone: 0, nameMismatch: 0, notInRoster: 0, tooLong: 0, noArea: 0, bad: 0 } };
  if (!head) return out;
  const names = new Map(students.map((s) => [String(s.studentId), s.name]));
  const recs = new Map(records.map((r) => [r.id, r]));
  const { cols } = head;
  const sheetArea = areaOf(sheetName) || areaOf(head.textLabel) || (cols.subject !== undefined && cols.area === undefined ? 'subject' : null);
  const issue = (r, kind, message) => out.issues.push({ row: rowOffset + r + 1, kind, message });

  for (let r = head.row + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    if (row.every((c) => cellText(c).trim() === '')) continue;
    const get = (k) => (cols[k] === undefined ? '' : cellText(row[cols[k]]));
    let classNo; let no;
    if (cols.classNoNo !== undefined) {
      const m = get('classNoNo').trim().match(/^(\d+)\s*[/-]\s*(\d+)$/);
      if (!m) { out.summary.bad += 1; issue(r, 'bad', `반/번호 '${get('classNoNo')}' 형식을 읽지 못했습니다.`); continue; }
      classNo = Number(m[1]); no = Number(m[2]);
    } else { classNo = Number(get('classNo')); no = Number(get('no')); }
    const grade = Number(get('grade'));
    if (!(grade > 0 && classNo > 0 && no > 0)) { out.summary.bad += 1; issue(r, 'bad', '학년·반·번호를 읽지 못했습니다.'); continue; }

    const area = (cols.area !== undefined ? areaOf(get('area')) : null) || sheetArea;
    if (!area) { out.summary.noArea += 1; issue(r, 'noArea', '영역을 알 수 없습니다.'); continue; }
    const subject = area === 'subject' ? get('subject').trim() : null;
    if (area === 'subject' && !subject) { out.summary.bad += 1; issue(r, 'bad', '과목명이 없습니다.'); continue; }

    const studentId = `${grade}${pad2(classNo)}${pad2(no)}`;
    const mine = names.get(studentId);
    if (mine === undefined) { out.summary.notInRoster += 1; issue(r, 'notInRoster', `${grade}학년 ${classNo}반 ${no}번이 작성기 명단에 없습니다.`); continue; }
    if (normName(mine) !== normName(get('name'))) { out.summary.nameMismatch += 1; issue(r, 'nameMismatch', `${grade}학년 ${classNo}반 ${no}번의 이름이 작성기 명단과 다릅니다. 건너뜁니다.`); continue; }

    const rec = recs.get(recordKey(studentId, area, subject));
    const fin = rec && typeof rec.final === 'string' ? rec.final : '';
    if (!fin.trim()) { out.summary.noRecord += 1; continue; }
    if (rec.status !== 'done' && !includeNotDone) { out.summary.notDone += 1; continue; }

    const cur = cellText(row[cols.text]);
    let next = fin; let kind = 'filled';
    if (normText(cur)) {
      if (normText(cur) === normText(fin)) { out.summary.same += 1; continue; }
      if (mode === 'append') {
        if (normText(cur).includes(normText(fin))) { out.summary.same += 1; continue; }
        next = cur.replace(/\s+$/, '') + separator + fin; kind = 'appended';
      } else if (mode === 'overwrite') kind = 'overwritten';
      else { out.summary.kept += 1; issue(r, 'kept', `${grade}학년 ${classNo}반 ${no}번: 나이스 파일에 이미 글이 있어 그대로 둡니다.`); continue; }
    }
    const limit = Number(limits[area]) || Infinity;
    if (byteLength(next) > limit) { out.summary.tooLong += 1; issue(r, 'tooLong', `${grade}학년 ${classNo}반 ${no}번: 바이트 한도(${limit})를 넘어 채우지 않았습니다.`); continue; }
    out.edits.push({ row: r, col: cols.text, value: next });
    out.summary[kind === 'filled' ? 'filled' : kind === 'appended' ? 'appended' : 'overwritten'] += 1;
  }
  return out;
}
