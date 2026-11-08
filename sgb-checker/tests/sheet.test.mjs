import test from 'node:test';
import assert from 'node:assert/strict';
import { XLSX, makeXlsx } from './helpers.mjs';
import { readWorkbook, findHeader, parseSheets, parseTsv, SheetError, LIMITS } from '../js/sheet.js';

const read = (sheets, name = 'a.xlsx') => { const buf = makeXlsx(sheets); return readWorkbook(XLSX, { name, size: buf.byteLength, buffer: buf }); };

test('머리글 찾기: 첫 10행 안, 제목 줄이 있어도 됨', () => {
  const rows = [['2026학년도 1학년 3반 자율활동'], [], ['번호', '성명', '특기사항']];
  assert.deepEqual(findHeader(rows), { row: 2, cols: { id: 0, name: 1, text: 2 } });
  assert.equal(findHeader([['a', 'b'], ['c', 'd']]), null);
  const late = Array.from({ length: 11 }, () => ['x']).concat([['학번', '이름', '내용']]);
  assert.equal(findHeader(late), null);
});

test('엑셀 읽기: 시트 이름으로 항목, 빈 내용은 미작성, 세특 과목', () => {
  const r = read({
    자율: [['학번', '이름', '과목', '내용'], ['10101', '가상하나', '', '학급 회의에 참여함.'], ['10102', '가상두리', '', '']],
    세특_국어: [['NEIS 내려받기'], ['학번', '이름', '세부능력 및 특기사항'], ['10101', '가상하나', '시를 낭송함.']],
    Sheet3: [['학번', '이름', '내용'], ['1', '가', '글.']],
  });
  assert.equal(r.groups.length, 3);
  assert.equal(r.groups[0].area, 'autonomy');
  assert.equal(r.groups[0].rows[1].text, '');
  assert.deepEqual([r.groups[1].area, r.groups[1].rows[0].subject], ['subject', '국어']);
  assert.equal(r.groups[2].area, null);
});

test('__proto__ 같은 머리글과 시트 이름은 아무 일도 하지 않음', () => {
  const r = read({ __proto__x: [['__proto__', 'constructor', '학번', '이름', '내용', 'prototype'], ['{"a":1}', 'x', '10101', '가상', '글함.', 'y']] });
  const row = r.groups[0].rows[0];
  assert.deepEqual(Object.keys(row).sort(), ['name', 'studentId', 'subject', 'text', 'tooLong']);
  assert.equal(row.text, '글함.');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.a, undefined);
  const r2 = read(Object.fromEntries([['__proto__', [['학번', '이름', '내용'], ['1', '가', '나.']]]]));
  assert.ok(Array.isArray(r2.groups));
});

test('제한: 확장자, 5MB, 시트 30개, 행 3,000개', () => {
  assert.throws(() => readWorkbook(XLSX, { name: 'a.exe', size: 10, buffer: new Uint8Array(10) }), SheetError);
  assert.throws(() => readWorkbook(XLSX, { name: 'a.xlsx', size: LIMITS.bytes + 1, buffer: new Uint8Array(1) }), /5MB/);
  const many = {};
  for (let i = 0; i < 31; i++) many[`s${i}`] = [['학번', '이름', '내용']];
  assert.throws(() => read(many), /시트/);
  const big = [['학번', '이름', '내용'], ...Array.from({ length: 3001 }, (_, i) => [String(i), '가', '글.'])];
  assert.throws(() => read({ 자율: big }), /3,000/);
});

test('셀 5,000자에서 자르고 너무 김 표시', () => {
  const r = read({ 자율: [['학번', '이름', '내용'], ['1', '가', '가'.repeat(6000)]] });
  assert.equal(r.groups[0].rows[0].text.length, 5000);
  assert.equal(r.groups[0].rows[0].tooLong, true);
});

test('수식은 값으로만 읽음', () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['학번', '이름', '내용'], ['1', '가', '']]);
  ws.C2 = { t: 'n', f: 'HYPERLINK("http://x","y")', v: 0 };
  XLSX.utils.book_append_sheet(wb, ws, '자율');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const r = readWorkbook(XLSX, { name: 'f.xlsx', size: buf.byteLength, buffer: buf });
  assert.ok(!r.groups[0].rows[0].text.includes('HYPERLINK'));
});

test('CSV: UTF-8과 EUC-KR', () => {
  const utf = new TextEncoder().encode('학번,이름,내용\n10101,가상,토론에 참여함.\n');
  const r = readWorkbook(XLSX, { name: 'a.csv', size: utf.byteLength, buffer: utf });
  assert.equal(r.groups[0].rows[0].text, '토론에 참여함.');
  // EUC-KR '학번,이름,내용' + '1,가,나.'
  const euc = new Uint8Array([0xc7, 0xd0, 0xb9, 0xf8, 0x2c, 0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xb3, 0xbb, 0xbf, 0xeb, 0x0a, 0x31, 0x2c, 0xb0, 0xa1, 0x2c, 0xb3, 0xaa, 0x2e, 0x0a]);
  const r2 = readWorkbook(XLSX, { name: 'b.csv', size: euc.byteLength, buffer: euc });
  assert.equal(r2.groups[0].rows[0].name, '가');
});

test('붙여넣기 표 (탭, 따옴표 안 줄바꿈)', () => {
  const rows = parseTsv('학번\t이름\t내용\n10101\t가상\t"첫 줄.\n둘째 줄."\n');
  assert.deepEqual(rows[1], ['10101', '가상', '첫 줄.\n둘째 줄.']);
  const r = parseSheets([{ name: '붙여넣기', rows }]);
  assert.equal(r.groups[0].rows[0].text, '첫 줄.\n둘째 줄.');
});

test('보안 시험 샘플: __proto__ 시트는 건너뛰고 이유를 알림, 머리글 __proto__는 무시', async () => {
  const { readFileSync } = await import('node:fs');
  const buf = readFileSync(new URL('./samples/보안-시험.xlsx', import.meta.url));
  const r = readWorkbook(XLSX, { name: 'x.xlsx', size: buf.length, buffer: new Uint8Array(buf) });
  assert.match(r.problems[0], /__proto__/);
  assert.equal(r.groups.length, 1);
  assert.deepEqual(r.groups[0].rows.map((x) => x.text), ['=1+1', '+SUM(A1:A2) 학급 회의에 참여함.', '@cmd 토론에 참여함.']);
  assert.equal({}.polluted, undefined);
});
