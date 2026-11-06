// 검사: 금지 표현, NEIS에서 문제가 되는 문자, 연속 공백, 정리, 유사도, 종합 검사.
// 순수 모듈. 경고는 저장을 막지 않는다.

import { byteLength, byteLevel } from './bytes.js';

const WORD_CHAR = /[가-힣ㄱ-ㅣA-Za-z0-9]/;
const ASCII_ALNUM = /[A-Za-z0-9]/;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const regexCache = new Map();

function entryRegExp(entry) {
  const key = `${entry.match}\u0000${entry.term}`;
  if (regexCache.has(key)) return regexCache.get(key);
  let re = null;
  try {
    if (entry.match === 'regex') re = new RegExp(entry.term, 'gi');
    else re = new RegExp(escapeRegExp(String(entry.term)), 'gi');
  } catch {
    re = null; // 잘못된 정규식은 검사하지 않음
  }
  regexCache.set(key, re);
  return re;
}

function appliesTo(entry, area) {
  if (!Array.isArray(entry.areas) || entry.areas.length === 0) return true;
  if (!area) return true;
  return entry.areas.includes(area);
}

/**
 * 금지 표현 찾기.
 * @returns {{entry, index, length, match}[]} 위치 순서
 */
export function findForbidden(text, area, entries) {
  const src = String(text ?? '');
  if (!src || !Array.isArray(entries)) return [];
  const hits = [];
  for (const entry of entries) {
    if (!entry || !entry.term || !appliesTo(entry, area)) continue;
    const re = entryRegExp(entry);
    if (!re) continue;
    re.lastIndex = 0;
    const term = String(entry.term);
    const checkFront = entry.match !== 'regex';
    const checkBack = entry.match !== 'regex' && ASCII_ALNUM.test(term[term.length - 1]);
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue; }
      const start = m.index;
      const end = start + m[0].length;
      if (checkFront && start > 0 && WORD_CHAR.test(src[start - 1])) continue;
      if (checkBack && end < src.length && ASCII_ALNUM.test(src[end])) continue;
      hits.push({ entry, index: start, length: m[0].length, match: m[0] });
    }
  }
  hits.sort((a, b) => a.index - b.index || b.length - a.length);
  return hits;
}

// NEIS에 붙여 넣을 때 깨지거나 거부되는 문자. 장식 기호는 소스에 직접 쓰지 않고 코드값으로 적는다.
export const NEIS_CHAR_RULES = [
  { id: 'double-quote', label: '둥근 큰따옴표', pattern: /[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, replace: '"' },
  { id: 'single-quote', label: '둥근 작은따옴표', pattern: /[\u2018\u2019\u201A\u201B]/g, replace: "'" },
  { id: 'ellipsis', label: '말줄임표 문자', pattern: /[\u2026\u22EF]/g, replace: '...' },
  { id: 'dash', label: '긴 줄표', pattern: /[\u2012\u2013\u2014\u2015\u2212]/g, replace: '-' },
  { id: 'middle-dot', label: '일본식 가운뎃점', pattern: /[\u30FB\uFF65\u2027]/g, replace: '·' },
  { id: 'newline', label: '줄바꿈', pattern: /\r\n|\r|\n|\u2028|\u2029/g, replace: ' ' },
  { id: 'tab', label: '탭', pattern: /\t/g, replace: ' ' },
  { id: 'special-space', label: '특수 공백', pattern: /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, replace: ' ' },
  { id: 'zero-width', label: '보이지 않는 문자', pattern: /[\u200B-\u200D\u2060\uFEFF\u00AD]/g, replace: '' },
  { id: 'control', label: '제어 문자', pattern: /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, replace: '' },
  { id: 'emoji', label: '이모지', pattern: /\p{Extended_Pictographic}[\uFE0E\uFE0F\u200D]*|[\uFE0E\uFE0F]|[\u{1F3FB}-\u{1F3FF}]/gu, replace: '' },
  { id: 'symbol', label: '장식 기호', pattern: /[\u2190-\u21FF\u25A0-\u25FF\u2600-\u27BF\u2B00-\u2BFF\u203B]/g, replace: '' },
  { id: 'double-space', label: '연속 공백', pattern: / {2,}/g, replace: ' ' },
];

/** NEIS 문자 문제 목록: [{ id, label, count }] (count > 0 인 것만) */
export function findNeisIssues(text) {
  const src = String(text ?? '');
  const issues = [];
  for (const rule of NEIS_CHAR_RULES) {
    rule.pattern.lastIndex = 0;
    const found = src.match(rule.pattern);
    if (found && found.length) issues.push({ id: rule.id, label: rule.label, count: found.length });
  }
  return issues;
}

/** [정리]: NEIS 문자 바꿈 + 연속 공백 1칸 + 앞뒤 공백 제거 */
export function cleanText(text) {
  let out = String(text ?? '');
  for (const rule of NEIS_CHAR_RULES) {
    rule.pattern.lastIndex = 0;
    out = out.replace(rule.pattern, rule.replace);
  }
  out = out.replace(/ {2,}/g, ' ');
  // 문장부호 앞 공백 정리 (예: '함 .' -> '함.')
  out = out.replace(/ +([.,])/g, '$1');
  return out.trim();
}

function bigrams(s) {
  const map = new Map();
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2);
    map.set(g, (map.get(g) || 0) + 1);
  }
  return map;
}

function compact(text) {
  return Array.from(String(text ?? '').replace(/\s+/g, '')).join('');
}

/** 0~1. 공백을 뺀 2글자 묶음의 Dice 계수 */
export function similarity(a, b) {
  const x = compact(a);
  const y = compact(b);
  if (!x && !y) return 1;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const gx = bigrams(x);
  const gy = bigrams(y);
  let inter = 0;
  for (const [g, n] of gx) {
    const m = gy.get(g);
    if (m) inter += Math.min(n, m);
  }
  return (2 * inter) / ((x.length - 1) + (y.length - 1));
}

export const SIMILAR_MIN_CHARS = 30;

/** 비슷한 글 찾기. 공백 뺀 30자 미만인 글은 검사하지 않음 */
export function findSimilar(text, others, threshold = 0.9) {
  if (compact(text).length < SIMILAR_MIN_CHARS || !Array.isArray(others)) return [];
  const out = [];
  for (const o of others) {
    if (!o || compact(o.text).length < SIMILAR_MIN_CHARS) continue;
    const score = similarity(text, o.text);
    if (score >= threshold) out.push({ id: o.id, score });
  }
  out.sort((p, q) => q.score - p.score);
  return out;
}

/**
 * 종합 검사.
 * issueCount = 초과(1) + 금지 표현 수 + NEIS 문자 문제 종류 수 + 비슷한 글 수.
 * '한도에 가까움'(near)은 알림일 뿐 issueCount에 넣지 않는다.
 */
export function checkRecord(text, { area, limit, entries = [], others = [] } = {}) {
  const src = String(text ?? '');
  const bytes = byteLength(src);
  const level = byteLevel(bytes, limit);
  const forbidden = findForbidden(src, area, entries);
  const neis = findNeisIssues(src);
  const similar = findSimilar(src, others);
  const issueCount = (level === 'over' ? 1 : 0) + forbidden.length + neis.length + similar.length;
  return { bytes, limit, level, forbidden, neis, similar, issueCount };
}
