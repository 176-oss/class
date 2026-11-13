// 가짜 AI (개발용). 실제 호출 없이 프롬프트의 메모 부분을 읽어 명사형 문장 JSON 을 돌려준다.
// 결정적: 같은 입력이면 같은 출력. 후보끼리는 문장 순서와 마무리 문장이 다르다.

import { INSUFFICIENT_TEXT, extractMemo, extractCount, extractRefine } from './prompt.js';
import { STYLE_SUMMARY_MARK, EXAMPLE_OPEN, EXAMPLE_CLOSE } from './style.js';

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

function splitSentences(text) {
  return String(text ?? '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
}

/** 스타일 정리: 예시의 평균 문장 길이와 끝말을 보고 정해진 모양의 규칙을 만든다 */
function fakeStyleRules(user) {
  const s = String(user);
  const a = s.indexOf(EXAMPLE_OPEN);
  const b = s.lastIndexOf(EXAMPLE_CLOSE);
  const body = a >= 0 && b > a ? s.slice(a + EXAMPLE_OPEN.length, b) : '';
  const sentences = body.split(/\n---\n/).flatMap(splitSentences);
  const avg = sentences.length ? sentences.reduce((n, x) => n + x.length, 0) / sentences.length : 40;
  const nounEnd = sentences.filter((x) => /[함임됨음][.]?$/.test(x)).length;
  return [
    `한 문장은 ${Math.max(20, Math.round(avg / 5) * 5)}자 안팎으로 씀`,
    nounEnd >= sentences.length / 2 ? '문장은 ~함, ~임 같은 명사형으로 끝냄' : '문장 끝말을 명사형으로 맞춤',
    '활동, 과정, 변화 순서로 씀',
    '평가하는 말은 마지막 문장에 한 번만 씀',
    '구체적인 행동을 나타내는 말을 앞에 둠',
  ];
}

const PRAISE = /(?:매우|아주|무척|탁월한|탁월하게|뛰어난|뛰어나게|훌륭한|훌륭하게|우수한|남다른)\s*/g;

/** 다듬기: 요청 말에 따라 정해진 방식으로 바꾼다. 메모에 없는 사실은 더하지 않는다 */
function fakeRefine(text, request, memo) {
  const sentences = splitSentences(text);
  const req = String(request);
  let out;
  if (req.includes('짧게')) out = sentences.slice(0, Math.max(1, Math.ceil(sentences.length * 0.6))).join(' ');
  else if (req.includes('자세히')) {
    const extra = memo.split(/\r?\n|[.!?](?=\s|$)/).map(toNounEnding).filter((x) => x && !text.includes(x.slice(0, -1)));
    out = [...sentences, extra[0] || '활동 과정을 차근차근 이어감.'].join(' ');
  } else if (req.includes('나누')) {
    // '보이며 ' -> '보임. ' (받침 없는 글자에 받침 ㅁ을 붙임)
    out = text.replace(/([가-힣])며,?\s+/g, (m, ch) => ((ch.charCodeAt(0) - 0xac00) % 28 === 0 ? `${String.fromCharCode(ch.charCodeAt(0) + 16)}. ` : m));
  }
  else if (req.includes('평가어')) out = text.replace(PRAISE, '');
  else out = sentences.length > 1 ? [...sentences.slice(1), sentences[0]].join(' ') : text;
  return out.trim() === String(text).trim() ? `${String(text).trim()} 맡은 일을 끝까지 해냄.` : out;
}

/**
 * 프롬프트 종류: 스타일 정리(STYLE_SUMMARY_MARK) -> {"rules"}, 다듬기(REFINE_MARK) -> {"drafts": [1개]}, 그 밖 -> 초안.
 * @param {{system: string, user: string}} prompt
 * @param {{delayMs?: number, signal?: AbortSignal}} [opts]
 * @returns {Promise<{ text: string, model: 'fake' }>}
 */
/** [도달한 성취기준] 줄마다 '...수준에 도달함.' 문장 하나 (코드와 '할 수 있다'는 뺀다) */
function fakeReached(user) {
  const s = String(user ?? '');
  const head = '[도달한 성취기준]\n';
  const a = s.indexOf(head);
  if (a < 0) return [];
  const b = s.indexOf('\n교사가 이 학생이', a);
  return s.slice(a + head.length, b < 0 ? undefined : b).split('\n')
    .map((l) => l.replace(/^\[[^\]]+\]\s*/, '').replace(/\s*(할|될) 수 있다\.?$|\.$/, '').trim())
    .filter(Boolean).map((t) => `수업 활동을 통해 ${t} 수준에 도달함.`);
}

export async function fakeGenerate(prompt, { delayMs = 300, signal } = {}) {
  await sleep(delayMs, signal);
  const user = typeof prompt === 'string' ? prompt : prompt?.user;
  if (String(user ?? '').includes(STYLE_SUMMARY_MARK)) return { text: JSON.stringify({ rules: fakeStyleRules(user) }), model: 'fake' };
  const refine = extractRefine(user);
  if (refine) return { text: JSON.stringify({ drafts: [fakeRefine(refine.text, refine.request, extractMemo(user))] }), model: 'fake' };
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
  const reached = fakeReached(user);
  const drafts = [];
  for (let i = 0; i < count; i += 1) {
    const k = sentences.length ? i % sentences.length : 0;
    const order = i % 2 === 1
      ? [...sentences].reverse()
      : [...sentences.slice(k), ...sentences.slice(0, k)];
    const closing = CLOSINGS[(seed + i) % CLOSINGS.length];
    drafts.push([...order, ...reached, closing].join(' '));
  }
  return { text: JSON.stringify({ drafts }), model: 'fake' };
}
