import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSpelling, fixSpelling, findInputErrors, checkCell, tidyText, composeMemo, planPaste, memoTargets, assignedDrafts, removeCandidate } from '../js/core/grid.js';

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

test('후보 개수는 고른 학생 수 + 5, 자동 배정은 안 쓴 후보부터 차례로', async () => {
  const { candidateTarget, autoAssign } = await import('../js/core/grid.js');
  assert.equal(candidateTarget(0), 5);
  assert.equal(candidateTarget(12), 17);
  assert.equal(candidateTarget(100), 40);
  const m = autoAssign(['a', 'b', 'c'], new Map([['x', 1]]), 4);
  assert.deepEqual([...m], [['x', 1], ['a', 0], ['b', 2], ['c', 3]]);
  const w = autoAssign(['a', 'b', 'c'], new Map(), 2);
  assert.deepEqual([...w], [['a', 0], ['b', 1], ['c', 0]]);
  assert.deepEqual([...autoAssign(['a'], new Map([['a', 3]]), 5)], [['a', 3]]);
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

test('후보 하나를 여러 학생에게: 배정대로 글을 모으고, 후보를 지우면 번호를 당긴다', () => {
  const cands = ['후보 A.', '후보 B.', '  ', '후보 D.'];
  const assign = new Map([['s1', 0], ['s2', 1], ['s3', 0], ['s4', 2], ['s5', 9]]);
  assert.deepEqual(assignedDrafts(cands, assign), { s1: '후보 A.', s2: '후보 B.', s3: '후보 A.' });
  assert.deepEqual(assignedDrafts(cands, { s1: 3 }), { s1: '후보 D.' });
  const next = removeCandidate(new Map([['s1', 0], ['s2', 1], ['s3', 3]]), 1);
  assert.deepEqual([...next], [['s1', 0], ['s3', 2]]);
  // 붙이기 계획과 이어짐: 배정된 학생만, 완료는 건너뜀
  const rows = [{ id: 's1', final: '', status: 'memo' }, { id: 's2', final: '', status: 'done' }, { id: 's3', final: '', status: 'empty' }];
  const p = planPaste(rows, assignedDrafts(cands, assign));
  assert.deepEqual(p.patches.map((x) => x.id), ['s1', 's3']);
  assert.equal(p.summary.done, 1);
});

test('성취기준 나누기: 줄마다 하나, 한 줄에 여러 개면 코드 앞에서 나눔, 중복 제거', async () => {
  const { parseStandards, standardsText } = await import('../js/core/grid.js');
  const list = parseStandards('[10통과01-01] 우주의 기원을 설명한다.\n[10통과01-02] 원소의 생성을 설명한다. [10통과01-03] 별을 이해한다.\n\n[10통과01-01] 우주의 기원을 설명한다.\n자유롭게 쓴 줄');
  assert.deepEqual(list.map((x) => x.code), ['10통과01-01', '10통과01-02', '10통과01-03', '']);
  assert.equal(list[0].text, '우주의 기원을 설명한다.');
  assert.equal(list[3].line, '자유롭게 쓴 줄');
  assert.equal(standardsText(new Set([list[0].line, list[2].line])), '[10통과01-01] 우주의 기원을 설명한다.\n[10통과01-03] 별을 이해한다.');
  assert.deepEqual(parseStandards(''), []);
});

test('composeMemo 세 갈래, 모둠 저장·찾기·이름', async () => {
  const { groupOfStudent, saveGroup, nextGroupName } = await import('../js/core/grid.js');
  assert.equal(composeMemo('공통', '모둠', '학생'), '공통\n모둠\n학생');
  assert.equal(composeMemo('', '모둠', ''), '모둠');
  let g = saveGroup([], { id: 'g1', name: '1모둠', memo: '전지 만들기 실험', studentIds: ['10101', '10102'] });
  g = saveGroup(g, { id: 'g2', name: '', memo: '', studentIds: ['10102', '10103'] });
  assert.deepEqual(g.map((x) => [x.id, x.name, x.studentIds]), [['g1', '1모둠', ['10101']], ['g2', '모둠', ['10102', '10103']]]);
  assert.equal(groupOfStudent(g, '10102').id, 'g2');
  assert.equal(groupOfStudent(g, 10101).memo, '전지 만들기 실험');
  assert.equal(groupOfStudent(undefined, '1'), null);
  g = saveGroup(g, { id: 'g1', name: '1모둠', memo: 'x', studentIds: ['10102', '10103'] });
  assert.deepEqual(g.map((x) => x.id), ['g1'], '학생을 모두 뺏긴 모둠은 지워짐');
  assert.equal(nextGroupName([{ name: '1모둠' }, { name: '3모둠' }]), '2모둠');
  assert.equal(nextGroupName(), '1모둠');
});

test('행사 날짜 형식, 표기, 저장, 빠진 표기', async () => {
  const { formatEventDate, eventLabel, saveEvent, missingEventLabels } = await import('../js/core/grid.js');
  const f = (s, y) => formatEventDate(s, y).value;
  assert.equal(f('2026.05.14.'), '2026.05.14.');
  assert.equal(f('2026-5-14'), '2026.05.14.');
  assert.equal(f('2026.5.14'), '2026.05.14.');
  assert.equal(f('20260514'), '2026.05.14.');
  assert.equal(f('2026년 5월 14일'), '2026.05.14.');
  assert.equal(f('5/14', 2026), '2026.05.14.');
  assert.equal(formatEventDate('5/14').ok, false, '학년도 없이 월·일만');
  assert.equal(f('2026.05.14.~2026.05.16.'), '2026.05.14.-2026.05.16.');
  assert.equal(f('2026.5.14 ~ 5.16'), '2026.05.14.-2026.05.16.');
  assert.equal(f('2026.05.14.-2026.05.16.'), '2026.05.14.-2026.05.16.');
  assert.equal(f('2026.05.14.~2026.05.14.'), '2026.05.14.', '같은 날 기간은 하루');
  assert.equal(formatEventDate('2026.02.30').ok, false);
  assert.match(formatEventDate('2026.05.16~2026.05.14').error, /앞입니다/);
  assert.equal(formatEventDate('').ok, false);
  assert.equal(formatEventDate('다음 주').ok, false);
  assert.equal(eventLabel({ name: ' 학생자치회 임원 선거 ', date: '2026.03.15.' }), '학생자치회 임원 선거(2026.03.15.)');
  let ev = saveEvent([], { id: 'b', name: '체육대회', date: '2026.05.14.' });
  ev = saveEvent(ev, { id: 'a', name: '임원 선거', date: '2026.03.15.' });
  ev = saveEvent(ev, { id: 'b', name: '체육 대회', date: '2026.05.14.' });
  assert.deepEqual(ev.map((e) => e.name), ['임원 선거', '체육 대회']);
  assert.deepEqual(missingEventLabels('임원 선거(2026.03.15.)에서 공약을 발표함.', ev), ['체육 대회(2026.05.14.)']);
});

test('parseEventList: 붙여넣기 여러 꼴, 엑셀 표, 머리글·오류·중복', async () => {
  const { parseEventList } = await import('../js/core/grid.js');
  const r = parseEventList('행사명\t날짜\n학생자치회 임원 선거\t2026-3-15\n체육대회, 2026.05.14.~2026.05.15.\n진로의 날(2026.6.3)\n과학의 날 2026.04.21\n잘못된 줄\n진로의 날(2026.06.03.)\n축제\t다음 달');
  assert.deepEqual(r.events, [
    { name: '학생자치회 임원 선거', date: '2026.03.15.' },
    { name: '체육대회', date: '2026.05.14.-2026.05.15.' },
    { name: '진로의 날', date: '2026.06.03.' },
    { name: '과학의 날', date: '2026.04.21.' },
  ]);
  assert.equal(r.errors.length, 2);
  assert.deepEqual(parseEventList([['행사', '일자'], ['독서 토론회', '2026.09.10'], ['직업인 특강', '9/24']], 2026).events,
    [{ name: '독서 토론회', date: '2026.09.10.' }, { name: '직업인 특강', date: '2026.09.24.' }]);
});
