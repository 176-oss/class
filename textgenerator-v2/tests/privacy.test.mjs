// AI 요청 본문(초안, 일괄 초안, 다듬기, 스타일 정리)에 이름, 학번, API 키가 없어야 한다 (지시서 7장, contract 20절).
// fetchImpl로 실제로 보낼 요청을 잡아 검사한다. 실제 Gemini 호출 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDrafts, refineDraft, summarizeStyle, AiError } from '../js/core/gemini.js';
import { pickExamples, addExample, setAreaRules } from '../js/core/style.js';
import { defaultStyles, newRecord } from '../js/core/model.js';

const KEY = 'AIzaTEST-secret-key-0123456789';
const roster = [
  { studentId: '30501', name: '박하늘' },
  { studentId: '30502', name: '이도윤' },
  { studentId: '30503', name: '남궁민수' },
];
const settings = { models: ['m1'], limits: { autonomy: 1500 } };
const FORBIDDEN = ['박하늘', '하늘', '이도윤', '도윤', '남궁민수', '민수', '30501', '30502', '30503', '3학년 5반 2번', KEY];

function capture(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const text = JSON.stringify(reply);
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) };
  };
  return { calls, fetchImpl };
}

function assertClean(calls) {
  assert.ok(calls.length >= 1, '요청이 있어야 함');
  for (const { url, init } of calls) {
    const out = `${url}\n${init.body}`;
    for (const s of FORBIDDEN) assert.ok(!out.includes(s), `요청에 ${s} 가 들어감`);
    assert.equal(init.headers['x-goog-api-key'], KEY, '키는 헤더에만');
  }
}

function record() {
  const r = newRecord('30501', 'autonomy');
  r.memo = '박하늘(30501)이 학급 회의에서 이도윤, 민수와 의견을 정리함. 3학년 5반 2번과 준비물을 나눔.';
  return r;
}

// 가리지 않은 이름이 든 스타일 (보내기 직전 한 번 더 가리는지 보려고 일부러 그대로 넣음)
function rawStyle() {
  let s = defaultStyles();
  s = setAreaRules(s, 'autonomy', { rules: '하늘이처럼 짧게 씀', aiRules: '30502 글처럼 명사형' });
  s = addExample(s, 'autonomy', '이도윤은 3학년 5반 2번으로 회의를 이끔.').styles;
  return pickExamples(s, 'autonomy');
}

test('초안 만들기: 메모·스타일 속 이름, 학번, 반 번호와 키가 요청 본문에 없음', async () => {
  const { calls, fetchImpl } = capture({ drafts: ['회의에서 의견을 정리함.', '준비물을 나눔.'] });
  const res = await generateDrafts({ record: record(), studentName: '박하늘', roster, settings, apiKey: KEY, count: 2, fetchImpl, fake: false, style: rawStyle() });
  assert.equal(res.drafts.length, 2);
  assertClean(calls);
  assert.ok(calls[0].init.body.includes('문체만 참고'), '스타일은 들어감');
});

test('일괄 초안(count 1): 같은 검사', async () => {
  const { calls, fetchImpl } = capture({ drafts: ['회의에서 의견을 정리함.'] });
  await generateDrafts({ record: record(), studentName: '박하늘', roster, settings, apiKey: KEY, count: 1, fetchImpl, fake: false, style: rawStyle() });
  assertClean(calls);
});

test('다듬기: 후보 글·요청·메모·스타일에 이름, 학번이 있어도 요청 본문에 없음', async () => {
  const { calls, fetchImpl } = capture({ drafts: ['회의를 이끔.'] });
  const res = await refineDraft({
    record: record(), text: '박하늘은 30501 학생으로 회의를 이끔.', request: '도윤 이야기를 줄이고 더 짧게',
    studentName: '박하늘', roster, settings, apiKey: KEY, style: rawStyle(), fetchImpl, fake: false,
  });
  assert.equal(res.text, '회의를 이끔.');
  assertClean(calls);
  assert.ok(calls[0].init.body.includes('[다듬기 요청]'));
});

test('스타일 정리: 예시 속 이름, 학번, 반 번호가 요청 본문에 없음', async () => {
  const { calls, fetchImpl } = capture({ rules: ['짧게 씀', '명사형으로 끝냄'] });
  const res = await summarizeStyle({
    examples: ['박하늘(30501)은 회의를 이끔.', '남궁민수는 3학년 5반 2번이며 민수는 발표함.'],
    roster, settings, apiKey: KEY, fetchImpl, fake: false,
  });
  assert.deepEqual(res.rules, ['짧게 씀', '명사형으로 끝냄']);
  assertClean(calls);
});

test('가짜 AI도 같은 흐름으로 스타일 정리와 다듬기에 답함', async () => {
  const s = await summarizeStyle({ examples: ['회의를 이끔. 목록을 만듦.'], roster, settings, fake: true, fakeDelayMs: 0 });
  assert.ok(s.rules.length >= 3);
  const r = await refineDraft({ record: record(), text: '매우 뛰어난 리더십을 보임. 회의를 이끔.', request: '평가어 줄이기', roster, settings, fake: true, fakeDelayMs: 0 });
  assert.equal(r.text, '리더십을 보임. 회의를 이끔.');
});

test('키가 없으면 다듬기·스타일 정리도 보내지 않음', async () => {
  const { calls, fetchImpl } = capture({ rules: ['x'] });
  await assert.rejects(summarizeStyle({ examples: ['글'], roster, settings, apiKey: '', fetchImpl, fake: false }), (e) => e instanceof AiError && e.kind === 'key');
  await assert.rejects(refineDraft({ record: record(), text: '글', request: '짧게', roster, settings, apiKey: '', fetchImpl, fake: false }), (e) => e instanceof AiError && e.kind === 'key');
  assert.equal(calls.length, 0);
});
