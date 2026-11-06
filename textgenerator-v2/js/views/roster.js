// 명단: 반 만들기·고치기·지우기, 명단 등록(엑셀 양식, NEIS 출석부, 붙여넣기), 학생 빼기
import { h, clear, icon, focusEl, uid } from '../dom.js';
import { toast, confirmDialog, openDialog, seg, badge, alertBox, emptyState, viewHeader, field } from '../ui.js';
import * as store from '../store.js';
import { KIND_LABELS, AREAS_BY_KIND, AREA_LABELS } from '../core/model.js';
import { parseRosterRows, parsePastedRoster, TEMPLATE_ROWS } from '../core/roster-parse.js';
import { hasXlsx, readSheetFile, downloadSheet, XLSX_MISSING_TEXT } from '../xlsx-io.js';

let selectedId = null;
let pasteText = '';
let root = null;
let resultEl = null;

const KIND_OPTIONS = [['homeroom', '담임'], ['subject', '교과'], ['club', '동아리']];

function rowMessage(e) {
  const msg = String(e.message || '');
  return e.row && !msg.startsWith(`${e.row}행`) ? `${e.row}행: ${msg}` : msg;
}

// ---------- 반 만들기 ----------
/** 같은 이름의 반이 있는지 (exceptId 반은 빼고) */
function nameTaken(name, exceptId = null) {
  const n = String(name).trim();
  return store.listClasses().some((c) => c.id !== exceptId && c.name.trim() === n);
}

function createForm() {
  let kind = 'homeroom';
  const nameInput = h('input', { class: 'input', type: 'text', id: 'new-class-name', autocomplete: 'off', placeholder: '예: 3학년 5반, 통합과학 1-3, 과학탐구반', maxlength: '40' });
  const subjectInput = h('input', { class: 'input', type: 'text', id: 'new-class-subject', autocomplete: 'off', placeholder: '예: 통합과학', maxlength: '40' });
  const achInput = h('textarea', { class: 'textarea', id: 'new-class-ach', rows: '3', placeholder: '선택. 교과세특 초안에 기본으로 쓰는 성취기준' });
  const subjectWrap = h('div', { class: 'stack', hidden: true },
    field('과목명', subjectInput),
    field('기본 성취기준 (선택)', achInput, '학생마다 따로 적을 수도 있습니다.'));
  const errEl = h('p', { class: 'hint form-error', role: 'alert' });
  const kindSeg = seg({ label: '반 종류', options: KIND_OPTIONS, value: kind, onChange: (v) => { kind = v; subjectWrap.hidden = v !== 'subject'; areaHint.textContent = areaText(v); } });
  const areaText = (k) => `쓸 영역: ${AREAS_BY_KIND[k].map((a) => AREA_LABELS[a]).join(', ')}`;
  const areaHint = h('p', { class: 'hint' }, areaText(kind));
  const form = h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      errEl.textContent = '';
      nameInput.removeAttribute('aria-invalid');
      subjectInput.removeAttribute('aria-invalid');
      const name = nameInput.value.trim();
      if (!name) { nameInput.setAttribute('aria-invalid', 'true'); errEl.textContent = '반 이름을 적어 주세요.'; nameInput.focus(); return; }
      if (nameTaken(name)) { nameInput.setAttribute('aria-invalid', 'true'); errEl.textContent = `'${name}' 반이 이미 있습니다. 다른 이름을 적어 주세요 (예: ${name} 동아리).`; nameInput.focus(); return; }
      if (kind === 'subject' && !subjectInput.value.trim()) { subjectInput.setAttribute('aria-invalid', 'true'); errEl.textContent = '교과반은 과목명을 적어 주세요.'; subjectInput.focus(); return; }
      const cls = store.createClass({ name, kind, subject: subjectInput.value, achievement: achInput.value });
      selectedId = cls.id;
      nameInput.value = ''; subjectInput.value = ''; achInput.value = '';
      toast(`'${cls.name}' 반을 만들었습니다. 이제 명단을 등록해 주세요.`);
      render();
      focusEl(root.querySelector('#class-detail-title'));
    },
  },
  field('반 이름', nameInput),
  h('div', { class: 'field' }, h('span', { class: 'label', id: 'new-class-kind-label' }, '종류'), kindSeg, areaHint),
  subjectWrap,
  errEl,
  h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn btn-primary' }, icon('plus'), '반 만들기')));
  return h('section', { class: 'card stack', 'aria-labelledby': 'create-class-title' },
    h('h2', { class: 'card-title', id: 'create-class-title' }, '반 만들기'), form);
}

// ---------- 반 목록 ----------
function classList(classes) {
  if (!classes.length) return emptyState('users', '아직 만든 반이 없습니다. 위에서 반을 만들어 주세요.');
  return h('ul', { class: 'class-list', 'aria-label': '내 반 목록' }, classes.map((c) => h('li', {},
    h('button', {
      type: 'button', class: 'class-item', 'aria-pressed': c.id === selectedId,
      onclick: () => { selectedId = c.id; render(); focusEl(root.querySelector('#class-detail-title')); },
    },
    h('span', { class: 'class-item-name' }, c.name),
    h('span', { class: 'row' }, badge(KIND_LABELS[c.kind], 'memo'), c.subject ? h('span', { class: 'small muted' }, c.subject) : null,
      h('span', { class: 'small muted num' }, `${c.studentIds.length}명`))))));
}

// ---------- 반 고치기 ----------
function editClassDialog(cls) {
  const nameInput = h('input', { class: 'input', type: 'text', value: cls.name, autocomplete: 'off', maxlength: '40', autofocus: true });
  const subjectInput = h('input', { class: 'input', type: 'text', value: cls.subject || '', autocomplete: 'off', maxlength: '40' });
  const achInput = h('textarea', { class: 'textarea', rows: '3', value: cls.achievement || '' });
  const err = h('p', { class: 'hint form-error', role: 'alert' });
  const body = [
    field('반 이름', nameInput),
    cls.kind === 'subject' ? field('과목명', subjectInput, '과목명을 바꾸면 이 반 학생의 교과세특 기록도 새 과목명으로 옮깁니다.') : null,
    cls.kind === 'subject' ? field('기본 성취기준 (선택)', achInput) : null,
    h('p', { class: 'hint' }, `종류(${KIND_LABELS[cls.kind]})는 바꿀 수 없습니다. 다른 종류가 필요하면 새 반을 만들어 주세요.`),
    err,
  ];
  openDialog({
    title: '반 정보 고치기',
    body,
    actions: [
      { label: '취소', variant: 'secondary' },
      {
        label: '저장하기', variant: 'primary',
        onClick: () => {
          const name = nameInput.value.trim();
          if (!name) { err.textContent = '반 이름을 적어 주세요.'; nameInput.setAttribute('aria-invalid', 'true'); nameInput.focus(); return false; }
          if (nameTaken(name, cls.id)) { err.textContent = `'${name}' 반이 이미 있습니다. 다른 이름을 적어 주세요.`; nameInput.setAttribute('aria-invalid', 'true'); nameInput.focus(); return false; }
          const patch = { name };
          if (cls.kind === 'subject') {
            const sub = subjectInput.value.trim();
            if (!sub) { err.textContent = '과목명을 적어 주세요.'; subjectInput.setAttribute('aria-invalid', 'true'); subjectInput.focus(); return false; }
            if (sub !== cls.subject) store.renameSubjectRecords(cls.studentIds, cls.subject, sub);
            patch.subject = sub;
            patch.achievement = achInput.value;
          }
          store.updateClass(cls.id, patch);
          toast('반 정보를 고쳤습니다');
          return true;
        },
      },
    ],
  });
}

async function deleteClass(cls) {
  const ok = await confirmDialog({
    title: `'${cls.name}' 반을 지울까요?`,
    body: '반과 명단 연결만 지웁니다. 학생과 이미 쓴 기록은 남아 있어 같은 학번으로 다시 등록하면 그대로 보입니다.',
    ok: '반 지우기', danger: true,
  });
  if (!ok || !store.getClass(cls.id)) return;
  store.deleteClass(cls.id);
  selectedId = null;
  toast(`'${cls.name}' 반을 지웠습니다`);
  if (!root || !root.isConnected) return; // 확인하는 사이 화면이 바뀜
  render();
  focusEl(root.querySelector('h1'));
}

// ---------- 명단 등록 ----------
function showResult(node) {
  if (resultEl) clear(resultEl, node);
}

function errorBox(errors) {
  return alertBox('warn', h('div', { class: 'stack' },
    h('ul', { class: 'issue-list' }, errors.slice(0, 50).map((e) => h('li', { class: 'is-warn' }, rowMessage(e)))),
    errors.length > 50 ? h('p', { class: 'small' }, `그 밖에 ${errors.length - 50}개 행이 더 있습니다.`) : null,
    h('p', { class: 'small' }, '고치는 방법: 학번은 학년 1자리 + 반 2자리 + 번호 2자리 숫자 5자리로 씁니다 (예: 30501). 이름 칸이 비었는지, 같은 학번이 두 번 있는지 확인하세요. 엑셀을 고친 뒤 다시 올리면 됩니다.')),
  { title: `${errors.length}개 행에 문제가 있습니다` });
}

async function importParsed(cls, result) {
  const students = result?.students || [];
  const errors = result?.errors || [];
  if (!students.length && !errors.length) {
    showResult(alertBox('warn', '읽을 학생이 없습니다. 학번과 이름이 들어 있는지 확인해 주세요.'));
    return;
  }
  showResult(errors.length ? errorBox(errors) : null);
  if (errors.length) {
    if (!students.length) return;
    const ok = await confirmDialog({
      title: '오류 없는 행만 등록할까요?',
      body: `문제가 있는 ${errors.length}개 행은 빼고 ${students.length}명만 등록합니다. 나머지는 고친 뒤 다시 올리면 됩니다.`,
      ok: `${students.length}명 등록하기`,
    });
    if (!ok) return;
  }
  const conflicts = students.filter((s) => {
    const cur = store.getStudent(s.studentId);
    return cur && cur.name !== s.name;
  });
  let replaceNames = false;
  if (conflicts.length) {
    const dlg = openDialog({
      title: '이름이 다른 학번이 있습니다',
      body: [
        h('p', {}, '이미 등록된 학번인데 이름이 다릅니다. 어느 이름을 쓸까요?'),
        h('ul', { class: 'issue-list' }, conflicts.slice(0, 30).map((s) => h('li', { class: 'is-info' },
          `${s.studentId}: 지금 '${store.getStudent(s.studentId).name}', 새 명단 '${s.name}'`))),
        conflicts.length > 30 ? h('p', { class: 'small' }, `그 밖에 ${conflicts.length - 30}명`) : null,
      ],
      actions: [
        { label: '지금 이름 그대로 두기', variant: 'secondary', value: 'keep' },
        { label: '새 이름으로 바꾸기', variant: 'primary', value: 'replace' },
      ],
    });
    const choice = await dlg.closed;
    if (!choice) { toast('등록을 취소했습니다'); return; }
    replaceNames = choice === 'replace';
  }
  const toUpsert = students.filter((s) => {
    const cur = store.getStudent(s.studentId);
    return !cur || (replaceNames && cur.name !== s.name);
  }).map((s) => ({ studentId: s.studentId, name: s.name }));
  if (toUpsert.length) store.upsertStudents(toUpsert);
  const added = store.addStudentsToClass(cls.id, students.map((s) => s.studentId));
  const already = students.length - added;
  const msg = `'${cls.name}'에 ${added}명을 등록했습니다${already ? ` (${already}명은 이미 있었습니다)` : ''}`;
  toast(msg);
  if (!errors.length) showResult(alertBox('ok', msg));
  pasteText = '';
}

function registerSection(cls) {
  const fileInput = h('input', {
    type: 'file', accept: '.xlsx,.xls,.csv', hidden: true, id: 'roster-file',
    onchange: async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const rows = await readSheetFile(file);
        await importParsed(cls, parseRosterRows(rows));
      } catch (e) {
        console.error(e);
        showResult(alertBox('danger', e.name === 'XlsxMissingError' ? e.message : `파일을 읽지 못했습니다. 엑셀(.xlsx) 또는 CSV 파일인지 확인해 주세요. (${e.message || '알 수 없는 오류'})`, { role: 'alert' }));
      }
    },
  });
  const pasteId = uid('paste');
  const pasteArea = h('textarea', {
    class: 'textarea', id: pasteId, rows: '6', value: pasteText,
    placeholder: '30501\t김가온\n30502\t이나래\n(엑셀에서 학번과 이름 두 열을 복사해 붙여넣기)',
    oninput: () => { pasteText = pasteArea.value; },
  });
  const xlsxNote = hasXlsx() ? null : alertBox('warn', XLSX_MISSING_TEXT);
  return h('section', { class: 'stack', 'aria-labelledby': 'register-title' },
    h('h3', { id: 'register-title', class: 'section-title' }, '명단 등록'),
    xlsxNote,
    h('div', { class: 'grid-2' },
      h('div', { class: 'stack' },
        h('p', { class: 'small' }, '엑셀로 등록: 양식에 학번과 이름을 채워 올리거나, NEIS 출석부 엑셀을 그대로 올립니다. 머리글(학번, 이름 또는 학년·반·번호, 성명)은 자동으로 찾습니다.'),
        h('div', { class: 'row' },
          h('button', {
            type: 'button', class: 'btn btn-secondary',
            onclick: () => {
              try { downloadSheet(TEMPLATE_ROWS, '생기부_명단_양식.xlsx', '명단', { widths: [10, 16] }); }
              catch (e) { toast(e.message || XLSX_MISSING_TEXT, { danger: true }); }
            },
          }, icon('download'), '엑셀 양식 내려받기'),
          h('button', {
            type: 'button', class: 'btn btn-primary',
            onclick: () => fileInput.click(),
          }, icon('upload'), '엑셀 파일 올리기'),
          fileInput)),
      h('div', { class: 'stack' },
        field('붙여넣기로 등록', pasteArea, '한 줄에 한 명. 학번과 이름 사이는 탭, 쉼표, 띄어쓰기 모두 됩니다.'),
        h('div', { class: 'row' }, h('button', {
          type: 'button', class: 'btn btn-primary',
          onclick: () => {
            if (!pasteArea.value.trim()) { toast('붙여넣은 명단이 없습니다'); pasteArea.focus(); return; }
            importParsed(cls, parsePastedRoster(pasteArea.value));
          },
        }, '붙여넣은 명단 등록하기')))),
    h('div', { id: 'roster-result', class: 'stack', ref: (el) => { resultEl = el; } }));
}

function studentTable(cls) {
  const students = store.studentsOf(cls);
  if (!students.length) return emptyState('users', '아직 등록한 학생이 없습니다.');
  return h('div', { class: 'table-wrap is-scroll' },
    h('table', { class: 'table' },
      h('caption', { class: 'sr-only' }, `${cls.name} 학생 ${students.length}명`),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, '학번'), h('th', { scope: 'col' }, '이름'),
        h('th', { scope: 'col' }, '함께 속한 반'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, '빼기')))),
      h('tbody', {}, students.map((s) => {
        const others = store.classesOfStudent(s.studentId).filter((c) => c.id !== cls.id).map((c) => c.name);
        return h('tr', {},
          h('th', { scope: 'row', class: 'num' }, s.studentId),
          h('td', {}, s.name),
          h('td', { class: 'muted' }, others.join(', ') || '-'),
          h('td', {}, h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `${s.studentId} ${s.name} 학생을 이 반에서 빼기`,
            onclick: () => {
              store.removeStudentFromClass(cls.id, s.studentId);
              toast(`${s.name} 학생을 '${cls.name}'에서 뺐습니다. 기록은 남아 있습니다.`, {
                action: '되돌리기',
                onAction: () => { store.addStudentsToClass(cls.id, [s.studentId]); },
              });
              focusEl(root.querySelector('#class-detail-title'));
            },
          }, '반에서 빼기')));
      }))));
}

function detail(cls) {
  if (!cls) return null;
  return h('section', { class: 'card stack', 'aria-labelledby': 'class-detail-title' },
    h('div', { class: 'row-between' },
      h('div', { class: 'stack gap-1' },
        h('h2', { class: 'card-title', id: 'class-detail-title', tabindex: '-1' }, cls.name),
        h('p', { class: 'small muted' },
          `${KIND_LABELS[cls.kind]}반${cls.subject ? `, ${cls.subject}` : ''}, 학생 ${cls.studentIds.length}명, 영역: ${store.areasOfClass(cls).map((a) => a.label).join(', ')}`)),
      h('div', { class: 'row' },
        h('a', { class: 'btn btn-secondary', href: `#write?class=${encodeURIComponent(cls.id)}` }, icon('pen'), '작성하러 가기'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => editClassDialog(cls) }, icon('edit'), '반 정보 고치기'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: () => deleteClass(cls) }, icon('trash'), '반 지우기'))),
    registerSection(cls),
    h('section', { class: 'stack', 'aria-labelledby': 'students-title' },
      h('h3', { id: 'students-title', class: 'section-title' }, `학생 ${cls.studentIds.length}명`),
      studentTable(cls)));
}

function render() {
  if (!root) return;
  const activeId = document.activeElement?.id;
  const classes = store.listClasses();
  if (selectedId && !store.getClass(selectedId)) selectedId = null;
  if (!selectedId && classes.length) selectedId = classes[classes.length - 1].id;
  const prevResult = resultEl ? [...resultEl.childNodes] : [];
  clear(root,
    viewHeader('명단', '맡은 반(담임, 교과, 동아리)을 만들고 학번 5자리 명단을 등록합니다. 한 학생이 여러 반에 있어도 됩니다.'),
    h('div', { class: 'roster-layout' },
      h('div', { class: 'stack' },
        createForm(),
        h('section', { class: 'card stack', 'aria-labelledby': 'class-list-title' },
          h('h2', { class: 'card-title', id: 'class-list-title' }, `내 반 ${classes.length}개`),
          classList(classes))),
      detail(store.getClass(selectedId))));
  if (resultEl && prevResult.length) resultEl.append(...prevResult);
  if (activeId) { const el = document.getElementById(activeId); if (el && el !== document.activeElement) el.focus(); }
}

export const rosterView = {
  mount(el, params) {
    root = h('div', { class: 'view view-roster stack' });
    el.appendChild(root);
    if (params.get('class') && store.getClass(params.get('class'))) selectedId = params.get('class');
    render();
  },
  update(kind) {
    if (['classes', 'students', 'all'].includes(kind)) render();
  },
  unmount() { root = null; resultEl = null; },
};
