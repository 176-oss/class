// 현황: 행=학생, 열=영역. 칸은 바이트 비율 막대 + 상태 글자. 누르면 작성 화면 그 학생 패널로
import { h, clear } from '../dom.js';
import { byteBar, emptyState, viewHeader, LEVEL_TEXT } from '../ui.js';
import * as store from '../store.js';
import { STATUS_LABELS, KIND_LABELS, AREAS } from '../core/model.js';
import { byteLength, byteLevel } from '../core/bytes.js';

let root = null;
let ctx = null;
let classFilter = 'all';

function columnsFor(classes) {
  // 열 = (영역, 과목). 같은 열을 주는 반 목록도 함께
  const map = new Map();
  for (const c of classes) {
    for (const a of store.areasOfClass(c)) {
      const key = `${a.area}|${a.subject || ''}`;
      if (!map.has(key)) map.set(key, { ...a, key, classIds: [] });
      map.get(key).classIds.push(c.id);
    }
  }
  return [...map.values()].sort((x, y) => AREAS.indexOf(x.area) - AREAS.indexOf(y.area) || String(x.subject).localeCompare(String(y.subject)));
}

function cell(student, col, classes) {
  const cls = classes.find((c) => col.classIds.includes(c.id) && c.studentIds.includes(student.studentId));
  if (!cls) return h('td', { class: 'muted status-na' }, h('span', { 'aria-hidden': 'true' }, '-'), h('span', { class: 'sr-only' }, '해당 없음'));
  const rec = store.findRecord(student.studentId, col.area, col.subject) || { status: 'empty', final: '', area: col.area, subject: col.subject, studentId: student.studentId };
  const limit = store.limitOf(col.area);
  const text = rec.final || '';
  const bytes = byteLength(text);
  const level = byteLevel(bytes, limit);
  let forbiddenCount = 0;
  if (text) {
    const r = store.checkOf(rec, text);
    forbiddenCount = (r.forbidden || []).length;
  }
  const alert = level === 'over' || forbiddenCount > 0;
  const status = STATUS_LABELS[rec.status] || STATUS_LABELS.empty;
  const parts = [`${student.studentId} ${student.name}`, col.label, status];
  if (text) parts.push(`${bytes} / ${limit} byte`);
  if (level !== 'ok' && text) parts.push(LEVEL_TEXT[level]);
  if (forbiddenCount) parts.push(`금지 표현 ${forbiddenCount}개`);
  return h('td', { class: alert ? 'cell-alert' : null },
    h('button', {
      type: 'button', class: 'cell-link', 'aria-label': parts.join(', '),
      onclick: () => ctx.go('write-detail', { class: cls.id, area: col.area, student: student.studentId }),
    },
    byteBar(bytes, limit, level),
    h('span', { class: 'small status-cell-text', 'aria-hidden': 'true' },
      status, text ? h('span', { class: 'muted num' }, ` ${bytes}`) : null,
      forbiddenCount ? h('span', { class: 'text-danger' }, ` 금지 ${forbiddenCount}`) : null)));
}

function render() {
  if (!root) return;
  const all = store.listClasses();
  if (classFilter !== 'all' && !store.getClass(classFilter)) classFilter = 'all';
  const classes = classFilter === 'all' ? all : [store.getClass(classFilter)];
  const head = viewHeader('현황', '학생별, 영역별 작성 상태입니다. 막대는 한도 대비 최종본 바이트입니다. 빨간 테두리는 한도 초과나 금지 표현이 있는 칸입니다. 칸을 누르면 그 학생을 작성 화면에서 엽니다.');
  if (!all.length) {
    clear(root, head, emptyState('grid', '아직 반이 없습니다.', h('a', { class: 'btn btn-primary', href: '#roster' }, '명단으로 가기')));
    return;
  }
  const select = h('select', {
    class: 'select', id: 'status-class', value: classFilter,
    onchange: (e) => { classFilter = e.target.value; render(); document.getElementById('status-class')?.focus(); },
  }, h('option', { value: 'all' }, '모든 반'), all.map((c) => h('option', { value: c.id }, `${c.name} (${KIND_LABELS[c.kind]})`)));
  const ids = new Set();
  for (const c of classes) for (const id of c.studentIds) ids.add(id);
  const students = [...ids].map((id) => store.getStudent(id)).filter(Boolean).sort((a, b) => a.studentId.localeCompare(b.studentId));
  const cols = columnsFor(classes);

  // 열마다 완료 수
  const counts = cols.map((col) => {
    let total = 0; let done = 0;
    for (const s of students) {
      if (!classes.some((c) => col.classIds.includes(c.id) && c.studentIds.includes(s.studentId))) continue;
      total += 1;
      if (store.findRecord(s.studentId, col.area, col.subject)?.status === 'done') done += 1;
    }
    return { total, done };
  });

  const table = students.length ? h('div', { class: 'table-wrap is-scroll' },
    h('table', { class: 'table status-table' },
      h('caption', { class: 'sr-only' }, `작성 현황: 학생 ${students.length}명, 영역 ${cols.length}개`),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, '학번'),
        h('th', { scope: 'col' }, '이름'),
        cols.map((col, i) => h('th', { scope: 'col' }, col.label, h('span', { class: 'small muted num status-col-count' }, ` 완료 ${counts[i].done}/${counts[i].total}`))))),
      h('tbody', {}, students.map((s) => h('tr', {},
        h('th', { scope: 'row', class: 'num' }, s.studentId),
        h('td', {}, s.name),
        cols.map((col) => cell(s, col, classes)))))))
    : emptyState('users', '이 반에 학생이 없습니다.');

  clear(root, head,
    h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', { class: 'label', for: 'status-class' }, '반'), select)),
    table);
}

export const statusView = {
  mount(el, params, c) {
    ctx = c;
    root = h('div', { class: 'view view-status stack' });
    el.appendChild(root);
    const pc = params.get('class');
    if (pc && store.getClass(pc)) classFilter = pc;
    render();
  },
  update(kind) {
    if (['save', 'key', 'sync', 'styles', 'secrets'].includes(kind)) return;
    const active = document.activeElement?.id;
    render();
    if (active) document.getElementById(active)?.focus();
  },
  unmount() { root = null; },
};
