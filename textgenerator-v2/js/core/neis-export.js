// 확장프로그램으로 보낼 데이터, 글 hash, 입력 완료 반영. 순수 모듈.

import { byteLength } from './bytes.js';
import { AREAS, splitStudentId } from './model.js';

export const NEIS_BATCH_KIND = 'sgb-neis-batch';
export const NEIS_BATCH_VERSION = 1;

function getSubtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('crypto.subtle 을 쓸 수 없습니다.');
  return c.subtle;
}

/** SHA-256 hex 앞 16자리 (UTF-8) */
export async function textHash(text) {
  const data = new TextEncoder().encode(String(text ?? ''));
  const buf = await getSubtle().digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < 8; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function nameMap(students) {
  const map = new Map();
  if (students instanceof Map) {
    for (const [k, v] of students) map.set(String(k), typeof v === 'string' ? v : v?.name ?? '');
  } else if (Array.isArray(students)) {
    for (const s of students) if (s && s.studentId) map.set(String(s.studentId), s.name ?? '');
  } else if (students && typeof students === 'object') {
    for (const [k, v] of Object.entries(students)) map.set(String(k), typeof v === 'string' ? v : v?.name ?? '');
  }
  return map;
}

function hasFinal(r) {
  return typeof r?.final === 'string' && r.final.trim() !== '';
}

/**
 * 확장 보내기 데이터. done 이고 final 이 있는 기록만.
 * @returns {Promise<{kind, version, createdAt, schoolYear, semester, items}>}
 */
export async function buildNeisBatch({ records = [], students = [], settings = {}, now = new Date() } = {}) {
  const names = nameMap(students);
  const picked = (Array.isArray(records) ? records : [])
    .filter((r) => r && r.status === 'done' && hasFinal(r))
    .sort((a, b) => {
      if (a.studentId !== b.studentId) return String(a.studentId).localeCompare(String(b.studentId));
      const ai = AREAS.indexOf(a.area);
      const bi = AREAS.indexOf(b.area);
      if (ai !== bi) return ai - bi;
      return String(a.subject ?? '').localeCompare(String(b.subject ?? ''));
    });
  const items = [];
  for (const r of picked) {
    const { grade, classNo, no } = splitStudentId(r.studentId);
    items.push({
      id: r.id,
      studentId: String(r.studentId),
      grade,
      classNo,
      no,
      name: names.get(String(r.studentId)) ?? '',
      area: r.area,
      subject: r.area === 'subject' ? (r.subject ?? null) : null,
      text: r.final,
      bytes: byteLength(r.final),
      hash: await textHash(r.final),
    });
  }
  const created = now instanceof Date ? now : new Date(now);
  return {
    kind: NEIS_BATCH_KIND,
    version: NEIS_BATCH_VERSION,
    createdAt: created.toISOString(),
    schoolYear: settings?.schoolYear ?? null,
    semester: settings?.semester ?? null,
    items,
  };
}

const HASH_RE = /^[0-9a-f]{16}$/;

/**
 * 확장이 알려 준 입력 완료 목록 반영.
 * record.id === item.id 이고 hash 가 지금 final 의 hash 와 같을 때만 neis = { hash, doneAt: savedAt }.
 * @returns {Promise<{ updated: object[], ignored: number }>}
 */
export async function applyNeisDone(records, doneItems) {
  const byId = new Map();
  for (const r of Array.isArray(records) ? records : []) if (r && r.id) byId.set(r.id, r);
  const updated = [];
  let ignored = 0;
  for (const item of Array.isArray(doneItems) ? doneItems : []) {
    const rec = item && byId.get(item.id);
    if (!rec || typeof item.hash !== 'string' || !HASH_RE.test(item.hash) || !hasFinal(rec)) {
      ignored += 1;
      continue;
    }
    const current = await textHash(rec.final);
    if (current !== item.hash) {
      ignored += 1;
      continue;
    }
    const doneAt = typeof item.savedAt === 'string' && item.savedAt ? item.savedAt : new Date().toISOString();
    const next = { ...rec, neis: { hash: item.hash, doneAt } };
    byId.set(rec.id, next);
    updated.push(next);
  }
  return { updated, ignored };
}
