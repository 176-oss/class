// SheetJS(전역 XLSX) 감싸기. 이 파일만 XLSX를 쓴다.

export const XLSX_MISSING_TEXT = '엑셀 기능을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요. 그동안은 붙여넣기로 명단을 등록할 수 있습니다.';

export class XlsxMissingError extends Error {
  constructor() { super(XLSX_MISSING_TEXT); this.name = 'XlsxMissingError'; }
}

export function hasXlsx() {
  return typeof window !== 'undefined' && typeof window.XLSX !== 'undefined' && !!window.XLSX.utils;
}

function readArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('파일을 읽지 못했습니다.'));
    r.readAsArrayBuffer(file);
  });
}

function readText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('파일을 읽지 못했습니다.'));
    r.readAsText(file, 'utf-8');
  });
}

/** 간단한 CSV 읽기 (따옴표 지원). 엑셀 라이브러리가 없을 때 .csv 용 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i += 1; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** 엑셀/CSV 파일의 첫 시트를 문자열 2차원 배열로 */
export async function readSheetFile(file) {
  const isCsv = /\.csv$/i.test(file.name);
  if (!hasXlsx()) {
    if (isCsv) return parseCsv(await readText(file)).map((r) => r.map((c) => String(c ?? '').trim()));
    throw new XlsxMissingError();
  }
  const XLSX = window.XLSX;
  const wb = isCsv
    ? XLSX.read(await readText(file), { type: 'string', raw: true })
    : XLSX.read(new Uint8Array(await readArrayBuffer(file)), { type: 'array' });
  const name = wb.SheetNames[0];
  if (!name) return [];
  const ws = wb.Sheets[name];
  if (!ws || !ws['!ref']) return [];
  // 칸을 직접 읽어 빈 행도 그대로 둔다: 배열 i번째 = 엑셀 (i+1)행 (오류 행 번호가 엑셀과 맞게)
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = 0; r <= range.e.r; r += 1) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      row.push(cell ? String(cell.w ?? cell.v ?? '').trim() : '');
    }
    while (row.length && row[row.length - 1] === '') row.pop();
    rows.push(row);
  }
  return rows;
}

/** 2차원 배열을 .xlsx 로 내려받기. 모든 칸은 글자로 넣어 학번 앞 0이 사라지지 않게 함 */
export function downloadSheet(rows, filename, sheetName = 'Sheet1', { widths } = {}) {
  if (!hasXlsx()) throw new XlsxMissingError();
  const XLSX = window.XLSX;
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : (typeof c === 'number' ? c : String(c))))));
  if (widths) ws['!cols'] = widths.map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

/**
 * 나이스에서 내려받은 엑셀 파일의 칸을 채워 새 파일로 내려받는다. 파일의 다른 칸·병합·열 너비는 그대로 둔다
 * (SheetJS 무료판은 글꼴·색 같은 꾸밈은 저장하지 못한다).
 * planSheet({ name, rows, rowOffset }) -> { found, edits:[{row,col,value}], ... } (rows[r] 이 엑셀 r+1 행)
 * 반환: { outName, perSheet:[{ name, plan }] }. 고칠 칸이 하나도 없으면 파일을 내려받지 않는다.
 */
export async function fillWorkbookFile(file, planSheet) {
  if (!hasXlsx()) throw new XlsxMissingError();
  const XLSX = window.XLSX;
  const wb = XLSX.read(new Uint8Array(await readArrayBuffer(file)), { type: 'array' });
  const perSheet = [];
  let total = 0;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) { perSheet.push({ name, plan: null }); continue; }
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows = [];
    for (let r = 0; r <= range.e.r; r += 1) {
      const row = [];
      for (let c = 0; c <= range.e.c; c += 1) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        row.push(cell ? String(cell.w ?? cell.v ?? '') : '');
      }
      rows.push(row);
    }
    const plan = planSheet({ name, rows, rowOffset: 0 });
    perSheet.push({ name, plan });
    if (!plan || !plan.found) continue;
    for (const e of plan.edits) {
      ws[XLSX.utils.encode_cell({ r: e.row, c: e.col })] = { t: 's', v: e.value };
      total += 1;
    }
  }
  if (!total) return { outName: null, perSheet, total };
  const base = file.name.replace(/\.[^.]+$/, '');
  const outName = `${base}_작성기채움.xlsx`;
  XLSX.writeFile(wb, outName);
  return { outName, perSheet, total };
}
