import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AiError, buildRequest, callGemini, classifyError, generateDrafts, readGeminiText, API_BASE,
} from '../js/core/gemini.js';
import { newRecord, defaultSettings } from '../js/core/model.js';

const KEY = 'TEST-KEY-abc123';
const PROMPT = { system: '시스템', user: '사용자' };

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임'];
const GIVEN = ['가온', '도윤', '서연', '하준', '지우', '서준', '하은', '민준', '지호', '예린',
  '수아', '시우', '유나', '건우', '채원', '준서', '다인', '현우', '소율', '태민',
  '윤슬', '은호', '나래', '우진', '세아', '라온', '해솔', '다온', '지안', '리안'];
const ROSTER = GIVEN.map((g, i) => ({
  studentId: `305${String(i + 1).padStart(2, '0')}`,
  name: `${SURNAMES[i % SURNAMES.length]}${g}`,
}));

function okBody(drafts) {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ drafts }) }] }, finishReason: 'STOP' }],
  });
}

/** 가짜 fetch: responses 는 (url, init, n) => Response 또는 배열 */
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = typeof responses === 'function' ? responses(url, init, calls.length - 1) : responses[calls.length - 1];
    if (r instanceof Error) throw r;
    return r;
  };
  fn.calls = calls;
  return fn;
}

const res = (status, body) => new Response(body, { status });

test('buildRequest: 키는 헤더에만, URL 과 본문에 없음', () => {
  const { url, init } = buildRequest({ model: 'gemini-2.5-flash', apiKey: KEY, prompt: PROMPT });
  assert.equal(url, `${API_BASE}/gemini-2.5-flash:generateContent`);
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  assert.ok(!url.includes(KEY) && !url.includes('key='));
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-goog-api-key'], KEY);
  assert.ok(!init.body.includes(KEY));
  const body = JSON.parse(init.body);
  assert.deepEqual(body.systemInstruction, { parts: [{ text: '시스템' }] });
  assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: '사용자' }] }]);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.temperature, 0.7);
  assert.equal(buildRequest({ model: 'models/gemini-x', apiKey: KEY, prompt: PROMPT }).url, `${API_BASE}/gemini-x:generateContent`);
});

test('generateDrafts: 요청 본문에 명단 30명의 이름과 학번이 하나도 없음', async () => {
  const me = ROSTER[0];
  const record = {
    ...newRecord(me.studentId, 'subject', '통합과학'),
    memo: `${me.name}(${me.studentId})이 모둠장을 맡아 실험 계획을 세움. ${ROSTER[1].name}, ${ROSTER[2].studentId} ${ROSTER[2].name}과 결과를 비교함.\n`
      + `${GIVEN[0]}이가 ${GIVEN[5]}에게 그래프 그리는 법을 알려 줌. ${ROSTER.slice(10).map((s) => `${s.name} ${s.studentId}`).join(', ')} 모두 참여.`,
    traits: ['탐구력'],
    achievement: `${ROSTER[3].name} 참고: 물질의 규칙성 이해`,
  };
  const fetchImpl = fakeFetch(() => res(200, okBody(['이 학생은 실험 계획을 세움.', '결과를 비교하여 정리함.', '그래프 그리기를 도움.'])));
  const settings = defaultSettings();
  const out = await generateDrafts({
    record, studentName: me.name, roster: ROSTER, settings, apiKey: KEY, count: 3, fetchImpl,
  });
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.ok(!url.includes(KEY));
  assert.equal(init.headers['x-goog-api-key'], KEY);
  const sent = `${url}\n${init.body}`;
  for (const s of ROSTER) {
    assert.ok(!sent.includes(s.name), `이름 ${s.name} 이 요청에 있음`);
    assert.ok(!sent.includes(s.name.slice(1)), `이름 ${s.name.slice(1)} 이 요청에 있음`);
    assert.ok(!sent.includes(s.studentId), `학번 ${s.studentId} 이 요청에 있음`);
  }
  assert.ok(!/\d{5}/.test(init.body), '5자리 숫자가 없음');
  assert.ok(init.body.includes('실험 계획을 세움'), '메모 내용은 전달됨');
  assert.deepEqual(out, {
    drafts: ['실험 계획을 세움.', '결과를 비교하여 정리함.', '그래프 그리기를 도움.'],
    insufficient: false,
    model: settings.models[0],
  });
});

test('generateDrafts: fake 이면 fetch 를 부르지 않음', async () => {
  const fetchImpl = fakeFetch(() => { throw new Error('부르면 안 됨'); });
  const record = { ...newRecord('30501', 'club'), memo: '동아리 회의에서 활동 계획을 발표했다. 부원들과 역할을 나누었다.' };
  const out = await generateDrafts({ record, studentName: '김가온', roster: ROSTER, settings: defaultSettings(), count: 2, fetchImpl, fake: true, fakeDelayMs: 0 });
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(out.model, 'fake');
  assert.equal(out.drafts.length, 2);
  assert.equal(out.insufficient, false);
});

test('callGemini: 429 분당 한도면 다음 모델', async () => {
  const fetchImpl = fakeFetch([
    res(429, '{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel"}]}}'),
    res(200, okBody(['둘째 모델 답임.'])),
  ]);
  const out = await callGemini({ models: ['m1', 'm2', 'm3'], apiKey: KEY, prompt: PROMPT, fetchImpl });
  assert.equal(out.model, 'm2');
  assert.ok(out.text.includes('둘째 모델 답임.'));
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(fetchImpl.calls[0].url.includes('/m1:'));
  assert.ok(fetchImpl.calls[1].url.includes('/m2:'));
});

test('callGemini: 503 이면 다음 모델', async () => {
  const fetchImpl = fakeFetch([res(503, '{"error":{"status":"UNAVAILABLE","message":"The model is overloaded."}}'), res(200, okBody(['답임.']))]);
  const out = await callGemini({ models: ['m1', 'm2'], apiKey: KEY, prompt: PROMPT, fetchImpl });
  assert.equal(out.model, 'm2');
});

test('callGemini: 모두 실패하면 마지막 오류', async () => {
  const fetchImpl = fakeFetch([
    res(429, 'GenerateRequestsPerMinute'),
    res(503, 'overloaded'),
    res(429, '{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}'),
  ]);
  await assert.rejects(
    callGemini({ models: ['m1', 'm2', 'm3'], apiKey: KEY, prompt: PROMPT, fetchImpl }),
    (e) => e instanceof AiError && e.kind === 'quota-day' && e.model === 'm3' && e.userMessage.includes('내일'),
  );
  assert.equal(fetchImpl.calls.length, 3);
});

test('callGemini: 키 오류는 다음 모델로 넘어가지 않음, 키가 없으면 부르지 않음', async () => {
  const fetchImpl = fakeFetch([res(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}')]);
  await assert.rejects(callGemini({ models: ['m1', 'm2'], apiKey: KEY, prompt: PROMPT, fetchImpl }), (e) => e.kind === 'key');
  assert.equal(fetchImpl.calls.length, 1);
  const none = fakeFetch([]);
  await assert.rejects(callGemini({ models: ['m1'], apiKey: '', prompt: PROMPT, fetchImpl: none }), (e) => e.kind === 'key');
  assert.equal(none.calls.length, 0);
});

test('callGemini: 시간 제한', async () => {
  const hang = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  await assert.rejects(
    callGemini({ models: ['m1', 'm2'], apiKey: KEY, prompt: PROMPT, fetchImpl: hang, timeoutMs: 20 }),
    (e) => e instanceof AiError && e.kind === 'timeout',
  );
});

test('callGemini: 외부 signal 로 중단', async () => {
  const hang = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 10);
  await assert.rejects(
    callGemini({ models: ['m1'], apiKey: KEY, prompt: PROMPT, fetchImpl: hang, timeoutMs: 5000, signal: ctl.signal }),
    (e) => e.kind === 'aborted',
  );
});

test('callGemini: 네트워크 오류', async () => {
  const fetchImpl = fakeFetch([new TypeError('Failed to fetch')]);
  await assert.rejects(callGemini({ models: ['m1', 'm2'], apiKey: KEY, prompt: PROMPT, fetchImpl }), (e) => e.kind === 'network');
});

test('classifyError: 상태와 본문으로 분류, 쉬운 한국어 안내', () => {
  assert.equal(classifyError(400, 'API key not valid').kind, 'key');
  assert.equal(classifyError(400, '{"reason":"API_KEY_INVALID"}').kind, 'key');
  assert.equal(classifyError(401, '').kind, 'key');
  assert.equal(classifyError(403, 'PERMISSION_DENIED').kind, 'key');
  assert.equal(classifyError(404, 'models/x is not found').kind, 'model');
  const minute = classifyError(429, 'GenerateRequestsPerMinutePerProjectPerModel');
  assert.equal(minute.kind, 'quota-minute');
  assert.match(minute.userMessage, /1분쯤 기다렸다가 다시/);
  const day = classifyError(429, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier');
  assert.equal(day.kind, 'quota-day');
  assert.match(day.userMessage, /오늘 쓸 수 있는 양을 다 썼어요/);
  assert.match(day.userMessage, /내일 다시/);
  assert.match(day.userMessage, /설정에서 다른 모델/);
  assert.equal(classifyError(429, 'You exceeded your daily quota').kind, 'quota-day');
  assert.equal(classifyError(429, 'limit per day').kind, 'quota-day');
  assert.equal(classifyError(500, '').kind, 'busy');
  assert.equal(classifyError(503, '').kind, 'busy');
  assert.equal(classifyError(200, 'UNAVAILABLE').kind, 'busy');
  assert.equal(classifyError(429, 'overloaded').kind, 'quota-minute');
  assert.equal(classifyError(418, 'teapot').kind, 'unknown');
  const e = classifyError(503, 'x');
  assert.ok(e instanceof AiError && e instanceof Error);
  assert.equal(e.status, 503);
});

test('readGeminiText: 여러 part 합치기, 차단 감지', () => {
  assert.equal(readGeminiText({ candidates: [{ content: { parts: [{ text: '{"dr' }, { text: 'afts":[]}' }] } }] }), '{"drafts":[]}');
  assert.equal(readGeminiText({ candidates: [{ content: { parts: [{ text: '생각', thought: true }, { text: '답' }] } }] }), '답');
  assert.throws(() => readGeminiText({ promptFeedback: { blockReason: 'SAFETY' } }), (e) => e.kind === 'blocked');
  assert.throws(() => readGeminiText({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }), (e) => e.kind === 'blocked');
  assert.throws(() => readGeminiText({ candidates: [] }), (e) => e.kind === 'parse');
});

test('callGemini: 200 이지만 차단된 응답은 blocked', async () => {
  const fetchImpl = fakeFetch([res(200, JSON.stringify({ promptFeedback: { blockReason: 'OTHER' } }))]);
  await assert.rejects(callGemini({ models: ['m1', 'm2'], apiKey: KEY, prompt: PROMPT, fetchImpl }), (e) => e.kind === 'blocked');
  assert.equal(fetchImpl.calls.length, 1);
});
