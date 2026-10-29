// 화면 공통 도우미: 이스케이프, 아이콘, 토스트, 바텀시트, 확인 모달
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const icon = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// 세그먼트 (role=radiogroup)
export function seg(name, label, options, value, { disabled = false } = {}) {
  return `<div class="seg" role="radiogroup" aria-label="${esc(label)}" data-seg="${esc(name)}">${options.map(([v, t]) =>
    `<button type="button" class="seg-item" role="radio" aria-checked="${v === value}" tabindex="${v === value ? 0 : -1}" data-seg-value="${esc(v)}"${disabled ? ' disabled' : ''}>${esc(t)}</button>`).join('')}</div>`;
}

// 세그먼트 키보드 이동 (화살표)
document.addEventListener('keydown', (e) => {
  const item = e.target.closest?.('.seg-item');
  if (!item || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const items = $$('.seg-item:not(:disabled)', item.parentElement);
  const i = items.indexOf(item);
  const next = items[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length];
  e.preventDefault();
  const segName = item.parentElement.dataset.seg;
  const value = next.dataset.segValue;
  next.click();
  // 클릭 후 화면이 다시 그려질 수 있으므로 같은 항목을 다시 찾아 포커스
  const target = document.querySelector(`[data-seg="${segName}"] [data-seg-value="${value}"]`) || next;
  target.focus();
});

export function quota(used, limit, text) {
  const full = used >= limit;
  let bars = '';
  for (let i = 0; i < limit; i++) bars += `<i${i < used ? ' class="on"' : ''}></i>`;
  return `<span class="quota${full ? ' is-full' : ''}"><span class="quota-bar" aria-hidden="true">${bars}</span>${esc(text)}</span>`;
}

// ---------- 토스트 ----------
let toastTimer = null;
export function toast(message, { action, onAction, danger = false, duration = 4000 } = {}) {
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="toast${danger ? ' toast-danger' : ''}" role="status">${esc(message)}${action ? ` <button type="button" class="btn btn-ghost" data-toast-action>${esc(action)}</button>` : ''}</div>`;
  if (action) {
    root.querySelector('[data-toast-action]').addEventListener('click', () => {
      root.innerHTML = '';
      onAction?.();
    });
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { root.innerHTML = ''; }, action ? Math.max(duration, 6000) : duration);
}

// ---------- 바텀시트 / 모달 ----------
let lastFocus = null;
export function openSheet(html, { center = false, labelledby = 'sheet-title', onClose } = {}) {
  closeSheet();
  lastFocus = document.activeElement;
  const root = document.getElementById('overlay-root');
  root.innerHTML = `<div class="overlay${center ? ' overlay-center' : ''}" data-overlay>
    <div class="${center ? 'modal' : 'sheet'}" role="dialog" aria-modal="true" aria-labelledby="${labelledby}">${center ? '' : '<div class="sheet-handle"></div>'}${html}</div></div>`;
  const overlay = root.firstElementChild;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });
  overlay._onClose = onClose;
  document.body.classList.add('has-overlay');
  const focusable = overlay.querySelector('[autofocus], .sheet-title, .modal-title');
  if (focusable) { focusable.setAttribute('tabindex', '-1'); focusable.focus({ preventScroll: true }); }
  return overlay.firstElementChild;
}
export function closeSheet() {
  const root = document.getElementById('overlay-root');
  if (!root || !root.firstElementChild) return;
  const cb = root.firstElementChild._onClose;
  root.innerHTML = '';
  document.body.classList.remove('has-overlay');
  cb?.();
  if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

export function confirmDialog({ title, body, ok = '확인', cancel = '취소', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const el = openSheet(`
      <div class="modal-head"><h2 class="modal-title" id="modal-title">${esc(title)}</h2></div>
      <p class="small muted" style="margin:0">${esc(body)}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-cancel>${esc(cancel)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button>
      </div>`, { center: true, labelledby: 'modal-title', onClose: () => finish(false) });
    el.querySelector('[data-ok]').addEventListener('click', () => { finish(true); closeSheet(); });
    el.querySelector('[data-cancel]').addEventListener('click', () => closeSheet());
  });
}

// 받침에 따라 조사 고르기: josa('처방전', '을', '를') → '처방전을'
export function josa(word, withBatchim, without) {
  const w = String(word || '').trim();
  const code = w.charCodeAt(w.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return w + withBatchim;
  return w + (code % 28 ? withBatchim : without);
}

// 역할이 버튼인 목록 행: Enter/Space로 열기
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-open]')) {
    e.preventDefault();
    e.target.click();
  }
});
