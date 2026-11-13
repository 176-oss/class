import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNeisFill, findNeisHeader, areaOf } from '../js/core/neis-excel.js';
import { parseRosterRows } from '../js/core/roster-parse.js';

// 나이스에서 내려받은 엑셀과 같은 머리글의 가짜 표 (이름은 가명)
const STUDENTS = [
  { studentId: '31001', name: '가나다' }, { studentId: '31002', name: '라마바' }, { studentId: '31003', name: '사아자' },
  { studentId: '30803', name: '차카타' }, { studentId: '30101', name: '하갸냐' },
];
const rec = (id, final, status = 'done') => ({ id, final, status });
const RECORDS = [
  rec('31001|autonomy', '학급 회의를 이끎.'),
  rec('31002|autonomy', '초안 단계의 글', 'draft'),
  rec('31003|autonomy', ''),
  rec('31001|career', '진로를 탐색함.'),
  rec('31001|behavior', '배려심이 깊음.'),
  rec('30803|subject|과학', '자료 해석을 정확히 함.'),
  rec('30101|club', '요리 활동에 참여함.'),
];
const LIMITS = { autonomy: 1500, career: 1500, behavior: 900, club: 1500, subject: 1500 };
const plan = (over) => planNeisFill({ students: STUDENTS, records: RECORDS, limits: LIMITS, ...over });

const AUTONOMY = [
  ['영역 구분', '학년도', '학년', '반', '번호', '성명', '학생개인번호', '특기사항'],
  ['자율·자치활동_특기사항', '2026', '3', '10', '1', '가나다', '2024000001', ''],
  ['자율·자치활동_특기사항', '2026', '3', '10', '2', '라마바', '2024000002', ''],
  ['자율·자치활동_특기사항', '2026', '3', '10', '3', '사아자', '2024000003', ''],
];

test('areaOf: 나이스 영역 이름', () => {
  assert.equal(areaOf('자율·자치활동_특기사항'), 'autonomy');
  assert.equal(areaOf('동아리활동_특기사항'), 'club');
  assert.equal(areaOf('진로활동_특기사항'), 'career');
  assert.equal(areaOf('행동특성및종합의견'), 'behavior');
  assert.equal(areaOf('세부능력 및 특기사항'), 'subject');
  assert.equal(areaOf('과학'), null);
});

test('자율: 완료된 글만 본문 칸(특기사항)에 채움, 다른 칸은 그대로', () => {
  const r = plan({ sheetName: '자율활동관리 특기사항 ', rows: AUTONOMY, rowOffset: 0 });
  assert.equal(r.found, true);
  assert.deepEqual(r.edits, [{ row: 1, col: 7, value: '학급 회의를 이끎.' }]);
  assert.equal(r.summary.filled, 1);
  assert.equal(r.summary.notDone, 1, '초안 단계는 제외');
  assert.equal(r.summary.noRecord, 1, '글이 없는 학생은 건너뜀');
});

test('완료가 아닌 글도 채우기 선택', () => {
  const r = plan({ sheetName: '자율', rows: AUTONOMY, includeNotDone: true });
  assert.deepEqual(r.edits.map((e) => e.row), [1, 2]);
});

test('진로: 희망분야 열은 건드리지 않음', () => {
  const rows = [
    ['영역 구분', '학년도', '학년', '반', '번호', '학생개인번호', '성명', '특기사항', '희망분야'],
    ['진로활동_특기사항', '2026', '3', '10', '1', '2024000001', '가나다', '', '의사'],
  ];
  const r = plan({ sheetName: '진로활동관리 특기사항 ', rows });
  assert.deepEqual(r.edits, [{ row: 1, col: 7, value: '진로를 탐색함.' }]);
});

test('행동특성: 머리글 "행동특성 및 종합의견"', () => {
  const rows = [
    ['영역 구분', '학년도', '학년', '반', '번호', '학생개인번호', '성명', '행동특성 및 종합의견'],
    ['행동특성및종합의견', '2026', '3', '10', '1', '2024000001', '가나다', ''],
  ];
  assert.deepEqual(plan({ sheetName: '행동특성및종합의견', rows }).edits, [{ row: 1, col: 7, value: '배려심이 깊음.' }]);
});

test('동아리: 학년·반이 섞여 있어도 학년|반|번호로 찾음', () => {
  const rows = [
    ['영역 구분', '학년도', '학년', '반', '번호', '동아리활동\n부서명', '학생개인번호', '성명', '특기사항'],
    ['동아리활동_특기사항', '2026', '3', '1', '3', '요리조리', '2024000011', '다른학생', ''],
    ['동아리활동_특기사항', '2026', '1', '1', '1', '요리조리', '2024000012', '하갸냐', ''],
  ];
  const r = plan({ sheetName: '요리조리  _특기사항', rows });
  assert.equal(r.summary.notInRoster, 2, '3학년 1반 3번(30103), 1학년 1반 1번(10101)은 명단에 없음');
  assert.deepEqual(r.edits, []);
  const rows2 = [rows[0], ['동아리활동_특기사항', '2026', '3', '1', '1', '요리조리', '2024000012', '하갸냐', '']];
  // 작성기 학번 30101 = 3학년 01반 01번
  assert.deepEqual(plan({ sheetName: '요리조리', rows: rows2 }).edits, [{ row: 1, col: 8, value: '요리 활동에 참여함.' }]);
});

test('교과세특: 반/번호(8/3) 한 칸, 영역 열 없음, 과목명으로 기록 찾기', () => {
  const rows = [
    ['학년도', '학기', '학년', '반/번호', '학생개인번호', '성명', '과목명', '세부능력 및 특기사항'],
    ['2026', '2', '3', '8/3', '2024000023', '차카타', '과학', ''],
    ['2026', '2', '3', '8/4', '2024000024', '없는학생', '과학', ''],
  ];
  const r = plan({ sheetName: '과학', rows });
  assert.deepEqual(r.edits, [{ row: 1, col: 7, value: '자료 해석을 정확히 함.' }]);
  assert.equal(r.summary.notInRoster, 1);
});

test('이름이 작성기 명단과 다르면 채우지 않음', () => {
  const rows = [AUTONOMY[0], ['자율·자치활동_특기사항', '2026', '3', '10', '1', '다른이름', '2024000001', '']];
  const r = plan({ sheetName: '자율', rows });
  assert.deepEqual(r.edits, []);
  assert.equal(r.summary.nameMismatch, 1);
});

test('나이스에 이미 글이 있을 때: 기본은 그대로, 이어쓰기, 덮어쓰기', () => {
  const rows = [AUTONOMY[0], ['자율·자치활동_특기사항', '2026', '3', '10', '1', '가나다', '2024000001', '원래 글입니다.  ']];
  let r = plan({ sheetName: '자율', rows });
  assert.deepEqual(r.edits, []); assert.equal(r.summary.kept, 1); assert.equal(r.issues[0].kind, 'kept');
  r = plan({ sheetName: '자율', rows, mode: 'append' });
  assert.deepEqual(r.edits, [{ row: 1, col: 7, value: '원래 글입니다. 학급 회의를 이끎.' }]);
  assert.equal(r.summary.appended, 1);
  r = plan({ sheetName: '자율', rows, mode: 'overwrite' });
  assert.deepEqual(r.edits, [{ row: 1, col: 7, value: '학급 회의를 이끎.' }]); assert.equal(r.summary.overwritten, 1);
  // 같은 글이면 바꾸지 않음, 이미 들어 있으면 이어쓰지 않음
  const same = [AUTONOMY[0], ['자율·자치활동_특기사항', '2026', '3', '10', '1', '가나다', '2024000001', '학급 회의를 이끎.']];
  assert.equal(plan({ sheetName: '자율', rows: same, mode: 'append' }).summary.same, 1);
});

test('바이트 한도를 넘으면 채우지 않음 (행동특성 900)', () => {
  const records = [rec('31001|behavior', '가'.repeat(301))];   // 903 바이트
  const rows = [
    ['영역 구분', '학년도', '학년', '반', '번호', '학생개인번호', '성명', '행동특성 및 종합의견'],
    ['행동특성및종합의견', '2026', '3', '10', '1', '2024000001', '가나다', ''],
  ];
  const r = planNeisFill({ sheetName: '행동특성및종합의견', rows, students: STUDENTS, records, limits: LIMITS });
  assert.deepEqual(r.edits, []); assert.equal(r.summary.tooLong, 1);
});

test('오류 행 번호는 엑셀 기준 (머리글 위에 줄이 있거나 시작 행이 다를 때)', () => {
  const rows = [['제목'], AUTONOMY[0], ['자율·자치활동_특기사항', '2026', '3', '10', '9', '없음', '2024000009', '']];
  const r = plan({ sheetName: '자율', rows, rowOffset: 4 });
  assert.equal(r.issues[0].row, 4 + 2 + 1);   // rows[2] -> 엑셀 7행
});

test('머리글이 없는 시트는 found false', () => {
  assert.equal(findNeisHeader([['아무', '표']]), null);
  assert.equal(plan({ sheetName: 'x', rows: [['아무', '표']] }).found, false);
});

test('명단 등록: 나이스 특기사항 엑셀 5가지 머리글을 읽음 (교과세특 반/번호 포함)', () => {
  const neis = [
    [['영역 구분', '학년도', '학년', '반', '번호', '성명', '학생개인번호', '특기사항'], ['자율·자치활동_특기사항', '2026', '3', '10', '1', '가나다', '2024000001', '글']],
    [['영역 구분', '학년도', '학년', '반', '번호', '학생개인번호', '성명', '특기사항', '희망분야'], ['진로활동_특기사항', '2026', '3', '10', '1', '2024000001', '가나다', '글', '의사']],
    [['영역 구분', '학년도', '학년', '반', '번호', '동아리활동\n부서명', '학생개인번호', '성명', '특기사항'], ['동아리활동_특기사항', '2026', '3', '1', '3', '요리조리', '2024000011', '가나다', '']],
    [['영역 구분', '학년도', '학년', '반', '번호', '학생개인번호', '성명', '행동특성 및 종합의견'], ['행동특성및종합의견', '2026', '3', '10', '1', '2024000001', '가나다', '']],
    [['학년도', '학기', '학년', '반/번호', '학생개인번호', '성명', '과목명', '세부능력 및 특기사항'], ['2026', '2', '3', '8/1', '2024000021', '가나다', '과학', '']],
  ];
  const ids = neis.map((rows) => parseRosterRows(rows));
  for (const r of ids) assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.deepEqual(ids.map((r) => r.students[0].studentId), ['31001', '31001', '30103', '31001', '30801']);
  assert.ok(ids.every((r) => r.students[0].name === '가나다'));
});
