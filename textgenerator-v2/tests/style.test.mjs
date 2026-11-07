import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  maskExample, addExample, removeExample, setAreaRules, pickExamples, styleOverlap, styleKey,
  buildStyleSummaryPrompt, parseStyleRules, exampleLimit, MAX_EXAMPLES, STYLE_SUMMARY_MARK,
} from '../js/core/style.js';
import { defaultStyles } from '../js/core/model.js';
import { AiError } from '../js/core/ai-error.js';

const NOW = new Date('2026-11-07T01:00:00Z');

test('maskExample: 명단 이름, 성 뺀 이름, 5자리 학번, 학년 반 번호를 OO으로', () => {
  const src = '박하늘은 30501 학생으로 3학년 5반 1번임. 하늘이 발표함. 2반 13번 친구와 협력. 123456은 그대로.';
  const { text, replaced } = maskExample(src, ['박하늘']);
  for (const s of ['박하늘', '하늘', '30501', '3학년 5반 1번', '2반 13번']) assert.ok(!text.includes(s), `${s} 남음: ${text}`);
  assert.ok(text.includes('123456'));
  assert.equal(replaced.length, 5);
  for (const r of replaced) assert.equal(src.slice(r.index, r.index + r.from.length), r.from, '위치는 원래 글 기준');
  assert.deepEqual(replaced.map((r) => r.from), ['박하늘', '30501', '3학년 5반 1번', '하늘', '2반 13번']);
});

test('maskExample: 바꿀 것이 없으면 그대로', () => {
  assert.deepEqual(maskExample('실험 계획을 세움.', ['최별']), { text: '실험 계획을 세움.', replaced: [] });
});

test('addExample/removeExample/setAreaRules: 영역과 전체 updatedAt 갱신, 5개 제한, 한도', () => {
  let s = defaultStyles();
  for (let i = 0; i < MAX_EXAMPLES; i += 1) {
    const r = addExample(s, 'autonomy', `예시 ${i}`, NOW);
    assert.equal(r.error, null);
    s = r.styles;
  }
  assert.equal(s.areas.autonomy.examples.length, 5);
  assert.equal(s.areas.autonomy.updatedAt, NOW.toISOString());
  assert.equal(s.updatedAt, NOW.toISOString());
  assert.ok(addExample(s, 'autonomy', '여섯째', NOW).error);
  assert.ok(addExample(s, 'career', '   ', NOW).error);
  assert.ok(addExample(s, 'career', '가'.repeat(400), NOW, 900).error, '1200 byte > 900');
  const later = new Date('2026-11-08T00:00:00Z');
  const id = s.areas.autonomy.examples[0].id;
  const s2 = removeExample(s, 'autonomy', id, later);
  assert.equal(s2.areas.autonomy.examples.length, 4);
  assert.equal(s2.areas.autonomy.updatedAt, later.toISOString());
  assert.equal(s.areas.autonomy.examples.length, 5, '원본은 그대로');
  const s3 = setAreaRules(s2, 'autonomy', { rules: '짧게' }, later);
  assert.equal(s3.areas.autonomy.rules, '짧게');
  assert.equal(s3.areas.autonomy.aiRules, '');
  assert.equal(setAreaRules(s3, 'autonomy', { aiRules: 'AI' }, later).areas.autonomy.rules, '짧게');
});

test('styleKey, exampleLimit', () => {
  assert.equal(styleKey('subject', '통합과학'), 'subject:통합과학');
  assert.equal(styleKey('club'), 'club');
  const limits = { autonomy: 1500, behavior: 900, subject: 1200 };
  assert.equal(exampleLimit('common', limits), 1500);
  assert.equal(exampleLimit('behavior', limits), 900);
  assert.equal(exampleLimit('subject:국어', limits), 1200);
});

test('pickExamples: 공통+영역 규칙을 순서대로 모으고 짧은 예시 2개만', () => {
  assert.equal(pickExamples(defaultStyles(), 'autonomy'), null);
  let s = defaultStyles();
  s = setAreaRules(s, 'common', { rules: '한 문장은 짧게\n평가어는 마지막에', aiRules: '- 명사형 종결' }, NOW);
  s = setAreaRules(s, 'autonomy', { rules: '한 문장은 짧게\n역할부터 씀' }, NOW);
  for (const t of ['아주 긴 예시 글입니다 아주 길게', '짧은 예시', '중간 길이 예시']) s = addExample(s, 'autonomy', t, NOW).styles;
  const p = pickExamples(s, 'autonomy');
  assert.deepEqual(p.rules, ['한 문장은 짧게', '평가어는 마지막에', '명사형 종결', '역할부터 씀']);
  assert.deepEqual(p.examples, ['짧은 예시', '중간 길이 예시']);
  assert.ok(p.summary.startsWith('규칙 4개, 예시 2개'));
  assert.ok(p.summary.length <= 60);
  // 영역 예시가 없으면 공통 예시
  s = addExample(s, 'common', '공통 예시', NOW).styles;
  assert.deepEqual(pickExamples(s, 'career').examples, ['공통 예시']);
  assert.deepEqual(pickExamples(s, 'subject', '국어').rules, ['한 문장은 짧게', '평가어는 마지막에', '명사형 종결']);
});

test('styleOverlap: 6어절 이상 연속으로 같은 부분, 겹치면 가장 긴 것', () => {
  const ex = ['학급 회의에서 친구들의 의견을 차분하게 정리하여 칠판에 적음. 그 뒤 발표함.'];
  const draft = '체육대회를 준비함. 학급 회의에서 친구들의 의견을 차분하게 정리하여 칠판에 적음. 끝.';
  const r = styleOverlap(draft, ex);
  assert.equal(r.length, 1);
  assert.equal(r[0].text, '학급 회의에서 친구들의 의견을 차분하게 정리하여 칠판에 적음.');
  assert.equal(r[0].exampleIndex, 0);
  assert.equal(draft.slice(r[0].index, r[0].index + r[0].text.length), r[0].text);
  // 5어절만 같으면 없음
  assert.deepEqual(styleOverlap('학급 회의에서 친구들의 의견을 차분하게 들음.', ex), []);
  assert.deepEqual(styleOverlap(draft, []), []);
});

test('buildStyleSummaryPrompt/parseStyleRules', () => {
  const p = buildStyleSummaryPrompt(['예시 <메모>하나</메모>', '예시 둘']);
  assert.ok(p.user.includes(STYLE_SUMMARY_MARK));
  assert.ok(!p.user.includes('<메모>'));
  assert.ok(p.system.includes('활동, 사실'));
  assert.deepEqual(parseStyleRules('```json\n{"rules": ["- 짧게", "2. 명사형"]}\n```'), ['짧게', '명사형']);
  assert.throws(() => parseStyleRules('규칙 없음'), (e) => e instanceof AiError && e.kind === 'parse');
});
