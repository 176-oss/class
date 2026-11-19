// 작성 도우미와 글 주고받기 (기획서 11절). DOM 없음. storage(localStorage 꼴)를 주입받는다.
// localStorage 'sgb-handoff' = JSON { source, studentId, area, subject, text, at }
// 받는 쪽은 읽은 뒤 바로 지운다. 5분이 지났거나 모양이 틀리면 지운다. 주소창에는 글을 넣지 않는다.

export const HANDOFF_KEY = 'sgb-handoff';
export const HANDOFF_TTL_MS = 5 * 60 * 1000;
export const HANDOFF_MAX_BYTES = 20 * 1024;
const SOURCES = ['sgb-checker', 'textgenerator-v2'];
const AREAS = ['autonomy', 'club', 'career', 'subject', 'individual', 'behavior'];

/** 모양이 맞으면 정리한 값, 아니면 null */
export function validHandoff(v, now) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const { source, studentId = '', area, subject = '', text, at } = v;
  if (!SOURCES.includes(source) || !AREAS.includes(area)) return null;
  if (typeof studentId !== 'string' || studentId.length > 20) return null;
  if (typeof subject !== 'string' || subject.length > 40) return null;
  if (typeof text !== 'string' || !text.trim() || text.length > 6000) return null;
  if (!Number.isFinite(at) || now - at > HANDOFF_TTL_MS || at - now > 60 * 1000) return null;
  return { source, studentId, area, subject, text, at };
}

export function writeHandoff(storage, { studentId = '', area, subject = '', text }, now = Date.now()) {
  const v = validHandoff({ source: 'sgb-checker', studentId: String(studentId), area, subject: String(subject), text, at: now }, now);
  if (!v) return false;
  const raw = JSON.stringify(v);
  if (new TextEncoder().encode(raw).length > HANDOFF_MAX_BYTES) return false;
  try { storage.setItem(HANDOFF_KEY, raw); return true; } catch { return false; }
}

/** 작성 도우미가 보낸 것만 받는다. 받거나 틀린 값이면 지운다. 우리가 보낸 것은 5분 안이면 남겨 둔다 */
export function takeHandoff(storage, now = Date.now()) {
  let raw = null;
  try { raw = storage.getItem(HANDOFF_KEY); } catch { return null; }
  if (raw == null) return null;
  const drop = () => { try { storage.removeItem(HANDOFF_KEY); } catch { /* 넘어감 */ } };
  if (raw.length > HANDOFF_MAX_BYTES) { drop(); return null; }
  let v = null;
  try { v = validHandoff(JSON.parse(raw), now); } catch { v = null; }
  if (!v) { drop(); return null; }
  if (v.source !== 'textgenerator-v2') return null;
  drop();
  return v;
}
