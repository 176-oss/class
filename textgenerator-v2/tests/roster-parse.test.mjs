import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStudentId, parseRosterRows, parsePastedRoster, TEMPLATE_ROWS } from '../js/core/roster-parse.js';

test('validateStudentId: 맞는 학번', () => {
  assert.deepEqual(validateStudentId('30501'), { ok: true, value: '30501', error: null });
  assert.equal(validateStudentId(' 3 05 01 ').value, '30501', '공백 제거');
  assert.equal(validateStudentId(30501).ok, true, '숫자도 받음');
  assert.equal(validateStudentId('30501.0').value, '30501', '엑셀 숫자 꼴');
});

test('validateStudentId: 자릿수 오류 문구', () => {
  const r = validateStudentId('3051');
  assert.equal(r.ok, false);
  assert.equal(r.error, '학번 "3051"이 4자리입니다. 학년 1자리 + 반 2자리 + 번호 2자리로 고쳐 주세요 (예: 30501).');
  assert.match(validateStudentId('305011').error, /6자리/);
});

test('validateStudentId: 숫자 아님, 학년, 반, 번호, 빈 값', () => {
  assert.match(validateStudentId('3-501').error, /숫자가 아닌/);
  assert.match(validateStudentId('70501').error, /학년/);
  assert.match(validateStudentId('00501').error, /학년/);
  assert.match(validateStudentId('30001').error, /반/);
  assert.match(validateStudentId('30500').error, /번호/);
  assert.match(validateStudentId('').error, /비어/);
  assert.equal(validateStudentId(null).ok, false);
});

test('parseRosterRows: 템플릿 형식', () => {
  const rows = [...TEMPLATE_ROWS, ['30102', '이도윤'], ['30103', '박서연']];
  const r = parseRosterRows(rows);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.students, [
    { studentId: '30102', name: '이도윤', row: 3 },
    { studentId: '30103', name: '박서연', row: 4 },
  ], '(예시) 줄은 건너뜀');
});

test('parseRosterRows: 머리글 없으면 [학번, 이름]', () => {
  const r = parseRosterRows([['30101', '김가온'], [30102, '이도윤'], [], ['', '']]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.students.map((s) => s.studentId), ['30101', '30102']);
});

test('parseRosterRows: 오류에 엑셀 행 번호', () => {
  const rows = [
    ['학번', '이름'],
    ['30101', '김가온'],
    ['3010', '이도윤'],
    ['30103', ''],
    ['', ''],
    ['30105', '최지우'],
    ['3051', '정하람'],
  ];
  const r = parseRosterRows(rows);
  assert.deepEqual(r.students.map((s) => s.studentId), ['30101', '30105']);
  assert.equal(r.errors.length, 3);
  assert.equal(r.errors[0].row, 3);
  assert.ok(r.errors[0].message.startsWith('3행: 학번 "3010"이 4자리입니다.'));
  assert.equal(r.errors[1].row, 4);
  assert.match(r.errors[1].message, /^4행: .*이름이 비어/);
  assert.equal(r.errors[2].message, '7행: 학번 "3051"이 4자리입니다. 학년 1자리 + 반 2자리 + 번호 2자리로 고쳐 주세요 (예: 30501).');
});

test('parseRosterRows: NEIS 출석부처럼 제목 줄 + 학년/반/번호/성명 열', () => {
  const rows = [
    ['2026학년도 출석부'],
    ['\u25CB\u25CB고등학교', '', '', '', ''],
    ['담임: 홍길동', '', '', '', ''],
    [],
    ['번호', '학년', '반', '성명', '성별'],
    ['1', '3', '5', '박하늘', '여'],
    [2, 3, 5, '이바다', '남'],
    ['3번', '3학년', '5반', '최별', '여'],
    ['', '', '', '', ''],
    ['계', '', '', '', '3명'],
  ];
  const r = parseRosterRows(rows);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.students, [
    { studentId: '30501', name: '박하늘', row: 6 },
    { studentId: '30502', name: '이바다', row: 7 },
    { studentId: '30503', name: '최별', row: 8 },
  ]);
});

test('parseRosterRows: 학번 열과 이름 열 위치가 달라도 머리글로 찾음', () => {
  const rows = [['반 명렬표'], ['순', '이름', '비고', '학번'], ['1', '김가온', '', '20301']];
  const r = parseRosterRows(rows);
  assert.deepEqual(r.students, [{ studentId: '20301', name: '김가온', row: 3 }]);
});

test('parseRosterRows: 같은 학번 다른 이름은 오류, 같은 이름은 한 번만', () => {
  const rows = [['학번', '이름'], ['30101', '김가온'], ['30101', '김가온'], ['30101', '이도윤']];
  const r = parseRosterRows(rows);
  assert.equal(r.students.length, 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].row, 4);
  assert.match(r.errors[0].message, /^4행: 학번 30101이 2행\(김가온\)과 같은데 이름\(이도윤\)이 다릅니다/);
});

test('parsePastedRoster: 탭, 쉼표, 공백', () => {
  const tab = parsePastedRoster('학번\t이름\n30101\t김가온\n30102\t이도윤\n');
  assert.deepEqual(tab.students.map((s) => [s.studentId, s.name]), [['30101', '김가온'], ['30102', '이도윤']]);
  const comma = parsePastedRoster('30101,김가온\r\n30102, 이도윤');
  assert.deepEqual(comma.students.map((s) => s.name), ['김가온', '이도윤']);
  const space = parsePastedRoster('30101 김가온\n  30102    이도윤  \n\n30103 박서연');
  assert.deepEqual(space.students.map((s) => s.studentId), ['30101', '30102', '30103']);
  assert.equal(space.students[2].row, 4, '빈 줄도 행 번호에 셈');
  const bad = parsePastedRoster('30101 김가온\n3012 이도윤');
  assert.equal(bad.errors[0].row, 2);
  assert.match(bad.errors[0].message, /^2행: 학번 "3012"이 4자리/);
});

test('parsePastedRoster: 학년 반 번호 이름 머리글', () => {
  const r = parsePastedRoster('학년\t반\t번호\t이름\n1\t2\t3\t김가온\n1\t12\t15\t이도윤');
  assert.deepEqual(r.students.map((s) => s.studentId), ['10203', '11215']);
});

test('parseClassNumbers: 범위, 쉼표, 공백, 중복', async () => {
  const { parseClassNumbers } = await import('../js/core/roster-parse.js');
  assert.deepEqual(parseClassNumbers('1-5, 7').numbers, [1, 2, 3, 4, 5, 7]);
  assert.deepEqual(parseClassNumbers('3~4 2 3').numbers, [2, 3, 4]);
  assert.deepEqual(parseClassNumbers(' 10 ').numbers, [10]);
  assert.equal(parseClassNumbers('').ok, false);
  assert.equal(parseClassNumbers('1-a').ok, false);
  assert.equal(parseClassNumbers('5-2').ok, false);
  assert.equal(parseClassNumbers('0').ok, false);
  assert.match(parseClassNumbers('1-40').error, /30개/);
});
