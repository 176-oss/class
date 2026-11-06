// 확장프로그램과 window.postMessage 로 주고받기 (contract 7절)
// 받는 메시지는 출처, source 필드, type, 필드 형식을 모두 검사한 뒤에만 쓴다.

const OUT = 'sgb-webapp';
const IN = 'sgb-extension';
const MAX_ITEMS = 5000;
const HASH_RE = /^[0-9a-f]{16}$/;

const pending = new Map(); // requestId별 resolve
const doneListeners = new Set();
let listening = false;

function newRequestId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function canPost() {
  return typeof location !== 'undefined' && location.origin && location.origin !== 'null';
}

function post(msg) {
  if (!canPost()) return false;
  window.postMessage(msg, location.origin);
  return true;
}

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function validDoneItem(it) {
  return isPlainObject(it)
    && typeof it.id === 'string' && it.id.length > 0 && it.id.length <= 200
    && typeof it.hash === 'string' && HASH_RE.test(it.hash)
    && typeof it.savedAt === 'string' && it.savedAt.length <= 40 && !Number.isNaN(Date.parse(it.savedAt));
}

/** 받은 메시지 검사. 맞으면 data, 아니면 null */
export function checkIncoming(event) {
  if (event.source !== window) return null;
  if (event.origin !== location.origin) return null;
  const d = event.data;
  if (!isPlainObject(d) || d.source !== IN) return null;
  if (d.type === 'sgb-batch-received') {
    if (typeof d.requestId !== 'string' || !d.requestId) return null;
    if (!Number.isInteger(d.count) || d.count < 0 || d.count > MAX_ITEMS) return null;
    return { type: d.type, requestId: d.requestId, count: d.count };
  }
  if (d.type === 'sgb-done-list') {
    if (d.requestId !== undefined && typeof d.requestId !== 'string') return null;
    if (!Array.isArray(d.items) || d.items.length > MAX_ITEMS) return null;
    if (!d.items.every(validDoneItem)) return null;
    return { type: d.type, requestId: d.requestId || null, items: d.items.map((it) => ({ id: it.id, hash: it.hash, savedAt: it.savedAt })) };
  }
  return null;
}

function onMessage(event) {
  const msg = checkIncoming(event);
  if (!msg) return;
  if (msg.type === 'sgb-batch-received') {
    const resolve = pending.get(msg.requestId);
    if (resolve) { pending.delete(msg.requestId); resolve({ received: true, count: msg.count }); }
    return;
  }
  if (msg.type === 'sgb-done-list') {
    for (const fn of [...doneListeners]) {
      try { fn(msg.items); } catch (e) { console.error(e); }
    }
  }
}

export function startBridge() {
  if (listening) return;
  listening = true;
  window.addEventListener('message', onMessage);
}

/** NEIS 입력 묶음 보내기. 3초 안에 받았다는 답이 오면 { received: true, count }, 아니면 { received: false } */
export function sendBatch(batch, { timeoutMs = 3000 } = {}) {
  startBridge();
  const requestId = newRequestId();
  return new Promise((resolve) => {
    if (!post({ source: OUT, type: 'sgb-batch', requestId, payload: batch })) { resolve({ received: false }); return; }
    pending.set(requestId, resolve);
    setTimeout(() => {
      if (pending.has(requestId)) { pending.delete(requestId); resolve({ received: false }); }
    }, timeoutMs);
  });
}

/** 확장에 입력 완료 목록을 달라고 요청 */
export function requestDone() {
  startBridge();
  post({ source: OUT, type: 'sgb-done-request', requestId: newRequestId() });
}

/** 입력 완료 목록을 받으면 fn(items). 해제 함수를 돌려줌 */
export function onDoneList(fn) {
  startBridge();
  doneListeners.add(fn);
  return () => doneListeners.delete(fn);
}
