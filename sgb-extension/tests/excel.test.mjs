// 엑셀 불러오기 시험: 나이스에서 내려받은 엑셀과 같은 머리글의 가짜 파일(가명)을 SheetJS 로 만들었다가 다시 읽어 확인한다.
// 실행: node tests/excel.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseExcelSheets, areaOf } from '../shared/sgb-excel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const XLSX = createRequire(import.meta.url)('../lib/xlsx.full.min.js');

// 확장에 넣은 SheetJS 는 sgb-checker/lib 의 것과 같아야 한다 (공식 배포 0.20.3)
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert.equal(sha(path.join(here, '../lib/xlsx.full.min.js')), sha(path.join(here, '../../sgb-checker/lib/xlsx.full.min.js')));

// aoa -> 파일 -> 다시 읽기 (패널의 readExcel 과 같은 방식)
function roundtrip(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  const back = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellFormula: false, cellStyles: false });
  return back.SheetNames.map((name) => {
    const ws = back.Sheets[name];
    return { name, rowOffset: XLSX.utils.decode_range(ws['!ref']).s.r, rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true }) };
  });
}
const idOf = (it) => `${it.grade}-${it.classNo}-${it.no}:${it.area}${it.subject ? `:${it.subject}` : ''}`;

// ---------- 나이스 자율·자치활동 (성명이 학생개인번호보다 앞) ----------
{
  const d = await parseExcelSheets(roundtrip([['자율활동관리 특기사항 ', [
    ['영역 구분', '학년도', '학년', '반', '번호', '성명', '학생개인번호', '특기사항'],
    ['자율·자치활동_특기사항', 2026, 3, 10, 1, '가나다', '2024000001', '학급 자치 회의를 진행함.\n규칙을 세움.'],
    ['자율·자치활동_특기사항', 2026, 3, 10, 2, '라마바', '2024000002', ''],           // 글 없음: 건너뜀
    ['자율·자치활동_특기사항', 2026, 3, 10, 3, '사아자', '2024000003', '체험학습 안전 지도를 도움.'],
  ]]]));
  assert.deepEqual(d.items.map(idOf), ['3-10-1:autonomy', '3-10-3:autonomy']);
  assert.equal(d.items[0].name, '가나다');
  assert.equal(d.items[0].text, '학급 자치 회의를 진행함.\n규칙을 세움.');   // 본문은 원문 그대로 (줄바꿈 유지)
  assert.equal(d.items[0].bytes, [...d.items[0].text].reduce((n, c) => n + (c.charCodeAt(0) >= 0xac00 && c.charCodeAt(0) <= 0xd7a3 ? 3 : 1), 0));
  assert.match(d.items[0].hash, /^[0-9a-f]{16}$/);
  assert.equal(d.schoolYear, 2026); assert.equal(d.semester, null);
  assert.equal(d.source, 'excel'); assert.equal(d.notes.noText, 1);
}

// ---------- 나이스 진로 (희망분야 열은 무시) / 행동특성 ----------
{
  const d = await parseExcelSheets(roundtrip([
    ['진로활동관리 특기사항 ', [
      ['영역 구분', '학년도', '학년', '반', '번호', '학생개인번호', '성명', '특기사항', '희망분야'],
      ['진로활동_특기사항', 2026, 3, 10, 1, '2024000001', '가나다', '진로 검사 결과를 바탕으로 탐색함.', '의사'],
    ]],
    ['행동특성및종합의견', [
      ['영역 구분', '학년도', '학년', '반', '번호', '학생개인번호', '성명', '행동특성 및 종합의견'],
      ['행동특성및종합의견', 2026, 3, 10, 1, '2024000001', '가나다', '배려심이 깊음.'],
      ['행동특성및종합의견', 2026, 3, 10, 2, '2024000002', '라마바', ''],
    ]],
  ]));
  assert.deepEqual(d.items.map(idOf), ['3-10-1:career', '3-10-1:behavior']);
  assert.equal(d.items[0].text, '진로 검사 결과를 바탕으로 탐색함.');          // 희망분야('의사')가 섞이지 않음
}

// ---------- 나이스 동아리 (학년·반이 섞여 있음, 부서명 열은 무시) ----------
{
  const d = await parseExcelSheets(roundtrip([['요리조리  _특기사항', [
    ['영역 구분', '학년도', '학년', '반', '번호', '동아리활동\n부서명', '학생개인번호', '성명', '특기사항'],
    ['동아리활동_특기사항', 2026, 3, 1, 3, '요리조리', '2024000011', '가나다', '요리 활동에 참여함.'],
    ['동아리활동_특기사항', 2026, 3, 5, 3, '요리조리', '2024000012', '라마바', '위생 수칙을 지킴.'],
  ]]]));
  assert.deepEqual(d.items.map(idOf), ['3-1-3:club', '3-5-3:club']);
}

// ---------- 나이스 교과세특 (반/번호 한 칸, 영역 열 없음, 시트 이름이 과목) ----------
{
  const d = await parseExcelSheets(roundtrip([['과학', [
    ['학년도', '학기', '학년', '반/번호', '학생개인번호', '성명', '과목명', '세부능력 및 특기사항'],
    [2026, 2, 3, '8/1', '2024000021', '가나다', '과학', '실험 설계 능력이 뛰어남.'],
    [2026, 2, 3, '8/2', '2024000022', '라마바', '과학', ''],
    [2026, 2, 3, '8/3', '2024000023', '사아자', '과학', '자료 해석을 정확히 함.'],
    [2026, 2, 3, '여덟/셋', '2024000024', '차카타', '과학', '형식이 이상한 행'],
  ]]]));
  assert.deepEqual(d.items.map(idOf), ['3-8-1:subject:과학', '3-8-3:subject:과학']);
  assert.equal(d.schoolYear, 2026); assert.equal(d.semester, 2);
  assert.equal(d.errors.length, 1); assert.match(d.errors[0].message, /반\/번호/); assert.equal(d.errors[0].row, 5);
}

// ---------- 웹앱 영역별 엑셀 내보내기: 학번 + 상태 '완료'만 ----------
{
  const d = await parseExcelSheets(roundtrip([['자율자치', [
    ['학번', '이름', '반', '과목', '최종본', '바이트', '상태'],
    ['31001', '가나다', '3학년 10반', '', '학급 회의를 이끎.', 20, '완료'],
    ['31002', '라마바', '3학년 10반', '', '초안 상태의 글', 12, '초안'],
    ['31003', '사아자', '3학년 10반', '', '', 0, '미작성'],
    ['3101', '차카타', '3학년 10반', '', '학번이 4자리', 5, '완료'],
  ]]]));
  assert.deepEqual(d.items.map(idOf), ['3-10-1:autonomy']);
  assert.equal(d.notes.notDone, 1); assert.equal(d.notes.noText, 1);
  assert.equal(d.errors.length, 1); assert.match(d.errors[0].message, /5자리/);
}

// ---------- 간단한 양식 ----------
{
  const d = await parseExcelSheets(roundtrip([['Sheet1', [
    ['제목 줄', '', '', '', '', '', ''],
    ['학년', '반', '번호', '이름', '영역', '과목', '내용'],
    [3, 5, 3, '가나다', '교과세특', '통합과학', '탐구를 주도함.'],
    [3, 5, 4, '라마바', '교과세특', '', '과목이 비어 있음'],
    [3, 5, 5, '사아자', '모르는영역', '', '영역을 모름'],
  ]]]));
  assert.deepEqual(d.items.map(idOf), ['3-5-3:subject:통합과학']);   // 머리글이 둘째 줄이어도 찾는다
  assert.equal(d.errors.length, 2);
  assert.equal(d.errors[0].row, 4);   // 엑셀 행 번호 기준
}

// ---------- 거르는 경우 ----------
await assert.rejects(parseExcelSheets(roundtrip([['빈 시트', [['아무', '표']]]])), /표를 찾지 못했습니다/);
await assert.rejects(parseExcelSheets(roundtrip([['자율', [['영역 구분', '학년', '반', '번호', '성명', '특기사항'], ['자율활동', 3, 1, 1, '', '이름 없는 학생']]]])), /이름/);
assert.equal(areaOf('자율·자치활동_특기사항'), 'autonomy');
assert.equal(areaOf('동아리활동_특기사항'), 'club');
assert.equal(areaOf('진로활동_특기사항'), 'career');
assert.equal(areaOf('행동특성및종합의견'), 'behavior');
assert.equal(areaOf('과학'), null);

console.log('excel tests ok');
