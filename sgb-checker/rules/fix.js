// 고치기: 지적 하나 적용, [정리], 전후 비교. 순수 함수.

export function applyFix(text, issue) {
  if (typeof issue?.fix !== 'string') return text;
  return text.slice(0, issue.start) + issue.fix + text.slice(issue.end);
}

const TIDY_RULES = new Set(['space-double', 'space-edge', 'neis-char', 'date-format']);

/** [정리]: 연속 공백, 줄 앞뒤 공백, 깨짐 문자, 날짜 형식(연도를 붙여야 하는 것은 빼고)을 한 번에. issues는 checkText 결과 */
export function tidy(text, issues) {
  const list = issues
    .filter((i) => TIDY_RULES.has(i.ruleId) && typeof i.fix === 'string' && !i.needsConfirm)
    .sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Infinity; // 뒤에서부터 적용, 겹치면 건너뜀
  for (const i of list) {
    if (i.end > floor) continue;
    out = applyFix(out, i);
    floor = i.start;
  }
  return out;
}

/** 글자 단위 비교: [{ type: 'same'|'del'|'ins', text }] */
export function diff(a, b) {
  a = String(a); b = String(b);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const A = a.slice(p, a.length - s), B = b.slice(p, b.length - s);
  const n = A.length, m = B.length;
  const parts = [];
  if (n * m > 4_000_000) { // shortcut: 아주 긴 글은 가운데를 통째로 바꾼 것으로 표시
    if (n) parts.push({ type: 'del', text: A });
    if (m) parts.push({ type: 'ins', text: B });
  } else {
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    const push = (type, ch) => { const last = parts[parts.length - 1]; if (last && last.type === type) last.text += ch; else parts.push({ type, text: ch }); };
    while (i < n && j < m) {
      if (A[i] === B[j]) { push('same', A[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { push('del', A[i]); i++; } else { push('ins', B[j]); j++; }
    }
    while (i < n) push('del', A[i++]);
    while (j < m) push('ins', B[j++]);
  }
  const res = [];
  if (p) res.push({ type: 'same', text: a.slice(0, p) });
  for (const x of parts) { const last = res[res.length - 1]; if (last && last.type === x.type) last.text += x.text; else res.push(x); }
  if (s) { const tail = a.slice(a.length - s); const last = res[res.length - 1]; if (last && last.type === 'same') last.text += tail; else res.push({ type: 'same', text: tail }); }
  return res;
}
