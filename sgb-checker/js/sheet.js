// 엑셀·CSV·붙여넣기 읽기. XLSX(SheetJS)는 주입받는다 (브라우저: window.XLSX, 테스트: lib 파일).
// 다른 선생님이 보낸 파일을 여는 도구라 믿지 않는 입력으로 다룬다: 크기·시트·행 제한, 값만 읽기, 정해진 열만 꺼내기.
import { areaFromSheetName } from '../rules/areas.js';

export const LIMITS = { bytes: 5 * 1024 * 1024, sheets: 30, rows: 3000, cell: 5000 };
export const EXTENSIONS = ['xlsx', 'xls', 'csv'];

export class SheetError extends Error {
  constructor(message) { super(message); this.name = 'SheetError'; }
}

const HEAD = {
  id: ['학번'],
  num: ['번호'],
  name: ['이름', '성명'],
  subject: ['과목'],
  text: ['내용', '특기사항', '세부능력', '종합의견'],
};
const cell = (v) => (v == null ? '' : String(v));
const has = (c, words) => words.some((w) => c.replace(/\s/g, '').includes(w));

/** 첫 10행 안에서 머리글 행 찾기. { row, cols: { id, name, subject, text } } 또는 null */
export function findHeader(rows) {
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const cols = {};
    (rows[r] || []).forEach((v, c) => {
      const s = cell(v).trim();
      if (!s || s.length > 30) return;
      for (const k of Object.keys(HEAD)) if (cols[k] == null && has(s, HEAD[k])) { cols[k] = c; break; }
    });
    if (cols.id == null && cols.num != null) cols.id = cols.num;
    delete cols.num;
    if (cols.text != null && (cols.id != null || cols.name != null)) return { row: r, cols };
  }
  return null;
}

/**
 * 시트 목록 -> 점검 묶음.
 * sheets: [{ name, rows: 셀 값 2차원 배열 }]
 * @returns { groups: [{ sheetName, area, subject, rows: [{ studentId, name, subject, text, tooLong }] }], problems: [문장] }
 */
export function parseSheets(sheets) {
  const groups = [];
  const problems = [];
  for (const sh of sheets) {
    const rows = sh.rows || [];
    if (!rows.some((r) => (r || []).some((v) => cell(v).trim()))) continue;
    const head = findHeader(rows);
    if (!head) { problems.push(`'${sh.name}' 시트에서 머리글(학번·이름·내용)을 찾지 못함`); continue; }
    const guess = areaFromSheetName(sh.name);
    const out = [];
    for (let r = head.row + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const get = (k) => (head.cols[k] == null ? '' : cell(row[head.cols[k]]).trim());
      const id = get('id'), name = get('name');
      let text = head.cols.text == null ? '' : cell(row[head.cols.text]).replace(/\r\n?/g, '\n');
      if (!id && !name && !text.trim()) continue;
      let tooLong = false;
      if (text.length > LIMITS.cell) { text = text.slice(0, LIMITS.cell); tooLong = true; }
      out.push({ studentId: id.slice(0, 20), name: name.slice(0, 30), subject: (get('subject') || guess?.subject || '').slice(0, 40), text: text.trim(), tooLong });
    }
    groups.push({ sheetName: String(sh.name).slice(0, 40), area: guess?.area || null, subject: guess?.subject || '', rows: out });
  }
  return { groups, problems };
}

/** 엑셀에서 복사한 탭 구분 글 (따옴표 안 줄바꿈 포함) -> 2차원 배열 */
export function parseTsv(text) {
  const rows = [[]];
  let cur = '', q = false;
  const s = String(text).replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === '\t') { rows[rows.length - 1].push(cur); cur = ''; } else if (ch === '\n') { rows[rows.length - 1].push(cur); cur = ''; rows.push([]); } else cur += ch;
  }
  rows[rows.length - 1].push(cur);
  return rows.filter((r) => r.some((v) => v.trim()));
}

function decodeCsv(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); } catch { /* 엑셀이 저장한 CSV는 EUC-KR일 수 있음 */ }
  return new TextDecoder('euc-kr').decode(buf);
}

/**
 * 파일 읽기. file: { name, size, buffer: ArrayBuffer|Uint8Array }
 * @returns parseSheets 결과
 */
export function readWorkbook(XLSX, file) {
  const ext = String(file.name || '').toLowerCase().split('.').pop();
  if (!EXTENSIONS.includes(ext)) throw new SheetError('엑셀(.xlsx, .xls) 또는 .csv 파일만 열 수 있습니다.');
  const size = file.size ?? file.buffer?.byteLength ?? 0;
  if (size > LIMITS.bytes) throw new SheetError('파일이 5MB보다 커서 열지 않았습니다.');
  if (!XLSX?.read) throw new SheetError('엑셀 도구를 불러오지 못했습니다. 페이지를 새로 고쳐 주세요.');
  const opts = { cellFormula: false, cellHTML: false, cellStyles: false, cellNF: false, cellDates: false, sheetRows: LIMITS.rows + 11 };
  let wb;
  try {
    wb = ext === 'csv'
      ? XLSX.read(decodeCsv(file.buffer), { ...opts, type: 'string' })
      : XLSX.read(file.buffer instanceof Uint8Array ? file.buffer : new Uint8Array(file.buffer), { ...opts, type: 'array' });
  } catch {
    throw new SheetError('파일을 읽지 못했습니다. 엑셀에서 다시 저장한 뒤 올려 주세요.');
  }
  const names = Array.isArray(wb?.SheetNames) ? wb.SheetNames : [];
  if (names.length > LIMITS.sheets) throw new SheetError(`시트가 ${LIMITS.sheets}개보다 많아서 열지 않았습니다.`);
  let total = 0;
  const sheets = [];
  const skipped = [];
  for (const name of names) {
    const ws = wb.Sheets && Object.prototype.hasOwnProperty.call(wb.Sheets, name) ? wb.Sheets[name] : null;
    if (!ws) { skipped.push(`'${String(name).slice(0, 40)}' 시트는 읽지 못해 건너뜀 (시트 이름을 바꿔 다시 저장해 주세요)`); continue; }
    const ref = ws['!fullref'] || ws['!ref'];
    if (ref) total += XLSX.utils.decode_range(ref).e.r + 1;
    if (total > LIMITS.rows) throw new SheetError(`행이 ${LIMITS.rows.toLocaleString('ko-KR')}개보다 많아서 열지 않았습니다. 파일을 나눠 올려 주세요.`);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
    sheets.push({ name, rows: rows.map((r) => (Array.isArray(r) ? r.map(cell) : [])) });
  }
  const r = parseSheets(sheets);
  r.problems.unshift(...skipped);
  return r;
}
