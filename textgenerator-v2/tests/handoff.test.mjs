import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validBatch, writeBatch, takeBatch, planReturn, groupsForCheck, BATCH_KEY } from '../js/core/handoff.js';

const NOW = 1_800_000_000_000;
const store = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
};
const groups = [{ area: 'subject', subject: '과학', items: [{ studentId: '30801', name: '가나다', text: '탐구함.' }, { studentId: '30802', name: '라마바', text: '설명함.' }] }];

test('작성기 -> 점검기: 반 전체를 한 묶음으로 쓰고, 점검기가 읽으면 지운다', () => {
  const s = store();
  const w = writeBatch(s, { source: 'textgenerator-v2', school: 'high', groups }, NOW);
  assert.deepEqual(w, { ok: true, count: 2 });
  assert.equal(takeBatch(s, 'sgb-checker', NOW), null, '내가 보낸 것은 내가 받지 않음');
  assert.notEqual(s.getItem(BATCH_KEY), null);
  const got = takeBatch(s, 'textgenerator-v2', NOW + 1000);
  assert.equal(got.school, 'high');
  assert.equal(got.groups[0].items.length, 2);
  assert.equal(s.getItem(BATCH_KEY), null);
});

test('이상한 값은 받지 않고 지운다 (시간 초과, 영역, 교과세특 과목 없음, 글 너무 김)', () => {
  const base = { v: 1, source: 'sgb-checker', groups, at: NOW };
  assert.ok(validBatch(base, NOW + 1000));
  assert.equal(validBatch({ ...base, at: NOW - 6 * 60 * 1000 }, NOW), null);
  assert.equal(validBatch({ ...base, groups: [{ area: 'nope', items: [{ text: '가' }] }] }, NOW), null);
  assert.equal(validBatch({ ...base, groups: [{ area: 'subject', subject: '', items: [{ text: '가' }] }] }, NOW), null);
  assert.equal(validBatch({ ...base, groups: [{ area: 'club', items: [{ text: '가'.repeat(6001) }] }] }, NOW), null);
  assert.equal(validBatch({ ...base, source: 'evil' }, NOW), null);
  const s = store({ [BATCH_KEY]: '{깨짐' });
  assert.equal(takeBatch(s, 'textgenerator-v2', NOW), null);
  assert.equal(s.getItem(BATCH_KEY), null);
  assert.equal(writeBatch(store(), { source: 'textgenerator-v2', groups: [] }, NOW).ok, false);
});

test('점검기에서 고친 글 반영 계획: 완료·명단 밖·같은 글은 건너뜀', () => {
  const recs = new Map([
    ['30801', { id: '30801|subject|과학', final: '옛 글.', status: 'draft' }],
    ['30802', { id: '30802|subject|과학', final: '확정 글.', status: 'done' }],
  ]);
  const batch = validBatch({ v: 1, source: 'sgb-checker', at: NOW, groups: [{ area: 'subject', subject: '과학', items: [
    { studentId: '30801', name: '가나다', text: '고친 글.' }, { studentId: '30802', name: '라마바', text: '고친 글2.' }, { studentId: '30899', name: '없는', text: '고친 글3.' },
  ] }] }, NOW);
  const p = planReturn(batch, (id) => recs.get(id) || null);
  assert.deepEqual(p.updates.map((u) => [u.id, u.text, u.before]), [['30801|subject|과학', '고친 글.', '옛 글.']]);
  assert.deepEqual(p.skipped, { noStudent: 1, done: 1, same: 0 });
  const same = planReturn(validBatch({ v: 1, source: 'sgb-checker', at: NOW, groups: [{ area: 'subject', subject: '과학', items: [{ studentId: '30801', text: '옛 글.' }] }] }, NOW), (id) => recs.get(id) || null);
  assert.deepEqual(same.skipped, { noStudent: 0, done: 0, same: 1 });
});

test('표의 행을 영역·과목별 묶음으로, 빈 글은 뺀다', () => {
  const g = groupsForCheck([
    { studentId: '30801', name: '가', area: 'subject', subject: '과학', text: '글1' },
    { studentId: '30802', name: '나', area: 'subject', subject: '과학', text: ' ' },
    { studentId: '30803', name: '다', area: 'subject', subject: '수학', text: '글3' },
    { studentId: '30804', name: '라', area: 'club', subject: '', text: '글4' },
  ]);
  assert.deepEqual(g.map((x) => [x.area, x.subject, x.items.length]), [['subject', '과학', 1], ['subject', '수학', 1], ['club', '', 1]]);
});
