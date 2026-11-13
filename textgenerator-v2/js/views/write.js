// 작성: 반 고르기 + 영역 탭 + 학생 표 + 오른쪽 패널(메모/초안/검사/NEIS) + 일괄 초안
import { h, clear, icon, focusEl, debounce } from '../dom.js';
import {
  toast, announce, openDialog, seg, chip, byteBar, badge, alertBox, emptyState, field,
  progressBar, LEVEL_TEXT, formatDateTime,
} from '../ui.js';
import * as store from '../store.js';
import { STATUS_LABELS, LENGTH_LABELS, TRAITS_BY_AREA, KIND_LABELS, deriveStatus, newCandidate, normalizeCandidates } from '../core/model.js';
import { byteLength, byteLevel } from '../core/bytes.js';
import { cleanText, STYLE_OVERLAP_TEXT } from '../core/check.js';
import { generateDrafts, refineDraft, AiError } from '../core/gemini.js';
import { editCandidate, pushVersion, undoVersion, resetCandidate } from '../core/candidates.js';
import { pickExamples, styleKey } from '../core/style.js';
import { createBatch, pickBatchTargets } from '../core/batch.js';
import { textHash } from '../core/neis-export.js';

const STEPS = [
  { key: 'memo', label: '1 메모' },
  { key: 'draft', label: '2 초안' },
  { key: 'check', label: '3 검사' },
  { key: 'neis', label: '4 NEIS' },
];
const FILTERS = [['all', '모든 상태'], ['empty', '미작성'], ['memo', '메모'], ['draft', '초안'], ['done', '완료']];

const S = {
  classId: null,
  area: null,
  open: null, // 학번
  step: 'memo',
  filter: 'all',
  selected: new Set(), // 학번
  busy: new Set(), // 초안 만드는 중인 기록 id
  errors: new Map(), // 기록 id별 오류 문구
  insufficient: new Set(), // 기록 id
  refining: new Set(), // 다듬는 중인 후보 '기록id#번호'
  styleOff: new Set(), // '내 스타일 적용'을 끈 스타일 영역 키 (화면 메모리, 저장 안 함)
};

let ctx = null;
let root = null;
let els = {}; // 화면 조각 참조
let batch = null; // 진행 중인 일괄 초안
let batchUi = null;
let batchShort = new Set(); // 일괄 초안에서 메모가 부족해 건너뛴 기록 id

// ---------- 공통 계산 ----------
const cls = () => store.getClass(S.classId);
const areaInfo = () => store.areasOfClass(cls()).find((a) => a.area === S.area) || null;
function recordOf(studentId) {
  const a = areaInfo();
  return a ? store.getRecord(studentId, a.area, a.subject) : null;
}
function rosterAll() {
  return [...store.state.students.values()].map((s) => ({ studentId: s.studentId, name: s.name }));
}
function aiRecord(rec) {
  const c = cls();
  return { ...rec, achievement: rec.achievement || c?.achievement || '' };
}
function syncParams() {
  ctx?.setParams('write-detail', { class: S.classId, area: S.area, student: S.open });
}

// ---------- 자동 저장 (0.6초 디바운스) ----------
let pending = null; // { id, patch }
const commit = debounce(() => {
  if (!pending) return;
  const { id, patch } = pending;
  pending = null;
  store.updateRecord(id, patch);
}, 600);
function queuePatch(id, patch) {
  if (pending && pending.id !== id) commit.flush();
  pending = pending ? { id, patch: { ...pending.patch, ...patch } } : { id, patch: { ...patch } };
  setSaveText('입력 중');
  commit();
}
function flushPending() { commit.flush(); }
/** 지금 화면에 보이는 값 (아직 저장 전 입력 포함) */
function liveRecord(id) {
  const r = store.state.records.get(id);
  return pending && pending.id === id ? { ...r, ...pending.patch } : r;
}

function setSaveText(text) {
  if (els.saveText) els.saveText.textContent = text;
}
function saveStatusText() {
  const s = store.state.save.status;
  if (s === 'pending' || s === 'saving') return '저장 중';
  if (s === 'error') return '저장 실패';
  if (s === 'saved') return '저장됨';
  return '';
}

// ---------- 탭 목록 (화살표 키) ----------
function tabList({ label, items, value, onSelect, idPrefix, panelId }) {
  const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': label });
  const btns = items.map((it) => h('button', {
    type: 'button', class: 'tab', role: 'tab', id: `${idPrefix}-${it.key}`,
    'aria-selected': it.key === value, 'aria-controls': panelId, tabindex: it.key === value ? '0' : '-1',
    onclick: () => onSelect(it.key),
  }, it.label));
  list.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    let n = i;
    if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = btns.length - 1;
    else n = (i + (e.key === 'ArrowLeft' ? -1 : 1) + btns.length) % btns.length;
    const key = items[n].key;
    onSelect(key);
    document.getElementById(`${idPrefix}-${key}`)?.focus();
  });
  list.append(...btns);
  return list;
}

// ---------- 표 ----------
function visibleStudents() {
  const list = store.studentsOf(cls());
  if (S.filter === 'all') return list;
  return list.filter((s) => recordOf(s.studentId).status === S.filter);
}

function checkSummary(rec) {
  const text = rec.final;
  if (!text) return { node: h('span', { class: 'muted' }, '-'), alert: false };
  const r = store.checkOf(rec, text);
  if (!r.issueCount) return { node: h('span', { class: 'small muted' }, '문제 없음'), alert: false, result: r };
  return { node: badge(`문제 ${r.issueCount}`, 'danger'), alert: true, result: r };
}

function rowFor(s) {
  const rec = recordOf(s.studentId);
  const limit = store.limitOf(rec.area);
  const bytes = byteLength(rec.final || '');
  const level = byteLevel(bytes, limit);
  const chk = checkSummary(rec);
  const isOpen = S.open === s.studentId;
  // 체크박스는 Tab 순서에서 빼고(행에서 Space로 고름), 칸 전체를 감싼 label이 누르는 곳
  const cb = h('input', {
    type: 'checkbox', checked: S.selected.has(s.studentId), tabindex: '-1',
    'aria-label': `${s.studentId} ${s.name} 고르기`,
    onchange: (e) => {
      if (e.target.checked) S.selected.add(s.studentId); else S.selected.delete(s.studentId);
      updateSelectionUi();
    },
  });
  return h('tr', {
    'data-sid': s.studentId,
    class: ['is-clickable', isOpen && 'is-selected'],
    'aria-selected': isOpen ? 'true' : null,
    tabindex: isOpen ? '0' : '-1',
    onclick: (e) => { if (e.target.closest('input,button,a,label')) return; openStudent(s.studentId, { focus: 'panel' }); },
    onkeydown: (e) => onRowKey(e, s.studentId),
  },
  h('td', { class: 'col-check' }, h('label', { class: 'check-hit', onclick: (e) => e.stopPropagation() }, cb)),
  h('th', { scope: 'row', class: 'num' }, s.studentId),
  h('td', { class: 'col-name' }, s.name),
  h('td', { class: 'col-text' }, h('div', { class: 'clamp-2' }, rec.memo || '')),
  h('td', { class: 'col-text' }, h('div', { class: 'clamp-2' }, rec.draft || '')),
  h('td', { class: 'col-text' }, h('div', { class: 'clamp-2' }, rec.final || '')),
  h('td', { class: ['num', level === 'over' && 'text-danger'] }, rec.final ? `${bytes}` : '-',
    level !== 'ok' && rec.final ? h('span', { class: 'sr-only' }, ` ${LEVEL_TEXT[level]}`) : null),
  h('td', {}, badge(STATUS_LABELS[rec.status], rec.status)),
  h('td', { class: chk.alert ? 'cell-alert' : null }, chk.node));
}

function onRowKey(e, sid) {
  const tr = e.currentTarget;
  if (e.target !== tr) return;
  if (e.key === 'Enter') { e.preventDefault(); openStudent(sid, { focus: 'panel' }); return; }
  if (e.key === ' ') { e.preventDefault(); toggleSelect(sid); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
    if (next) moveRowFocus(next);
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    const rows = [...tr.parentElement.children];
    moveRowFocus(e.key === 'Home' ? rows[0] : rows[rows.length - 1]);
  }
}
function toggleSelect(sid) {
  const on = !S.selected.has(sid);
  if (on) S.selected.add(sid); else S.selected.delete(sid);
  updateSelectionUi();
  const st = store.getStudent(sid);
  announce(`${st?.name || sid} ${on ? '고름' : '고르기 풀림'}. 모두 ${S.selected.size}명`);
}
function moveRowFocus(tr) {
  for (const r of tr.parentElement.children) r.tabIndex = -1;
  tr.tabIndex = 0;
  tr.focus();
}

function renderTable() {
  if (!els.tableHost) return;
  const c = cls();
  const a = areaInfo();
  const focusedSid = document.activeElement?.closest?.('tr[data-sid]')?.dataset.sid;
  const focusedIsRow = document.activeElement?.matches?.('tr[data-sid]');
  const all = store.studentsOf(c);
  if (!all.length) {
    clear(els.tableHost, emptyState('users', '이 반에 학생이 없습니다.', h('a', { class: 'btn btn-primary', href: `#roster?class=${encodeURIComponent(c.id)}` }, '명단 등록하러 가기')));
    return;
  }
  const rows = visibleStudents();
  const selAll = h('input', {
    type: 'checkbox', id: 'write-select-all', 'aria-label': '보이는 학생 모두 고르기',
    onchange: (e) => {
      for (const s of rows) { if (e.target.checked) S.selected.add(s.studentId); else S.selected.delete(s.studentId); }
      renderTable();
      updateSelectionUi();
      document.getElementById('write-select-all')?.focus();
    },
  });
  els.selectAll = selAll;
  const table = h('table', { class: 'table write-table' },
    h('caption', { class: 'sr-only' }, `${c.name} ${a.label} 학생 표`),
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col', class: 'col-check' }, h('label', { class: 'check-hit' }, selAll)),
      h('th', { scope: 'col' }, '학번'),
      h('th', { scope: 'col' }, '이름'),
      h('th', { scope: 'col' }, '메모'),
      h('th', { scope: 'col' }, 'AI 초안'),
      h('th', { scope: 'col' }, '최종본'),
      h('th', { scope: 'col', class: 'num' }, '바이트'),
      h('th', { scope: 'col' }, '상태'),
      h('th', { scope: 'col' }, '검사'))),
    h('tbody', {}, rows.length ? rows.map(rowFor)
      : h('tr', {}, h('td', { colspan: '9', class: 'muted' }, '이 상태의 학생이 없습니다.'))));
  clear(els.tableHost,
    h('p', { class: 'hint', id: 'write-table-keys' }, '키보드: Tab으로 표에 들어와 위아래 화살표로 학생을 옮기고, Enter로 패널을 열고, Space로 고르거나 풉니다.'),
    h('div', { class: 'table-wrap is-scroll' }, table));
  table.setAttribute('aria-describedby', 'write-table-keys');
  // 로빙 tabindex: 행 하나만 Tab 순서에
  const bodyRows = [...table.querySelectorAll('tbody tr[data-sid]')];
  if (bodyRows.length && !bodyRows.some((r) => r.tabIndex === 0)) bodyRows[0].tabIndex = 0;
  updateSelectionUi();
  if (focusedSid) {
    const tr = els.tableHost.querySelector(`tr[data-sid="${CSS.escape(focusedSid)}"]`);
    if (tr && focusedIsRow) moveRowFocus(tr);
  }
}

function updateSelectionUi() {
  const rows = visibleStudents();
  const n = rows.filter((s) => S.selected.has(s.studentId)).length;
  if (els.selectAll) {
    els.selectAll.checked = rows.length > 0 && n === rows.length;
    els.selectAll.indeterminate = n > 0 && n < rows.length;
  }
  if (els.selCount) els.selCount.textContent = S.selected.size ? `${S.selected.size}명 고름` : '';
  els.tableHost?.querySelectorAll('tr[data-sid] input[type="checkbox"]').forEach((cb) => {
    cb.checked = S.selected.has(cb.closest('tr').dataset.sid);
  });
}

// ---------- 패널 ----------
function openStudent(sid, { focus } = {}) {
  flushPending();
  S.open = sid;
  syncParams();
  renderTable();
  renderPanel();
  if (focus === 'panel') {
    const t = els.panel?.querySelector('.panel-title');
    if (t) { focusEl(t, { scroll: false }); t.scrollIntoView({ block: 'nearest', behavior: 'auto' }); }
  }
}

function closePanel() {
  flushPending();
  const sid = S.open;
  S.open = null;
  syncParams();
  renderPanel();
  renderTable();
  const tr = els.tableHost?.querySelector(`tr[data-sid="${CSS.escape(sid || '')}"]`);
  if (tr) moveRowFocus(tr);
}

function renderPanel() {
  if (!els.panel) return;
  const ae = document.activeElement;
  const hadFocus = !!ae && ae !== els.panel && els.panel.contains(ae);
  const fkey = hadFocus ? (ae.id || ae.dataset.fkey || null) : null;
  renderPanelInner();
  if (hadFocus && !els.panel.contains(document.activeElement)) {
    const t = (fkey && (document.getElementById(fkey) || els.panel.querySelector(`[data-fkey="${CSS.escape(fkey)}"]`)))
      || els.panel.querySelector('.panel-title');
    if (t) focusEl(t, { scroll: false });
  }
}

function renderPanelInner() {
  const sid = S.open;
  const student = sid ? store.getStudent(sid) : null;
  if (!student || !cls()?.studentIds.includes(sid)) {
    S.open = null;
    clear(els.panel, h('div', { class: 'panel-empty stack' },
      h('h2', { class: 'card-title' }, '학생을 고르세요'),
      h('p', { class: 'muted small' }, '표에서 학생 행을 누르거나, 행에서 Enter를 누르면 여기에 메모, 초안, 검사, NEIS 단계가 열립니다.')));
    els.panel.setAttribute('aria-label', '학생 패널');
    return;
  }
  const rec = recordOf(sid);
  const a = areaInfo();
  els.panel.removeAttribute('aria-label');
  els.saveText = h('span', { class: 'small muted save-state' }, saveStatusText());
  els.statusSlot = h('span', {});
  const stepPanelId = 'write-step-panel';
  els.stepBody = h('div', { class: 'stack', id: stepPanelId, role: 'tabpanel', 'aria-labelledby': `write-step-${S.step}` });
  clear(els.panel,
    h('div', { class: 'panel-head' },
      h('div', { class: 'stack gap-1' },
        h('h2', { class: 'card-title panel-title', id: 'panel-title', tabindex: '-1' }, `${student.studentId} ${student.name}`),
        h('p', { class: 'small muted row' }, a.label, els.statusSlot, els.saveText)),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '패널 닫기', onclick: closePanel }, icon('close'))),
    tabList({
      label: '작성 단계', idPrefix: 'write-step', panelId: stepPanelId, value: S.step,
      items: STEPS, onSelect: (k) => { flushPending(); S.step = k; renderPanel(); },
    }),
    els.stepBody);
  els.panel.setAttribute('aria-labelledby', 'panel-title');
  fillStatus(rec);
  const body = { memo: memoStep, draft: draftStep, check: checkStep, neis: neisStep }[S.step](rec, student);
  els.stepBody.append(...[].concat(body).filter(Boolean));
}

function fillStatus(rec) {
  if (els.statusSlot) clear(els.statusSlot, badge(STATUS_LABELS[rec.status], rec.status));
}

function nextStepBtn(key, label) {
  return h('div', { class: 'row step-nav' }, h('button', {
    type: 'button', class: 'btn btn-ghost',
    onclick: () => { flushPending(); S.step = key; renderPanel(); document.getElementById(`write-step-${key}`)?.focus(); },
  }, label, icon('right')));
}

// 1 메모
function chipWithKey(text, on, fn) { const b = chip(text, on, fn); b.dataset.fkey = `chip-${text}`; return b; }
function memoStep(rec) {
  const a = areaInfo();
  const memo = h('textarea', {
    class: 'textarea', id: 'f-memo', rows: '8', value: rec.memo || '',
    placeholder: '관찰한 사실을 적어 주세요. 예: 학급 회의에서 의견을 정리해 칠판에 적음. 체육대회 준비물 목록을 만들어 나눔.',
    oninput: (e) => queuePatch(rec.id, { memo: e.target.value }),
  });
  const traits = TRAITS_BY_AREA[a.area] || [];
  const chosen = new Set(liveRecord(rec.id).traits || []);
  const traitBox = h('div', { class: 'row chips', role: 'group', 'aria-labelledby': 'traits-label' },
    traits.map((t) => chipWithKey(t, chosen.has(t), (on) => {
      if (on) chosen.add(t); else chosen.delete(t);
      store.updateRecord(rec.id, { traits: traits.filter((x) => chosen.has(x)) });
    })));
  const lengthSeg = seg({
    labelledby: 'length-label',
    options: Object.entries(LENGTH_LABELS),
    value: rec.length || 'standard',
    onChange: (v) => store.updateRecord(rec.id, { length: v }),
  });
  const parts = [
    field('메모', memo, '학생 이름과 학번은 AI로 보내지 않습니다. 메모 속 명단 이름은 보내기 전에 지웁니다.'),
    h('div', { class: 'field' }, h('span', { class: 'label', id: 'traits-label' }, '드러낼 모습 (여러 개 고를 수 있음)'), traitBox),
    h('div', { class: 'field' }, h('span', { class: 'label', id: 'length-label' }, '목표 분량'), lengthSeg,
      h('p', { class: 'hint' }, `한도 ${store.limitOf(a.area)} byte 기준. 메모가 짧으면 분량을 줄여 만듭니다.`)),
  ];
  if (a.area === 'subject') {
    const c = cls();
    const ach = h('textarea', {
      class: 'textarea', id: 'f-ach', rows: '3', value: rec.achievement || '',
      placeholder: c.achievement ? `비우면 반 기본값: ${c.achievement}` : '예: [10통과01-02] ...',
      oninput: (e) => queuePatch(rec.id, { achievement: e.target.value }),
    });
    parts.push(h('p', { class: 'small' }, h('strong', {}, '과목: '), a.subject || '(과목명 없음)'));
    parts.push(field('성취기준 (선택)', ach, '비우면 반의 기본 성취기준을 씁니다.'));
  }
  parts.push(nextStepBtn('draft', '다음: 초안'));
  return parts;
}

// 2 초안
function draftStep(rec, student) {
  const busy = S.busy.has(rec.id);
  const noKey = !ctx.isFakeAI() && !ctx.hasKey();
  const out = [];
  out.push(h('div', { class: 'row' },
    h('button', {
      type: 'button', class: 'btn btn-primary', disabled: busy || noKey, 'aria-describedby': noKey ? 'nokey-hint' : null,
      onclick: () => makeDrafts(rec.id, student),
    }, icon('spark'), busy ? '만드는 중' : '초안 만들기'),
    ctx.isFakeAI() ? badge('가짜 AI', 'warn') : null));
  out.push(styleSwitch(rec));
  if (noKey) {
    out.push(h('p', { class: 'hint', id: 'nokey-hint' }, '설정에서 API 키를 넣으면 초안을 만들 수 있습니다. ',
      h('a', { href: '#settings' }, '설정으로 가기')));
  }
  if (busy) out.push(h('p', { class: 'small muted', role: 'status' }, 'AI가 초안 후보를 만들고 있습니다. 10초쯤 걸립니다.'));
  const err = S.errors.get(rec.id);
  if (err) out.push(alertBox('danger', err, { role: 'alert' }));
  if (S.insufficient.has(rec.id)) {
    out.push(alertBox('info', '메모에 쓸 내용이 부족해 AI가 초안을 만들지 않았습니다. 관찰한 사실을 더 적은 뒤 다시 만들어 주세요.'));
  }
  const cands = candidatesOf(rec.id);
  const done = rec.status === 'done';
  if (cands.length) {
    out.push(h('h3', { class: 'section-title' }, `초안 후보 ${cands.length}개`));
    out.push(h('p', { class: 'hint' }, '후보 글은 바로 고칠 수 있고, 고친 글은 자동으로 저장됩니다.'));
    out.push(h('ol', { class: 'candidate-list stack' }, cands.map((c, i) => candidateCard(rec, i, c, { done, noKey, student }))));
  }
  const draft = h('textarea', {
    class: 'textarea', id: 'f-draft', rows: '6', value: liveRecord(rec.id).draft || '',
    oninput: (e) => queuePatch(rec.id, { draft: e.target.value }),
  });
  out.push(field('AI 초안 칸', draft, '고쳐 써도 됩니다. 최종본은 선생님이 직접 정합니다.'));
  out.push(h('div', { class: 'row' }, h('button', {
    type: 'button', class: 'btn btn-secondary', disabled: done,
    onclick: () => { flushPending(); const r = store.state.records.get(rec.id); if (!r.draft.trim()) { toast('초안 칸이 비어 있습니다'); return; } appendFinal(rec.id, r.draft.trim()); },
  }, '초안을 최종본 끝에 붙이기')));
  if (done) out.push(h('p', { class: 'hint' }, '완료한 기록입니다. 최종본에 붙이려면 검사 단계에서 [완료 풀기]를 먼저 눌러 주세요.'));
  out.push(nextStepBtn('check', '다음: 검사'));
  return out;
}

// ---------- 후보 카드 (contract 17절) ----------
const REFINE_CHIPS = ['더 짧게', '더 자세히', '문장 나누기', '평가어 줄이기'];
/** '후보 1을', '후보 2를': 숫자 끝자리 읽는 소리에 받침이 없으면(2, 4, 5, 9) '를' */
const hubo = (n) => `후보 ${n}${[2, 4, 5, 9].includes(n % 10) ? '를' : '을'}`;

/** 지금 보이는 후보 목록 (저장 전 입력 포함). v1 문자열도 Candidate로 */
function candidatesOf(id) {
  return normalizeCandidates(liveRecord(id)?.candidates);
}

function setCandidate(id, i, fn, { now = true } = {}) {
  const list = candidatesOf(id);
  if (!list[i]) return null;
  const next = fn(list[i]);
  if (next === list[i]) return null;
  list[i] = next;
  if (now) { flushPending(); store.updateRecord(id, { candidates: list }); } else queuePatch(id, { candidates: list });
  return next;
}

function byteText(bytes, limit) {
  const level = byteLevel(bytes, limit);
  return { level, text: `${bytes} / ${limit} byte${level !== 'ok' ? ` (${LEVEL_TEXT[level]})` : ''}` };
}

function candidateCard(rec, i, c, { done, noKey, student }) {
  const n = i + 1;
  const limit = store.limitOf(rec.area);
  const key = `${rec.id}#${i}`;
  const refining = S.refining.has(key);
  const b0 = byteText(byteLength(c.text), limit);
  const bytesEl = h('p', { class: ['small', 'num', b0.level === 'over' && 'text-danger'], 'aria-live': 'polite', id: `cand-bytes-${i}` }, b0.text);
  const editedEl = badge('고침', 'warn');
  editedEl.hidden = !c.edited;
  const undoBtn = h('button', {
    type: 'button', class: 'btn btn-ghost btn-sm', 'data-fkey': `cand-undo-${i}`, disabled: !c.versions.length || refining,
    'aria-label': `후보 ${n} 이전 판으로`,
    onclick: () => { if (setCandidate(rec.id, i, undoVersion)) { renderPanel(); announce(`${hubo(n)} 이전 판으로 되돌렸습니다`); } },
  }, icon('undo'), '이전 판');
  const ta = h('textarea', {
    class: ['textarea', b0.level === 'over' && 'is-over'], id: `cand-${i}`, rows: '6', value: c.text, readonly: refining,
    'aria-describedby': `cand-bytes-${i}`,
    oninput: (e) => {
      const next = setCandidate(rec.id, i, (x) => editCandidate(x, e.target.value), { now: false }) || candidatesOf(rec.id)[i];
      const b = byteText(byteLength(e.target.value), limit);
      bytesEl.textContent = b.text;
      bytesEl.classList.toggle('text-danger', b.level === 'over');
      ta.classList.toggle('is-over', b.level === 'over');
      editedEl.hidden = !next.edited;
    },
  });
  const textNow = () => candidatesOf(rec.id)[i]?.text || '';
  const reqInput = h('input', {
    type: 'text', class: 'input', id: `cand-req-${i}`, disabled: refining || noKey,
    placeholder: '예: 리더십 부분을 줄이고 탐구 과정을 앞으로',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); refine(rec.id, i, reqInput.value, student); } },
  });
  return h('li', { class: 'card stack candidate' },
    h('div', { class: 'row-between' },
      h('label', { class: 'label', for: `cand-${i}` }, `후보 ${n}`),
      editedEl),
    ta,
    bytesEl,
    h('div', { class: 'row' },
      h('button', {
        type: 'button', class: 'btn btn-secondary btn-sm', 'data-fkey': `cand-draft-${i}`, 'aria-label': `${hubo(n)} 초안 칸에 저장`,
        onclick: () => {
          flushPending();
          const prev = store.state.records.get(rec.id).draft;
          store.updateRecord(rec.id, { draft: textNow() });
          renderPanel();
          toast(`${hubo(n)} 초안 칸에 저장했습니다`, { action: '되돌리기', onAction: () => { store.updateRecord(rec.id, { draft: prev }); renderPanel(); } });
        },
      }, '초안 칸에 저장'),
      h('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', 'data-fkey': `cand-final-${i}`, disabled: done, 'aria-label': `${hubo(n)} 최종본 끝에 붙이기`,
        onclick: () => appendFinal(rec.id, textNow().trim()),
      }, '최종본 끝에 붙이기'),
      h('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', 'data-fkey': `cand-reset-${i}`, disabled: refining, 'aria-label': `${hubo(n)} 처음 상태로`,
        onclick: () => {
          if (!setCandidate(rec.id, i, resetCandidate)) { toast('이미 AI가 처음 준 글입니다'); return; }
          renderPanel();
          toast(`${hubo(n)} 처음 상태로 되돌렸습니다. [이전 판]으로 고친 글에 돌아갈 수 있습니다.`);
        },
      }, '처음 상태로'),
      undoBtn),
    h('div', { class: 'stack gap-1 candidate-refine' },
      h('label', { class: 'label', for: `cand-req-${i}` }, `후보 ${n} 다듬기 요청`),
      h('div', { class: 'row', role: 'group', 'aria-label': `후보 ${n} 빠른 요청` },
        REFINE_CHIPS.map((t) => h('button', {
          type: 'button', class: 'chip', 'data-fkey': `cand-chip-${i}-${t}`, disabled: refining || noKey,
          onclick: () => refine(rec.id, i, t, student),
        }, t))),
      h('div', { class: 'row' },
        reqInput,
        h('button', {
          type: 'button', class: 'btn btn-secondary btn-sm', 'data-fkey': `cand-refine-${i}`, disabled: refining || noKey,
          onclick: () => refine(rec.id, i, reqInput.value, student),
        }, icon('spark'), refining ? '다듬는 중' : 'AI에게 다듬기 요청')),
      refining ? h('p', { class: 'small muted', role: 'status' }, `AI가 ${hubo(n)} 다듬고 있습니다.`) : null));
}

async function refine(id, i, request, student) {
  const req = String(request || '').trim();
  if (!req) { toast('요청을 적거나 빠른 요청을 눌러 주세요'); return; }
  flushPending();
  const rec = store.state.records.get(id);
  const c = candidatesOf(id)[i];
  if (!rec || !c) return;
  const key = `${id}#${i}`;
  S.refining.add(key);
  S.errors.delete(id);
  renderPanel();
  announce(`${hubo(i + 1)} 다듬고 있습니다`);
  try {
    const res = await refineDraft({
      record: aiRecord(rec), text: c.text, request: req, studentName: student?.name || '', roster: rosterAll(),
      settings: store.state.settings, apiKey: store.getApiKey(), style: styleFor(rec), fake: ctx.isFakeAI(),
    });
    if (setCandidate(id, i, (x) => pushVersion(x, res.text))) toast(`${hubo(i + 1)} 다듬었습니다. [이전 판]으로 되돌릴 수 있습니다.`);
    else toast('AI가 같은 글을 돌려주었습니다');
  } catch (e) {
    if (!(e instanceof AiError)) console.warn('다듬기 중 예상 못 한 오류:', e?.name || 'Error');
    const msg = e?.userMessage || '다듬지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
    S.errors.set(id, msg);
    toast(msg, { danger: true });
  } finally {
    S.refining.delete(key);
    if (S.open === rec.studentId && S.step === 'draft') {
      // 다른 칸에 입력 중이면 그 카드만 바로 바꿔 입력·포커스를 지킨다 (오류 안내는 토스트로 이미 보임)
      if (typing() && !replaceCard(id, i, student)) staleAll = true;
      else if (!typing()) { renderPanel(); document.getElementById(`cand-${i}`)?.focus(); }
    }
  }
}

/** 후보 카드 하나만 새로 그림. 포커스가 그 카드 안에 있었으면 같은 칸으로 되돌림 */
function replaceCard(id, i, student) {
  const li = document.getElementById(`cand-${i}`)?.closest('li.candidate');
  const rec = store.state.records.get(id);
  const c = candidatesOf(id)[i];
  if (!li || !rec || !c || !els.panel?.contains(li)) return false;
  const ae = document.activeElement;
  const own = li.contains(ae) ? (ae.id || ae.dataset.fkey || null) : null;
  li.replaceWith(candidateCard(rec, i, c, { done: rec.status === 'done', noKey: !ctx.isFakeAI() && !ctx.hasKey(), student }));
  if (own) (document.getElementById(own) || els.panel.querySelector(`[data-fkey="${CSS.escape(own)}"]`))?.focus();
  return true;
}

// ---------- 내 스타일 적용 (contract 16-5) ----------
function styleKeyOf(rec) { return styleKey(rec.area, rec.subject); }
/** 이 기록에 쓸 스타일. 스위치를 껐거나 자료가 없으면 null */
function styleFor(rec) {
  if (S.styleOff.has(styleKeyOf(rec))) return null;
  return pickExamples(store.getStyles(), rec.area, rec.subject);
}
function styleSwitch(rec) {
  const picked = pickExamples(store.getStyles(), rec.area, rec.subject);
  if (!picked) return null;
  const k = styleKeyOf(rec);
  const on = !S.styleOff.has(k);
  return h('div', { class: 'stack gap-1 style-apply' },
    h('label', { class: 'check-row', for: 'f-style-on' },
      h('input', {
        type: 'checkbox', id: 'f-style-on', role: 'switch', checked: on,
        onchange: (e) => { if (e.target.checked) S.styleOff.delete(k); else S.styleOff.add(k); renderPanel(); },
      }),
      '내 스타일 적용'),
    h('p', { class: ['small', !on && 'muted'] }, on ? `적용 중: ${picked.summary}` : '이번 초안에는 내 스타일을 쓰지 않습니다.',
      ' ', h('a', { href: `#style?area=${encodeURIComponent(k)}` }, '내 스타일 고치기')));
}

function appendFinal(id, text) {
  flushPending();
  const rec = store.state.records.get(id);
  if (rec.status === 'done') { toast('완료한 기록입니다. 먼저 완료를 풀어 주세요.'); return; }
  const prev = rec.final || '';
  const next = prev.trim() ? `${prev.replace(/\s+$/, '')} ${text}` : text;
  store.updateRecord(id, { final: next });
  renderPanel();
  toast('최종본 끝에 붙였습니다', { action: '되돌리기', onAction: () => { store.updateRecord(id, { final: prev }); renderPanel(); } });
}

async function makeDrafts(id, student) {
  flushPending();
  const rec = store.state.records.get(id);
  if (!rec) return;
  S.busy.add(id);
  S.errors.delete(id);
  S.insufficient.delete(id);
  if (S.open === rec.studentId) renderPanel();
  announce('초안을 만들고 있습니다');
  try {
    const res = await generateDrafts({
      record: aiRecord(rec),
      studentName: student.name,
      roster: rosterAll(),
      settings: store.state.settings,
      apiKey: store.getApiKey(),
      count: 3,
      fake: ctx.isFakeAI(),
      style: styleFor(rec),
    });
    const drafts = (res?.drafts || []).filter((d) => d && d.trim()).slice(0, 3);
    if (res?.insufficient || !drafts.length) {
      S.insufficient.add(id);
      announce('메모에 쓸 내용이 부족해 초안을 만들지 않았습니다');
    } else {
      store.updateRecord(id, { candidates: drafts.map(newCandidate) });
      toast(`초안 후보 ${drafts.length}개를 만들었습니다`);
    }
  } catch (e) {
    // 예상된 AI 오류(키, 한도, 혼잡 등)는 화면 안내만. 예상 못 한 오류만 이름만 남김 (메모·이름은 찍지 않음)
    if (!(e instanceof AiError)) console.warn('초안 만들기 중 예상 못 한 오류:', e?.name || 'Error');
    const msg = e?.userMessage || '초안을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
    S.errors.set(id, msg);
    toast(msg, { danger: true });
  } finally {
    S.busy.delete(id);
    if (S.open === rec.studentId && S.step === 'draft') renderPanel();
  }
}

// 3 검사
function checkView(rec, text) {
  const r = store.checkOf(rec, text);
  const limit = r.limit ?? store.limitOf(rec.area);
  const items = [];
  if (r.level === 'over') items.push(h('li', { class: 'is-danger' }, `한도보다 ${r.bytes - limit} byte 깁니다. 줄여 주세요.`));
  else if (r.level === 'near') items.push(h('li', { class: 'is-warn' }, '한도에 가깝습니다 (95% 이상).'));
  for (const hit of r.forbidden || []) {
    const en = hit.entry || {};
    items.push(h('li', { class: 'is-danger stack gap-1' },
      h('span', {}, h('mark', {}, hit.match || en.term), ` ${en.category || '금지 표현'}`),
      en.basis ? h('span', { class: 'small' }, `근거: ${en.basis}`) : null,
      en.replace ? h('span', { class: 'small' }, `바꿀 표현: ${en.replace}`) : null));
  }
  for (const is of r.neis || []) {
    items.push(h('li', { class: 'is-warn' }, `NEIS에서 깨질 수 있는 문자: ${is.label} ${is.count}곳. [정리]로 고칠 수 있습니다.`));
  }
  if (r.similar && r.similar.length) {
    const who = r.similar.map((s) => { const st = store.getStudent(s.id); return st ? `${s.id} ${st.name}` : s.id; });
    items.push(h('li', { class: 'is-warn' }, `같은 영역 다른 학생 글과 90% 이상 비슷합니다: ${who.join(', ')}`));
  }
  if (r.styleOverlap && r.styleOverlap.length) {
    items.push(h('li', { class: 'is-warn stack gap-1' },
      h('span', {}, `${STYLE_OVERLAP_TEXT}. 예시의 문장을 그대로 쓰지 않도록 고쳐 주세요.`),
      r.styleOverlap.map((o) => h('span', { class: 'small' }, h('mark', {}, o.text)))));
  }
  return h('div', { class: 'stack' },
    h('div', { class: 'stack gap-1' },
      byteBar(r.bytes, limit, r.level),
      h('p', { class: ['small', 'num', r.level === 'over' && 'text-danger'] }, `${r.bytes} / ${limit} byte`, r.level !== 'ok' ? ` (${LEVEL_TEXT[r.level]})` : '')),
    !text ? h('p', { class: 'small muted' }, '최종본이 비어 있습니다.')
      : items.length ? h('ul', { class: 'issue-list', 'aria-label': `검사 결과 ${items.length}건` }, items)
        : alertBox('ok', '고칠 점을 찾지 못했습니다.'),
    h('p', { class: 'hint' }, '경고가 있어도 저장은 됩니다.'));
}

function checkStep(rec) {
  const done = rec.status === 'done';
  const resultHost = h('div', { 'aria-live': 'off' }, checkView(rec, liveRecord(rec.id).final));
  const refresh = debounce((v) => clear(resultHost, checkView(rec, v)), 200);
  const final = h('textarea', {
    class: 'textarea', id: 'f-final', rows: '9', value: liveRecord(rec.id).final || '', readonly: done,
    oninput: (e) => { queuePatch(rec.id, { final: e.target.value }); refresh(e.target.value); },
  });
  return [
    field('최종본', final, done ? '완료한 기록은 고칠 수 없습니다. [완료 풀기]를 누르면 고칠 수 있습니다.' : '선생님이 직접 확정하는 글입니다.'),
    resultHost,
    h('div', { class: 'row' },
      h('button', {
        type: 'button', class: 'btn btn-secondary', disabled: done,
        onclick: () => {
          flushPending();
          const cur = store.state.records.get(rec.id);
          const cleaned = cleanText(cur.final || '');
          if (cleaned === (cur.final || '')) { toast('정리할 것이 없습니다'); return; }
          const prev = cur.final;
          store.updateRecord(rec.id, { final: cleaned });
          renderPanel();
          toast('특수 문자와 겹친 공백을 정리했습니다', { action: '되돌리기', onAction: () => { store.updateRecord(rec.id, { final: prev }); renderPanel(); } });
        },
      }, icon('clean'), '정리'),
      done
        ? h('button', {
          type: 'button', class: 'btn btn-secondary',
          onclick: () => {
            const r = store.state.records.get(rec.id);
            store.updateRecord(rec.id, { status: deriveStatus({ ...r, status: 'draft' }) });
            renderPanel();
            toast('완료를 풀었습니다. 이제 고칠 수 있습니다.');
          },
        }, '완료 풀기')
        : h('button', {
          type: 'button', class: 'btn btn-primary',
          onclick: () => {
            flushPending();
            const r = store.state.records.get(rec.id);
            if (!(r.final || '').trim()) { toast('최종본이 비어 있어 완료로 표시할 수 없습니다'); final.focus(); return; }
            store.updateRecord(rec.id, { status: 'done' });
            renderPanel();
            toast('완료로 표시했습니다. 일괄 초안과 가져오기에서 덮어쓰지 않습니다.');
          },
        }, icon('check'), '완료로 표시')),
    nextStepBtn('neis', '다음: NEIS'),
  ];
}

// 4 NEIS
function neisStep(rec) {
  const text = rec.final || '';
  const ta = h('textarea', { class: 'textarea', id: 'f-neis', rows: '8', readonly: true, value: text });
  const stateEl = h('p', { class: 'small', role: 'status' }, '');
  const out = [
    field('NEIS에 붙여 넣을 글 (읽기 전용)', ta, `${byteLength(text)} byte`),
    h('div', { class: 'row' },
      h('button', {
        type: 'button', class: 'btn btn-primary', disabled: !text,
        onclick: () => copyText(text, ta),
      }, icon('copy'), '복사'),
      h('a', { class: 'btn btn-ghost', href: '#neis' }, 'NEIS 옮기기 화면으로')),
    stateEl,
  ];
  if (rec.status !== 'done') out.unshift(alertBox('info', '완료로 표시한 기록만 NEIS 옮기기와 확장프로그램 보내기에 들어갑니다.'));
  if (rec.neis && text) {
    textHash(text).then((hash) => {
      stateEl.textContent = hash === rec.neis.hash
        ? `나이스 입력 완료 (${formatDateTime(rec.neis.doneAt)})`
        : '입력 후 수정됨: 나이스에 입력한 뒤 최종본이 바뀌었습니다.';
    }).catch(() => {});
  } else {
    stateEl.textContent = '아직 나이스 입력 완료 알림이 없습니다.';
  }
  return out;
}

export async function copyText(text, textarea) {
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했습니다. NEIS 입력 칸에 붙여 넣으세요 (Ctrl+V).');
    return true;
  } catch {
    if (textarea) { textarea.focus(); textarea.select(); }
    toast('자동 복사가 막혀 있습니다. 글을 선택해 두었으니 Ctrl+C로 복사해 주세요.', { danger: true });
    return false;
  }
}

// ---------- 일괄 초안 ----------
function classRecords() {
  return store.studentsOf(cls()).map((s) => recordOf(s.studentId));
}

function openBatchDialog() {
  flushPending();
  const c = cls();
  const a = areaInfo();
  if (!c || !a) return;
  const records = classRecords();
  if (!records.length) { toast('반에 학생이 없습니다'); return; }
  const selectedIds = [...S.selected].filter((sid) => c.studentIds.includes(sid)).map((sid) => recordOf(sid).id);
  let mode = selectedIds.length ? 'selected' : 'unwritten';
  const interval = Number(store.state.settings.batchIntervalSec) || 5;
  const noKey = !ctx.isFakeAI() && !ctx.hasKey();
  // 일괄 초안도 같은 내 스타일 (기본 켬). 영역이 하나라 한 번만 고름
  const picked = pickExamples(store.getStyles(), a.area, a.subject);
  const styleBox = picked ? h('input', { type: 'checkbox', id: 'batch-style-on', role: 'switch', checked: !S.styleOff.has(styleKey(a.area, a.subject)) }) : null;

  const info = h('div', { class: 'stack' });
  const progress = progressBar('일괄 초안 진행');
  const progText = h('p', { class: 'small num', 'aria-live': 'polite' }, '');
  const failHost = h('div', {});
  const progWrap = h('div', { class: 'stack', hidden: true }, progress, progText, failHost);

  const targetsFor = () => pickBatchTargets(records, { mode, selectedIds });
  function renderInfo() {
    const targets = targetsFor();
    const pool = mode === 'selected' ? records.filter((r) => selectedIds.includes(r.id)) : records;
    const doneCount = pool.filter((r) => r.status === 'done').length;
    const hasDraft = targets.filter((id) => (store.state.records.get(id)?.draft || '').trim()).length;
    clear(info,
      h('p', {}, `대상: ${targets.length}명`),
      mode === 'selected'
        ? h('div', { class: 'stack gap-1' },
          h('p', { class: 'small muted' }, `고른 학생 ${selectedIds.length}명 중 완료 ${doneCount}명은 건너뜁니다.`),
          h('p', { class: 'small' }, `이미 있는 초안은 새 초안으로 바뀝니다(최종본은 그대로).${hasDraft ? ` 초안이 있는 학생: ${hasDraft}명` : ''}`))
        : h('p', { class: 'small muted' }, `메모는 있고 초안과 최종본이 빈 학생만 합니다. 완료 ${doneCount}명은 건너뜁니다.`),
      h('p', { class: 'small muted' }, `한 명마다 ${interval}초 간격을 둡니다 (설정에서 바꿀 수 있음). 결과는 각 학생의 AI 초안 칸에 들어가고 최종본은 건드리지 않습니다.`),
      noKey ? alertBox('warn', '설정에서 API 키를 먼저 넣어 주세요.') : null,
      mode === 'selected' && !selectedIds.length ? alertBox('info', '표에서 학생을 먼저 고르거나, 미작성 학생을 고르세요.') : null);
  }
  const modeSeg = seg({
    label: '일괄 초안 대상',
    options: [['selected', `고른 학생 (${selectedIds.length}명)`], ['unwritten', '미작성 학생']],
    value: mode,
    onChange: (v) => { mode = v; renderInfo(); setActions(); },
  });

  const studentLabel = (rid) => {
    const r = store.state.records.get(rid);
    const s = r ? store.getStudent(r.studentId) : null;
    return s ? `${s.studentId} ${s.name}` : rid;
  };

  function showState() {
    if (!batch) return;
    const st = batch.state;
    progWrap.hidden = false;
    const finished = (st.done || 0) + (st.failed?.length || 0) + (st.skipped || 0);
    progress.set(finished, st.total || 0);
    const short = batchShort.size;
    let line = `${st.total}명 중 ${st.done}명 완료`;
    if (short) line += `, 메모 부족 ${short}명`;
    if (st.failed?.length) line += `, 실패 ${st.failed.length}명`;
    if (st.skipped - short > 0) line += `, 건너뜀 ${st.skipped - short}명`;
    if (!st.running && finished >= st.total) line += '. 모두 끝났습니다.';
    else if (!st.running) line += '. 멈췄습니다.';
    progText.textContent = line;
    clear(failHost,
      st.stopReason ? alertBox('danger', st.stopMessage || '오류 때문에 자동으로 멈췄습니다. 문제를 해결한 뒤 [이어서 하기]를 눌러 주세요.', { role: 'alert' }) : null,
      short ? h('div', { class: 'stack gap-1' },
        h('p', { class: 'small' }, '메모가 부족해 초안을 만들지 않은 학생 (메모를 더 적은 뒤 다시 하세요)'),
        h('ul', { class: 'issue-list' }, [...batchShort].map((id) => h('li', { class: 'is-info' }, studentLabel(id))))) : null,
      st.failed?.length ? h('div', { class: 'stack gap-1' },
        h('p', { class: 'small' }, '만들지 못한 학생'),
        h('ul', { class: 'issue-list' }, st.failed.map((f) => h('li', { class: 'is-warn' }, `${studentLabel(f.id)}: ${f.message || '실패'}`)))) : null);
    setActions();
  }

  const dlg = openDialog({
    title: `일괄 초안: ${c.name} ${a.label}`,
    wide: true,
    body: [
      h('div', { class: 'field' }, h('span', { class: 'label' }, '대상'), modeSeg),
      styleBox ? h('div', { class: 'stack gap-1 style-apply' },
        h('label', { class: 'check-row', for: 'batch-style-on' }, styleBox, '내 스타일 적용'),
        h('p', { class: 'small muted' }, picked.summary)) : null,
      info, progWrap],
    beforeClose: () => {
      if (batch?.state.running) { batch.stop(); toast('일괄 초안을 멈췄습니다'); }
      return true;
    },
    onClose: () => { batchUi = null; },
  });
  batchUi = { showState };

  function start() {
    const targets = targetsFor();
    if (!targets.length) { toast('대상 학생이 없습니다'); return false; }
    const settings = store.state.settings;
    const roster = rosterAll();
    const style = styleBox?.checked ? picked : null;
    batchShort = new Set();
    batch = createBatch({
      targets,
      intervalMs: interval * 1000,
      onProgress: () => { batchUi?.showState(); },
      run: async (rid) => {
        const rec = store.state.records.get(rid);
        if (!rec || rec.status === 'done') return 'skipped';
        const st = store.getStudent(rec.studentId);
        const res = await generateDrafts({
          record: aiRecord(rec), studentName: st?.name || '', roster, settings,
          apiKey: store.getApiKey(), count: 1, fake: ctx.isFakeAI(), style,
        });
        const text = (res?.drafts || []).find((d) => d && d.trim());
        if (res?.insufficient || !text) { batchShort.add(rid); return 'skipped'; }
        const cur = store.state.records.get(rid);
        if (cur.status === 'done') return 'skipped';
        store.updateRecord(rid, { draft: text, candidates: [newCandidate(text)] });
      },
    });
    modeSeg.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    if (styleBox) styleBox.disabled = true;
    Promise.resolve(batch.start()).catch(() => console.warn('일괄 초안 실행 중 예상 못 한 오류')).finally(() => batchUi?.showState());
    showState();
    return false;
  }

  function setActions() {
    const running = !!batch?.state.running;
    const st = batch?.state;
    const finished = st ? (st.done || 0) + (st.failed?.length || 0) + (st.skipped || 0) : 0;
    const canResume = st && !running && finished < st.total;
    const list = [{ label: '닫기', variant: 'secondary' }];
    if (!batch) list.push({ label: '시작하기', variant: 'primary', icon: 'play', disabled: noKey || !targetsFor().length, onClick: start });
    else if (running) list.push({ label: '멈추기', variant: 'danger', icon: 'pause', onClick: () => { batch.stop(); showState(); announce('멈췄습니다'); return false; } });
    else if (canResume) {
      list.push({
        label: '이어서 하기', variant: 'primary', icon: 'play',
        onClick: () => { Promise.resolve(batch.resume()).catch(() => console.warn('일괄 초안 실행 중 예상 못 한 오류')).finally(() => batchUi?.showState()); showState(); return false; },
      });
    }
    dlg.setActions(list);
  }
  renderInfo();
  if (batch && batch.state.running) showState(); else { batch = null; setActions(); }
}

// ---------- 전체 그리기 ----------
let staleAll = false; // 입력 중이라 미뤄 둔 전체 다시 그리기

function typing() {
  const ae = document.activeElement;
  return !!root && root.contains(ae) && ae.matches('textarea,input:not([type="checkbox"])');
}

/** 전체를 다시 그리고 포커스를 같은 id 또는 data-fkey 요소로 되돌림 */
function redrawAll() {
  staleAll = false;
  const ae = document.activeElement;
  const had = root && root.contains(ae);
  const fkey = had ? (ae.id || ae.dataset.fkey || null) : null;
  pickDefaults(null);
  renderAll();
  if (fkey && !root.contains(document.activeElement)) {
    (document.getElementById(fkey) || root.querySelector(`[data-fkey="${CSS.escape(fkey)}"]`))?.focus();
  }
}

function pickDefaults(params) {
  const classes = store.listClasses();
  const pc = params?.get('class');
  if (pc && store.getClass(pc)) S.classId = pc;
  if (!S.classId || !store.getClass(S.classId)) S.classId = classes[0]?.id || null;
  const areas = store.areasOfClass(cls());
  const pa = params?.get('area');
  if (pa && areas.some((x) => x.area === pa)) S.area = pa;
  if (!areas.some((x) => x.area === S.area)) S.area = areas[0]?.area || null;
  const ps = params?.get('student');
  if (ps) { S.open = ps; S.step = params.get('step') || S.step; }
  if (S.open && !cls()?.studentIds.includes(S.open)) S.open = null;
}

function renderAll() {
  if (!root) return;
  const classes = store.listClasses();
  els = {};
  if (!classes.length) {
    clear(root,
      h('h1', { class: 'view-title', tabindex: '-1' }, '작성'),
      emptyState('users', '먼저 명단 화면에서 반을 만들고 학생을 등록해 주세요.', h('a', { class: 'btn btn-primary', href: '#roster' }, '명단으로 가기')));
    return;
  }
  const c = cls();
  const areas = store.areasOfClass(c);
  const noKey = !ctx.isFakeAI() && !ctx.hasKey();
  const classSelect = h('select', {
    class: 'select', id: 'write-class', value: S.classId,
    onchange: (e) => { flushPending(); S.classId = e.target.value; S.selected.clear(); S.open = null; pickDefaults(null); syncParams(); renderAll(); document.getElementById('write-class')?.focus(); },
  }, classes.map((x) => h('option', { value: x.id }, `${x.name} (${KIND_LABELS[x.kind]})`)));
  const filterSelect = h('select', {
    class: 'select', id: 'write-filter', value: S.filter,
    onchange: (e) => { S.filter = e.target.value; renderTable(); },
  }, FILTERS.map(([v, t]) => h('option', { value: v }, t)));
  els.selCount = h('span', { class: 'small muted', 'aria-live': 'polite' });
  els.tableHost = h('div', { id: 'write-tabpanel', role: 'tabpanel', 'aria-labelledby': `write-area-${S.area}`, class: 'write-table-host' });
  els.panel = h('aside', { class: 'panel write-panel', id: 'write-panel' });
  clear(root,
    h('div', { class: 'view-head row-between' },
      h('h1', { class: 'view-title', tabindex: '-1' }, '작성'),
      h('span', { class: 'small muted save-global' })),
    noKey ? alertBox('info', h('p', {}, 'AI 초안을 만들려면 설정에서 Gemini API 키를 넣어 주세요. 메모 쓰기와 검사는 키 없이도 됩니다. ', h('a', { href: '#settings' }, '설정으로 가기'))) : null,
    h('div', { class: 'write-toolbar' },
      h('div', { class: 'field write-class-field' }, h('label', { class: 'label', for: 'write-class' }, '반'), classSelect),
      tabList({
        label: '영역', idPrefix: 'write-area', panelId: 'write-tabpanel', value: S.area,
        items: areas.map((x) => ({ key: x.area, label: x.label })),
        onSelect: (k) => { flushPending(); S.area = k; syncParams(); renderAll(); },
      }),
      h('div', { class: 'row write-tools' },
        h('div', { class: 'field' }, h('label', { class: 'label', for: 'write-filter' }, '상태 거르기'), filterSelect),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: openBatchDialog }, icon('spark'), '일괄 초안'),
        els.selCount)),
    h('div', { class: ['write-layout', S.open && 'has-panel'] }, els.tableHost, els.panel));
  renderTable();
  renderPanel();
}

export const writeView = {
  mount(el, params, c) {
    ctx = c;
    root = h('div', { class: 'view view-write stack' });
    el.appendChild(root);
    pickDefaults(params);
    syncParams();
    renderAll();
    root.addEventListener('focusout', () => {
      setTimeout(() => { if (staleAll && root && !typing()) { flushPending(); redrawAll(); } }, 0);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && S.open && els.panel?.contains(e.target) && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        closePanel();
      }
    });
    if (S.open && params?.get('student')) {
      const t = els.panel?.querySelector('.panel-title');
      setTimeout(() => { if (t) { focusEl(t); } }, 0);
    }
  },
  update(kind, detail) {
    if (!root) return;
    if (kind === 'save') { setSaveText(saveStatusText()); return; }
    if (kind === 'key') { renderAll(); return; }
    if (kind === 'records') {
      renderTable();
      const openRec = S.open && areaInfo() ? recordOf(S.open) : null;
      if (openRec) {
        fillStatus(openRec);
        const ids = detail?.ids || [];
        if (ids.includes(openRec.id) && !typing() && !pending) {
          // 입력 중이 아닐 때만 패널을 새로 그림 (포커스는 renderPanel이 되돌림)
          renderPanel();
        }
      }
      return;
    }
    if (['classes', 'students', 'settings', 'all', 'styles'].includes(kind)) {
      // 동기화 반영('all') 등이 입력 중에 오면 포커스와 입력을 잃지 않게 칸을 벗어날 때까지 미룸
      if (typing() || pending) { staleAll = true; return; }
      redrawAll();
    }
  },
  flush() { flushPending(); },
  unmount() { flushPending(); root = null; els = {}; staleAll = false; },
};
