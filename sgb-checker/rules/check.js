// 점검 입구. 순수 모듈 (DOM 없음). 작성 도우미도 복사해 쓸 수 있게 DOM·저장소에 의존하지 않는다.
import data from './data/forbidden.json' with { type: 'json' };
import { byteLength } from './bytes.js';
import { checkFormat, splitSentences } from './text.js';
import { findForbidden } from './forbidden.js';
import { commonSubjectBase, LIMIT_BASIS } from './areas.js';
import { checkEvents, EVENT_AREAS } from './events.js';

export const FORBIDDEN = data.entries;

// 규칙 id -> 이름, 근거 (학교급별)
export const RULES = {
  'bytes-over': { label: '바이트 초과', basis: LIMIT_BASIS },
  'bytes-near': { label: '한도에 가까움', basis: LIMIT_BASIS },
  ending: { label: '명사형 어미 아님', basis: { mid: '중 30', high: '고 30' } },
  'ending-noun': { label: '명사로 끝남', basis: { mid: '중 30', high: '고 30' } },
  'viewpoint-first': { label: '1인칭', basis: { mid: '선생님 기준', high: '선생님 기준' } },
  'viewpoint-pronoun': { label: '대명사', basis: { mid: '선생님 기준', high: '선생님 기준' } },
  'viewpoint-teacher': { label: '교사 주어', basis: { mid: '선생님 기준', high: '선생님 기준' } },
  'viewpoint-name': { label: '학생 이름·호칭', basis: { mid: '선생님 기준', high: '선생님 기준' } },
  period: { label: '마침표 없음', basis: { mid: '선생님 기준', high: '선생님 기준' } },
  'space-double': { label: '두 칸 띄어쓰기', basis: { mid: '선생님 기준', high: '선생님 기준' } },
  'space-edge': { label: '줄 앞뒤 공백', basis: { mid: '선생님 기준', high: '선생님 기준' } },
  bullet: { label: '번호·기호 문단 구분', basis: { mid: '중 30', high: '고 30' } },
  'special-char': { label: '특수문자', basis: { mid: '중 30', high: '고 30' } },
  'neis-char': { label: 'NEIS 깨짐 문자', basis: { mid: 'NEIS 입력', high: 'NEIS 입력' } },
  'date-format': { label: '날짜 형식', basis: { mid: '중 77', high: '고 82' } },
  'event-date': { label: '행사 날짜가 목록과 다름', basis: { mid: '학교 행사 목록', high: '학교 행사 목록' } },
  'event-name': { label: '행사 이름이 목록과 다름', basis: { mid: '학교 행사 목록', high: '학교 행사 목록' } },
  'event-unknown': { label: '목록에 없는 행사 날짜', basis: { mid: '학교 행사 목록', high: '학교 행사 목록' } },
  'event-no-date': { label: '행사 날짜 빠짐', basis: { mid: '중 77', high: '고 82' } },
  exaggeration: { label: '과장 표현', basis: { mid: '중 19', high: '고 19' } },
  'grade3-autonomy': { label: '3학년 영역 이름', basis: { mid: '중 162', high: '고 208' } },
  'club-name-repeat': { label: '동아리명 반복', basis: { mid: '중 79', high: '고 84' } },
  'club-intro-length': { label: '자율동아리 소개 30자 초과', basis: { mid: '중 79', high: '고 84' } },
  'behavior-negative': { label: '성장 관점 확인', basis: { mid: '중 115', high: '고 158' } },
  similar: { label: '다른 학생과 90% 이상 비슷함', basis: { mid: '중 77', high: '고 82' } },
  'repeat-sentence': { label: '반복 문장 (3명 이상)', basis: { mid: '중 77', high: '고 82' } },
  'common-sum': { label: '공통과목 1·2 합산 초과', basis: { high: '고 208' } },
  'forbidden-school-word': { label: '학교를 알 수 있는 내용', basis: { high: '고 19' } },
  'ai-spelling': { label: '맞춤법·띄어쓰기 (AI)', basis: { mid: '-', high: '-' } },
  'ai-area': { label: '영역 적합성 (AI)', basis: { mid: '중 77', high: '고 82' } },
  'ai-listing': { label: '나열식 (AI)', basis: { mid: '중 77', high: '고 82' } },
  'ai-rewrite': { label: '수정 문구 (AI)', basis: { mid: '중 19', high: '고 19' } },
};
for (const e of FORBIDDEN) RULES[`forbidden-${e.id}`] = { label: e.label, basis: e.basis };

/** 지적 정보 채우기 */
export function finish(issue, text, school) {
  const r = RULES[issue.ruleId] || {};
  return {
    ...issue,
    label: issue.label || r.label || issue.ruleId,
    basis: issue.basis || r.basis?.[school] || '',
    text: text.slice(issue.start, issue.end),
    key: `${issue.ruleId}|${text.slice(issue.start, issue.end)}`,
  };
}

const NEG = /(산만|불량|거칠|폭력|지각이 잦|결석이 잦|소극적|무기력|부주의|반항|다툼|욕설|공격적|게으|나태|불성실)/;
const GROWTH = /(노력|개선|변화|성장|나아|발전|기대|극복|좋아짐|줄어|늘어|향상|스스로)/;

function checkArea(text, ctx, out) {
  const { area, grade } = ctx;
  if (area === 'autonomy' && Number(grade) === 3) {
    for (const m of text.matchAll(/자율\s*[·ㆍ･.]?\s*자치/g)) {
      out.push({ ruleId: 'grade3-autonomy', level: 'warn', start: m.index, end: m.index + m[0].length, reason: "3학년은 '자율·자치활동'이 아니라 '자율활동'" });
    }
  }
  if (area === 'club') {
    const head = text.match(/^\s*\(([^():]{2,30})(?::[^)]*)?\)/);
    if (head) {
      const name = head[1].trim();
      let i = text.indexOf(name, head.index + head[0].length);
      while (i >= 0) {
        out.push({ ruleId: 'club-name-repeat', level: 'warn', start: i, end: i + name.length, reason: '본문 앞 (동아리명) 말고 본문에서 동아리명을 되풀이함' });
        i = text.indexOf(name, i + name.length);
      }
    }
    { // 중 79, 고 84: 자율동아리 소개는 동아리명과 공백 포함 30자 이내
      for (const m of text.matchAll(/\(([^():\n]+):\s*자율동아리\)[ \t]*([^\n]*)/g)) {
        const intro = m[2].trim();
        const len = [...`${m[1].trim()} ${intro}`].length;
        if (intro && len > 30) {
          out.push({ ruleId: 'club-intro-length', level: 'warn', start: m.index, end: m.index + m[0].length, reason: `자율동아리 소개는 동아리명과 공백 포함 30자 이내 (지금 ${len}자)` });
        }
      }
    }
  }
  if (area === 'behavior' && NEG.test(text) && !GROWTH.test(text)) {
    const m = text.match(NEG);
    out.push({ ruleId: 'behavior-negative', level: 'warn', start: m.index, end: m.index + m[0].length, reason: '부정적인 표현만 있고 성장·변화 관점이 보이지 않음. 행동특성이 구체적으로 드러나는지, 성장을 돕는 관점인지 확인' });
  }
}

/**
 * 글 하나 점검.
 * ctx: { school: 'mid'|'high', grade, area, subject, limitBytes, names: [], schoolWords: [], schoolYear }
 * @returns { issues, bytes, limit }
 */
export function checkText(text, ctx) {
  const t = String(text ?? '');
  const bytes = byteLength(t);
  const limit = ctx.limitBytes || 0;
  const raw = [];
  if (limit && bytes > limit) raw.push({ ruleId: 'bytes-over', level: 'error', start: 0, end: 0, reason: `${bytes}/${limit}바이트. 한도를 ${bytes - limit}바이트 넘음` });
  else if (limit && bytes >= limit * 0.95) raw.push({ ruleId: 'bytes-near', level: 'warn', start: 0, end: 0, reason: `${bytes}/${limit}바이트. 한도에 가까움` });
  raw.push(...checkFormat(t, ctx));
  if (EVENT_AREAS.includes(ctx.area)) raw.push(...checkEvents(t, ctx.events, ctx.schoolYear));
  raw.push(...findForbidden(t, FORBIDDEN, ctx));
  checkArea(t, ctx, raw);
  const seen = new Set();
  return {
    bytes, limit,
    issues: raw
      .filter((i) => { const k = `${i.ruleId}@${i.start}-${i.end}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((i) => finish(i, t, ctx.school))
      .sort((a, b) => a.start - b.start || a.end - b.end),
  };
}

// ---------- 반 전체 점검 ----------
const norm = (s) => String(s).replace(/[\s\p{P}\p{S}]/gu, '');
function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}
/** 글자 두 개 묶음 기준 다이스 유사도 (0~1) */
export function similarity(a, b) {
  const x = bigrams(norm(a)), y = bigrams(norm(b));
  let nx = 0, ny = 0, both = 0;
  for (const v of x.values()) nx += v;
  for (const v of y.values()) ny += v;
  if (!nx || !ny) return 0;
  for (const [g, v] of x) if (y.has(g)) both += Math.min(v, y.get(g));
  return (2 * both) / (nx + ny);
}

/**
 * 같은 항목(과목) 안에서 비교. rows: [{ key, studentId, name, area, subject, text }]
 * @returns Map(key -> 지적[])
 */
export function checkClass(rows, { school, grade } = {}) {
  const out = new Map(rows.map((r) => [r.key, []]));
  const add = (r, issue) => out.get(r.key).push(finish(issue, r.text, school));
  const groups = new Map();
  for (const r of rows) {
    if (!String(r.text || '').trim()) continue;
    const g = `${r.area}|${r.area === 'subject' ? r.subject || '' : ''}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  for (const list of groups.values()) {
    // shortcut: 두 학생씩 모두 비교(n^2). 한 묶음이 500명을 넘으면 건너뜀. 더 크면 색인 방식으로 바꿀 것
    if (list.length <= 500) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const s = similarity(list[i].text, list[j].text);
        if (s >= 0.9) {
          const pct = Math.round(s * 100);
          add(list[i], { ruleId: 'similar', level: 'warn', start: 0, end: 0, reason: `${list[j].name || list[j].studentId || '다른 학생'}의 글과 ${pct}% 비슷함` });
          add(list[j], { ruleId: 'similar', level: 'warn', start: 0, end: 0, reason: `${list[i].name || list[i].studentId || '다른 학생'}의 글과 ${pct}% 비슷함` });
        }
      }
    }
    const bySentence = new Map();
    for (const r of list) {
      for (const sp of splitSentences(r.text)) {
        const n = norm(r.text.slice(sp.start, sp.end));
        if (n.length < 10) continue;
        if (!bySentence.has(n)) bySentence.set(n, []);
        bySentence.get(n).push({ r, sp });
      }
    }
    for (const hits of bySentence.values()) {
      const people = new Set(hits.map((h) => h.r.key));
      if (people.size < 3) continue;
      for (const { r, sp } of hits) add(r, { ruleId: 'repeat-sentence', level: 'warn', start: sp.start, end: sp.end, reason: `같은 문장이 ${people.size}명의 글에 있음. 학생별 특성이 드러나게 바꿈` });
    }
  }
  // 고등학교 1~2학년 공통과목 1·2 합산 500자 (고 208)
  if (school === 'high' && [1, 2].includes(Number(grade))) {
    const sums = new Map();
    for (const r of rows) {
      if (r.area !== 'subject') continue;
      const base = commonSubjectBase(r.subject);
      const who = r.studentId || r.name;
      if (!base || !who) continue;
      const k = `${who}|${base}`;
      if (!sums.has(k)) sums.set(k, []);
      sums.get(k).push(r);
    }
    for (const [k, list] of sums) {
      const total = list.reduce((n, r) => n + byteLength(r.text), 0);
      if (list.length > 1 && total > 1500) {
        for (const r of list) add(r, { ruleId: 'common-sum', level: 'error', start: 0, end: 0, reason: `${k.split('|')[1]} 1·2 합산 ${total}/1500바이트` });
      }
    }
  }
  return out;
}
