import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './helpers.mjs';
import { writeHandoff, takeHandoff, HANDOFF_KEY } from '../shared/handoff.js';

const NOW = 1_800_000_000_000;
const put = (v) => fakeStorage({ [HANDOFF_KEY]: typeof v === 'string' ? v : JSON.stringify(v) });
const good = { source: 'textgenerator-v2', studentId: '10101', area: 'club', subject: '', text: '글함.', at: NOW - 1000 };

test('점검기 -> 작성 도우미: 정해진 모양으로 씀', () => {
  const s = fakeStorage();
  assert.equal(writeHandoff(s, { studentId: '10101', area: 'subject', subject: '국어', text: '시를 낭송함.' }, NOW), true);
  assert.deepEqual(JSON.parse(s.getItem(HANDOFF_KEY)), { source: 'sgb-checker', studentId: '10101', area: 'subject', subject: '국어', text: '시를 낭송함.', at: NOW });
  assert.equal(writeHandoff(s, { area: 'subject', text: '' }, NOW), false);
  assert.equal(writeHandoff(s, { area: 'nope', text: '글' }, NOW), false);
});

test('작성 도우미가 보낸 것은 읽고 바로 지움', () => {
  const s = put(good);
  assert.deepEqual(takeHandoff(s, NOW), good);
  assert.equal(s.getItem(HANDOFF_KEY), null);
});

test('우리가 보낸 것은 남겨 둠 (작성 도우미가 읽을 몫)', () => {
  const s = put({ ...good, source: 'sgb-checker' });
  assert.equal(takeHandoff(s, NOW), null);
  assert.notEqual(s.getItem(HANDOFF_KEY), null);
});

test('이상한 값은 버리고 지움', () => {
  const bad = [
    'not json', '[1,2]', '{"__proto__":{"x":1}}',
    { ...good, at: NOW - 6 * 60 * 1000 }, // 5분 지남
    { ...good, at: NOW + 10 * 60 * 1000 }, // 미래
    { ...good, source: 'evil' },
    { ...good, area: '<script>' },
    { ...good, text: 123 },
    { ...good, text: '가'.repeat(7000) },
    { ...good, studentId: { a: 1 } },
    JSON.stringify({ ...good, pad: 'x'.repeat(21 * 1024) }),
  ];
  for (const v of bad) {
    const s = put(v);
    assert.equal(takeHandoff(s, NOW), null, String(typeof v === 'string' ? v.slice(0, 30) : JSON.stringify(v).slice(0, 60)));
    assert.equal(s.getItem(HANDOFF_KEY), null);
  }
});
