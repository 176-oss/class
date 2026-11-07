import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editCandidate, pushVersion, undoVersion, resetCandidate } from '../js/core/candidates.js';
import { newCandidate, normalizeCandidates, MAX_CANDIDATE_VERSIONS } from '../js/core/model.js';

test('editCandidate: 글을 바꾸고 edited 다시 계산, 판은 그대로', () => {
  const c = newCandidate('원문');
  const e = editCandidate(c, '고친 글');
  assert.deepEqual(e, { original: '원문', text: '고친 글', versions: [], edited: true });
  assert.equal(editCandidate(e, '원문').edited, false);
  assert.equal(c.text, '원문', '원본은 그대로');
});

test('pushVersion: 지금 글을 판으로, 최대 3개, 같은 글이면 그대로', () => {
  let c = newCandidate('v0');
  for (let i = 1; i <= 5; i += 1) c = pushVersion(c, `v${i}`);
  assert.equal(c.text, 'v5');
  assert.equal(c.versions.length, MAX_CANDIDATE_VERSIONS);
  assert.deepEqual(c.versions, ['v2', 'v3', 'v4']);
  assert.equal(pushVersion(c, 'v5'), c);
});

test('undoVersion: 마지막 판을 꺼냄, 없으면 그대로', () => {
  let c = pushVersion(pushVersion(newCandidate('a'), 'b'), 'c');
  c = undoVersion(c);
  assert.equal(c.text, 'b');
  assert.deepEqual(c.versions, ['a']);
  c = undoVersion(c);
  assert.deepEqual(c, { original: 'a', text: 'a', versions: [], edited: false });
  assert.equal(undoVersion(c), c);
});

test('resetCandidate: AI 원문으로, 고친 글은 판으로 남음', () => {
  const c = editCandidate(newCandidate('원문'), '고친 글');
  const r = resetCandidate(c);
  assert.equal(r.text, '원문');
  assert.equal(r.edited, false);
  assert.deepEqual(r.versions, ['고친 글']);
  assert.equal(undoVersion(r).text, '고친 글');
  assert.equal(resetCandidate(r), r, '이미 처음 상태면 그대로');
});

test('normalizeCandidates 결과에도 그대로 씀 (v1 문자열 후보)', () => {
  const [c] = normalizeCandidates(['옛 후보']);
  assert.equal(pushVersion(c, '새 글').versions[0], '옛 후보');
});
