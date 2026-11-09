import test from 'node:test';
import assert from 'node:assert/strict';
import { XLSX } from './helpers.mjs';
import { buildReport, reportFile } from '../js/report.js';

const item = (o = {}) => ({
  studentId: '10101', name: '가상하나', areaLabel: '자율·자치활동', subject: '', original: '=1+1', current: '=1+1.', bytes: 5, limit: 1500, status: 'error',
  issues: [{ level: 'error', label: '마침표 없음', text: '', reason: '문장 끝에 마침표가 없음', basis: '선생님 기준', fix: '.' }],
  excepted: [], ...o,
});

test('보고서: 요약, 학생별, 수정본 3개 시트', () => {
  const s = buildReport([item(), item({ studentId: '10102', status: 'pass', issues: [] })]);
  assert.deepEqual(s.map((x) => x.name), ['요약', '학생별', '수정본']);
  assert.equal(s[0].rows[1][1], 2);
  assert.match(s[1].rows[1][5], /마침표 없음/);
});

test('= + - @로 시작하는 글도 수식이 아니라 글자로 남음', () => {
  const rows = [item({ original: '=1+1', current: '+SUM(A1)' }), item({ original: '-2', current: '@x', name: '=HYPERLINK("http://x","y")' })];
  const buf = reportFile(XLSX, buildReport(rows));
  const wb = XLSX.read(buf, { type: 'array', cellFormula: true });
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    for (const [addr, c] of Object.entries(ws)) {
      if (addr.startsWith('!')) continue;
      assert.equal(c.f, undefined, `${name} ${addr} 수식`);
      assert.equal(c.t, 's', `${name} ${addr} 문자열 셀`);
    }
  }
  assert.equal(wb.Sheets['수정본'].D2.v, '=1+1');
  assert.equal(wb.Sheets['수정본'].B3.v, '=HYPERLINK("http://x","y")');
});
