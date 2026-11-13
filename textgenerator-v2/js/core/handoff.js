// 점검기와 반 전체 글 주고받기 (순수 모듈, 저장소는 주입). 점검기 쪽 shared/handoff.js 의 '묶음' 부분과 같은 규칙이다.
// localStorage 'sgb-handoff-batch' = JSON { v:1, source, school?, groups:[{ area, subject, items:[{ studentId, name?, text }] }], at }
// 받는 쪽은 읽은 뒤 바로 지운다. 5분이 지났거나 모양이 틀리면 지운다. 주소창에는 글을 넣지 않는다.

export const BATCH_KEY = 'sgb-handoff-batch';
export const BATCH_TTL_MS = 5 * 60 * 1000;
export const BATCH_MAX_ITEMS = 3000;
export const BATCH_MAX_BYTES = 1500 * 1024;
export const BATCH_SOURCES = ['textgenerator-v2', 'sgb-checker'];
const AREAS = ['autonomy', 'career', 'behavior', 'club', 'subject'];

/** 모양이 맞으면 정리한 값, 아니면 null */
export function validBatch(v, now = Date.now()) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.v !== 1) return null;
  if (!BATCH_SOURCES.includes(v.source)) return null;
  if (!Number.isFinite(v.at) || now - v.at > BATCH_TTL_MS || v.at - now > 60 * 1000) return null;
  if (v.school !== undefined && v.school !== 'mid' && v.school !== 'high') return null;
  if (!Array.isArray(v.groups) || !v.groups.length || v.groups.length > 200) return null;
  let total = 0;
  const groups = [];
  for (const g of v.groups) {
    if (!g || typeof g !== 'object' || !AREAS.includes(g.area)) return null;
    const subject = g.subject == null ? '' : g.subject;
    if (typeof subject !== 'string' || subject.length > 40) return null;
    if (g.area === 'subject' && !subject.trim()) return null;
    if (!Array.isArray(g.items)) return null;
    const items = [];
    for (const it of g.items) {
      if (!it || typeof it !== 'object') return null;
      const { studentId = '', name = '', text } = it;
      if (typeof studentId !== 'string' || studentId.length > 20 || typeof name !== 'string' || name.length > 40) return null;
      if (typeof text !== 'string' || !text.trim() || text.length > 6000) return null;
      items.push({ studentId, name, text });
    }
    total += items.length;
    if (total > BATCH_MAX_ITEMS) return null;
    if (items.length) groups.push({ area: g.area, subject: g.area === 'subject' ? subject.trim() : '', items });
  }
  if (!groups.length) return null;
  const out = { v: 1, source: v.source, groups, at: v.at };
  if (v.school) out.school = v.school;
  return out;
}

/** 쓰기. 성공하면 { ok:true, count }, 아니면 { ok:false, reason } */
export function writeBatch(storage, { source, school, groups }, now = Date.now()) {
  const v = validBatch({ v: 1, source, school, groups, at: now }, now);
  if (!v) return { ok: false, reason: '보낼 글이 없거나 모양이 맞지 않습니다 (글 6,000자 이하, 3,000명 이하).' };
  const raw = JSON.stringify(v);
  if (new TextEncoder().encode(raw).length > BATCH_MAX_BYTES) return { ok: false, reason: '글이 너무 많아 한 번에 보낼 수 없습니다. 반이나 항목을 나눠 보내세요.' };
  try { storage.setItem(BATCH_KEY, raw); } catch { return { ok: false, reason: '브라우저 저장소를 쓸 수 없어 보내지 못했습니다.' }; }
  return { ok: true, count: v.groups.reduce((n, g) => n + g.items.length, 0) };
}

/** want 쪽에서 보낸 것만 받는다. 받았거나 틀린 값이면 지운다. 내가 보낸 것은 5분 안이면 남겨 둔다 */
export function takeBatch(storage, want, now = Date.now()) {
  let raw = null;
  try { raw = storage.getItem(BATCH_KEY); } catch { return null; }
  if (raw == null) return null;
  const drop = () => { try { storage.removeItem(BATCH_KEY); } catch { /* 넘어감 */ } };
  if (raw.length > BATCH_MAX_BYTES * 2) { drop(); return null; }
  let v = null;
  try { v = validBatch(JSON.parse(raw), now); } catch { v = null; }
  if (!v) { drop(); return null; }
  if (v.source !== want) return null;
  drop();
  return v;
}

/** 작성기 표의 행들을 보낼 묶음으로: rows [{ studentId, name, area, subject, text }] -> groups */
export function groupsForCheck(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!String(r.text || '').trim()) continue;
    const key = `${r.area}|${r.subject || ''}`;
    if (!map.has(key)) map.set(key, { area: r.area, subject: r.area === 'subject' ? r.subject || '' : '', items: [] });
    map.get(key).items.push({ studentId: r.studentId, name: r.name || '', text: r.text });
  }
  return [...map.values()];
}
