// 작성(표): 반 전체를 명렬순 표로 보고 칸에서 바로 쓴다. 표에서 점검(공백·맞춤법·금지어·한도)까지 한다.
// 학생을 체크하면 오른쪽 패널에서 '특징 -> 초안 -> 수정 -> 표에 순서대로 붙여넣기'를 한다.
// 맨 위 버튼 하나는 메모를 적어 둔 학생의 초안을 한꺼번에 만든다.
import { h, clear, icon, debounce } from '../dom.js';
import { toast, announce, chip, seg, badge, alertBox, emptyState, field, progressBar } from '../ui.js';
import * as store from '../store.js';
import { AREA_LABELS, STATUS_LABELS, LENGTH_LABELS, TRAITS_BY_AREA, KIND_LABELS, newCandidate, deriveStatus } from '../core/model.js';
import { byteLength, byteLevel } from '../core/bytes.js';
import { generateDrafts, AiError } from '../core/gemini.js';
import { pickExamples } from '../core/style.js';
import { createBatch } from '../core/batch.js';
import { checkCell, tidyText, composeMemo, planPaste, memoTargets, PASTE_MODES } from '../core/grid.js';

const G = {
  area: null,
  hidden: new Set(), // 숨긴 반 id
  selected: new Set(), // 기록 id
  panel: false,
  common: '',
  traits: new Set(),
  length: 'standard',
  withOwn: true,
  styleOn: true,
  mode: 'skip',
  generated: new Set(), // 이번에 패널에서 만든 기록 id
  short: new Set(), // 메모가 부족해 못 만든 기록 id
  job: null, // { batch, label, ids, kind }
};

let ctx = null;
let root = null;
let els = {};
let rows = []; // 표 순서의 { cls, student, rec }
const cellRefs = new Map(); // 기록 id -> { tr, memo, final, bytes, status, issues, done }
const edits = new Map(); // 기록 id -> 저장 전 patch
const checkTimers = new Map();
let staleAll = false;

const noKey = () => !ctx.isFakeAI() && !ctx.hasKey();

// ---------- 계산 ----------
function classesForArea() {
  return store.listClasses().filter((c) => store.areasOfClass(c).some((a) => a.area === G.area));
}
function allAreas() {
  const set = new Set();
  for (const c of store.listClasses()) for (const a of store.areasOfClass(c)) set.add(a.area);
  return ['autonomy', 'career', 'behavior', 'club', 'subject'].filter((a) => set.has(a));
}
function buildRows() {
  const out = [];
  for (const cls of classesForArea()) {
    if (G.hidden.has(cls.id)) continue;
    for (const student of store.studentsOf(cls)) {
      const rec = store.getRecord(student.studentId, G.area, G.area === 'subject' ? cls.subject : null);
      out.push({ cls, student, rec });
    }
  }
  return out;
}
// 표의 rows 에 든 기록은 저장소가 바뀌면 낡으니, 언제나 저장소의 최신 기록 + 저장 전 입력을 합쳐 쓴다
const liveRec = (rec) => {
  const cur = store.state.records.get(rec.id) || rec;
  return edits.has(rec.id) ? { ...cur, ...edits.get(rec.id) } : cur;
};
function statusOf(rec) { const r = liveRec(rec); return r.status === 'done' ? 'done' : deriveStatus(r); }
function rosterAll() { return [...store.state.students.values()].map((s) => ({ studentId: s.studentId, name: s.name })); }
function checkOfText(rec, text) {
  return checkCell(text, {
    area: rec.area, limit: store.limitOf(rec.area), entries: store.state.settings?.forbidden || [],
    others: store.othersFor(rec), styleExamples: store.styleExamplesFor(rec),
  });
}

// ---------- 저장 (0.6초 디바운스, 기록별로 모음) ----------
const commit = debounce(() => {
  for (const [id, patch] of edits) store.updateRecord(id, patch);
  edits.clear();
  setSave();
}, 600);
function queue(id, patch) {
  edits.set(id, { ...(edits.get(id) || {}), ...patch });
  setSave('입력 중');
  commit();
}
function flushEdits() { commit.flush(); }
function setSave(t) {
  if (!els.save) return;
  if (t) { els.save.textContent = t; return; }
  const s = store.state.save.status;
  els.save.textContent = s === 'pending' || s === 'saving' ? '저장 중' : s === 'error' ? '저장 실패' : s === 'saved' ? '저장됨' : '';
}

// ---------- 표 ----------
function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}
function resizeAll() { els.table?.querySelectorAll('textarea.grid-ta').forEach(autosize); }

function issueLines(chk) {
  const kinds = { over: 'danger', forbidden: 'danger', spell: 'warn', neis: 'warn', input: 'warn', similar: 'warn', style: 'warn' };
  const shown = chk.issues.slice(0, 3).map((i) => h('li', { class: `is-${kinds[i.kind] || 'warn'}` }, i.message));
  if (chk.issues.length > 3) shown.push(h('li', { class: 'muted' }, `외 ${chk.issues.length - 3}건`));
  return shown;
}

function refreshRow(id, { setText = false } = {}) {
  const ref = cellRefs.get(id);
  const row = rows.find((r) => r.rec.id === id);
  if (!ref || !row) return;
  const rec = store.state.records.get(id) || row.rec;
  const live = liveRec(rec);
  if (setText) {
    if (document.activeElement !== ref.final && ref.final.value !== (live.final || '')) { ref.final.value = live.final || ''; autosize(ref.final); }
    if (document.activeElement !== ref.memo && ref.memo.value !== (live.memo || '')) { ref.memo.value = live.memo || ''; autosize(ref.memo); }
  }
  const status = statusOf(rec);
  const locked = status === 'done';
  ref.final.readOnly = locked; ref.memo.readOnly = locked;
  ref.tr.classList.toggle('is-done', locked);
  ref.done.checked = locked;
  const text = ref.final.value;
  const bytes = byteLength(text);
  const limit = store.limitOf(rec.area);
  const level = byteLevel(bytes, limit);
  clear(ref.bytes, text ? `${bytes}` : '-');
  ref.bytes.classList.toggle('text-danger', level === 'over' && !!text);
  clear(ref.status, badge(STATUS_LABELS[status], status));
  clearTimeout(checkTimers.get(id));
  checkTimers.set(id, setTimeout(() => {
    const chk = checkOfText(rec, ref.final.value);
    ref.chk = chk;
    ref.tr.classList.toggle('has-issue', chk.count > 0);
    if (chk.empty) { clear(ref.issues, h('span', { class: 'muted' }, '-')); return; }
    clear(ref.issues,
      chk.count ? badge(`문제 ${chk.count}`, 'danger') : h('span', { class: 'small muted' }, '문제 없음'),
      chk.count ? h('ul', { class: 'issue-list grid-issues' }, issueLines(chk)) : null,
      chk.fixable && !locked ? h('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `${row.student.name} 글 정리하기`,
        onclick: () => {
          const next = tidyText(ref.final.value);
          if (next === ref.final.value) return;
          ref.final.value = next; autosize(ref.final);
          queue(id, { final: next }); refreshRow(id);
          announce('공백과 맞춤법을 정리했습니다');
        },
      }, '정리') : null);
  }, 250));
}

function rowEl(row) {
  const { cls, student, rec } = row;
  const id = rec.id;
  const sel = h('input', {
    type: 'checkbox', checked: G.selected.has(id), 'aria-label': `${student.name} 고르기`,
    onchange: (e) => { if (e.target.checked) G.selected.add(id); else G.selected.delete(id); onSelection(); },
  });
  const ta = (key, label, rows_) => h('textarea', {
    class: 'textarea grid-ta', rows: String(rows_), value: rec[key] || '', 'aria-label': `${student.name} ${label}`,
    oninput: (e) => { autosize(e.target); queue(id, { [key]: e.target.value }); refreshRow(id); },
  });
  const memo = ta('memo', '메모', 1);
  const fin = ta('final', '최종본', 2);
  const doneBox = h('input', {
    type: 'checkbox', 'aria-label': `${student.name} 완료`,
    onchange: (e) => {
      flushEdits();
      const cur = store.state.records.get(id);
      if (e.target.checked) {
        const c = checkOfText(cur, cur.final);
        if (!String(cur.final || '').trim()) { e.target.checked = false; toast('최종본이 비어 있어 완료로 할 수 없습니다'); return; }
        store.updateRecord(id, { status: 'done' });
        if (c.count) toast(`${student.name}: 문제 ${c.count}건이 남은 채 완료로 표시했습니다`);
      } else store.updateRecord(id, { status: deriveStatus({ ...cur, status: 'x' }) });
      refreshRow(id);
    },
  });
  const ref = {
    tr: null, memo, final: fin, done: doneBox,
    bytes: h('td', { class: 'num' }), status: h('td', {}), issues: h('td', { class: 'grid-issue-cell' }),
  };
  ref.tr = h('tr', { 'data-id': id },
    h('td', { class: 'col-check' }, h('label', { class: 'check-hit' }, sel)),
    h('td', { class: 'num' }, String(student.studentId).slice(3) * 1 || student.studentId),
    h('th', { scope: 'row', class: 'col-name' }, student.name),
    h('td', {}, memo),
    h('td', {}, fin),
    ref.bytes,
    ref.status,
    ref.issues,
    h('td', { class: 'col-done' }, h('label', { class: 'check-hit' }, doneBox)),
    h('td', {}, h('a', {
      class: 'btn btn-ghost btn-sm', 'aria-label': `${student.name} 자세히 (후보 3개 비교, 검사, NEIS)`,
      href: `#write-detail?class=${encodeURIComponent(cls.id)}&area=${G.area}&student=${student.studentId}`,
    }, '자세히')));
  cellRefs.set(id, ref);
  return ref.tr;
}

function renderTable() {
  if (!els.tableHost) return;
  cellRefs.clear();
  rows = buildRows();
  const classes = classesForArea();
  if (!classes.length) { clear(els.tableHost, emptyState('users', '이 영역을 쓰는 반이 없습니다.')); return; }
  if (!rows.length) { clear(els.tableHost, emptyState('users', '표시할 학생이 없습니다. 위에서 반을 켜 주세요.', h('a', { class: 'btn btn-primary', href: '#roster' }, '명단으로 가기'))); return; }
  const selAll = h('input', {
    type: 'checkbox', id: 'grid-select-all', 'aria-label': '보이는 학생 모두 고르기',
    onchange: (e) => { for (const r of rows) { if (e.target.checked) G.selected.add(r.rec.id); else G.selected.delete(r.rec.id); } syncChecks(); onSelection(); },
  });
  els.selectAll = selAll;
  const body = [];
  let lastCls = null;
  for (const row of rows) {
    if (row.cls.id !== lastCls) {
      lastCls = row.cls.id;
      const mine = rows.filter((r) => r.cls.id === row.cls.id);
      const gbox = h('input', {
        type: 'checkbox', 'aria-label': `${row.cls.name} 전체 고르기`, 'data-group': row.cls.id,
        onchange: (e) => { for (const r of mine) { if (e.target.checked) G.selected.add(r.rec.id); else G.selected.delete(r.rec.id); } syncChecks(); onSelection(); },
      });
      body.push(h('tr', { class: 'grid-group' },
        h('td', { class: 'col-check' }, h('label', { class: 'check-hit' }, gbox)),
        h('th', { colspan: '9', scope: 'colgroup' }, `${row.cls.name} (${KIND_LABELS[row.cls.kind]}${row.cls.subject ? ` · ${row.cls.subject}` : ''}) · ${mine.length}명`)));
    }
    body.push(rowEl(row));
  }
  const table = h('table', { class: 'table grid-table' },
    h('caption', { class: 'sr-only' }, `${AREA_LABELS[G.area]} 작성 표 (명렬순)`),
    h('colgroup', {}, ...['44px', '48px', '84px', '17%', 'auto', '72px', '84px', '19%', '56px', '72px'].map((w) => h('col', { style: { width: w } }))),
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col', class: 'col-check' }, h('label', { class: 'check-hit' }, selAll)),
      h('th', { scope: 'col', class: 'num' }, '번호'), h('th', { scope: 'col' }, '이름'),
      h('th', { scope: 'col' }, '메모'), h('th', { scope: 'col' }, '최종본 (칸에서 바로 쓰기)'),
      h('th', { scope: 'col', class: 'num' }, '바이트'), h('th', { scope: 'col' }, '상태'),
      h('th', { scope: 'col' }, '점검'), h('th', { scope: 'col' }, '완료'), h('th', { scope: 'col' }, ''))),
    h('tbody', {}, body));
  els.table = table;
  clear(els.tableHost, h('div', { class: 'table-wrap grid-wrap' }, table));
  for (const r of rows) refreshRow(r.rec.id);
  resizeAll();
  syncChecks();
}

function syncChecks() {
  if (!els.tableHost) return;
  const ids = rows.map((r) => r.rec.id);
  const n = ids.filter((id) => G.selected.has(id)).length;
  if (els.selectAll) { els.selectAll.checked = ids.length > 0 && n === ids.length; els.selectAll.indeterminate = n > 0 && n < ids.length; }
  els.tableHost.querySelectorAll('tr[data-id]').forEach((tr) => {
    const cb = tr.querySelector('.col-check input');
    if (cb) cb.checked = G.selected.has(tr.dataset.id);
  });
  els.tableHost.querySelectorAll('input[data-group]').forEach((gb) => {
    const mine = rows.filter((r) => r.cls.id === gb.dataset.group);
    const c = mine.filter((r) => G.selected.has(r.rec.id)).length;
    gb.checked = mine.length > 0 && c === mine.length; gb.indeterminate = c > 0 && c < mine.length;
  });
}

function selectedRows() { return rows.filter((r) => G.selected.has(r.rec.id)); }

function onSelection() {
  syncChecks();
  renderBar();
  if (G.panel) renderPanel();
}

// ---------- 위쪽 ----------
function renderBar() {
  if (!els.bar) return;
  const n = selectedRows().length;
  const memoCount = memoTargets(scopeRows().map(toPlain)).length;
  clear(els.bar,
    h('div', { class: 'row grid-actions' },
      h('button', {
        type: 'button', class: 'btn btn-primary', disabled: !!G.job || noKey() || !memoCount,
        'aria-describedby': 'grid-memo-hint', onclick: runMemoBatch,
      }, icon('spark'), '메모로 초안 한번에 만들기'),
      h('span', { class: 'small muted', id: 'grid-memo-hint' },
        noKey() ? '설정에서 API 키를 넣으면 쓸 수 있습니다.'
          : memoCount ? `${n ? '고른 학생 중 ' : ''}메모가 있고 최종본이 빈 ${memoCount}명의 초안을 최종본 칸에 만듭니다.`
            : `${n ? '고른 학생 중 ' : ''}메모가 있고 최종본이 빈 학생이 없습니다.`)),
    n ? h('div', { class: 'row grid-selbar', role: 'status' },
      h('strong', {}, `${n}명 선택`),
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { G.panel = true; renderPanel(); applyLayout(); document.getElementById('grid-common')?.focus(); } }, '특징 쓰고 초안 만들기'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { G.selected.clear(); onSelection(); } }, '선택 풀기')) : null);
}
const toPlain = (r) => { const l = liveRec(r.rec); return { id: l.id, memo: l.memo, final: l.final, status: statusOf(r.rec) }; };
function scopeRows() { const sel = selectedRows(); return sel.length ? sel : rows; }

function applyLayout() {
  els.layout?.classList.toggle('has-panel', G.panel);
  if (!G.panel) clear(els.panel);
  els.panel.hidden = !G.panel;
  setTimeout(resizeAll, 0);
}

// ---------- 초안 만들기 (공통) ----------
function styleFor(rec) {
  if (!G.styleOn) return null;
  return pickExamples(store.getStyles(), rec.area, rec.subject);
}
function startJob({ ids, label, makeRecord, onText }) {
  if (G.job) return;
  flushEdits();
  const roster = rosterAll();
  const settings = store.state.settings;
  const interval = (Number(settings.batchIntervalSec) || 5) * 1000;
  G.short = new Set();
  const failed = [];
  const job = { label, total: ids.length, done: 0, failed, short: 0, stopReason: '', batch: null };
  job.batch = createBatch({
    targets: ids, intervalMs: interval,
    onProgress: (st) => { job.done = st.done + st.skipped + st.failed.length; job.failed = st.failed; job.stopReason = st.stopReason ? (st.stopMessage || '오류로 멈췄습니다') : ''; job.running = st.running; renderJob(); },
    run: async (rid) => {
      const rec = store.state.records.get(rid);
      if (!rec || rec.status === 'done') return 'skipped';
      const row = rows.find((r) => r.rec.id === rid);
      const st = store.getStudent(rec.studentId);
      const res = await generateDrafts({
        record: makeRecord(rec, row), studentName: st?.name || '', roster, settings, apiKey: store.getApiKey(), count: 1, fake: ctx.isFakeAI(), style: styleFor(rec),
      });
      const text = (res?.drafts || []).find((d) => d && d.trim());
      if (res?.insufficient || !text) { G.short.add(rid); job.short += 1; return 'skipped'; }
      onText(rid, text.trim());
    },
  });
  G.job = job;
  renderBar(); renderJob();
  Promise.resolve(job.batch.start()).catch((e) => { if (!(e instanceof AiError)) console.warn('초안 만들기 중 예상 못 한 오류:', e?.name || 'Error'); }).finally(() => {
    const j = G.job;
    if (j && !j.batch.state.running && j.batch.state.next >= j.total) finishJob();
    else renderJob();
  });
}
function finishJob() {
  const j = G.job;
  if (!j) return;
  const made = j.total - j.short - j.failed.length;
  G.job = null;
  renderBar(); renderJob();
  if (G.panel) renderPanel();
  toast(`${j.label}: ${made}명 만들었습니다${j.short ? `, 메모 부족 ${j.short}명` : ''}${j.failed.length ? `, 실패 ${j.failed.length}명` : ''}`, j.after ? j.after : undefined);
}
function renderJob() {
  if (!els.job) return;
  const j = G.job;
  if (!j) { clear(els.job); els.job.hidden = true; return; }
  els.job.hidden = false;
  const bar = progressBar(j.label); bar.set(j.done, j.total);
  const running = j.batch.state.running;
  clear(els.job,
    h('div', { class: 'row grid-job' },
      h('strong', {}, j.label), h('span', { class: 'small num', 'aria-live': 'polite' }, `${j.done}/${j.total}명${j.short ? ` · 메모 부족 ${j.short}` : ''}${j.failed.length ? ` · 실패 ${j.failed.length}` : ''}`),
      running ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { j.batch.stop(); } }, '멈추기')
        : h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { j.stopReason = ''; Promise.resolve(j.batch.resume()).finally(() => { if (!j.batch.state.running && j.batch.state.next >= j.total) finishJob(); }); renderJob(); } }, '이어서 하기'),
      !running ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => finishJob() }, '그만하기') : null),
    bar,
    j.stopReason ? alertBox('danger', j.stopReason, { role: 'alert' }) : null,
    j.failed.length ? h('ul', { class: 'issue-list' }, j.failed.slice(0, 5).map((f) => h('li', { class: 'is-warn' }, `${store.getStudent(store.state.records.get(f.id)?.studentId)?.name || ''}: ${f.message || '실패'}`))) : null);
}

// 맨 위 버튼: 메모가 있는 학생의 초안을 한꺼번에 최종본 칸에 만든다
function runMemoBatch() {
  const ids = memoTargets(scopeRows().map(toPlain));
  if (!ids.length) { toast('대상 학생이 없습니다'); return; }
  const made = [];
  const job = { after: null };
  startJob({
    ids, label: '메모로 초안 만들기',
    makeRecord: (rec, row) => ({ ...rec, achievement: rec.achievement || row?.cls?.achievement || '' }),
    onText: (rid, text) => {
      store.updateRecord(rid, { draft: text, final: text, candidates: [newCandidate(text)] });
      made.push(rid);
      refreshRow(rid, { setText: true });
    },
  });
  if (G.job) G.job.after = { action: '되돌리기', onAction: () => { for (const rid of made) { store.updateRecord(rid, { final: '', draft: '', candidates: [] }); refreshRow(rid, { setText: true }); } toast('만든 초안을 지웠습니다'); } };
  void job;
}

// ---------- 오른쪽 패널: 특징 -> 초안 -> 수정 -> 표에 붙여넣기 ----------
function renderPanel() {
  if (!els.panel) return;
  if (!G.panel) { clear(els.panel); return; }
  const sel = selectedRows();
  const traits = TRAITS_BY_AREA[G.area] || [];
  const generated = sel.filter((r) => G.generated.has(r.rec.id));
  const groups = new Map();
  for (const r of sel) { if (!groups.has(r.cls.id)) groups.set(r.cls.id, { cls: r.cls, list: [] }); groups.get(r.cls.id).list.push(r); }
  const common = h('textarea', {
    class: 'textarea', id: 'grid-common', rows: '5', value: G.common,
    placeholder: '선택한 학생 모두에게 쓸 특징을 적어 주세요. 예: 학급 회의에서 의견을 조율함. 체육대회 준비를 주도함.',
    oninput: (e) => { G.common = e.target.value; },
  });
  const picked = pickExamples(store.getStyles(), G.area, G.area === 'subject' ? (sel[0]?.cls.subject || null) : null);
  const canMake = !G.job && !noKey() && sel.length > 0 && (G.common.trim() || G.withOwn);
  clear(els.panel,
    h('div', { class: 'panel-head' },
      h('h2', { class: 'card-title' }, '일괄 작성'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '패널 닫기', onclick: () => { G.panel = false; applyLayout(); } }, icon('close'))),
    h('section', { class: 'stack', 'aria-labelledby': 'gp-1' },
      h('h3', { class: 'section-title', id: 'gp-1' }, `1 대상 (${sel.length}명)`),
      sel.length ? h('div', { class: 'stack gap-1' }, [...groups.values()].map((g) => h('p', { class: 'small' }, h('strong', {}, `${g.cls.name}${g.cls.subject ? ` (${g.cls.subject})` : ''}: `), g.list.map((r) => r.student.name).join(', '))))
        : alertBox('info', '표에서 글을 쓸 학생을 체크하세요. 교과반이 여러 개면 반별 제목 줄의 체크로 반 전체를 고를 수 있습니다.')),
    h('section', { class: 'stack', 'aria-labelledby': 'gp-2' },
      h('h3', { class: 'section-title', id: 'gp-2' }, '2 특징'),
      field('공통 특징', common, '이름과 학번은 AI로 보내지 않습니다. 학생마다 다른 글이 되도록 학생 메모를 함께 쓸 수 있습니다.'),
      h('div', { class: 'field' }, h('span', { class: 'label', id: 'gp-traits' }, '드러낼 모습'),
        h('div', { class: 'row chips', role: 'group', 'aria-labelledby': 'gp-traits' }, traits.map((t) => chip(t, G.traits.has(t), (on) => { if (on) G.traits.add(t); else G.traits.delete(t); })))),
      h('div', { class: 'field' }, h('span', { class: 'label', id: 'gp-len' }, '목표 분량'),
        seg({ labelledby: 'gp-len', options: Object.entries(LENGTH_LABELS), value: G.length, onChange: (v) => { G.length = v; } })),
      h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: G.withOwn, onchange: (e) => { G.withOwn = e.target.checked; renderPanel(); } }), '학생 메모도 함께 쓰기'),
      picked ? h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: G.styleOn, onchange: (e) => { G.styleOn = e.target.checked; renderPanel(); } }), `내 스타일 적용 (${picked.summary})`) : null),
    h('section', { class: 'stack', 'aria-labelledby': 'gp-3' },
      h('h3', { class: 'section-title', id: 'gp-3' }, '3 초안 만들기'),
      noKey() ? h('p', { class: 'hint' }, '설정에서 API 키를 넣으면 만들 수 있습니다. ', h('a', { href: '#settings' }, '설정으로 가기')) : null,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-primary', disabled: !canMake, onclick: makeSelected }, icon('spark'), G.job ? '만드는 중' : `${sel.length}명 초안 만들기`),
        ctx.isFakeAI() ? badge('가짜 AI', 'warn') : null),
      G.short.size ? alertBox('info', `메모와 특징이 부족해 초안을 만들지 않은 학생: ${[...G.short].map((id) => store.getStudent(store.state.records.get(id)?.studentId)?.name).filter(Boolean).join(', ')}`) : null),
    h('section', { class: 'stack', 'aria-labelledby': 'gp-4' },
      h('h3', { class: 'section-title', id: 'gp-4' }, `4 초안 수정 (${generated.length}명)`),
      generated.length ? generated.map(draftEditor) : h('p', { class: 'hint' }, '초안을 만들면 여기에 학생 순서대로 나옵니다. 고쳐 쓴 글이 표에 붙습니다.')),
    h('section', { class: 'stack', 'aria-labelledby': 'gp-5' },
      h('h3', { class: 'section-title', id: 'gp-5' }, '5 표에 붙여넣기'),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'gp-mode' }, '최종본 칸에 이미 글이 있을 때'),
        h('select', { class: 'select', id: 'gp-mode', value: G.mode, onchange: (e) => { G.mode = e.target.value; } },
          Object.entries(PASTE_MODES).map(([k, v]) => h('option', { value: k }, v)))),
      h('button', { type: 'button', class: 'btn btn-primary', disabled: !generated.length || !!G.job, onclick: pasteToTable }, icon('send'), '표에 순서대로 붙여넣기'),
      h('p', { class: 'hint' }, '표의 명렬 순서대로 각 학생의 최종본 칸에 넣습니다. 완료한 학생은 건드리지 않습니다.')));
}

function draftEditor(r) {
  const id = r.rec.id;
  const rec = store.state.records.get(id) || r.rec;
  const meta = h('span', { class: 'small muted grid-draft-meta' });
  const ta = h('textarea', {
    class: 'textarea grid-ta', rows: '3', value: liveRec(rec).draft || '', 'aria-label': `${r.student.name} 초안`,
    oninput: (e) => { autosize(e.target); queue(id, { draft: e.target.value }); paint(); },
  });
  function paint() {
    const text = ta.value;
    const chk = checkOfText(rec, text);
    clear(meta, `${byteLength(text)}바이트`, chk.count ? ` · 문제 ${chk.count}건: ${chk.issues.slice(0, 2).map((i) => i.message).join(', ')}` : '');
    meta.classList.toggle('text-danger', chk.count > 0);
  }
  setTimeout(() => { autosize(ta); paint(); }, 0);
  return h('div', { class: 'stack gap-1 grid-draft' },
    h('div', { class: 'row-between' }, h('strong', {}, `${Number(String(r.student.studentId).slice(3))}번 ${r.student.name}`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { ta.value = tidyText(ta.value); autosize(ta); queue(id, { draft: ta.value }); paint(); } }, '정리')),
    ta, meta);
}

function makeSelected() {
  const sel = selectedRows().filter((r) => statusOf(r.rec) !== 'done');
  if (!sel.length) { toast('고른 학생이 없습니다'); return; }
  const common = G.common; const withOwn = G.withOwn; const traits = [...G.traits]; const length = G.length;
  G.generated = new Set([...G.generated].filter((id) => !sel.some((r) => r.rec.id === id)));
  startJob({
    ids: sel.map((r) => r.rec.id), label: '초안 만들기',
    makeRecord: (rec, row) => ({ ...rec, memo: composeMemo(common, withOwn ? rec.memo : ''), traits, length, achievement: rec.achievement || row?.cls?.achievement || '' }),
    onText: (rid, text) => {
      store.updateRecord(rid, { draft: text, candidates: [newCandidate(text)] });
      G.generated.add(rid);
      if (G.panel) renderPanel();
    },
  });
}

function pasteToTable() {
  flushEdits();
  const sel = selectedRows().filter((r) => G.generated.has(r.rec.id));
  const drafts = {};
  const plan = planPaste(sel.map((r) => { const l = store.state.records.get(r.rec.id) || r.rec; drafts[r.rec.id] = l.draft; return { id: l.id, final: l.final, status: l.status }; }), drafts, { mode: G.mode });
  if (!plan.patches.length) { toast(plan.summary.keptExisting ? '최종본이 이미 있어 붙이지 않았습니다. 위에서 이어쓰기나 덮어쓰기를 고르세요.' : '붙일 글이 없습니다'); return; }
  const before = new Map(plan.patches.map((p) => [p.id, (store.state.records.get(p.id) || {}).final || '']));
  for (const p of plan.patches) { store.updateRecord(p.id, { final: p.final }); refreshRow(p.id, { setText: true }); }
  const s = plan.summary;
  const parts = [s.pasted && `새로 ${s.pasted}`, s.appended && `이어씀 ${s.appended}`, s.overwritten && `덮어씀 ${s.overwritten}`, s.keptExisting && `그대로 ${s.keptExisting}`, s.done && `완료 건너뜀 ${s.done}`].filter(Boolean);
  toast(`표에 붙였습니다: ${parts.join(', ')}`, { action: '되돌리기', onAction: () => { for (const [id, f] of before) { store.updateRecord(id, { final: f }); refreshRow(id, { setText: true }); } toast('붙이기를 되돌렸습니다'); } });
  announce(`${plan.patches.length}명의 최종본에 붙였습니다`);
  resizeAll();
}

// ---------- 전체 ----------
function pickDefaults(params) {
  const areas = allAreas();
  const pa = params?.get('area');
  if (pa && areas.includes(pa)) G.area = pa;
  if (!areas.includes(G.area)) G.area = areas[0] || null;
  const pc = params?.get('class');
  if (pc && store.getClass(pc)) {
    // 주소로 반을 지정하면 그 반만 보이게 한다 (같은 영역의 다른 반은 켜서 볼 수 있음)
    G.hidden = new Set(classesForArea().filter((c) => c.id !== pc).map((c) => c.id));
  }
  for (const id of [...G.hidden]) if (!store.getClass(id)) G.hidden.delete(id);
}

function renderAll() {
  if (!root) return;
  els = {};
  cellRefs.clear();
  const classes = store.listClasses();
  if (!classes.length) {
    clear(root, h('h1', { class: 'view-title', tabindex: '-1' }, '작성'),
      emptyState('users', '먼저 명단 화면에서 반을 만들고 학생을 등록해 주세요.', h('a', { class: 'btn btn-primary', href: '#roster' }, '명단으로 가기')));
    return;
  }
  const areas = allAreas();
  els.save = h('span', { class: 'small muted save-state' });
  els.bar = h('div', { class: 'stack gap-1' });
  els.job = h('div', { class: 'stack gap-1 grid-jobbox', hidden: true });
  els.tableHost = h('div', { class: 'write-table-host' });
  els.panel = h('aside', { class: 'panel write-panel', 'aria-label': '일괄 작성 패널', hidden: !G.panel });
  els.layout = h('div', { class: ['write-layout', G.panel && 'has-panel'] }, els.tableHost, els.panel);
  const classChips = classesForArea().map((c) => chip(`${c.name}${c.subject ? ` (${c.subject})` : ''}`, !G.hidden.has(c.id), (on) => {
    if (on) G.hidden.delete(c.id); else G.hidden.add(c.id);
    for (const id of [...G.selected]) { /* 숨긴 반의 선택은 그대로 둔다 */ void id; }
    renderTable(); renderBar(); if (G.panel) renderPanel();
  }));
  clear(root,
    h('div', { class: 'view-head row-between' }, h('h1', { class: 'view-title', tabindex: '-1' }, '작성'), els.save),
    noKey() ? alertBox('info', h('p', {}, 'AI 초안을 만들려면 설정에서 Gemini API 키를 넣어 주세요. 표에서 직접 쓰기와 점검은 키 없이도 됩니다. ', h('a', { href: '#settings' }, '설정으로 가기'))) : null,
    h('div', { class: 'write-toolbar' },
      h('div', { class: 'tabs', role: 'tablist', 'aria-label': '영역' }, areas.map((a) => h('button', {
        type: 'button', class: 'tab', role: 'tab', 'aria-selected': a === G.area, tabindex: a === G.area ? '0' : '-1',
        onclick: () => { flushEdits(); G.area = a; G.selected.clear(); G.generated.clear(); G.hidden.clear(); ctx.setParams('write', { area: a }); renderAll(); },
      }, AREA_LABELS[a]))),
      h('div', { class: 'row chips', role: 'group', 'aria-label': '보이는 반' }, classChips)),
    els.bar, els.job, els.layout);
  renderTable(); renderBar(); renderJob(); renderPanel(); setSave();
}

const typing = () => !!root && root.contains(document.activeElement) && document.activeElement.matches('textarea,input:not([type="checkbox"])');

export const gridView = {
  mount(el, params, c) {
    ctx = c;
    root = h('div', { class: 'view view-write view-grid stack' });
    el.appendChild(root);
    pickDefaults(params);
    renderAll();
    root.addEventListener('focusout', () => { setTimeout(() => { if (staleAll && root && !typing()) { flushEdits(); staleAll = false; pickDefaults(null); renderAll(); } }, 0); });
    window.addEventListener('resize', resizeAll);
  },
  update(kind, detail) {
    if (!root) return;
    if (kind === 'save') { setSave(); return; }
    if (kind === 'key') { renderAll(); return; }
    if (kind === 'records') {
      for (const id of detail?.ids || []) if (cellRefs.has(id)) refreshRow(id, { setText: !edits.has(id) });
      renderBar();
      return;
    }
    if (['classes', 'students', 'settings', 'all', 'styles'].includes(kind)) {
      if (typing() || edits.size) { staleAll = true; return; }
      pickDefaults(null); renderAll();
    }
  },
  flush() { flushEdits(); },
  unmount() { flushEdits(); window.removeEventListener('resize', resizeAll); root = null; els = {}; cellRefs.clear(); staleAll = false; },
};
