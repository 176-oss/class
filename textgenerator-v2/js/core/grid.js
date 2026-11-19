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
/** AI에 보낼 메모. 공통 특징 -> 모둠 메모 -> 학생 메모 순서로, 빈 것은 빼고 줄로 잇는다 */
export function composeMemo(...parts) {
  return parts.map((x) => String(x ?? '').trim()).filter(Boolean).join('\n');
}

// ---------- 모둠: 반 안에서 학생 몇 명을 묶어 공통 메모를 둔다. 반에 cls.groups 로 저장 ----------
/** 학생이 든 모둠 (한 반에서 학생은 모둠 하나에만) */
export function groupOfStudent(groups, studentId) {
  return (Array.isArray(groups) ? groups : []).find((g) => g.studentIds?.includes(String(studentId))) || null;
}

/** 모둠 저장(새로 또는 고치기). 이 모둠 학생은 다른 모둠에서 빠지고, 빈 모둠은 지운다 */
export function saveGroup(groups, group) {
  const ids = [...new Set((group.studentIds || []).map(String))];
  const next = { id: group.id, name: String(group.name ?? '').trim() || '모둠', memo: String(group.memo ?? ''), studentIds: ids };
  const list = (Array.isArray(groups) ? groups : []).map((g) => (g.id === next.id ? next : { ...g, studentIds: (g.studentIds || []).filter((x) => !ids.includes(x)) }));
  if (!list.some((g) => g.id === next.id)) list.push(next);
  return list.filter((g) => g.studentIds.length);
}

/** 다음 모둠 기본 이름: 쓰지 않은 가장 작은 번호의 'n모둠' */
export function nextGroupName(groups) {
  const used = new Set((Array.isArray(groups) ? groups : []).map((g) => g.name));
  let n = 1;
  while (used.has(`${n}모둠`)) n += 1;
  return `${n}모둠`;
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

/**
 * 반에 올려 둔 성취기준 글을 항목으로: 줄마다 하나, 한 줄에 '[코드] 내용'이 여러 개면 코드 앞에서 나눈다.
 * 반환: [{ code, text, line }] — line 은 줄 전체 (체크 상태를 이 글자로 기억한다). 같은 줄은 한 번만.
 */
export function parseStandards(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text ?? '').split(/\r\n|\r|\n/)) {
    for (const part of raw.trim().split(/\s+(?=\[[^\]]{2,24}\]\s*\S)/)) {
      const line = part.trim();
      if (!line || seen.has(line)) continue;
      seen.add(line);
      const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
      out.push({ code: m ? m[1] : '', text: m ? m[2] : line, line });
    }
  }
  return out;
}

/** 체크한 항목들의 글 (AI에 보낼 성취기준) */
export const standardsText = (lines) => [...lines].map((l) => String(l).trim()).filter(Boolean).join('\n');

/** 메모가 있고 최종본이 비어 있는 (완료 아님) 기록 id — 맨 위 [메모로 초안 만들기] 대상 */
export function memoTargets(rows) {
  const filled = (v) => typeof v === 'string' && v.trim() !== '';
  return rows.filter((r) => r.status !== 'done' && filled(r.memo) && !filled(r.final)).map((r) => r.id);
}

export { byteLength };

// ---------- 행사 (자율·진로): 반에 cls.events = { autonomy: [], career: [] } 로 저장 ----------
export const EVENT_AREAS = ['autonomy', 'career'];

/** 날짜 한 개를 'YYYY.MM.DD.' 로. '2026-5-14', '2026.05.14', '20260514', '5/14'(year 필요) 를 받는다. 못 읽으면 null */
function oneDate(raw, year) {
  const s = String(raw ?? '').trim().replace(/\s+/g, '');
  let y; let m; let d;
  let r = s.match(/^(\d{4})[.\-/년](\d{1,2})[.\-/월](\d{1,2})[.일]?$/);
  if (r) [, y, m, d] = r;
  else if ((r = s.match(/^(\d{4})(\d{2})(\d{2})$/))) [, y, m, d] = r;
  else if ((r = s.match(/^(\d{1,2})[.\-/월](\d{1,2})[.일]?$/)) && year) { [, m, d] = r; y = String(year); } else return null;
  const Y = Number(y); const M = Number(m); const D = Number(d);
  const dt = new Date(Y, M - 1, D);
  if (dt.getFullYear() !== Y || dt.getMonth() !== M - 1 || dt.getDate() !== D) return null;
  return `${Y}.${String(M).padStart(2, '0')}.${String(D).padStart(2, '0')}.`;
}

/**
 * 행사 날짜를 기재요령 형식으로 (중 77, 고 82): 하루 '2026.05.14.', 기간 '2026.05.14.-2026.05.16.' (~ 또는 - 로 나눈 것을 받음).
 * year: 월·일만 적었을 때 쓸 학년도. 반환 { ok, value, error }
 */
export function formatEventDate(raw, year) {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, value: '', error: '날짜를 적어 주세요 (예: 2026.05.14.).' };
  const parts = s.split(/\s*~\s*|\s+-\s+|(?<=\.)\s*-\s*(?=\d)/);
  if (parts.length > 2) return { ok: false, value: '', error: `'${s}'을(를) 날짜로 읽을 수 없습니다. 기간은 2026.05.14.-2026.05.16.처럼 적어 주세요.` };
  const a = oneDate(parts[0], year);
  const b = parts[1] !== undefined ? oneDate(parts[1], a ? Number(a.slice(0, 4)) : year) : null;
  if (!a || (parts[1] !== undefined && !b)) return { ok: false, value: '', error: `'${s}'을(를) 날짜로 읽을 수 없습니다. 2026.05.14.처럼 적어 주세요.` };
  if (b && b < a) return { ok: false, value: '', error: '기간의 끝 날짜가 시작 날짜보다 앞입니다.' };
  return { ok: true, value: b && b !== a ? `${a}-${b}` : a, error: null };
}

/** 초안에 쓸 행사 표기: '학생자치회 임원 선거(2026.03.15.)' */
export const eventLabel = (ev) => `${String(ev?.name ?? '').trim()}(${String(ev?.date ?? '').trim()})`;

/** 행사 저장(새로 또는 고치기). 날짜순으로 정렬 */
export function saveEvent(events, ev) {
  const next = { id: ev.id, name: String(ev.name ?? '').trim(), date: String(ev.date ?? '').trim() };
  const list = (Array.isArray(events) ? events : []).filter((e) => e.id !== next.id);
  list.push(next);
  return list.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

/** 초안에서 빠진 행사 표기 (점검용) */
export function missingEventLabels(text, events) {
  const t = String(text ?? '');
  return (Array.isArray(events) ? events : []).map(eventLabel).filter((l) => !t.includes(l));
}

/**
 * 학교 행사 목록 읽기 (붙여넣기 글 또는 엑셀 표 2차원 배열). 줄마다 행사명과 날짜(또는 기간).
 * 글: '행사명<탭|쉼표>날짜', '행사명(날짜)', '행사명 2026.05.14'. 표: 앞 칸 행사명, 뒤 칸들 날짜.
 * 머리글 줄(행사명·날짜)은 건너뛴다. 반환 { events: [{ name, date }], errors: [줄 안내] } (최대 300개, 같은 행사는 한 번)
 */
export function parseEventList(input, year) {
  const rows = Array.isArray(input) ? input : String(input ?? '').split(/\r\n|\r|\n/).map((l) => [l]);
  const events = [];
  const errors = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    const cells = (Array.isArray(row) ? row : [row]).map((c) => String(c ?? '').trim()).filter(Boolean);
    if (!cells.length) return;
    let name; let raw;
    if (cells.length >= 2) [name, raw] = [cells[0], cells.slice(1).join(' ')];
    else {
      const line = cells[0];
      const m = line.match(/^(.+?)\s*\(([^()]+)\)\s*$/) || line.match(/^(.+?)[\t,]\s*(.+)$/) || line.match(/^(.+?)\s+(\d{4}[.\-/년][\s\S]*|\d{8}[\s\S]*)$/);
      if (!m) { errors.push(`${i + 1}째 줄: 행사명과 날짜를 나눌 수 없습니다 ('${line.slice(0, 30)}')`); return; }
      [, name, raw] = m;
    }
    if (/^(행사|행사명|이름)$/.test(name) && /날짜|일자|기간/.test(raw)) return; // 머리글
    const d = formatEventDate(raw, year);
    if (!d.ok) { errors.push(`${i + 1}째 줄: ${d.error}`); return; }
    name = name.replace(/\s+/g, ' ').slice(0, 60);
    const k = `${name}|${d.value}`;
    if (seen.has(k)) return;
    seen.add(k);
    events.push({ name, date: d.value });
  });
  if (events.length > 300) { errors.push('행사는 300개까지만 씁니다.'); events.length = 300; }
  return { events, errors };
}
