import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fakeStorage } from './helpers.mjs';
import { writeBatch, takeBatch, validBatch, BATCH_KEY } from '../shared/handoff-batch.js';

const NOW = 1_800_000_000_000;
const groups = [{ area: 'club', subject: '', items: [{ studentId: '10101', name: '가', text: '글함.' }] }];

test('점검기 -> 작성기: 고친 글 묶음을 쓰고, 작성기가 읽으면 지움', () => {
  const s = fakeStorage();
  assert.deepEqual(writeBatch(s, { source: 'sgb-checker', groups }, NOW), { ok: true, count: 1 });
  assert.equal(takeBatch(s, 'textgenerator-v2', NOW), null, '점검기는 자기가 보낸 것을 받지 않음');
  assert.notEqual(s.getItem(BATCH_KEY), null);
  const got = takeBatch(s, 'sgb-checker', NOW + 1);
  assert.equal(got.groups[0].items[0].text, '글함.', '작성기가 점검기 것을 받음');
  const t = fakeStorage();
  writeBatch(t, { source: 'textgenerator-v2', school: 'mid', groups }, NOW);
  const mine = takeBatch(t, 'textgenerator-v2', NOW + 1);
  assert.equal(mine.school, 'mid');
  assert.equal(t.getItem(BATCH_KEY), null);
});

test('이상한 묶음은 버림', () => {
  assert.equal(validBatch({ v: 1, source: 'x', groups, at: NOW }, NOW), null);
  assert.equal(validBatch({ v: 2, source: 'sgb-checker', groups, at: NOW }, NOW), null);
});

test('작성기 쪽 복사본과 규칙 상수가 같다', () => {
  const a = fs.readFileSync(new URL('../shared/handoff-batch.js', import.meta.url), 'utf8');
  const b = fs.readFileSync(new URL('../../textgenerator-v2/js/core/handoff.js', import.meta.url), 'utf8');
  for (const k of ['BATCH_KEY', 'BATCH_TTL_MS', 'BATCH_MAX_ITEMS', 'BATCH_MAX_BYTES', 'BATCH_SOURCES']) {
    const line = (src) => src.split('\n').find((l) => l.startsWith(`export const ${k} `));
    assert.equal(line(a), line(b), k);
  }
  assert.ok(a.includes("const AREAS = ['autonomy', 'career', 'behavior', 'club', 'subject'];"));
});
