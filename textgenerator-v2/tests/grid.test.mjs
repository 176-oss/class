import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSpelling, fixSpelling, findInputErrors, checkCell, tidyText, composeMemo, planPaste, memoTargets } from '../js/core/grid.js';

test('맞춤법: 자주 틀리는 말 찾기와 고치기', () => {
  const t = '발표를 잘 되요. 몇일 동안 금새 끝냈다. 안되요.';
  const f = findSpelling(t);
  assert.deepEqual(f.map((x) => x.from), ['되요', '몇일', '금새', '안되요']);
  assert.equal(fixSpelling(t), '발표를 잘 돼요. 며칠 동안 금세 끝냈다. 안 돼요.');
  assert.deepEqual(findSpelling('바른 글입니다.'), []);
});

test('입력 오류: 문장부호 앞 공백, 겹침, 뒤 공백 없음, 자모, 짝, 반복, 끝맺음', () => {
  const msgs = (t) => findInputErrors(t).map((e) => e.message);
  assert.ok(msgs('활동함 .').some((m) => /앞에 공백/.test(m)));
  assert.ok(msgs('활동함..').some((m) => /겹쳐/.test(m)));
  assert.ok(msgs('활동함.성실함.').some((m) => /뒤에 공백/.test(m)));
  assert.ok(msgs('좋았다 ㅋㅋ.').some((m) => /자음/.test(m)));
  assert.ok(msgs('(활동함.').some((m) => /짝/.test(m)));
  assert.ok(msgs('성실히 성실히 참여함.').some((m) => /반복/.test(m)));
  assert.ok(msgs('활동에 참여함').some((m) => /끝나지/.test(m)));
  assert.deepEqual(msgs('학급 회의에 참여하여 의견을 정리함. 규칙을 세움.'), []);
  assert.deepEqual(msgs('평균 3.5점을 받음.'), []);
});

test('점검 한 칸: 연속 공백, 금지어, 맞춤법, 한도를 한꺼번에', () => {
  const entries = [{ term: '최고', match: 'contains', areas: [] }];
  const r = checkCell('활동에  참여해서 몇일 노력함. 최고의 학생임.', { area: 'autonomy', limit: 1500, entries });
  const kinds = r.issues.map((i) => i.kind);
  assert.ok(kinds.includes('neis') && kinds.includes('spell') && kinds.includes('forbidden'));
  assert.equal(r.fixable, true);
  assert.equal(tidyText('활동에  참여해서 몇일 노력함 .'), '활동에 참여해서 며칠 노력함.');
  const over = checkCell('가'.repeat(301), { area: 'behavior', limit: 900, entries: [] });
  assert.ok(over.issues.some((i) => i.kind === 'over'));
  assert.equal(checkCell('', { area: 'autonomy', limit: 1500 }).empty, true);
});

test('초안 재료: 공통 특징 + 학생 메모', () => {
  assert.equal(composeMemo('책임감 있음', '회의 진행'), '책임감 있음\n회의 진행');
  assert.equal(composeMemo('책임감 있음', ''), '책임감 있음');
  assert.equal(composeMemo('', ' 메모 '), '메모');
});

test('표에 순서대로 붙여넣기: 비었으면 넣고, 있으면 모드대로, 완료는 건드리지 않음', () => {
  const rows = [
    { id: 'a', final: '', status: 'memo' },
    { id: 'b', final: '원래 글.', status: 'draft' },
    { id: 'c', final: '확정 글.', status: 'done' },
    { id: 'd', final: '', status: 'empty' },
  ];
  const drafts = { a: '새 글 A.', b: '새 글 B.', c: '새 글 C.' };
  let p = planPaste(rows, drafts);
  assert.deepEqual(p.patches, [{ id: 'a', final: '새 글 A.' }]);
  assert.deepEqual(p.summary, { pasted: 1, appended: 0, overwritten: 0, keptExisting: 1, done: 1, noDraft: 1 });
  p = planPaste(rows, drafts, { mode: 'append' });
  assert.deepEqual(p.patches, [{ id: 'a', final: '새 글 A.' }, { id: 'b', final: '원래 글. 새 글 B.' }]);
  p = planPaste(rows, drafts, { mode: 'overwrite' });
  assert.deepEqual(p.patches.map((x) => x.id), ['a', 'b']);
  assert.equal(p.summary.overwritten, 1);
  p = planPaste([{ id: 'b', final: '원래 글. 새 글 B.', status: 'draft' }], { b: '새 글 B.' }, { mode: 'append' });
  assert.equal(p.patches.length, 0);
});

test('맨 위 버튼 대상: 메모가 있고 최종본이 빈 학생만', () => {
  const rows = [
    { id: 'a', memo: '메모', final: '', status: 'memo' },
    { id: 'b', memo: '메모', final: '있음', status: 'draft' },
    { id: 'c', memo: '', final: '', status: 'empty' },
    { id: 'd', memo: '메모', final: '', status: 'done' },
  ];
  assert.deepEqual(memoTargets(rows), ['a']);
});
