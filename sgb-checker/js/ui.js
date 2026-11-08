// 알림, 대화상자, 내려받기. 글자는 모두 textContent/텍스트 노드로.
import { h } from './dom.js';

export function announce(text) {
  const live = document.getElementById('live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}

/** <dialog>로 묻기. body: 노드 배열. buttons: [{ label, value, primary }]. 닫히면 고른 value (Esc는 null) */
export function ask({ title, body = [], buttons, init }) {
  return new Promise((resolve) => {
    const id = `dlg-${Math.random().toString(36).slice(2)}`;
    const back = document.activeElement;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      if (back?.focus) back.focus();
      resolve(result ?? null);
    };
    const dlg = h('dialog', { 'aria-labelledby': id },
      h('h2', { id }, title),
      ...body,
      h('div', { class: 'row actions' },
        buttons.map((b) => h('button', { type: 'button', class: b.primary ? 'btn btn-primary' : 'btn', onclick: () => { const r = typeof b.value === 'function' ? b.value() : b.value; if (r !== undefined) finish(r); } }, b.label))));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); }); // Esc
    dlg.addEventListener('close', () => finish(null));
    document.body.appendChild(dlg);
    dlg.showModal();
    if (init) init(dlg);
  });
}

export const confirmBox = (title, text, ok = '확인') =>
  ask({ title, body: [h('p', text)], buttons: [{ label: '취소', value: false }, { label: ok, value: true, primary: true }] }).then((v) => v === true);

export function download(name, bytes, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function badge(kind, text) {
  return h('span', { class: `badge badge-${kind}` }, text);
}
