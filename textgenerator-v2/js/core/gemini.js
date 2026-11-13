// Gemini 호출, 모델 자동 전환, 오류 분류. 순수 모듈 (fetch 는 주입 가능).
// API 키는 URL 이 아니라 x-goog-api-key 헤더로 보낸다.

import { AiError } from './ai-error.js';
import { scrubMemo, buildPrompt, buildRefinePrompt, parseResponse, tidyDraft, MAX_DRAFTS } from './prompt.js';
import { maskExample, buildStyleSummaryPrompt, parseStyleRules } from './style.js';
import { fakeGenerate } from './fake-ai.js';
import { buildCheckPrompt, parseCheckResponse, toCheckIssues, fakeCheck } from './ai-check.js';
import { DEFAULT_MODELS, DEFAULT_LIMITS } from './model.js';

export { AiError, AI_USER_MESSAGES } from './ai-error.js';

export const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_TIMEOUT_MS = 35000;

const SWITCH_KINDS = new Set(['quota-minute', 'quota-day', 'busy', 'model']);
const BLOCK_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'OTHER']);

function cleanModelName(model) {
  return String(model ?? '').trim().replace(/^models\//, '');
}

/** 요청 만들기. 키는 headers['x-goog-api-key'], URL 에는 없음 */
export function buildRequest({ model, apiKey, prompt, temperature = 0.7 }) {
  const url = `${API_BASE}/${encodeURIComponent(cleanModelName(model))}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: String(prompt?.system ?? '') }] },
    contents: [{ role: 'user', parts: [{ text: String(prompt?.user ?? '') }] }],
    generationConfig: { responseMimeType: 'application/json', temperature },
  };
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': String(apiKey ?? '') },
    body: JSON.stringify(body),
  };
  return { url, init };
}

/** HTTP 상태와 본문으로 오류 분류 */
export function classifyError(status, bodyText) {
  const body = String(bodyText ?? '');
  const short = body.slice(0, 300);
  const msg = `Gemini HTTP ${status}: ${short}`;
  const extra = { status };
  if (status === 400 && /api[\s_-]?key/i.test(body)) return new AiError('key', msg, extra);
  if (status === 401 || status === 403) return new AiError('key', msg, extra);
  if (status === 404) return new AiError('model', msg, extra);
  if (status === 429) {
    if (/perday|per day|daily/i.test(body)) return new AiError('quota-day', msg, extra);
    return new AiError('quota-minute', msg, extra);
  }
  if (status === 500 || status === 502 || status === 503 || status === 504 || /overloaded|UNAVAILABLE/i.test(body)) {
    return new AiError('busy', msg, extra);
  }
  if (status === 400 && /model|not found|not supported/i.test(body)) return new AiError('model', msg, extra);
  return new AiError('unknown', msg, extra);
}

/** 성공 응답 JSON 에서 글 꺼내기 */
export function readGeminiText(data) {
  if (!data || typeof data !== 'object') throw new AiError('parse', '응답이 JSON 객체가 아님');
  const block = data.promptFeedback?.blockReason;
  if (block) throw new AiError('blocked', `promptFeedback.blockReason=${block}`);
  const cand = Array.isArray(data.candidates) ? data.candidates[0] : null;
  if (!cand) throw new AiError('parse', 'candidates 가 비어 있음');
  const parts = Array.isArray(cand.content?.parts) ? cand.content.parts : [];
  const text = parts
    .filter((p) => p && typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  if (BLOCK_REASONS.has(cand.finishReason) && (cand.finishReason === 'SAFETY' || !text.trim())) {
    throw new AiError('blocked', `finishReason=${cand.finishReason}`);
  }
  if (!text.trim()) throw new AiError('parse', '응답 글이 비어 있음');
  return text;
}

async function callOnce({ model, apiKey, prompt, fetchImpl, timeoutMs, signal }) {
  const { url, init } = buildRequest({ model, apiKey, prompt });
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw new AiError('aborted', '시작 전에 멈춤', { model });
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    let res;
    let bodyText;
    try {
      res = await fetchImpl(url, { ...init, signal: controller.signal });
      bodyText = await res.text();
    } catch (err) {
      if (timedOut) throw new AiError('timeout', `${timeoutMs}ms 안에 답이 없음`, { model });
      if (signal?.aborted) throw new AiError('aborted', '사용자가 멈춤', { model });
      throw new AiError('network', `네트워크 오류: ${err?.message || err}`, { model });
    }
    if (!res.ok) {
      const e = classifyError(res.status, bodyText);
      e.model = model;
      throw e;
    }
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      throw new AiError('parse', '응답 본문이 JSON 이 아님', { model });
    }
    return readGeminiText(data);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * 모델 목록 순서대로 시도. quota-minute/quota-day/busy/model 오류면 다음 모델.
 * 다 실패하면 마지막 AiError 를 던짐.
 * @returns {Promise<{ text: string, model: string }>}
 */
export async function callGemini({ models, apiKey, prompt, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  if (!apiKey || !String(apiKey).trim()) throw new AiError('key', 'API 키가 없음');
  const list = (Array.isArray(models) && models.length ? models : DEFAULT_MODELS).map(cleanModelName).filter(Boolean);
  if (typeof fetchImpl !== 'function') throw new AiError('network', 'fetch 를 쓸 수 없음');
  let lastErr = null;
  for (const model of list) {
    try {
      const text = await callOnce({ model, apiKey, prompt, fetchImpl, timeoutMs, signal });
      return { text, model };
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError('unknown', String(err?.message || err));
      if (!e.model) e.model = model;
      lastErr = e;
      if (!SWITCH_KINDS.has(e.kind)) throw e;
    }
  }
  throw lastErr || new AiError('model', '시도할 모델이 없음');
}

function containsIdentity(text, studentId, studentName) {
  const s = String(text);
  if (studentId && s.includes(String(studentId))) return true;
  const name = String(studentName ?? '').replace(/\s+/g, '');
  if (name.length >= 2 && s.includes(name)) return true;
  return false;
}

/**
 * 초안 만들기: scrubMemo, buildPrompt, (fake ? fakeGenerate : callGemini), parseResponse, tidyDraft.
 * studentName 은 scrubMemo 확인용으로만 쓰고 요청에 넣지 않는다.
 * @returns {Promise<{ drafts: string[], insufficient: boolean, model: string }>}
 */
export async function generateDrafts({
  record,
  studentName = '',
  roster = [],
  settings = {},
  apiKey,
  count = MAX_DRAFTS,
  fetchImpl,
  fake,
  achievement,
  signal,
  timeoutMs,
  fakeDelayMs,
  style = null,
} = {}) {
  if (!record) throw new AiError('unknown', 'record 가 없음');
  const people = peopleOf(roster, record, studentName);

  const area = record.area;
  const limit = settings?.limits?.[area] ?? DEFAULT_LIMITS.high[area];
  const memo = scrubMemo(record.memo, people);
  const ach = scrubMemo(record.achievement || achievement || '', people);
  const n = Math.max(1, Math.min(MAX_DRAFTS, Number(count) || 1));
  const prompt = buildPrompt({
    area,
    subject: record.subject,
    achievement: ach,
    achievementReached: !!record.achievementReached,
    events: (record.events || []).map((e) => scrubMemo(e, people)),
    request: scrubMemo(record.request || '', people),
    memo,
    traits: record.traits,
    length: record.length,
    limit,
    count: n,
    style: maskStyle(style, people),
  });

  // 마지막 확인: 이 학생의 학번과 전체 이름이 요청에 없어야 함
  if (containsIdentity(`${prompt.system}\n${prompt.user}`, record.studentId, studentName)) {
    throw new AiError('privacy', '요청에 학번이나 이름이 남아 있어 보내지 않음');
  }

  const result = await send(prompt, { settings, apiKey, fake, fetchImpl, timeoutMs, signal, fakeDelayMs });
  const parsed = parseResponse(result.text);
  const drafts = parsed.drafts.map(tidyDraft).filter(Boolean).slice(0, n);
  return { drafts, insufficient: parsed.insufficient, model: result.model };
}

function peopleOf(roster, record, studentName) {
  const people = Array.isArray(roster) ? [...roster] : [];
  if (studentName) people.push({ studentId: record?.studentId, name: studentName });
  return people;
}

/** 스타일 규칙·예시를 보내기 직전에 한 번 더 가림 (명단 이름, 학번, 반 번호) */
function maskStyle(style, people) {
  if (!style) return null;
  const names = people.map((p) => p?.name).filter(Boolean);
  const mask = (t) => maskExample(t, names).text;
  return { ...style, rules: (style.rules || []).map(mask), examples: (style.examples || []).map(mask) };
}

/** 가짜 AI 또는 Gemini 로 보냄 */
function send(prompt, { settings, apiKey, fake, fetchImpl, timeoutMs, signal, fakeDelayMs }) {
  const useFake = fake ?? Boolean(settings?.devFakeAI);
  return useFake
    ? fakeGenerate(prompt, { delayMs: fakeDelayMs ?? 300, signal })
    : callGemini({
      models: settings?.models,
      apiKey,
      prompt,
      fetchImpl: fetchImpl ?? globalThis.fetch,
      timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal,
    });
}

/**
 * 다듬기: 지금 후보 글, 요청, 메모, 스타일 규칙을 보내 새 글 하나를 받는다. 이름·학번은 보내지 않는다.
 * @returns {Promise<{ text: string, model: string }>}
 */
export async function refineDraft({
  record, text, request, studentName = '', roster = [], settings = {}, apiKey, style = null,
  fake, signal, fetchImpl, timeoutMs, fakeDelayMs,
} = {}) {
  if (!record) throw new AiError('unknown', 'record 가 없음');
  const people = peopleOf(roster, record, studentName);
  const area = record.area;
  const prompt = buildRefinePrompt({
    area,
    subject: record.subject,
    text: scrubMemo(text, people),
    request: scrubMemo(request, people),
    memo: scrubMemo(record.memo, people),
    style: maskStyle(style, people),
    limit: settings?.limits?.[area] ?? DEFAULT_LIMITS.high[area],
  });
  if (containsIdentity(`${prompt.system}\n${prompt.user}`, record.studentId, studentName)) {
    throw new AiError('privacy', '요청에 학번이나 이름이 남아 있어 보내지 않음');
  }
  const result = await send(prompt, { settings, apiKey, fake, fetchImpl, timeoutMs, signal, fakeDelayMs });
  const parsed = parseResponse(result.text);
  const out = parsed.drafts.map(tidyDraft).find(Boolean);
  if (!out) throw new AiError('parse', '다듬은 글이 비어 있음');
  return { text: out, model: result.model };
}

/**
 * 스타일 정리: 가린 예시를 보내 문체 규칙 목록을 받는다.
 * @returns {Promise<{ rules: string[], model: string }>}
 */
export async function summarizeStyle({
  examples = [], roster = [], settings = {}, apiKey, fake, signal, fetchImpl, timeoutMs, fakeDelayMs,
} = {}) {
  const people = peopleOf(roster);
  const names = people.map((p) => p?.name).filter(Boolean);
  const prompt = buildStyleSummaryPrompt((examples || []).map((e) => maskExample(e, names).text));
  const all = `${prompt.system}\n${prompt.user}`;
  if (people.some((p) => containsIdentity(all, p.studentId, p.name))) {
    throw new AiError('privacy', '요청에 학번이나 이름이 남아 있어 보내지 않음');
  }
  const result = await send(prompt, { settings, apiKey, fake, fetchImpl, timeoutMs, signal, fakeDelayMs });
  return { rules: parseStyleRules(result.text), model: result.model };
}

/**
 * 작성 표 AI 점검: 최종본(text)의 이름·학번·반 번호를 가리고 보낸 뒤 지적 목록으로.
 * @returns {Promise<Array<{ kind: 'ai', message, original, fix? }>>}
 */
export async function aiCheck({ record, text, studentName = '', roster = [], settings = {}, apiKey, fake, fetchImpl, signal, timeoutMs } = {}) {
  const people = peopleOf(roster, record, studentName);
  const sent = scrubMemo(text, people);
  const prompt = buildCheckPrompt({ text: sent, area: record?.area, subject: record?.subject, school: settings?.schoolLevel });
  if (containsIdentity(`${prompt.system}\n${prompt.user}`, record?.studentId, studentName)) {
    throw new AiError('privacy', '요청에 학번이나 이름이 남아 있어 보내지 않음');
  }
  const useFake = fake ?? Boolean(settings?.devFakeAI);
  const raw = useFake ? fakeCheck(sent) : (await callGemini({ models: settings?.models, apiKey, prompt, fetchImpl: fetchImpl ?? globalThis.fetch, timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS, signal })).text;
  return toCheckIssues(parseCheckResponse(raw, sent), text);
}
