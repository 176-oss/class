// 엑셀 파일 -> 생기부 글 목록 (순수 함수만. 엑셀을 읽는 SheetJS 는 사이드 패널이 부르고, 여기에는 이미 읽은 표를 넘긴다)
// 읽을 수 있는 모양:
//  1) 나이스에서 내려받은 엑셀 (2026-11-10 확인)
//     - 자율·진로·행동특성: 영역 구분, 학년도, 학년, 반, 번호, 성명, 학생개인번호, 특기사항 (행동특성은 '행동특성 및 종합의견'). 진로는 희망분야 열이 더 있음
//     - 동아리: 영역 구분, 학년도, 학년, 반, 번호, 동아리활동 부서명, 학생개인번호, 성명, 특기사항
//     - 교과세특: 학년도, 학기, 학년, 반/번호('8/1'), 학생개인번호, 성명, 과목명, 세부능력 및 특기사항
//     나이스 파일은 상태 열이 없고 지금 나이스에 들어 있는 값이라, 글이 있는 행을 모두 읽는다.
//  2) 웹앱의 영역별 엑셀 내보내기: 학번, 이름, 반, 과목, 최종본, 바이트, 상태 (시트 이름이 영역). 상태가 '완료'인 행만 읽는다.
//  3) 간단한 양식: 학년, 반, 번호, 이름, 영역, 과목(교과세특만), 내용 (학번 열이 있으면 학번을 쓴다)
// 안전 규칙은 JSON 불러오기와 같다: 학년·반·번호와 이름이 모두 있어야 하고, 바이트·해시는 다시 계산한다.
import { AREAS, toItem, splitStudentId } from './sgb-model.js';

export const MAX_ROWS = 3000;
export const MAX_CELL = 5000;
const HEADER_SEARCH_ROWS = 10;

const squash = (s) => String(s ?? '').replace(/[\s()（）·ㆍ,./_-]/g, '');
const ALIASES = {
  id: ['학번'],
  year: ['학년도'],
  semester: ['학기'],
  grade: ['학년'],
  classNo: ['반', '학급'],
  no: ['번호', '번'],
  classNoNo: ['반번호'],                       // 나이스 교과세특: '8/1' (반/번호)
  name: ['이름', '성명'],
  area: ['영역', '항목', '영역구분'],
  subject: ['과목', '과목명'],
  text: ['내용', '본문', '최종본', '특기사항', '세부능력및특기사항', '행동특성및종합의견', '글'],
  status: ['상태'],
};

// '자율자치' '자율·자치활동' '진로' '동아리' '행동특성' '교과세특' ... -> 영역 키
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

function findHeader(rows) {
  const limit = Math.min(rows.length, HEADER_SEARCH_ROWS);
  for (let r = 0; r < limit; r++) {
    const cols = {};
    (rows[r] || []).forEach((cell, c) => {
      const t = squash(cell);
      if (!t) return;
      for (const [key, names] of Object.entries(ALIASES)) if (cols[key] === undefined && names.includes(t)) cols[key] = c;
    });
    const hasWho = cols.id !== undefined || cols.no !== undefined || cols.classNoNo !== undefined;
    if (cols.text !== undefined && cols.name !== undefined && hasWho) return { row: r, cols, textLabel: squash(rows[r][cols.text]) };
  }
  return null;
}

const cellText = (v) => (v === null || v === undefined ? '' : String(v));

// sheets: [{ name, rows: string[][], rowOffset? }]  rowOffset: rows[0] 이 엑셀 몇 번째 행인지 - 1 (기본 0)
// 반환: parseBatch 와 같은 모양 + source 'excel' + notes
export async function parseExcelSheets(sheets) {
  const items = [];
  const errors = [];
  const years = new Set(), semesters = new Set();
  const notes = { sheetsRead: 0, sheetsIgnored: [], notDone: 0, noText: 0, tooLong: 0 };
  const addError = (sheet, excelRow, message) => errors.push({ sheet, row: excelRow, message });

  for (const sh of sheets || []) {
    const rows = sh.rows || [];
    const off = Number(sh.rowOffset) || 0;
    const head = findHeader(rows);
    if (!head) { notes.sheetsIgnored.push(sh.name); continue; }
    notes.sheetsRead++;
    const { cols } = head;
    // 영역을 알아내는 순서: 영역 열 > 시트 이름 > 본문 머리글('세부능력 및 특기사항' 등) > 과목 열이 있으면 교과세특
    const sheetArea = areaOf(sh.name) || areaOf(head.textLabel) || (cols.subject !== undefined && cols.area === undefined ? 'subject' : null);
    for (let r = head.row + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (row.every((c) => cellText(c).trim() === '')) continue;
      const excelRow = off + r + 1;
      if (items.length >= MAX_ROWS) { addError(sh.name, excelRow, `글이 ${MAX_ROWS}개를 넘어 나머지는 읽지 않았습니다.`); break; }
      const get = (k) => (cols[k] === undefined ? '' : cellText(row[cols[k]]));
      const text = get('text');
      if (text.trim() === '') { notes.noText++; continue; }                          // 쓰지 않은 학생
      if (cols.status !== undefined && squash(get('status')) !== '완료') { notes.notDone++; continue; }   // 웹앱에서 '완료'가 아님
      if (text.length > MAX_CELL) { notes.tooLong++; addError(sh.name, excelRow, `글이 ${MAX_CELL}자를 넘습니다.`); continue; }

      const area = (cols.area !== undefined ? areaOf(get('area')) : null) || sheetArea;
      if (!area || !AREAS[area]) { addError(sh.name, excelRow, '영역을 알 수 없습니다. 영역 열(자율, 진로, 동아리, 행동특성, 교과세특)을 채우거나 시트 이름을 영역으로 하세요.'); continue; }

      let grade, classNo, no;
      if (cols.classNoNo !== undefined && cols.id === undefined) {
        const m = get('classNoNo').trim().match(/^(\d+)\s*[/-]\s*(\d+)$/);
        if (!m) { addError(sh.name, excelRow, `반/번호 '${get('classNoNo')}' 형식을 읽지 못했습니다 (예: 8/1).`); continue; }
        grade = Number(get('grade')); classNo = Number(m[1]); no = Number(m[2]);
        if (cols.grade === undefined) { addError(sh.name, excelRow, '학년 열이 필요합니다.'); continue; }
      } else if (cols.id !== undefined) {
        const id = get('id').trim();
        if (!/^\d{5}$/.test(id)) { addError(sh.name, excelRow, `학번 '${id}'이 5자리가 아닙니다 (학년 1 + 반 2 + 번호 2, 예 30503).`); continue; }
        ({ grade, classNo, no } = splitStudentId(id));
      } else {
        grade = Number(get('grade')); classNo = Number(get('classNo')); no = Number(get('no'));
        if (cols.grade === undefined || cols.classNo === undefined) { addError(sh.name, excelRow, '학년·반·번호 열이 필요합니다 (또는 학번 열).'); continue; }
      }
      const name = get('name').trim();
      if (!name) { addError(sh.name, excelRow, '이름이 없습니다. 이름이 있어야 나이스 표와 대조해 입력합니다.'); continue; }
      const subject = get('subject').trim();
      if (area === 'subject' && !subject) { addError(sh.name, excelRow, '교과세특은 과목 열이 필요합니다.'); continue; }
      if (cols.year !== undefined && get('year').trim()) years.add(get('year').trim());
      if (cols.semester !== undefined && get('semester').trim()) semesters.add(get('semester').trim());
      try {
        items.push(await toItem({ grade, classNo, no, name, area, subject: area === 'subject' ? subject : null, text }, `${sh.name} ${excelRow}행`));
      } catch (e) { addError(sh.name, excelRow, String(e.message).replace(/^.*?행: /, '')); }
    }
  }

  if (!items.length) {
    const why = errors.length
      ? `읽을 수 있는 글이 없습니다. 예: ${errors[0].sheet} ${errors[0].row}행 - ${errors[0].message}`
      : notes.sheetsRead
        ? (notes.noText && !notes.notDone
          ? `글이 하나도 없습니다 (비어 있는 행 ${notes.noText}개). 나이스에서 받은 빈 양식이라면 특기사항 열에 글을 채운 파일을 올리세요.`
          : `읽을 수 있는 글이 없습니다${notes.notDone ? ` (상태가 '완료'가 아닌 행 ${notes.notDone}개가 제외되었습니다. 웹앱에서 '완료로 표시'하세요)` : ' (학생이 없습니다)'}.`)
        : '생기부 글 표를 찾지 못했습니다. 머리글에 학번(또는 번호), 이름, 최종본(또는 내용)이 있어야 합니다.';
    throw new Error(why);
  }
  // 파일에 학년도·학기가 하나로 일관되게 있으면 알려 준다 (나이스 화면과 다르면 패널이 막는다)
  const one = (set) => (set.size === 1 ? Number([...set][0]) || null : null);
  return { schoolYear: one(years), semester: one(semesters), limits: null, source: 'excel', receivedAt: Date.now(), skipped: errors.length, notes, errors, items };
}
