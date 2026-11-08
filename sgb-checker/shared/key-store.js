// Gemini API 키 함께 쓰기 (기획서 10-1절). DOM 없음. storage(localStorage 꼴)를 주입받는다.
// 작성 도우미도 이 파일 내용을 그대로 복사해 쓸 수 있게 만든다 (폴더 사이 import는 하지 않음).
//
// 공용 자리: localStorage 'class:gemini-key' = JSON { key, savedBy: 'textgenerator-v2'|'sgb-checker', savedAt: ms }
// 작성 도우미의 지금 자리: localStorage 'sgb-v2-api-key' = 키 문자열 그대로 (textgenerator-v2/js/store.js). 읽기만 한다.

export const SHARED_KEY = 'class:gemini-key';
export const LEGACY_KEYS = ['sgb-v2-api-key'];
const SAVERS = ['textgenerator-v2', 'sgb-checker'];
// 점검기에서 [키 지우기]를 누른 뒤에는 작성 도우미 자리의 같은 키(끝 4자리로 구분)를 다시 가져오지 않는다
export const SKIP_LEGACY = 'sgb-checker:skip-legacy-key';

/** 키 모양 검사: 공백 없는 30~100자 */
export function isValidKey(key) {
  return typeof key === 'string' && /^[^\s]{30,100}$/.test(key);
}

/** 끝 4자리만 */
export function maskKey(key) {
  return isValidKey(key) ? `****${key.slice(-4)}` : '';
}

const get = (s, k) => { try { return s?.getItem(k) ?? null; } catch { return null; } };
const set = (s, k, v) => { try { s?.setItem(k, v); return true; } catch { return false; } };
const del = (s, k) => { try { s?.removeItem(k); } catch { /* 막혀 있으면 넘어감 */ } };

function readShared(storage) {
  const raw = get(storage, SHARED_KEY);
  if (!raw || raw.length > 1000) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || !isValidKey(v.key) || !SAVERS.includes(v.savedBy) || !Number.isFinite(v.savedAt)) return null;
    return { key: v.key, savedBy: v.savedBy, savedAt: v.savedAt };
  } catch { return null; }
}

function readLegacy(storage) {
  for (const k of LEGACY_KEYS) {
    const v = get(storage, k);
    if (isValidKey(v)) return v;
  }
  return null;
}

/**
 * @param {Storage} storage localStorage
 * @param {() => number} now
 */
export function createKeyStore(storage, now = () => Date.now()) {
  let sessionKey = null; // '이번에만 사용': 메모리에만, 공유 안 함
  return {
    /** { key, source: 'session'|'shared'|'legacy', savedBy } 또는 null */
    read() {
      if (sessionKey) return { key: sessionKey, source: 'session', savedBy: 'sgb-checker' };
      const shared = readShared(storage);
      if (shared) return { key: shared.key, source: 'shared', savedBy: shared.savedBy };
      let legacy = readLegacy(storage);
      if (legacy && legacy.slice(-4) === get(storage, SKIP_LEGACY)) legacy = null; // 지운 그 키면 다시 가져오지 않음
      if (legacy) {
        // 다음부터 빠르게, 작성 도우미가 공용 자리로 바뀐 뒤에도 그대로 동작하게 복사해 둠
        set(storage, SHARED_KEY, JSON.stringify({ key: legacy, savedBy: 'textgenerator-v2', savedAt: now() }));
        return { key: legacy, source: 'legacy', savedBy: 'textgenerator-v2' };
      }
      return null;
    },
    /** 이 브라우저에 저장 (공용 자리). 실패하면 false */
    save(key) {
      const k = String(key ?? '').trim();
      if (!isValidKey(k)) return false;
      sessionKey = null;
      del(storage, SKIP_LEGACY);
      return set(storage, SHARED_KEY, JSON.stringify({ key: k, savedBy: 'sgb-checker', savedAt: now() }));
    },
    /** 이번에만 사용 */
    useForSession(key) {
      const k = String(key ?? '').trim();
      if (!isValidKey(k)) return false;
      sessionKey = k;
      return true;
    },
    /** 공용 자리만 지운다 (작성 도우미의 원래 자리는 그대로). legacyRemains: 작성 도우미 자리에 키가 남아 있는지 */
    clear() {
      sessionKey = null;
      del(storage, SHARED_KEY);
      const legacy = readLegacy(storage);
      if (legacy) set(storage, SKIP_LEGACY, legacy.slice(-4));
      return { legacyRemains: Boolean(legacy) };
    },
  };
}
