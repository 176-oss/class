import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeGenerate, toNounEnding } from '../js/core/fake-ai.js';
import { buildPrompt, parseResponse, INSUFFICIENT_TEXT } from '../js/core/prompt.js';

const memo = '실험 계획을 세웠다. 모둠원과 결과를 비교하였다.\n그래프를 그려 발표함';

test('fake-ai: 결정적이고 후보끼리 다름, 명사형', async () => {
  const p = buildPrompt({ area: 'subject', subject: '통합과학', memo, count: 3, limit: 1500 });
  const a = await fakeGenerate(p, { delayMs: 0 });
  const b = await fakeGenerate(p, { delayMs: 0 });
  assert.equal(a.model, 'fake');
  assert.equal(a.text, b.text, '같은 입력이면 같은 출력');
  const { drafts, insufficient } = parseResponse(a.text);
  assert.equal(insufficient, false);
  assert.equal(drafts.length, 3);
  assert.equal(new Set(drafts).size, 3, '후보끼리 다름');
  for (const d of drafts) {
    assert.ok(d.includes('실험 계획을 세움.'), d);
    assert.ok(d.includes('결과를 비교함.'), d);
    assert.ok(!/다\./.test(d), `평서형 종결이 남음: ${d}`);
  }
  const one = await fakeGenerate(buildPrompt({ area: 'club', memo, count: 1 }), { delayMs: 0 });
  assert.equal(parseResponse(one.text).drafts.length, 1);
});

test('fake-ai: 메모가 짧거나 부족이 있으면 부족 문장', async () => {
  for (const m of ['짧음', '활동 내용 부족, 나중에 채움', '']) {
    const r = await fakeGenerate(buildPrompt({ area: 'behavior', memo: m, count: 3 }), { delayMs: 0 });
    assert.deepEqual(JSON.parse(r.text), { drafts: [INSUFFICIENT_TEXT] });
    assert.deepEqual(parseResponse(r.text), { drafts: [], insufficient: true });
  }
});

test('fake-ai: 명사형 바꾸기', () => {
  assert.equal(toNounEnding('계획을 세웠다'), '계획을 세움.');
  assert.equal(toNounEnding('발표했다.'), '발표함.');
  assert.equal(toNounEnding('성실한 학생이다'), '성실한 학생임.');
  assert.equal(toNounEnding('변화가 보였다'), '변화가 보임.');
  assert.equal(toNounEnding('발표함'), '발표함.');
  assert.equal(toNounEnding('학급 회장'), '학급 회장 활동을 함.');
  assert.equal(toNounEnding('  '), '');
});

test('fakeGenerate: 도달한 성취기준을 초안에 넣음', async () => {
  const { buildPrompt } = await import('../js/core/prompt.js');
  const p = buildPrompt({ area: 'subject', subject: '통합과학', achievement: '[10통과01-01] 물질의 규칙성과 결합을 설명할 수 있다.', achievementReached: true, memo: '주기율표 탐구에서 족별 성질을 정리함.', length: 'standard', limit: 1500, count: 1 });
  const r = await fakeGenerate(p, { delayMs: 0 });
  const d = JSON.parse(r.text).drafts[0];
  assert.match(d, /물질의 규칙성과 결합을 설명 수준에 도달함/);
  assert.ok(!d.includes('10통과'));
});
