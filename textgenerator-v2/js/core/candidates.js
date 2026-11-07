// 초안 후보 고치기와 판(version) 관리. 순수 모듈 (contract 17절).
// Candidate = { original, text, versions: [], edited }. versions는 오래된 것부터, 최대 MAX_CANDIDATE_VERSIONS개.

import { MAX_CANDIDATE_VERSIONS } from './model.js';

const withText = (c, text, versions) => ({ ...c, text, versions, edited: text !== c.original });

/** 글 바꾸기 (판은 그대로) */
export function editCandidate(c, text) {
  return withText(c, String(text ?? ''), c.versions || []);
}

/** 지금 글을 판으로 남기고 새 글로. 새 글이 지금과 같으면 그대로 */
export function pushVersion(c, nextText) {
  const next = String(nextText ?? '');
  if (next === c.text) return c;
  return withText(c, next, [...(c.versions || []), c.text].slice(-MAX_CANDIDATE_VERSIONS));
}

/** 마지막 판으로 되돌림. 판이 없으면 그대로 */
export function undoVersion(c) {
  const v = c.versions || [];
  if (!v.length) return c;
  return withText(c, v[v.length - 1], v.slice(0, -1));
}

/** AI 원문으로 (지금 글은 판으로 남아 [이전 판]으로 돌아올 수 있음) */
export function resetCandidate(c) {
  return pushVersion(c, c.original);
}
