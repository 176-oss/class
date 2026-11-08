// 금지 내용 찾기 (rules/data/forbidden.json). 순수 함수.

const ASCII_WORD = /^[A-Za-z0-9&\-]+$/;

function rangesOf(text, words) {
  const r = [];
  for (const w of words || []) {
    let i = text.indexOf(w);
    while (i >= 0) { r.push([i, i + w.length]); i = text.indexOf(w, i + 1); }
  }
  return r;
}

function termHits(text, term) {
  const hits = [];
  const ascii = ASCII_WORD.test(term);
  const hay = ascii ? text.toUpperCase() : text;
  const needle = ascii ? term.toUpperCase() : term;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    const e = i + needle.length;
    const okL = !ascii || i === 0 || !/[A-Za-z0-9]/.test(text[i - 1]);
    const okR = !ascii || e === text.length || !/[A-Za-z0-9]/.test(text[e]);
    if (okL && okR) hits.push([i, e]);
    i = hay.indexOf(needle, i + 1);
  }
  return hits;
}

const reCache = new Map();
const re = (src) => { if (!reCache.has(src)) reCache.set(src, new RegExp(src, 'gu')); return reCache.get(src); };

/** 학교급·항목·과목에 맞는 항목만 */
export function entriesFor(entries, { school, area }) {
  return entries.filter((e) => e.schools.includes(school) && (e.areas === '*' || e.areas.includes(area)));
}

/**
 * ctx: { school, area, subject, schoolWords }
 * @returns 지적 목록 (ruleId 'forbidden-<id>', basis 포함)
 */
export function findForbidden(text, entries, ctx) {
  const out = [];
  const subj = String(ctx.subject || '').replace(/\s+/g, '');
  for (const e of entriesFor(entries, ctx)) {
    const exc = rangesOf(text, e.except);
    const covered = (a, b) => exc.some(([x, y]) => a < y && b > x); // 예외어와 겹치면 지적하지 않음
    let hits = [];
    for (const t of e.terms || []) hits.push(...termHits(text, t));
    for (const p of e.patterns || []) for (const m of text.matchAll(re(p))) hits.push([m.index, m.index + m[0].length]);
    hits = hits.filter(([a, b]) => !covered(a, b)).sort((x, y) => x[0] - y[0] || y[1] - x[1]);
    // 겹치는 것은 앞의 긴 것만
    const merged = [];
    for (const h of hits) { const last = merged[merged.length - 1]; if (last && h[0] < last[1]) continue; merged.push(h); }
    const special = e.exceptSubjects && (!e.exceptSchools || e.exceptSchools.includes(ctx.school)) && e.exceptSubjects.some((s) => subj.includes(s));
    for (const [a, b] of merged) {
      out.push({
        ruleId: `forbidden-${e.id}`, level: special ? e.exceptLevel : e.level, start: a, end: b,
        reason: `${e.label}: ${special ? e.exceptDesc : e.desc}`, basis: e.basis[ctx.school] || '', hint: e.fix,
      });
    }
  }
  if (ctx.school === 'high') {
    for (const w of ctx.schoolWords || []) {
      const word = String(w || '').trim();
      if (word.length < 2) continue;
      for (const [a, b] of rangesOf(text, [word])) {
        out.push({ ruleId: 'forbidden-school-word', level: 'error', start: a, end: b, reason: '학교를 알 수 있는 내용(학교명, 별칭, 축제명)은 쓸 수 없음', basis: '고 19', hint: "'본교', '학교 축제'처럼 바꿈" });
      }
    }
  }
  return out;
}
