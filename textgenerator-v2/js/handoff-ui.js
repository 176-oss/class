// 점검기에서 고친 글 받기: 점검기가 localStorage 에 둔 묶음을 읽어, 고른 학생의 최종본에 반영한다 (core/handoff.js).
import { h } from './dom.js';
import { toast, openDialog } from './ui.js';
import * as store from './store.js';
import { takeBatch, planReturn, BATCH_KEY } from './core/handoff.js';
import { AREA_LABELS } from './core/model.js';

let busy = false;

function lookup(studentId, area, subject, name) {
  const st = store.getStudent(studentId);
  if (!st) return null;
  if (name && st.name.replace(/\s+/g, '') !== name.replace(/\s+/g, '')) return null; // 이름이 다르면 다른 학생일 수 있어 건너뜀
  return store.getRecord(studentId, area, area === 'subject' ? subject : null);
}

async function receive() {
  if (busy) return;
  let got = null;
  try { got = takeBatch(window.localStorage, 'sgb-checker'); } catch { return; }
  if (!got) return;
  busy = true;
  try {
    const plan = planReturn(got, lookup);
    const s = plan.skipped;
    const skipText = [s.noStudent && `명단에 없거나 이름이 다른 학생 ${s.noStudent}명`, s.done && `완료한 학생 ${s.done}명`, s.same && `이미 같은 글 ${s.same}명`].filter(Boolean).join(', ');
    if (!plan.updates.length) { toast(`점검기에서 받은 글을 반영할 학생이 없습니다${skipText ? ` (${skipText})` : ''}`); return; }
    const dlg = openDialog({
      title: `점검기에서 고친 글 ${plan.updates.length}명`,
      wide: true,
      body: [
        h('p', {}, '고른 학생의 최종본을 점검기에서 고친 글로 바꿉니다. 바꾸기 전 글은 [되돌리기]로 돌릴 수 있습니다.'),
        skipText ? h('p', { class: 'small muted' }, `반영하지 않는 학생: ${skipText}`) : null,
        h('ul', { class: 'issue-list' }, plan.updates.slice(0, 30).map((u) => h('li', { class: 'is-info' },
          `${Number(String(u.studentId).slice(3)) || u.studentId}번 ${u.name} · ${AREA_LABELS[u.area]}${u.subject ? `(${u.subject})` : ''}`))),
        plan.updates.length > 30 ? h('p', { class: 'small' }, `그 밖에 ${plan.updates.length - 30}명`) : null,
      ],
      actions: [
        { label: '반영하지 않음', variant: 'secondary', value: false },
        { label: `${plan.updates.length}명 최종본에 반영`, variant: 'primary', value: true },
      ],
    });
    if (!(await dlg.closed)) { toast('점검기의 글을 반영하지 않았습니다'); return; }
    for (const u of plan.updates) store.updateRecord(u.id, { final: u.text });
    toast(`점검기에서 고친 글 ${plan.updates.length}명을 반영했습니다`, {
      action: '되돌리기',
      onAction: () => { for (const u of plan.updates) store.updateRecord(u.id, { final: u.before }); toast('반영을 되돌렸습니다'); },
    });
  } finally { busy = false; }
}

/** 처음 열 때와, 점검기가 다른 탭에서 글을 보낼 때(storage 이벤트) 받는다 */
export function watchChecker() {
  setTimeout(receive, 0);
  window.addEventListener('storage', (e) => { if (e.key === BATCH_KEY) receive(); });
}
