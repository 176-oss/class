// 화면 공통 부품: 알림(announce), 토스트, 대화상자, 세그먼트, 칩, 바이트 막대, 진행 막대, 내려받기
import { h, clear, icon, focusEl, uid } from './dom.js';

// ---------- 화면 읽기 알림 ----------
let liveTimer = null;
/** #live(aria-live=polite) 영역으로 화면 읽기 프로그램에 알림 */
export function announce(message) {
  const live = document.getElementById('live');
  if (!live) return;
  live.textContent = '';
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { live.textContent = String(message); }, 60);
}

// ---------- 토스트 ----------
let toastTimer = null;
/**
 * toast('저장했습니다', { action: '되돌리기', onAction, danger, duration })
 * 화면 읽기 알림은 #live 로 함께 보낸다.
 */
export function toast(message, { action, onAction, danger = false, duration = 4500 } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const actionBtn = action ? h('button', {
    type: 'button', class: 'btn btn-ghost btn-sm toast-action',
    onclick: () => { clear(root); clearTimeout(toastTimer); onAction?.(); },
  }, action) : null;
  const el = h('div', { class: ['toast', danger && 'toast-danger'] },
    h('span', {}, message), actionBtn);
  clear(root, el);
  announce(action ? `${message}. ${action} 버튼이 있습니다.` : message);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => clear(root), action ? Math.max(duration, 8000) : duration);
}

// ---------- 대화상자 ----------
/**
 * openDialog({ title, body, actions, onClose, wide })
 * - body: Node 또는 Node 배열
 * - actions: [{ label, variant: 'primary'|'secondary'|'danger'|'ghost', value, onClick(dlg) => false면 닫지 않음, autofocus }]
 * 돌려주는 값: { el, body, close(value), closed: Promise<value>, setActions(actions) }
 * Esc는 <dialog>의 cancel 동작으로 닫힌다. 닫히면 연 사람의 포커스로 돌아간다.
 */
export function openDialog({ title, body = [], actions = [], onClose, wide = false, beforeClose } = {}) {
  const opener = document.activeElement;
  const titleId = uid('dlg-title');
  const bodyEl = h('div', { class: 'stack dialog-body' }, body);
  const actionsEl = h('div', { class: 'dialog-actions' });
  const dialog = h('dialog', { class: ['dialog', wide && 'dialog-wide'], 'aria-labelledby': titleId },
    h('div', { class: 'row-between' },
      h('h2', { class: 'dialog-title', id: titleId, tabindex: '-1' }, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: () => api.close(undefined) }, icon('close'))),
    bodyEl, actionsEl);
  let resolveClosed;
  let result;
  const closed = new Promise((r) => { resolveClosed = r; });
  const api = {
    el: dialog,
    body: bodyEl,
    closed,
    close(value) {
      if (finished) return;
      if (beforeClose && beforeClose(value) === false) return;
      result = value;
      if (dialog.open) dialog.close();
      // close 이벤트는 화면을 그릴 때까지 늦게 올 수 있어 여기서 바로 마무리
      finish();
    },
    setActions(list) {
      clear(actionsEl, list.map((a) => h('button', {
        type: 'button',
        class: ['btn', `btn-${a.variant || 'secondary'}`],
        disabled: !!a.disabled,
        onclick: async () => {
          if (a.onClick) { const r = await a.onClick(api); if (r === false) return; }
          api.close(a.value);
        },
      }, a.icon ? icon(a.icon) : null, a.label)));
    },
  };
  api.setActions(actions);
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    dialog.remove();
    onClose?.(result);
    resolveClosed(result);
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
  }
  // Esc: 기본 닫기 대신 api.close 로 같은 길을 탐
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); api.close(undefined); });
  dialog.addEventListener('close', finish);
  document.body.appendChild(dialog);
  dialog.showModal();
  const auto = dialog.querySelector('[autofocus]');
  if (auto) auto.focus(); else focusEl(dialog.querySelector('.dialog-title'));
  return api;
}

/** 확인 대화상자. 확인을 누르면 true */
export function confirmDialog({ title, body, ok = '확인', cancel = '취소', danger = false }) {
  const content = Array.isArray(body) || body instanceof Node ? body : h('p', {}, body || '');
  const dlg = openDialog({
    title,
    body: content,
    actions: [
      { label: cancel, variant: 'secondary', value: false },
      { label: ok, variant: danger ? 'danger' : 'primary', value: true },
    ],
  });
  return dlg.closed.then((v) => v === true);
}

// ---------- 세그먼트 (라디오 묶음) ----------
/**
 * seg({ label, options: [[value, text]], value, onChange, disabled })
 * role=radiogroup, 화살표 키로 이동하며 고름
 */
export function seg({ label, labelledby, options, value, onChange, disabled = false }) {
  const group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': labelledby ? null : label, 'aria-labelledby': labelledby || null });
  let current = value;
  const items = options.map(([v, text]) => h('button', {
    type: 'button', class: 'seg-item', role: 'radio',
    'aria-checked': v === current, tabindex: v === current ? '0' : '-1',
    disabled, 'data-value': v, 'data-fkey': `seg-${labelledby || label}-${v}`,
    onclick: () => select(v, true),
  }, text));
  if (!options.some(([v]) => v === current) && items[0]) items[0].tabIndex = 0;
  function select(v, fire) {
    current = v;
    items.forEach((b, i) => {
      const on = options[i][0] === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (fire) onChange?.(v);
  }
  group.addEventListener('keydown', (e) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const live = items.filter((b) => !b.disabled);
    if (!live.length) return;
    let i = live.indexOf(document.activeElement);
    if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = live.length - 1;
    else i = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + live.length) % live.length;
    e.preventDefault();
    live[i].focus();
    select(options[items.indexOf(live[i])][0], true);
  });
  group.append(...items);
  group.setValue = (v) => select(v, false);
  return group;
}

// ---------- 칩 (켜고 끄기) ----------
export function chip(text, pressed, onToggle) {
  const b = h('button', {
    type: 'button', class: 'chip', 'aria-pressed': !!pressed,
    onclick: () => {
      const next = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(next));
      onToggle?.(next);
    },
  }, text);
  return b;
}

// ---------- 바이트 막대, 진행 막대 ----------
/** level: 'ok'|'near'|'over'. 막대는 장식이므로 숨기고 글자를 따로 둔다 */
export function byteBar(bytes, limit, level) {
  const pct = limit > 0 ? Math.min(100, Math.round((bytes / limit) * 100)) : 0;
  return h('div', { class: ['bytebar', level === 'near' && 'is-near', level === 'over' && 'is-over'], 'aria-hidden': 'true' },
    h('div', { class: 'bytebar-fill', style: { width: `${pct}%` } }));
}

export const LEVEL_TEXT = { ok: '', near: '한도에 가까움', over: '한도 초과' };

export function progressBar(label) {
  const fill = h('div', { class: 'progress-fill', style: { width: '0%' } });
  const el = h('div', { class: 'progress', role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
  el.set = (done, total) => {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    fill.style.width = `${pct}%`;
    el.setAttribute('aria-valuenow', String(pct));
    el.setAttribute('aria-valuetext', `${total}개 중 ${done}개`);
  };
  return el;
}

// ---------- 배지, 알림 상자 ----------
export function badge(text, kind) {
  return h('span', { class: ['badge', kind && `badge-${kind}`] }, text);
}

/** alert('warn', '내용', { title }) 내용은 문자열 또는 노드 */
export function alertBox(kind, content, { title, role } = {}) {
  const ic = { info: 'info', warn: 'alert', danger: 'alert', ok: 'check' }[kind] || 'info';
  return h('div', { class: ['alert', `alert-${kind}`], role: role || null },
    icon(ic),
    h('div', { class: 'stack alert-body' }, title ? h('strong', {}, title) : null,
      typeof content === 'string' ? h('p', {}, content) : content));
}

export function emptyState(iconName, text, ...extra) {
  return h('div', { class: 'empty-state' }, icon(iconName), h('p', {}, text), extra);
}

// ---------- 파일 ----------
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadJSON(obj, filename) {
  downloadBlob(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), filename);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('파일을 읽지 못했습니다.'));
    r.readAsText(file, 'utf-8');
  });
}

/** 파일명용 시각: 20261106-0930 */
export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 화면 제목 블록: h1 + 설명 */
export function viewHeader(title, desc, ...tools) {
  return h('div', { class: 'view-head row-between' },
    h('div', { class: 'stack view-head-text' },
      h('h1', { class: 'view-title', tabindex: '-1' }, title),
      desc ? h('p', { class: 'muted' }, desc) : null),
    tools.length ? h('div', { class: 'row' }, tools) : null);
}

/** 라벨이 붙은 입력 묶음 */
export function field(labelText, control, hintText) {
  const id = control.id || uid('f');
  control.id = id;
  const hintId = hintText ? `${id}-hint` : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return h('div', { class: 'field' },
    h('label', { class: 'label', for: id }, labelText),
    control,
    hintText ? h('p', { class: 'hint', id: hintId }, hintText) : null);
}
