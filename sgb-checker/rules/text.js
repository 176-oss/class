// 글 형식 점검: 명사형 어미, 관찰자 시점, 마침표, 공백, 문단 구분 기호, NEIS 깨짐 문자, 날짜, 과장 표현.
// 순수 함수. 지적 하나 = { ruleId, level, start, end, reason, fix?, needsConfirm? } (basis와 text는 check.js가 붙임)
// 장식 기호는 소스에 직접 쓰지 않고 \u 이스케이프로 적는다.

const H_BASE = 0xac00;
const isSyl = (c) => c >= 0xac00 && c <= 0xd7a3;
const jongOf = (ch) => { const c = ch.codePointAt(0); return isSyl(c) ? (c - H_BASE) % 28 : -1; };
const withJong = (ch, j) => { const c = ch.codePointAt(0); return String.fromCodePoint(c - ((c - H_BASE) % 28) + j); };
const J_N = 4, J_M = 16, J_B = 17; // ㄴ, ㅁ, ㅂ 받침

/** 문장 나누기: 마침표·물음표·느낌표 뒤 공백(또는 끝), 줄바꿈. [{start, end}] (end는 문장부호 포함) */
export function splitSentences(text) {
  const out = [];
  let s = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') { push(s, i); s = i + 1; continue; }
    if ((ch === '.' || ch === '?' || ch === '!') && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      push(s, i + 1); s = i + 1;
    }
  }
  push(s, text.length);
  function push(a, b) {
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b > a) out.push({ start: a, end: b });
  }
  return out;
}

/** 문장 끝의 문장부호·닫는 괄호·괄호 덩어리를 걷어 낸 본문 끝 위치 */
function coreEnd(text, start, end) {
  let e = end;
  for (;;) {
    const before = e;
    while (e > start && /[\s.!?'"\u2018\u2019\u201C\u201D\]]/.test(text[e - 1])) e--;
    if (e > start && text[e - 1] === ')') {
      let depth = 0, k = e - 1;
      for (; k >= start; k--) { if (text[k] === ')') depth++; else if (text[k] === '(' && --depth === 0) break; }
      if (k >= start) e = k;
    }
    if (e === before) return e;
  }
}

/** 명사형으로 바꾼 끝말. 모르는 꼴이면 null. word는 문장 끝 어절 */
export function toNounEnding(word) {
  const rules = [
    [/(하였|했)(습니다|다)$/, '함'], [/(합니다|한다|하다)$/, '함'],
    [/(되었|됐)(습니다|다)$/, '됨'], [/(됩니다|된다|되다)$/, '됨'],
    [/(입니다|이다)$/, '임'],
  ];
  for (const [re, rep] of rules) if (re.test(word)) return word.replace(re, rep);
  let m = word.match(/^(.*)(.)습니다$/);
  if (m) return m[1] + m[2] + '음';
  m = word.match(/^(.*)(.)니다$/);
  if (m && jongOf(m[2]) === J_B) return m[1] + withJong(m[2], J_M);
  m = word.match(/^(.*)는다$/);
  if (m && m[1]) return m[1] + '음';
  m = word.match(/^(.*)(.)다$/);
  if (m && jongOf(m[2]) === J_N) return m[1] + withJong(m[2], J_M);
  if (m && jongOf(m[2]) === 0) return m[1] + withJong(m[2], J_M);
  if (m && jongOf(m[2]) > 0) return m[1] + m[2] + '음';
  return null;
}

function checkEndings(text, out) {
  for (const { start, end } of splitSentences(text)) {
    if (CLUB_INTRO.test(text.slice(start, end))) continue; // (위드유: 자율동아리) 소개 글 (중 79, 고 84 예시)
    const ce = coreEnd(text, start, end);
    if (ce <= start) continue; // 괄호 머리말만 있는 줄 등
    const last = text[ce - 1];
    if (!isSyl(last.codePointAt(0))) continue; // 숫자·영문으로 끝남
    if (jongOf(last) === J_M || jongOf(last) === 10) continue; // ~함, ~음, ~임, ~됨, 만듦·앎(ㄻ)
    let ws = ce;
    while (ws > start && !/\s/.test(text[ws - 1])) ws--;
    const word = text.slice(ws, ce);
    if (/(다|요|니까|까|죠|네|어|아|지|라|자)$/.test(word)) {
      const fixed = toNounEnding(word);
      const ending = (word.match(/(습니다|니다|다|요|니까|까|죠|네|어|아|지|라|자)$/) || [''])[0];
      out.push({
        ruleId: 'ending', level: 'error', start: ws, end: ce,
        reason: `문장이 '~${ending}'로 끝남. 서술형 문장은 명사형 어미(~함, ~음, ~임)로 끝냄`,
        ...(fixed && fixed !== word ? { fix: fixed } : {}),
      });
    } else {
      out.push({ ruleId: 'ending-noun', level: 'warn', start: ws, end: ce, reason: '명사로 끝남. 명사형 어미(~함, ~음, ~임)로 끝나는 문장인지 확인' });
    }
  }
}

const B = '(?<![가-힣A-Za-z0-9])';
const CLUB_INTRO = /^\s*\([^()\n]*:\s*자율동아리\)/;
const FIRST_PERSON = new RegExp(`${B}(나는|내가|저는|제가|본인은|본인이|본인의|필자는|필자가)(?![가-힣])`, 'g');
const WE = new RegExp(`${B}(우리는|우리가|나의|저의)(?![가-힣])`, 'g'); // '나의 꿈' 같은 제목도 있어 확인으로
const HIS = new RegExp(`${B}그의(?![가-힣])`, 'g');
const PRONOUN = new RegExp(`${B}(그는|그가|그녀는|그녀가|그녀의)(?![가-힣])`, 'g');
const TEACHER_WORD = new RegExp(`${B}(교사는|교사가|담임교사는|담임교사가|담임은|담임이|본 교사|본교사)`, 'g');
const TEACHER_VERB = /(지도함|지도하였음|칭찬함|칭찬하였음|격려함|격려하였음|조언함|조언하였음|권유함|권유하였음|당부함|당부하였음)$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function checkViewpoint(text, names, out) {
  for (const m of text.matchAll(FIRST_PERSON)) out.push({ ruleId: 'viewpoint-first', level: 'error', start: m.index, end: m.index + m[0].length, reason: '1인칭 표현. 교사가 관찰한 시점(관찰자 시점)으로 씀' });
  for (const m of text.matchAll(WE)) out.push({ ruleId: 'viewpoint-first', level: 'warn', start: m.index, end: m.index + m[0].length, reason: '학생 자신을 가리키는 말이면 관찰자 시점으로 바꿈 (활동 제목이나 인용이면 그대로 둠)' });
  for (const m of text.matchAll(HIS)) out.push({ ruleId: 'viewpoint-pronoun', level: 'warn', start: m.index, end: m.index + m[0].length, reason: "'그의'가 학생을 가리키면 쓰지 않음 (다른 인물이면 그대로 둠)" });
  for (const m of text.matchAll(PRONOUN)) out.push({ ruleId: 'viewpoint-pronoun', level: 'error', start: m.index, end: m.index + m[0].length, reason: '학생을 가리키는 대명사(그, 그녀)는 쓰지 않음' });
  for (const m of text.matchAll(TEACHER_WORD)) out.push({ ruleId: 'viewpoint-teacher', level: 'warn', start: m.index, end: m.index + m[0].length, reason: '교사가 주어인 문장. 학생의 모습이 드러나게 쓰는지 확인' });
  for (const { start, end } of splitSentences(text)) {
    const ce = coreEnd(text, start, end);
    const m = text.slice(start, ce).match(TEACHER_VERB);
    if (m) out.push({ ruleId: 'viewpoint-teacher', level: 'warn', start: ce - m[0].length, end: ce, reason: '교사의 행위로 끝나는 문장. 학생의 행동·변화로 쓰는지 확인' });
  }
  const seen = new Set();
  for (const full of names || []) {
    const n = String(full || '').trim();
    if (n.length < 2 || seen.has(n)) continue;
    seen.add(n);
    const forms = [new RegExp(`${esc(n)}`, 'g')];
    if (n.length === 3) forms.push(new RegExp(`${B}${esc(n.slice(1))}(?:(이는|이가|이의|이를|이도|이와|이랑|이에게|이|은|는|가|의|를|과|와|도|에게)(?![가-힣])| 학생)`, 'g'));
    for (const re of forms) for (const m of text.matchAll(re)) {
      out.push({ ruleId: 'viewpoint-name', level: 'error', start: m.index, end: m.index + m[0].length, reason: '학생 이름이나 호칭은 쓰지 않음' });
    }
  }
}

function checkLines(text, out) {
  let pos = 0;
  for (const line of text.split('\n')) {
    const ls = pos;
    pos += line.length + 1;
    const t = line.replace(/\s+$/, '');
    if (!t.trim()) continue;
    const bullet = line.match(/^[ \t]*(?:[\u2460-\u2473\u2776-\u277F]|\(\d{1,2}\)|\d{1,2}[.)](?!\d)|[가-하][.)]|\[\d{1,2}\]|[-\u2013\u2014·\u2022\u25B6\u25B7\u25BA\u25A0\u25A1\u25C6\u25C7\u25CB\u25CF\u25CE※*>\u261E\u2605\u2606\u2713\u2714])[ \t]*/);
    if (bullet) out.push({ ruleId: 'bullet', level: 'error', start: ls, end: ls + bullet[0].length, reason: '번호나 기호로 문단을 나누지 않음', fix: '' });
    const lead = line.match(/^[ \t]+/);
    if (lead && !bullet) out.push({ ruleId: 'space-edge', level: 'warn', start: ls, end: ls + lead[0].length, reason: '줄 앞 공백', fix: '' });
    if (t.length < line.length) out.push({ ruleId: 'space-edge', level: 'warn', start: ls + t.length, end: ls + line.length, reason: '줄 끝 공백', fix: '' });
    const core = t.replace(/\([^()]*\)/g, '').trim();
    if (core && !CLUB_INTRO.test(t) && !/[.]$/.test(t)) {
      const e = ls + t.length;
      out.push({ ruleId: 'period', level: 'error', start: e, end: e, reason: '문장 끝에 마침표가 없음', fix: '.' });
    }
  }
  for (const m of text.matchAll(/ {2,}/g)) {
    out.push({ ruleId: 'space-double', level: 'error', start: m.index, end: m.index + m[0].length, reason: '띄어쓰기가 두 칸 이상', fix: ' ' });
  }
  for (const m of text.matchAll(/[\u2605\u2606\u2665\u2661\u25C6\u25C7\u25A0\u25A1\u25B6\u25B7\u25BA\u25CF\u25CB\u25CE※\u261E\u2713\u2714\u2190-\u21FF\u266A\u266C]/g)) {
    out.push({ ruleId: 'special-char', level: 'warn', start: m.index, end: m.index + 1, reason: '서술형 항목에는 특수문자를 쓰지 않음' });
  }
}

const NEIS_FIX = [
  [/[\u2018\u2019‚′]/g, "'"], [/[\u201C\u201D„″]/g, '"'], [/\u2026/g, '...'],
  [/[\u00A0 -   \u3000\t]/g, ' '], [/[\u200B-‍⁠\uFEFF️]/g, ''],
  [/～/g, '~'], [/\p{Extended_Pictographic}/gu, ''],
];
function checkNeisChars(text, out) {
  for (const [re, rep] of NEIS_FIX) for (const m of text.matchAll(re)) {
    out.push({ ruleId: 'neis-char', level: 'warn', start: m.index, end: m.index + m[0].length, reason: 'NEIS에서 깨지거나 다르게 보일 수 있는 문자', fix: rep });
  }
}

// 날짜: 하루 2026.03.04. / 기간 2026.03.04.-2026.07.08. (중 77, 고 82)
const DATE = /(?<![\d.])(\d{4})\s*(?:\.|-|\/|년)\s*(\d{1,2})\s*(?:\.|-|\/|월)\s*(\d{1,2})(?!\d)(?:\s*일|\.)?/g;
const NOYEAR = /(?<!\d)(\d{1,2})월\s*(\d{1,2})일/g;
const p2 = (n) => String(n).padStart(2, '0');
const okMD = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

function checkDates(text, schoolYear, out) {
  const found = [];
  for (const m of text.matchAll(DATE)) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (!okMD(mo, d)) continue;
    found.push({ start: m.index, end: m.index + m[0].length, canon: `${y}.${p2(mo)}.${p2(d)}.` });
  }
  for (const m of text.matchAll(NOYEAR)) {
    const [mo, d] = [+m[1], +m[2]];
    if (!okMD(mo, d) || found.some((f) => m.index >= f.start && m.index < f.end)) continue;
    const y = Number(schoolYear) || new Date().getFullYear();
    const yy = mo <= 2 ? y + 1 : y; // 1~2월은 학년도 다음 해
    found.push({ start: m.index, end: m.index + m[0].length, canon: `${yy}.${p2(mo)}.${p2(d)}.`, noYear: true });
  }
  found.sort((a, b) => a.start - b.start);
  for (let i = 0; i < found.length; i++) {
    const a = found[i], b = found[i + 1];
    const gap = b ? text.slice(a.end, b.start) : null;
    if (b && /^\s*[~〜∼\-\u2013]\s*$/.test(gap)) {
      const canon = `${a.canon}-${b.canon}`;
      if (text.slice(a.start, b.end) !== canon) out.push(dateIssue(a.start, b.end, canon, a.noYear || b.noYear, '기간은 2026.03.04.-2026.07.08.처럼 씀'));
      i++;
      continue;
    }
    let end = a.end;
    let canon = a.canon;
    if (text[end] === '.' && text.slice(a.start, end).endsWith('.')) { end++; } // 2026.03.04..
    if (text.slice(a.start, end) !== canon) out.push(dateIssue(a.start, end, canon, a.noYear, '날짜는 2026.03.04.처럼 씀'));
  }
}
function dateIssue(start, end, fix, noYear, reason) {
  return {
    ruleId: 'date-format', level: 'warn', start, end, fix,
    reason: noYear ? `${reason}. 연도가 없어 학년도를 붙였으니 맞는지 확인` : reason,
    ...(noYear ? { needsConfirm: true } : {}),
  };
}

// 과장 표현 (중 19, 고 19). '확인'으로만 표시
export const EXAGGERATIONS = ['탁월', '완벽', '최고', '최상', '천재', '독보적', '압도적', '모든 면에서', '누구보다', '항상', '전혀'];
function checkExaggeration(text, out) {
  for (const w of EXAGGERATIONS) {
    let i = text.indexOf(w);
    while (i >= 0) {
      out.push({ ruleId: 'exaggeration', level: 'warn', start: i, end: i + w.length, reason: '근거 없이 쓰기 쉬운 과장 표현. 글에 근거가 되는 활동이 있는지 확인' });
      i = text.indexOf(w, i + w.length);
    }
  }
}

/** ctx: { names, schoolYear } */
export function checkFormat(text, ctx = {}) {
  const out = [];
  checkEndings(text, out);
  checkViewpoint(text, ctx.names, out);
  checkLines(text, out);
  checkNeisChars(text, out);
  checkDates(text, ctx.schoolYear, out);
  checkExaggeration(text, out);
  return out;
}
