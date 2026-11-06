// 가짜 AI (개발용). 실제 호출 없이 프롬프트의 메모 부분을 읽어 명사형 문장 JSON 을 돌려준다.
// 결정적: 같은 입력이면 같은 출력. 후보끼리는 문장 순서와 마무리 문장이 다르다.

import { INSUFFICIENT_TEXT, extractMemo, extractCount } from './prompt.js';

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (!ms || ms <= 0) { resolve(); return; }
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

// 끝말 바꾸기 표 (긴 것부터 검사)
const ENDINGS = [
  [/하였습니다$/, '함'], [/했습니다$/, '함'], [/합니다$/, '함'],
  [/하였다$/, '함'], [/했다$/, '함'], [/했음$/, '함'], [/한다$/, '함'], [/하다$/, '함'],
  [/되었다$/, '됨'], [/됐다$/, '됨'], [/된다$/, '됨'],
  [/보였다$/, '보임'], [/보인다$/, '보임'],
  [/였다$/, '였음'], [/었다$/, '었음'], [/았다$/, '았음'],
  [/있다$/, '있음'], [/없다$/, '없음'], [/이다$/, '임'], [/이었다$/, '이었음'],
  [/냈다$/, '냄'], [/났다$/, '남'], [/왔다$/, '옴'], [/줬다$/, '줌'], [/웠다$/, '움'],
];

function hasFinalM(ch) {
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 === 16; // 받침 ㅁ
}

/** 한 조각을 명사형 문장으로 */
export function toNounEnding(fragment) {
  let s = String(fragment).trim().replace(/[.!?]+$/, '').trim();
  if (!s) return '';
  for (const [re, rep] of ENDINGS) {
    if (re.test(s)) return `${s.replace(re, rep)}.`;
  }
  if (/다$/.test(s)) return `${s.slice(0, -1)}음.`;
  const last = s[s.length - 1];
  if (hasFinalM(last)) return `${s}.`;
  return `${s} 활동을 함.`;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const CLOSINGS = [
  '활동 과정에서 맡은 일을 끝까지 해내는 모습이 드러남.',
  '이 경험을 통해 스스로 돌아보고 고쳐 나가는 태도를 보임.',
  '주어진 과제에 성실하게 참여하는 자세가 꾸준히 관찰됨.',
  '함께하는 사람들과 생각을 나누며 활동을 이어감.',
];

/**
 * @param {{system: string, user: string}} prompt
 * @param {{delayMs?: number, signal?: AbortSignal}} [opts]
 * @returns {Promise<{ text: string, model: 'fake' }>}
 */
export async function fakeGenerate(prompt, { delayMs = 300, signal } = {}) {
  await sleep(delayMs, signal);
  const user = typeof prompt === 'string' ? prompt : prompt?.user;
  const memo = extractMemo(user);
  const count = extractCount(user);
  if (memo.includes('부족') || memo.replace(/\s+/g, '').length < 10) {
    return { text: JSON.stringify({ drafts: [INSUFFICIENT_TEXT] }), model: 'fake' };
  }
  const sentences = memo
    .split(/\r?\n|[.!?](?=\s|$)|;|,\s+|\/|\s-\s/)
    .map(toNounEnding)
    .filter(Boolean);
  const seed = hashString(memo);
  const drafts = [];
  for (let i = 0; i < count; i += 1) {
    const k = sentences.length ? i % sentences.length : 0;
    const order = i % 2 === 1
      ? [...sentences].reverse()
      : [...sentences.slice(k), ...sentences.slice(0, k)];
    const closing = CLOSINGS[(seed + i) % CLOSINGS.length];
    drafts.push(`${order.join(' ')} ${closing}`);
  }
  return { text: JSON.stringify({ drafts }), model: 'fake' };
}
