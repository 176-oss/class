// 표 작성 화면의 순수 계산: 입력 오류·맞춤법 점검, 공통 특징+개별 메모 합치기, 표에 순서대로 붙여넣기 계획.
// 화면(views/grid.js)이 부르고, 네트워크·저장소를 직접 쓰지 않는다.
import { checkRecord, cleanText } from './check.js';
import { byteLength } from './bytes.js';

// ---------- 맞춤법: 자주 틀리는 것만 (확실한 것만 담고, 모든 오류를 찾지는 못한다) ----------
export const SPELLING_RULES = [
  { from: '되요', to: '돼요' },
  { from: '안되요', to: '안 돼요' },
  { from: '않되', to: '안 되' },
  { from: '몇일', to: '며칠' },
  { from: '왠만', to: '웬만' },
  { from: '금새', to: '금세' },
  { from: '오랫만', to: '오랜만' },
  { from: '설레임', to: '설렘' },
  { from: '희안', to: '희한' },
  { from: '어의없', to: '어이없' },
  { from: '일일히', to: '일일이' },
  { from: '틈틈히', to: '틈틈이' },
  { from: '역활', to: '역할' },
  { from: '웬지', to: '왠지' },
  { from: '어떻해', to: '어떡해' },
  { from: '할려고', to: '하려고' },
  { from: '하였음으로', to: '하였으므로' },
  { from: '뵈요', to: '봬요' },
];

/** [{ id:'spell', message, index, length, from, to }] */
export function findSpelling(text) {
  const src = String(text ?? '');
  const out = [];
  for (const r of SPELLING_RULES) {
    let i = src.indexOf(r.from);
    while (i >= 0) {
      out.push({ kind: 'spell', message: `'${r.from}'은(는) '${r.to}'(으)로 씁니다`, index: i, length: r.from.length, from: r.from, to: r.to });
      i = src.indexOf(r.from, i + r.from.length);
    }
  }
  // '안되요'는 '되요'에도 걸리니 같은 자리의 짧은 규칙은 뺀다
  const key = (x) => x.index;
  out.sort((a, b) => key(a) - key(b) || b.length - a.length);
  return out.filter((x, i) => !out.slice(0, i).some((y) => y.index <= x.index && x.index + x.length <= y.index + y.length));
}

export function fixSpelling(text) {
  let out = String(text ?? '');
  // 긴 규칙부터 바꿔야 '안되요'가 '안돼요'가 되지 않는다
  for (const r of [...SPELLING_RULES].sort((a, b) => b.from.length - a.from.length)) out = out.split(r.from).join(r.to);
  return out;
}

// ---------- 입력 오류 (생기부 글에서 흔한 실수) ----------
/** [{ kind:'input', message }] — 띄어쓰기 두 번 같은 NEIS 문자 문제는 check.js 의 neis 에서 따로 센다 */
export function findInputErrors(text) {
  const src = String(text ?? '');
  const out = [];
  if (!src.trim()) return out;
  if (/ +[.,!?]/.test(src)) out.push({ kind: 'input', message: '문장부호 앞에 공백이 있습니다' });
  if (/[.!?]{2,}/.test(src.replace(/\.\.\./g, ''))) out.push({ kind: 'input', message: '문장부호가 겹쳐 있습니다' });
  if (/[.,][가-힣A-Za-z]/.test(src.replace(/\d\.\d/g, '').replace(/\w+\.\w+/g, ''))) out.push({ kind: 'input', message: '문장부호 뒤에 공백이 없습니다' });
  if (/[ㄱ-ㅎㅏ-ㅣ]/.test(src)) out.push({ kind: 'input', message: '자음·모음만 쓴 글자(ㅋㅋ, ㅠㅠ 등)가 있습니다' });
  const pairs = [['(', ')'], ['[', ']'], ['"', '"'], ["'", "'"]];
  for (const [o, c] of pairs) {
    const n = (src.split(o).length - 1);
    const m = o === c ? n : (src.split(c).length - 1);
    if (o === c ? n % 2 : n !== m) out.push({ kind: 'input', message: `${o}${c} 짝이 맞지 않습니다` });
  }
  if (/(\S{2,}) \1(?=[ .,]|$)/.test(src)) out.push({ kind: 'input', message: '같은 말이 연달아 반복됩니다' });
  if (!/[.!?"')\]]\s*$/.test(src.trim())) out.push({ kind: 'input', message: '문장이 마침표 등으로 끝나지 않습니다' });
  return out;
}

/**
 * 한 칸의 점검 결과. checkRecord 에 입력 오류·맞춤법을 더한다.
 * issues: [{ kind, message, fix? }] — kind: over | forbidden | neis | input | spell | similar | style
 * fixable: [정리]로 바로 고칠 수 있는 것이 있는지 (연속 공백, 이상한 문자, 맞춤법)
 */
export function checkCell(text, opts = {}) {
  const src = String(text ?? '');
  if (!src.trim()) return { empty: true, issues: [], count: 0, fixable: false, bytes: 0, level: 'ok', base: null };
  const base = checkRecord(src, opts);
  const issues = [];
  if (base.level === 'over') issues.push({ kind: 'over', message: `한도(${base.limit}바이트)보다 ${base.bytes - base.limit}바이트 깁니다` });
  for (const f of base.forbidden) issues.push({ kind: 'forbidden', message: `금지 표현: ${f.match}`, index: f.index, length: f.length });
  for (const n of base.neis) issues.push({ kind: 'neis', message: `${n.label} ${n.count}곳`, fix: true });
  const sp = findSpelling(src);
  for (const s of sp) issues.push({ ...s, fix: true });
  for (const e of findInputErrors(src)) issues.push(e);
  if (base.similar.length) {
    const top = Math.round(Math.max(...base.similar.map((s) => s.score)) * 100);
    issues.push({ kind: 'similar', message: `다른 학생 ${base.similar.length}명의 글과 비슷합니다 (최대 ${top}%)` });
  }
  if (base.styleOverlap && base.styleOverlap.length) issues.push({ kind: 'style', message: '내 스타일 예시와 같은 문장이 있습니다' });
  return { empty: false, issues, count: issues.length, fixable: issues.some((i) => i.fix), bytes: base.bytes, level: base.level, limit: base.limit, base };
}

/** [정리]: NEIS 문자·연속 공백 정리 + 맞춤법 고치기 */
export function tidyText(text) {
  return fixSpelling(cleanText(text));
}

// ---------- 초안 재료: 공통 특징 + 학생 메모 ----------
/** AI에 보낼 메모. 공통 특징은 모든 학생에게, 학생 메모는 그 학생에게만 */
export function composeMemo(common, own) {
  const a = String(common ?? '').trim();
  const b = String(own ?? '').trim();
  if (a && b) return `${a}\n${b}`;
  return a || b;
}

// ---------- 표에 순서대로 붙여넣기 ----------
export const PASTE_MODES = { skip: '이미 최종본이 있으면 건너뜀', append: '이미 있으면 뒤에 이어씀', overwrite: '이미 있으면 덮어씀' };

/**
 * rows: 표 순서의 [{ id, final, status }], drafts: { [id]: 글 }, mode: skip|append|overwrite
 * 반환: { patches:[{id, final}], summary:{ pasted, appended, overwritten, keptExisting, done, noDraft } }
 * 완료(done)한 기록은 건드리지 않는다. 글이 없는 학생은 건너뛴다.
 */
export function planPaste(rows, drafts, { mode = 'skip', separator = ' ' } = {}) {
  const out = { patches: [], summary: { pasted: 0, appended: 0, overwritten: 0, keptExisting: 0, done: 0, noDraft: 0 } };
  for (const r of rows) {
    const d = String(drafts[r.id] ?? '').trim();
    if (!d) { out.summary.noDraft += 1; continue; }
    if (r.status === 'done') { out.summary.done += 1; continue; }
    const cur = String(r.final ?? '');
    if (!cur.trim()) { out.patches.push({ id: r.id, final: d }); out.summary.pasted += 1; continue; }
    if (mode === 'overwrite') { out.patches.push({ id: r.id, final: d }); out.summary.overwritten += 1; continue; }
    if (mode === 'append') {
      if (cur.includes(d)) { out.summary.keptExisting += 1; continue; }
      out.patches.push({ id: r.id, final: `${cur.replace(/\s+$/, '')}${separator}${d}` });
      out.summary.appended += 1;
      continue;
    }
    out.summary.keptExisting += 1;
  }
  return out;
}

/**
 * 후보 하나를 여러 학생에게: candidates 는 글 배열, assign 은 Map 또는 객체 (기록 id -> 후보 번호).
 * 반환: { [기록 id]: 글 } — 글이 비었거나 없는 후보 번호는 뺀다.
 */
export function assignedDrafts(candidates, assign) {
  const out = {};
  const entries = assign instanceof Map ? [...assign.entries()] : Object.entries(assign || {});
  for (const [id, i] of entries) {
    const t = String(candidates[Number(i)] ?? '').trim();
    if (t) out[id] = t;
  }
  return out;
}

export const CAND_EXTRA = 5;
export const CAND_MAX = 40;
/** 후보 목표 개수: 고른 학생 수 + 5 (학생마다 다른 후보를 붙이고도 5개가 남도록). 최대 40개 */
export function candidateTarget(selectedCount) {
  return Math.min(CAND_MAX, Math.max(0, Number(selectedCount) || 0) + CAND_EXTRA);
}

/**
 * 아직 배정이 없는 학생에게 후보를 차례로 하나씩 배정한다 (안 쓴 후보 번호부터, 후보가 모자라면 처음부터 돌려 씀).
 * ids: 학생 기록 id (표 순서), assign: Map. 새 Map 을 돌려준다.
 */
export function autoAssign(ids, assign, candCount) {
  const next = new Map(assign);
  if (!candCount) return next;
  const used = new Set(next.values());
  const free = [];
  for (let i = 0; i < candCount; i += 1) if (!used.has(i)) free.push(i);
  let k = 0;
  for (const id of ids) {
    if (next.has(id)) continue;
    next.set(id, free.length ? free.shift() : k % candCount);
    k += 1;
  }
  return next;
}

/** 후보를 지우면 그 후보에 배정된 학생은 풀고, 뒤 후보 번호는 하나씩 당긴다. 새 Map 을 돌려준다 */
export function removeCandidate(assign, index) {
  const next = new Map();
  for (const [id, i] of assign) {
    if (i === index) continue;
    next.set(id, i > index ? i - 1 : i);
  }
  return next;
}

/** 메모가 있고 최종본이 비어 있는 (완료 아님) 기록 id — 맨 위 [메모로 초안 만들기] 대상 */
export function memoTargets(rows) {
  const filled = (v) => typeof v === 'string' && v.trim() !== '';
  return rows.filter((r) => r.status !== 'done' && filled(r.memo) && !filled(r.final)).map((r) => r.id);
}

export { byteLength };
