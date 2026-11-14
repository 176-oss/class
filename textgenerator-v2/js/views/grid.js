// 작성(표): 반 전체를 명렬순 표로 보고 칸에서 바로 쓴다. 표에서 점검(공백·맞춤법·금지어·한도)까지 한다.
// 학생을 체크하면 오른쪽 패널에서 '특징 -> 초안 -> 수정 -> 표에 순서대로 붙여넣기'를 한다.
// 맨 위 버튼 하나는 메모를 적어 둔 학생의 초안을 한꺼번에 만든다.
import { h, clear, icon, debounce } from '../dom.js';
import { toast, announce, chip, seg, badge, alertBox, emptyState, field, progressBar, openTool, openDialog } from '../ui.js';
import * as store from '../store.js';
import { AREA_LABELS, STATUS_LABELS, LENGTH_LABELS, TRAITS_BY_AREA, KIND_LABELS, newCandidate, deriveStatus, recordKey } from '../core/model.js';
import { byteLength, byteLevel } from '../core/bytes.js';
import { generateDrafts, aiCheck, AiError } from '../core/gemini.js';
import { pickExamples } from '../core/style.js';
import { createBatch } from '../core/batch.js';
import { writeBatch, groupsForCheck } from '../core/handoff.js';
import { checkCell, tidyText, composeMemo, planPaste, PASTE_MODES, assignedDrafts, removeCandidate, candidateTarget, autoAssign, parseStandards, standardsText, groupOfStudent, saveGroup, nextGroupName, EVENT_AREAS, formatEventDate, eventLabel, saveEvent, missingEventLabels, parseEventList } from '../core/grid.js';
import { readSheetFile } from '../xlsx-io.js';

const G = {
  area: null,
  hidden: new Set(), // 숨긴 반 id
  onlySelected: false, // 체크한 학생만 보기 (반을 가리지 않고 체크한 학생을 모두 보여 준다)
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
  stds: new Set(), // 이번 초안에 쓸 성취기준 (줄 전체 글자)
  evIds: new Set(), // 이번 초안에 쓸 행사 id (자율·진로)
  request: '', // 추가 요청 (강조점·문장 모양)
  ai: new Map(), // AI 점검 결과: 기록 id -> { text, issues } (점검한 글과 지금 글이 같을 때만 보여 줌, 화면 메모리)
  method: 'each', // each: 학생마다 만들기 | shared: 후보 몇 개를 만들어 학생에게 나눠 붙이기
  cands: [], // shared 방식의 후보 글 (최대 6개, 화면 메모리)
  assign: new Map(), // 기록 id -> 후보 번호
  candBusy: false,
  inited: false,
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

// ---------- 모둠 (교과세특): 반에 cls.groups 로 저장, 모둠 메모는 그 모둠 학생의 초안 재료가 된다 ----------
let quietClass = false; // 모둠 메모를 고칠 때 표를 다시 그리지 않는다 (입력 중 포커스를 잃지 않게)
const liveCls = (cls) => store.getClass(cls?.id) || cls;
const groupOf = (rec, cls) => groupOfStudent(liveCls(cls)?.groups, rec.studentId);
function memoFor(rec, row, common, withOwn = true) {
  return composeMemo(common, groupOf(rec, row?.cls)?.memo, withOwn ? rec.memo : '');
}
function writeGroups(clsId, groups, { quiet = false } = {}) {
  quietClass = quiet;
  try { store.updateClass(clsId, { groups }); } finally { quietClass = false; }
}
/** 이 학생 반의 행사 중 이번에 체크한 것의 표기 (자율·진로) */
// 학교 행사 목록: 설정 events[영역] (모든 반이 함께 씀). 예전에 반에 넣은 행사(cls.events)도 함께 보여 준다
const schoolEvents = () => store.state.settings?.events?.[G.area] || [];
const eventsOf = (cls) => { const a = schoolEvents(); const ids = new Set(a.map((e) => e.id)); return [...a, ...(liveCls(cls)?.events?.[G.area] || []).filter((e) => !ids.has(e.id))]; };
const writeSchoolEvents = (list) => store.updateSettings({ events: { ...(store.state.settings?.events || {}), [G.area]: list } });
const newEventId = () => `e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const pickedEventList = (row) => (EVENT_AREAS.includes(G.area) ? eventsOf(row?.cls).filter((e) => G.evIds.has(e.id)) : []);
const pickedEvents = (row) => pickedEventList(row).map(eventLabel);

// ---------- 계산 ----------
function classesForArea() {
  return store.listClasses().filter((c) => store.areasOfClass(c).some((a) => a.area === G.area));
}
// 교과세특에서 반이 여럿이면 처음에는 아무 반도 열지 않고, 위에서 반을 체크해 명단을 불러온다
function defaultHidden() {
  const list = classesForArea();
  return G.area === 'subject' && list.length >= 2 ? new Set(list.map((c) => c.id)) : new Set();
}
function allAreas() {
  const set = new Set();
  for (const c of store.listClasses()) for (const a of store.areasOfClass(c)) set.add(a.area);
  return ['autonomy', 'career', 'behavior', 'club', 'subject'].filter((a) => set.has(a));
}
function buildRows() {
  const out = [];
  for (const cls of classesForArea()) {
    if (!G.onlySelected && G.hidden.has(cls.id)) continue;
    for (const student of store.studentsOf(cls)) {
      const rec = store.getRecord(student.studentId, G.area, G.area === 'subject' ? cls.subject : null);
      if (G.onlySelected && !G.selected.has(rec.id)) continue;
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

// 점검 지적은 학생 행 바로 아래의 넓은 줄에 가로로 이어 쓴다 (좁은 칸에 세로로 쌓이지 않게)
const ISSUE_LEVEL = { over: 'danger', forbidden: 'danger', spell: 'warn', neis: 'warn', input: 'warn', similar: 'warn', style: 'warn' };
const MAX_LINE_ITEMS = 8;
const issueItem = (level, message, tag, action) => h('li', { class: `is-${level}` },
  tag ? h('span', { class: 'grid-issue-tag' }, tag) : null, h('span', {}, message), action || null);

// ---------- AI 점검 (설정 aiCheck 로 켜고 끔) ----------
const aiOn = () => !!store.state.settings?.aiCheck;
/** AI 지적 결과. 점검한 뒤 글이 바뀌었으면 결과를 버린다. 없으면 null */
function aiResult(id, ref) {
  if (!aiOn()) return null;
  const got = G.ai.get(id);
  if (!got) return null;
  if (got.text !== ref.final.value) { G.ai.delete(id); return null; }
  return got;
}
function aiItems(id, row, ref, locked, got) {
  return got.issues.map((i) => issueItem('warn', i.message, 'AI', i.fix && !locked ? h('button', {
    type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `${row.student.name} AI 고침 적용: ${i.message}`,
    onclick: () => {
      const cur = ref.final.value;
      if (cur.indexOf(i.original) < 0) return;
      const next = cur.replace(i.original, i.fix);
      ref.final.value = next; autosize(ref.final);
      G.ai.set(id, { text: next, issues: got.issues.filter((x) => x !== i && next.includes(x.original)) });
      queue(id, { final: next }); refreshRow(id);
      announce('AI 고침을 적용했습니다');
    },
  }, '고침 적용') : null));
}

function runAiCheck() {
  flushEdits();
  const targets = scopeRows().filter((r) => String(liveRec(r.rec).final || '').trim());
  if (!targets.length) { toast('최종본이 있는 학생이 없습니다'); return; }
  const roster = rosterAll();
  const settings = store.state.settings;
  const job = { label: 'AI 점검', total: targets.length, done: 0, failed: [], short: 0, stopReason: '', batch: null, summary: () => `${targets.length}명 점검했습니다` };
  job.batch = createBatch({
    targets: targets.map((r) => r.rec.id),
    intervalMs: (Number(settings.batchIntervalSec) || 5) * 1000,
    onProgress: (st) => { job.done = st.done + st.skipped + st.failed.length; job.failed = st.failed; job.stopReason = st.stopReason ? (st.stopMessage || '오류로 멈췄습니다') : ''; renderJob(); },
    run: async (rid) => {
      const rec = store.state.records.get(rid);
      const text = rec?.final || '';
      if (!text.trim()) return 'skipped';
      const st = store.getStudent(rec.studentId);
      const issues = await aiCheck({ record: rec, text, studentName: st?.name || '', roster, settings, apiKey: store.getApiKey(), fake: ctx.isFakeAI() });
      G.ai.set(rid, { text, issues });
      refreshRow(rid);
    },
  });
  G.job = job;
  renderBar(); renderJob();
  Promise.resolve(job.batch.start()).catch((e) => { if (!(e instanceof AiError)) console.warn('AI 점검 중 예상 못 한 오류:', e?.name || 'Error'); }).finally(() => {
    if (G.job === job && !job.batch.state.running && job.batch.state.next >= job.total) finishJob(); else renderJob();
  });
}

function aiBar() {
  const n = scopeRows().filter((r) => String(liveRec(r.rec).final || '').trim()).length;
  return h('div', { class: 'row grid-ai' },
    h('label', { class: 'check-row', for: 'grid-ai-on' },
      h('input', { type: 'checkbox', id: 'grid-ai-on', checked: aiOn(), onchange: (e) => { store.updateSettings({ aiCheck: e.target.checked }); renderBar(); for (const id of cellRefs.keys()) refreshRow(id); document.getElementById('grid-ai-on')?.focus(); } }),
      h('span', {}, 'AI 점검 (맞춤법, 영역, 나열식)')),
    aiOn() ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: !!G.job || noKey() || !n, onclick: runAiCheck }, icon('spark'), `AI로 점검 (${n}명)`) : null,
    aiOn() ? h('span', { class: 'small muted' }, noKey() ? '설정에서 API 키를 넣으면 쓸 수 있습니다.' : `${selectedRows().length ? '고른 학생' : '표의 학생'} 중 최종본이 있는 학생을 점검합니다. 이름과 학번은 가리고 보냅니다.`) : null);
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
  if (ref.std) { const n = parseStandards(live.achievement).length; ref.std.textContent = n ? `성취기준 ${n}` : '성취기준'; }
  clearTimeout(checkTimers.get(id));
  checkTimers.set(id, setTimeout(() => {
    const chk = checkOfText(rec, ref.final.value);
    ref.chk = chk;
    ref.tr.classList.toggle('has-issue', chk.count > 0);
    const ai = chk.empty ? null : aiResult(id, ref);
    const same = new Map(); // 같은 지적은 한 번만, 몇 곳인지 붙인다
    for (const i of chk.empty ? [] : chk.issues) { const k = `${i.kind}|${i.message}`; same.set(k, { i, n: (same.get(k)?.n || 0) + 1 }); }
    const items = chk.empty ? [] : [
      ...[...same.values()].map(({ i, n }) => issueItem(ISSUE_LEVEL[i.kind] || 'warn', n > 1 ? `${i.message} ${n}곳` : i.message)),
      ...(ai ? aiItems(id, row, ref, locked, ai) : []),
    ];
    clear(ref.detailCell, items.length ? h('ul', { class: 'grid-issue-line', 'aria-label': `${row.student.name} 점검 지적` },
      items.slice(0, MAX_LINE_ITEMS), items.length > MAX_LINE_ITEMS ? h('li', { class: 'muted' }, `외 ${items.length - MAX_LINE_ITEMS}건`) : null) : null);
    ref.detail.hidden = !items.length || !ref.showDetail;
    ref.tr.classList.toggle('has-detail', items.length > 0);
    if (chk.empty) { clear(ref.issues, h('span', { class: 'muted' }, '-')); return; }
    clear(ref.issues,
      h('div', { class: 'row gap-1' },
        chk.count ? badge(`문제 ${chk.count}`, 'danger') : h('span', { class: 'small muted' }, '문제 없음'),
        ai ? badge(ai.issues.length ? `AI ${ai.issues.length}` : 'AI 없음', ai.issues.length ? 'warn' : 'done') : null),
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
  const stdBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': `${student.name} 성취기준 고르기`, onclick: () => openStandards(row) });
  const ref = {
    tr: null, memo, final: fin, done: doneBox, std: stdBtn,
    bytes: h('td', { class: 'num' }), status: h('td', {}), issues: h('td', { class: 'grid-issue-cell' }),
  };
  const showClass = cls.kind !== 'homeroom';
  const cells = {
    check: () => h('td', { class: 'col-check' }, h('label', { class: 'check-hit' }, sel)),
    no: () => h('td', { class: 'num' }, showClass ? `${Number(String(student.studentId).slice(0, 1))}-${Number(String(student.studentId).slice(1, 3))} ${Number(String(student.studentId).slice(3)) || ''}` : (String(student.studentId).slice(3) * 1 || student.studentId)),
    name: () => h('th', { scope: 'row', class: 'col-name' }, student.name, G.area === 'subject' && groupOf(rec, cls) ? h('span', { class: 'small muted grid-group-tag' }, groupOf(rec, cls).name) : null),
    memo: () => h('td', {}, memo),
    final: () => h('td', {}, fin),
    bytes: () => ref.bytes,
    status: () => ref.status,
    issues: () => ref.issues,
    std: () => h('td', {}, stdBtn),
    done: () => h('td', { class: 'col-done' }, h('label', { class: 'check-hit' }, doneBox)),
  };
  const keys = visibleCols().map((c) => c.key);
  ref.tr = h('tr', { 'data-id': id }, keys.map((k) => cells[k]()));
  // 지적 줄: 체크·번호·이름 칸 아래는 비우고, 그 뒤부터 끝까지 넓게 쓴다 (점검 열을 숨기면 지적 줄도 숨김)
  ref.showDetail = keys.includes('issues');
  ref.detailCell = h('td', { class: 'grid-issue-detail', colspan: String(keys.length - 3) });
  ref.detail = h('tr', { class: 'grid-issue-row', hidden: true }, h('td', { colspan: '3' }), ref.detailCell);
  cellRefs.set(id, ref);
  return [ref.tr, ref.detail];
}

// ---------- 열: 숨기기와 너비 조절 (이 브라우저에만 저장) ----------
const COLS_KEY = 'sgb-v2-grid-cols';
const colPrefs = (() => { try { const v = JSON.parse(localStorage.getItem(COLS_KEY) || 'null'); return { hide: Array.isArray(v?.hide) ? v.hide : [], w: v?.w && typeof v.w === 'object' ? v.w : {} }; } catch { return { hide: [], w: {} }; } })();
const saveColPrefs = () => { try { localStorage.setItem(COLS_KEY, JSON.stringify(colPrefs)); } catch { /* 저장 못 하면 이번에만 */ } };
// hideable: 숨길 수 있는 열. resize: 너비를 끌어 바꿀 수 있는 열 (최종본은 남는 폭을 모두 씀)
function allCols() {
  const wide = rows.some((r) => r.cls.kind !== 'homeroom'); // 교과·동아리 반은 학년-반 번호로 보인다
  const p = G.panel;
  return [
    { key: 'check', label: '', w: 44 },
    { key: 'no', label: wide ? '반 번호' : '번호', w: wide ? 76 : 48, num: true },
    { key: 'name', label: '이름', w: 76, resize: true },
    { key: 'memo', label: '메모', w: p ? '14%' : '18%', hideable: true, resize: true },
    { key: 'final', label: '최종본', w: 'auto' },
    { key: 'bytes', label: '바이트', w: 64, num: true, hideable: true },
    p ? null : { key: 'status', label: '상태', w: 72, hideable: true },
    { key: 'issues', label: '점검', w: p ? 96 : 104, hideable: true, resize: true },
    G.area === 'subject' && !p ? { key: 'std', label: '성취기준', w: 104, hideable: true } : null,
    p ? null : { key: 'done', label: '완료', w: 52, hideable: true },
  ].filter(Boolean);
}
const visibleCols = () => allCols().filter((c) => !(c.hideable && colPrefs.hide.includes(c.key)));
const colWidth = (c) => (colPrefs.w[c.key] ? `${colPrefs.w[c.key]}px` : typeof c.w === 'number' ? `${c.w}px` : c.w);
const COL_MIN = 48; const COL_MAX = 640;

/** 머리 칸 오른쪽 끝의 손잡이: 끌거나, 포커스 뒤 왼쪽·오른쪽 화살표로 16px씩. 두 번 누르면 처음 너비 */
function resizer(c, col) {
  const set = (px) => { const v = Math.round(Math.min(COL_MAX, Math.max(COL_MIN, px))); colPrefs.w[c.key] = v; col.style.width = `${v}px`; el.setAttribute('aria-valuenow', String(v)); return v; };
  const el = h('span', {
    class: 'col-resize', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': `${c.label} 열 너비 (왼쪽·오른쪽 화살표로 조절)`,
    'aria-valuemin': String(COL_MIN), 'aria-valuemax': String(COL_MAX),
    onpointerdown: (e) => {
      e.preventDefault();
      const th = el.parentElement; const x0 = e.clientX; const w0 = th.getBoundingClientRect().width;
      el.setPointerCapture?.(e.pointerId);
      const move = (ev) => { set(w0 + ev.clientX - x0); };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); saveColPrefs(); resizeAll(); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
    },
    onkeydown: (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const cur = el.parentElement.getBoundingClientRect().width;
      announce(`${c.label} 열 ${set(cur + (e.key === 'ArrowRight' ? 16 : -16))}px`);
      saveColPrefs(); resizeAll();
    },
    ondblclick: () => { delete colPrefs.w[c.key]; saveColPrefs(); renderTable(); },
  });
  return el;
}

/** 표 위 '보이는 열' 메뉴 */
function colMenu() {
  const opts = allCols().filter((c) => c.hideable);
  const hidden = opts.filter((c) => colPrefs.hide.includes(c.key)).length;
  return h('details', { class: 'grid-colmenu' },
    h('summary', { class: 'btn btn-ghost btn-sm' }, `보이는 열${hidden ? ` (${hidden}개 숨김)` : ''}`),
    h('div', { class: 'stack gap-1 grid-colmenu-body', role: 'group', 'aria-label': '보이는 열' },
      opts.map((c) => h('label', { class: 'check-row', for: `col-${c.key}` },
        h('input', { type: 'checkbox', id: `col-${c.key}`, checked: !colPrefs.hide.includes(c.key), onchange: (e) => {
          colPrefs.hide = e.target.checked ? colPrefs.hide.filter((k) => k !== c.key) : [...colPrefs.hide, c.key];
          saveColPrefs(); renderTable(); document.getElementById(`col-${c.key}`)?.focus();
        } }), h('span', {}, c.label))),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { colPrefs.hide = []; colPrefs.w = {}; saveColPrefs(); renderTable(); } }, '열 처음대로'),
      h('p', { class: 'hint' }, '열 이름 오른쪽 끝을 끌면 너비가 바뀝니다. 두 번 누르면 처음 너비로 돌아갑니다.')));
}

function renderTable() {
  if (!els.tableHost) return;
  cellRefs.clear();
  rows = buildRows();
  const classes = classesForArea();
  if (!classes.length) { clear(els.tableHost, emptyState('users', '이 영역을 쓰는 반이 없습니다.')); return; }
  if (!rows.length) { clear(els.tableHost, emptyState('users', G.onlySelected ? '체크한 학생이 없습니다. "체크한 학생만"를 끄고 학생을 체크하세요.' : G.hidden.size ? '위에서 반을 체크하면 그 반의 명단이 나옵니다.' : '표시할 학생이 없습니다.', h('a', { class: 'btn btn-primary', href: '#roster' }, '명단으로 가기'))); return; }
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
        h('th', { colspan: String(visibleCols().length - 1), scope: 'colgroup' }, `${row.cls.name} (${KIND_LABELS[row.cls.kind]}${row.cls.subject ? ` · ${row.cls.subject}` : ''}) · ${mine.length}명`)));
    }
    body.push(...rowEl(row));
  }
  const cols = visibleCols();
  const colEls = cols.map((c) => h('col', { style: { width: colWidth(c) } }));
  const table = h('table', { class: 'table grid-table' },
    h('caption', { class: 'sr-only' }, `${AREA_LABELS[G.area]} 작성 표 (명렬순)`),
    h('colgroup', {}, colEls),
    h('thead', {}, h('tr', {}, cols.map((c, i) => h('th', { scope: 'col', class: [c.key === 'check' ? 'col-check' : null, c.num ? 'num' : null, 'grid-th'] },
      c.key === 'check' ? h('label', { class: 'check-hit' }, selAll) : c.label,
      c.resize ? resizer(c, colEls[i]) : null)))),
    h('tbody', {}, body));
  els.table = table;
  clear(els.tableHost, h('div', { class: 'grid-table-actions' }, colMenu()), h('div', { class: 'table-wrap grid-wrap' }, table));
  for (const r of rows) refreshRow(r.rec.id);
  resizeAll();
  syncChecks();
}

function syncChecks() {
  syncBoard();
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

// ---------- 칩 판: 반마다 번호·이름 칩을 한눈에 보고 눌러서 고른다 (교과·동아리 반) ----------
const boardIds = (cls) => store.studentsOf(cls).map((st) => ({ st, id: recordKey(st.studentId, G.area, G.area === 'subject' ? cls.subject : null) }));

function renderBoard() {
  if (!els.board) return;
  const kinds = G.area === 'subject' || G.area === 'club';
  const list = kinds ? classesForArea().filter((c) => !G.hidden.has(c.id)) : [];
  if (!list.length) { clear(els.board); els.board.hidden = true; return; }
  els.board.hidden = false;
  clear(els.board,
    h('h2', { class: 'section-title' }, '학생 고르기'),
    h('p', { class: 'small muted' }, '이름을 눌러 고르고 다시 누르면 풉니다. 밑줄이 있는 학생은 최종본이 이미 있습니다.'),
    list.map((cls) => {
      const members = boardIds(cls);
      return h('section', { class: 'stack gap-1 board-class', 'aria-label': `${cls.name} 학생 고르기` },
        h('div', { class: 'row' },
          h('strong', {}, `${cls.name}${cls.subject ? ` (${cls.subject})` : ''}`),
          h('span', { class: 'small muted num', 'data-board-count': cls.id }),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { members.forEach((m) => G.selected.add(m.id)); onSelection(); } }, '반 전체'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { members.forEach((m) => G.selected.delete(m.id)); onSelection(); } }, '반 해제')),
        h('div', { class: 'board-grid', role: 'group', 'aria-label': `${cls.name} 학생` }, members.map(({ st, id }) => h('button', {
          type: 'button', class: 'chip board-chip', 'data-board-id': id, 'data-cls': cls.id, 'aria-pressed': String(G.selected.has(id)),
          title: `${st.studentId} ${st.name}`,
          onclick: () => { if (G.selected.has(id)) G.selected.delete(id); else G.selected.add(id); onSelection(); },
        }, `${Number(String(st.studentId).slice(3)) || st.studentId} ${st.name}`))));
    }));
  syncBoard();
}

function syncBoard() {
  if (!els.board || els.board.hidden) return;
  els.board.querySelectorAll('[data-board-id]').forEach((b) => {
    const id = b.dataset.boardId;
    b.setAttribute('aria-pressed', String(G.selected.has(id)));
    const fin = (store.state.records.get(id)?.final || '').trim();
    b.classList.toggle('is-written', !!fin);
  });
  els.board.querySelectorAll('[data-board-count]').forEach((el) => {
    const chips = [...els.board.querySelectorAll(`[data-cls="${el.dataset.boardCount}"]`)];
    el.textContent = `${chips.filter((b) => G.selected.has(b.dataset.boardId)).length}/${chips.length}명 선택`;
  });
}

function selectedRows() { return rows.filter((r) => G.selected.has(r.rec.id)); }

// 학생을 고르면 초안 만들기 패널을 바로 열고, 모두 풀면 닫는다
function onSelection() {
  const n = selectedRows().length;
  const toggle = (n > 0) !== G.panel;
  if (toggle) G.panel = n > 0;
  if (toggle) applyLayout(); else if (G.onlySelected) renderTable(); // 체크를 풀면 그 학생은 표에서 빠진다
  syncChecks();
  renderBar();
  if (G.panel) renderPanel();
}
function openPanel() { G.panel = true; applyLayout(); renderPanel(); renderBar(); document.getElementById('grid-common')?.focus(); }

// ---------- 성취기준 ----------
/** 이 학생에게 쓸 성취기준 글: 패널에서 체크한 것 > 학생에게 고른 것 > 반에 올려 둔 전체 */
function achFor(rec, cls) {
  if (G.stds.size) return standardsText(G.stds);
  return rec.achievement || cls?.achievement || '';
}

/** 학생 한 명이 성취한 성취기준을 체크한다. 아무것도 안 고르면 반에 올려 둔 전체를 AI에 알려 준다 */
function openStandards(row) {
  const rec = store.state.records.get(row.rec.id) || row.rec;
  const all = parseStandards(row.cls.achievement);
  const mine = new Set(parseStandards(rec.achievement).map((x) => x.line));
  const extra = [...mine].filter((l) => !all.some((x) => x.line === l)); // 반 목록에 없는 직접 쓴 줄
  const items = [...all.map((x) => x.line), ...extra];
  if (!items.length) {
    openDialog({
      title: `${row.student.name} 성취기준`,
      body: [h('p', {}, '이 반에 올려 둔 성취기준이 없습니다. 명단 화면의 반 설정에서 성취기준을 먼저 올려 주세요.'), h('a', { class: 'btn btn-secondary', href: `#roster?class=${encodeURIComponent(row.cls.id)}` }, '명단으로 가기')],
      actions: [{ label: '닫기', variant: 'secondary', value: true }],
    });
    return;
  }
  const checked = new Set(mine);
  const boxes = items.map((line, i) => h('label', { class: 'check-row grid-std', for: `std-${i}` },
    h('input', { type: 'checkbox', id: `std-${i}`, checked: checked.has(line), onchange: (e) => { if (e.target.checked) checked.add(line); else checked.delete(line); } }),
    h('span', {}, line)));
  const dlg = openDialog({
    title: `${row.student.name}이(가) 성취한 성취기준`,
    wide: true,
    body: [
      h('p', { class: 'small muted' }, '체크한 성취기준을 포함해 글을 만듭니다. 아무것도 체크하지 않으면 반에 올려 둔 성취기준 전체를 AI에 알려 줍니다.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { items.forEach((l, i) => { checked.add(l); const b = dlg.el.querySelector(`#std-${i}`); if (b) b.checked = true; }); } }, '모두 체크'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { checked.clear(); dlg.el.querySelectorAll('input[type=checkbox]').forEach((b) => { b.checked = false; }); } }, '모두 풀기')),
      h('div', { class: 'stack gap-1' }, boxes),
    ],
    actions: [{ label: '취소', variant: 'secondary', value: false }, { label: '저장', variant: 'primary', value: true }],
  });
  dlg.closed.then((ok) => {
    if (!ok) return;
    store.updateRecord(row.rec.id, { achievement: standardsText(items.filter((l) => checked.has(l))) });
    refreshRow(row.rec.id);
    toast(`${row.student.name}: 성취기준 ${checked.size}개를 골랐습니다`);
  });
}

// ---------- 위쪽 ----------
// 점검기로 보내기: 고른 학생(없으면 표의 모든 학생)의 최종본을 점검기에 넘기고 점검기를 연다
function sendToChecker() {
  flushEdits();
  const src = selectedRows().length ? selectedRows() : rows;
  const items = src.map((r) => ({
    studentId: r.student.studentId, name: r.student.name, area: G.area, subject: G.area === 'subject' ? r.cls.subject || '' : '',
    text: liveRec(r.rec).final || '',
  }));
  const groups = groupsForCheck(items);
  if (!groups.length) { toast('보낼 최종본이 없습니다. 최종본을 쓴 학생이 있어야 점검할 수 있습니다.'); return; }
  const school = store.state.settings?.schoolLevel === 'middle' ? 'mid' : 'high';
  const r = writeBatch(window.localStorage, { source: 'textgenerator-v2', school, groups });
  if (!r.ok) { toast(r.reason, { danger: true }); return; }
  openTool('sgb-checker', '../sgb-checker/');
  toast(`최종본 ${r.count}명을 점검기로 보냈습니다. 5분 안에 열려야 넘어갑니다.`);
}

function renderBar() {
  if (!els.bar) return;
  const n = selectedRows().length;
  clear(els.bar,
    n ? null : h('p', { class: 'small muted' }, '초안을 만들 학생을 표에서 체크하면 오른쪽에 초안 만들기 패널이 열립니다. 여러 명을 체크하면 함께 만듭니다.'),
    eventBar(),
    aiBar(),
    groupBar(),
    n ? h('div', { class: 'row grid-selbar', role: 'status' },
      h('strong', {}, `${n}명 선택`),
      G.panel ? null : h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: openPanel }, '초안 만들기 패널 열기'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { G.selected.clear(); onSelection(); } }, '선택 풀기')) : null);
}
function scopeRows() { const sel = selectedRows(); return sel.length ? sel : rows; }

function applyLayout() {
  els.layout?.classList.toggle('has-panel', G.panel);
  if (!G.panel) clear(els.panel);
  els.panel.hidden = !G.panel;
  renderTable();
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
  G.candBusy = false;
  renderBar(); renderJob();
  if (G.panel) renderPanel();
  const body = j.summary ? j.summary() : `${made}명 만들었습니다`;
  toast(`${j.label}: ${body}${j.short ? (j.summary ? `, 건너뜀 ${j.short}번` : `, 메모 부족 ${j.short}명`) : ''}${j.failed.length ? `, 실패 ${j.failed.length}${j.summary ? '번' : '명'}` : ''}`, j.after ? j.after : undefined);
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

// ---------- 모둠 ----------
/** 위쪽 모둠 버튼: 누르면 그 모둠 학생을 고르고 패널을 연다 */
function groupBar() {
  if (G.area !== 'subject') return null;
  const shown = classesForArea().filter((c) => G.onlySelected || !G.hidden.has(c.id));
  const list = shown.flatMap((c) => (liveCls(c).groups || []).map((g) => ({ c, g })));
  if (!list.length) return null;
  const many = shown.length > 1;
  return h('div', { class: 'row grid-groups', role: 'group', 'aria-labelledby': 'grid-groups-label' },
    h('span', { class: 'small muted', id: 'grid-groups-label' }, '모둠'),
    list.map(({ c, g }) => h('button', {
      type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': `${many ? `${c.name} ` : ''}${g.name} ${g.studentIds.length}명 고르기`,
      onclick: () => selectGroup(c, g),
    }, `${many ? `${c.name} ` : ''}${g.name} (${g.studentIds.length}명)`)));
}

function selectGroup(c, g) {
  G.selected.clear();
  for (const sid of g.studentIds) G.selected.add(store.getRecord(sid, G.area, c.subject).id);
  G.hidden.delete(c.id);
  G.panel = true;
  renderBar(); applyLayout(); renderPanel();
  document.getElementById(`gp-group-memo-${g.id}`)?.focus();
}

/** 패널: 고른 학생으로 모둠 만들기, 고른 학생이 든 반의 모둠과 모둠 메모 */
function groupSection(sel) {
  if (G.area !== 'subject') return null;
  const byCls = new Map();
  for (const r of sel) { if (!byCls.has(r.cls.id)) byCls.set(r.cls.id, liveCls(r.cls)); }
  const one = byCls.size === 1 ? [...byCls.values()][0] : null;
  const make = () => {
    if (!one) { toast('모둠은 한 반 안에서 만듭니다. 한 반의 학생만 골라 주세요.'); return; }
    const groups = one.groups || [];
    const g = { id: `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: nextGroupName(groups), memo: '', studentIds: sel.map((r) => r.student.studentId) };
    writeGroups(one.id, saveGroup(groups, g));
    toast(`${one.name}에 ${g.name}(${g.studentIds.length}명)을 만들었습니다. 모둠 메모를 적어 주세요.`);
    renderTable(); renderBar(); renderPanel();
    document.getElementById(`gp-group-memo-${g.id}`)?.focus();
  };
  const cards = [...byCls.values()].flatMap((c) => (c.groups || []).map((g) => groupCard(c, g, sel)));
  return h('section', { class: 'stack', 'aria-labelledby': 'gp-group' },
    h('h3', { class: 'section-title', id: 'gp-group' }, '모둠 메모'),
    h('p', { class: 'hint' }, '같이 활동한 학생을 모둠으로 묶고 공통 메모를 적어 두면, 초안을 만들 때 그 모둠 학생에게 모둠 메모가 들어갑니다. 한 학생은 한 반에서 모둠 하나에만 들어갑니다.'),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-secondary', disabled: !sel.length, onclick: make }, icon('plus'), `고른 ${sel.length}명으로 새 모둠 만들기`)),
    cards.length ? cards : null);
}

function groupCard(c, g, sel) {
  const save = (patch) => {
    const cur = (liveCls(c).groups || []).find((x) => x.id === g.id);
    if (cur) writeGroups(c.id, saveGroup(liveCls(c).groups, { ...cur, ...patch }), { quiet: true });
  };
  const names = g.studentIds.map((sid) => store.getStudent(sid)?.name).filter(Boolean);
  const picked = sel.filter((r) => r.cls.id === c.id).map((r) => r.student.studentId);
  const same = picked.length === g.studentIds.length && picked.every((x) => g.studentIds.includes(x));
  return h('div', { class: 'stack gap-1 grid-draft' },
    h('div', { class: 'row-between' },
      h('label', { class: 'label', for: `gp-group-name-${g.id}` }, '모둠 이름'),
      h('span', { class: 'small muted' }, c.name)),
    h('input', { class: 'input', id: `gp-group-name-${g.id}`, value: g.name, maxlength: '20', onchange: (e) => { save({ name: e.target.value }); renderBar(); renderTable(); } }),
    h('p', { class: 'small' }, `${names.length}명: ${names.join(', ')}`),
    h('label', { class: 'label', for: `gp-group-memo-${g.id}` }, `${g.name} 공통 메모`),
    h('textarea', {
      class: 'textarea', id: `gp-group-memo-${g.id}`, rows: '3', value: g.memo || '',
      placeholder: '예: 주기율표 모둠 탐구에서 족별 성질을 표로 정리하고 발표함.',
      oninput: (e) => save({ memo: e.target.value }), // 바로 저장해야 곧이어 [초안 만들기]를 눌러도 들어간다
    }),
    h('div', { class: 'row' },
      same ? null : h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => selectGroup(c, g) }, '이 모둠 고르기'),
      !same && picked.length ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { writeGroups(c.id, saveGroup(liveCls(c).groups, { ...g, studentIds: picked })); toast(`${g.name}을 고른 ${picked.length}명으로 바꿨습니다`); renderTable(); renderBar(); renderPanel(); } }, `고른 ${picked.length}명으로 바꾸기`) : null,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => {
        const before = liveCls(c).groups || [];
        writeGroups(c.id, before.filter((x) => x.id !== g.id));
        toast(`${g.name}을 지웠습니다. 학생 메모와 기록은 그대로입니다.`, { action: '되돌리기', onAction: () => { writeGroups(c.id, before); renderTable(); renderBar(); renderPanel(); } });
        renderTable(); renderBar(); renderPanel();
      } }, '모둠 지우기')));
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
    oninput: (e) => { G.common = e.target.value; updateMakeButtons(); },
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
    eventsBox(sel),
    groupSection(sel),
    h('section', { class: 'stack', 'aria-labelledby': 'gp-2' },
      h('h3', { class: 'section-title', id: 'gp-2' }, '2 특징'),
      field('공통 특징', common, '이름과 학번은 AI로 보내지 않습니다. 학생마다 다른 글이 되도록 학생 메모를 함께 쓸 수 있습니다.'),
      h('div', { class: 'field' }, h('span', { class: 'label', id: 'gp-traits' }, '드러낼 모습'),
        h('div', { class: 'row chips', role: 'group', 'aria-labelledby': 'gp-traits' }, traits.map((t) => chip(t, G.traits.has(t), (on) => { if (on) G.traits.add(t); else G.traits.delete(t); })))),
      h('div', { class: 'field' }, h('span', { class: 'label', id: 'gp-len' }, '목표 분량'),
        seg({ labelledby: 'gp-len', options: Object.entries(LENGTH_LABELS), value: G.length, onChange: (v) => { G.length = v; } })),
      standardsBox(sel),
      field('추가 요청 (선택)', h('textarea', { class: 'textarea', id: 'grid-request', rows: '2', value: G.request, placeholder: '예: 리더십을 특히 강조, 문장을 짧게', oninput: (e) => { G.request = e.target.value; } }), '강조점과 문장 모양에만 반영하고, 메모에 없는 사실은 더하지 않습니다.'),
      h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: G.withOwn, onchange: (e) => { G.withOwn = e.target.checked; renderPanel(); } }), '학생 메모도 함께 쓰기'),
      picked ? h('label', { class: 'check-row' }, h('input', { type: 'checkbox', checked: G.styleOn, onchange: (e) => { G.styleOn = e.target.checked; renderPanel(); } }), `내 스타일 적용 (${picked.summary})`) : null),
    ...methodSections(sel, generated, canMake));
}

// 공통 특징을 쓰는 동안 [초안/후보 만들기] 버튼의 켜짐을 맞춘다 (패널을 다시 그리지 않는다)
function updateMakeButtons() {
  const n = selectedRows().length;
  const base = !G.job && !G.candBusy && !noKey() && n > 0;
  els.panel?.querySelectorAll('[data-make]').forEach((b) => {
    b.disabled = !(base && (b.dataset.make === 'shared' ? G.common.trim() && G.cands.length < candidateTarget(n) : (G.common.trim() || G.withOwn)));
  });
}

// 행사 목록 가져오기: 붙여넣기 또는 엑셀·CSV (앞 칸 행사명, 뒤 칸 날짜). 지금 목록에 더한다 (같은 행사는 한 번)
function importEvents() {
  const year = store.state.settings?.schoolYear;
  const ta = h('textarea', { class: 'textarea', id: 'ev-import', rows: '8', placeholder: '학생자치회 임원 선거\t2026.03.15.\n체육대회\t2026.05.14.-2026.05.15.\n진로의 날, 2026.6.3' });
  const note = h('div', { class: 'stack gap-1', role: 'status' });
  let dlg = null;
  function save(input, how) {
    const r = parseEventList(input, year);
    if (!r.events.length) { clear(note, alertBox('warn', h('div', {}, '읽은 행사가 없습니다. 한 줄에 행사명과 날짜를 적어 주세요.', r.errors.length ? h('ul', {}, r.errors.slice(0, 5).map((x) => h('li', {}, x))) : null))); return; }
    const cur = schoolEvents();
    const have = new Set(cur.map((e) => `${e.name}|${e.date}`));
    const added = r.events.filter((e) => !have.has(`${e.name}|${e.date}`));
    let list = cur;
    for (const e of added) list = saveEvent(list, { id: newEventId(), ...e });
    writeSchoolEvents(list);
    toast(`${how} 행사 ${added.length}개를 더했습니다${r.events.length - added.length ? ` (이미 있는 ${r.events.length - added.length}개 빼고)` : ''}${r.errors.length ? `. 읽지 못한 줄 ${r.errors.length}개` : ''}`);
    dlg?.close(true);
    if (G.panel) renderPanel();
    renderBar();
  }
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', hidden: true, 'aria-label': '행사 목록 파일', onchange: async () => {
    const f = fileIn.files?.[0]; fileIn.value = '';
    if (!f) return;
    try { save(await readSheetFile(f), '파일에서'); } catch (e) { clear(note, alertBox('danger', e?.message || '파일을 읽지 못했습니다. 엑셀(.xlsx) 또는 CSV인지 확인해 주세요.')); }
  } });
  dlg = openDialog({
    title: `${AREA_LABELS[G.area]} 행사 목록 가져오기`,
    body: [
      h('p', { class: 'small' }, '학교 행사를 한 줄에 하나씩 행사명과 날짜(또는 기간)로 붙여 넣거나, 엑셀·CSV 파일(앞 칸 행사명, 뒤 칸 날짜)을 올립니다. 날짜는 2026.05.14., 기간은 2026.05.14.-2026.05.15.으로 맞춰 저장합니다. 모든 반이 이 목록을 함께 씁니다.'),
      field('붙여넣기', ta), note,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => fileIn.click() }, icon('upload'), '엑셀·CSV 파일에서 가져오기'), fileIn),
    ],
    actions: [
      { label: '취소', variant: 'secondary', value: false },
      { label: '붙여넣은 목록 저장', variant: 'primary', value: 'paste' },
    ],
    beforeClose: (v) => { if (v !== 'paste') return true; save(ta.value, '붙여넣은'); return false; },
  });
  setTimeout(() => ta.focus(), 0);
}

function eventBar() {
  if (!EVENT_AREAS.includes(G.area)) return null;
  const n = schoolEvents().length;
  return h('div', { class: 'row grid-events' },
    h('span', { class: 'small' }, n ? `${AREA_LABELS[G.area]} 행사 목록 ${n}개` : `${AREA_LABELS[G.area]} 행사 목록이 없습니다`),
    h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: importEvents }, icon('upload'), '행사 목록 가져오기'),
    h('span', { class: 'small muted' }, '학생을 체크하면 패널에서 쓸 행사를 고릅니다.'));
}

// 패널: 이번 초안에 쓸 행사 (자율·진로). 학교 행사 목록에서 체크하고, 없는 행사는 하나씩 더한다
function eventsBox(sel) {
  if (!EVENT_AREAS.includes(G.area) || !sel.length) return null;
  const year = store.state.settings?.schoolYear;
  const list = eventsOf(sel[0].cls);
  for (const id of [...G.evIds]) if (!list.some((e) => e.id === id)) G.evIds.delete(id);
  const nameIn = h('input', { class: 'input', type: 'text', id: 'gp-ev-name', maxlength: '60', placeholder: '예: 학생자치회 임원 선거' });
  const dateIn = h('input', { class: 'input', type: 'text', id: 'gp-ev-date', maxlength: '30', placeholder: '예: 2026.03.15.' });
  const err = h('p', { class: 'hint form-error', role: 'alert' });
  const pick = (id, on) => { if (on) { G.evIds.add(id); if (G.mode === 'skip') G.mode = 'append'; } else G.evIds.delete(id); };
  const add = () => {
    err.textContent = '';
    const name = nameIn.value.trim();
    if (!name) { err.textContent = '행사 이름을 적어 주세요.'; nameIn.focus(); return; }
    const d = formatEventDate(dateIn.value, year);
    if (!d.ok) { err.textContent = d.error; dateIn.focus(); return; }
    const ev = { id: newEventId(), name, date: d.value };
    writeSchoolEvents(saveEvent(schoolEvents(), ev));
    pick(ev.id, true);
    toast(`행사를 더했습니다: ${eventLabel(ev)}`);
    renderPanel(); renderBar();
    document.getElementById('gp-ev-name')?.focus();
  };
  const n = list.filter((e) => G.evIds.has(e.id)).length;
  return h('section', { class: 'stack', 'aria-labelledby': 'gp-ev' },
    h('div', { class: 'row-between' }, h('h3', { class: 'section-title', id: 'gp-ev' }, '행사 (이번 글에 넣을 것을 체크)'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: importEvents }, '목록 가져오기')),
    list.length ? h('div', { class: 'stack gap-1 grid-ev-list', role: 'group', 'aria-labelledby': 'gp-ev' }, list.map((e) => h('div', { class: 'row-between' },
      h('label', { class: 'check-row', for: `gp-ev-${e.id}` },
        h('input', { type: 'checkbox', id: `gp-ev-${e.id}`, checked: G.evIds.has(e.id), onchange: (ev) => { pick(e.id, ev.target.checked); renderPanel(); document.getElementById(`gp-ev-${e.id}`)?.focus(); } }),
        h('span', {}, eventLabel(e))),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `${eventLabel(e)} 행사 지우기`, onclick: () => {
        const before = schoolEvents();
        writeSchoolEvents(before.filter((x) => x.id !== e.id)); G.evIds.delete(e.id);
        toast(`행사를 지웠습니다: ${eventLabel(e)}`, { action: '되돌리기', onAction: () => { writeSchoolEvents(before); renderPanel(); renderBar(); } });
        renderPanel(); renderBar();
      } }, '지우기'))))
      : h('p', { class: 'hint' }, '행사 목록이 없습니다. [목록 가져오기]로 학교 행사를 한꺼번에 넣거나 아래에서 하나씩 더하세요.'),
    h('details', {}, h('summary', {}, '행사 하나 더하기'),
      h('div', { class: 'stack gap-1' }, h('div', { class: 'grid-2' }, field('행사 이름', nameIn), field('날짜 또는 기간', dateIn)), err,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: add }, icon('plus'), '행사 더하기')))),
    h('p', { class: 'hint' }, n
      ? `체크한 행사 ${n}개를 '행사명(날짜)'로 시작해 씁니다. 붙여넣기는 '뒤에 이어씀'이라 행사마다 만든 글이 최종본에 쌓입니다.`
      : '행사를 체크하면 글을 행사명(2026.05.14.) 형식으로 시작합니다.'));
}

// 패널: 이번 초안에 쓸 성취기준 (고른 학생들 반에 올려 둔 것을 모아 보여 준다)
function standardsBox(sel) {
  if (G.area !== 'subject') return null;
  const list = [];
  const seen = new Set();
  for (const r of sel) for (const x of parseStandards(r.cls.achievement)) if (!seen.has(x.line)) { seen.add(x.line); list.push(x.line); }
  for (const l of [...G.stds]) if (!seen.has(l)) G.stds.delete(l); // 다른 반을 고르면 없는 줄은 뺀다
  if (!list.length) return h('p', { class: 'hint' }, '반에 올려 둔 성취기준이 없습니다. 명단 화면의 반 설정에서 올리면 여기서 고를 수 있습니다.');
  return h('div', { class: 'field' }, h('span', { class: 'label', id: 'gp-std' }, '이번 글에 포함할 성취기준 (성취한 것을 체크)'),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { list.forEach((l) => G.stds.add(l)); renderPanel(); } }, '모두 체크'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { G.stds.clear(); renderPanel(); } }, '모두 풀기')),
    h('div', { class: 'stack gap-1', role: 'group', 'aria-labelledby': 'gp-std' }, list.map((l, i) => h('label', { class: 'check-row grid-std', for: `gp-std-${i}` },
      h('input', { type: 'checkbox', id: `gp-std-${i}`, checked: G.stds.has(l), onchange: (e) => { if (e.target.checked) G.stds.add(l); else G.stds.delete(l); } }),
      h('span', {}, l)))),
    h('p', { class: 'hint' }, G.stds.size ? '체크한 성취기준으로 글을 만듭니다 (학생별로 고른 것보다 우선).' : '아무것도 체크하지 않으면 학생별로 고른 성취기준, 없으면 반에 올려 둔 전체를 씁니다.'));
}

function methodSeg() {
  return h('div', { class: 'field' }, h('span', { class: 'label', id: 'gp-method' }, '초안 만드는 방식'),
    seg({
      labelledby: 'gp-method',
      options: [['shared', '후보를 만들어 학생에게 나눠 붙이기'], ['each', '학생마다 따로 만들기']],
      value: G.method,
      onChange: (v) => { G.method = v; renderPanel(); },
    }));
}

function pasteSection(count, onPaste, hint) {
  return h('section', { class: 'stack', 'aria-labelledby': 'gp-5' },
    h('h3', { class: 'section-title', id: 'gp-5' }, '5 표에 붙여넣기'),
    h('div', { class: 'field' }, h('label', { class: 'label', for: 'gp-mode' }, '최종본 칸에 이미 글이 있을 때'),
      h('select', { class: 'select', id: 'gp-mode', value: G.mode, onchange: (e) => { G.mode = e.target.value; } },
        Object.entries(PASTE_MODES).map(([k, v]) => h('option', { value: k }, v)))),
    h('button', { type: 'button', class: 'btn btn-primary', disabled: !count || !!G.job || G.candBusy, onclick: onPaste }, icon('send'), `표에 순서대로 붙여넣기${count ? ` (${count}명)` : ''}`),
    h('p', { class: 'hint' }, hint));
}

function methodSections(sel, generated, canMake) {
  if (G.method === 'shared') return sharedSections(sel);
  return [
    h('section', { class: 'stack', 'aria-labelledby': 'gp-3' },
      h('h3', { class: 'section-title', id: 'gp-3' }, '3 초안 만들기'),
      methodSeg(),
      noKey() ? h('p', { class: 'hint' }, '설정에서 API 키를 넣으면 만들 수 있습니다. ', h('a', { href: '#settings' }, '설정으로 가기')) : null,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-primary', 'data-make': 'each', disabled: !canMake, onclick: makeSelected }, icon('spark'), G.job ? '만드는 중' : `${sel.length}명 초안 만들기`),
        ctx.isFakeAI() ? badge('가짜 AI', 'warn') : null),
      G.short.size ? alertBox('info', `메모와 특징이 부족해 초안을 만들지 않은 학생: ${[...G.short].map((id) => store.getStudent(store.state.records.get(id)?.studentId)?.name).filter(Boolean).join(', ')}`) : null),
    h('section', { class: 'stack', 'aria-labelledby': 'gp-4' },
      h('h3', { class: 'section-title', id: 'gp-4' }, `4 초안 수정 (${generated.length}명)`),
      generated.length ? generated.map(draftEditor) : h('p', { class: 'hint' }, '초안을 만들면 여기에 학생 순서대로 나옵니다. 고쳐 쓴 글이 표에 붙습니다.')),
    pasteSection(generated.length, pasteToTable, '표의 명렬 순서대로 각 학생의 최종본 칸에 넣습니다. 완료한 학생은 건드리지 않습니다.'),
  ];
}

// 후보를 만들어 학생에게 나눠 붙이기: 비슷한 학생끼리 같은 후보를 쓴다
function sharedSections(sel) {
  const assigned = sel.filter((r) => G.assign.has(r.rec.id) && G.cands[G.assign.get(r.rec.id)]?.trim());
  const target = candidateTarget(sel.length);
  const remain = Math.max(0, target - G.cands.length);
  const canMake = !G.candBusy && !G.job && !noKey() && sel.length > 0 && G.common.trim() && remain > 0;
  return [
    h('section', { class: 'stack', 'aria-labelledby': 'gp-3' },
      h('h3', { class: 'section-title', id: 'gp-3' }, '3 후보 만들기'),
      methodSeg(),
      h('p', { class: 'hint' }, `위의 공통 특징만으로 후보를 만듭니다 (학생 메모와 모둠 메모는 쓰지 않음). 고른 학생 ${sel.length}명에 5개를 더해 ${target}개까지 만들고, 만든 뒤 후보마다 붙일 학생을 고르세요.`),
      noKey() ? h('p', { class: 'hint' }, '설정에서 API 키를 넣으면 만들 수 있습니다. ', h('a', { href: '#settings' }, '설정으로 가기')) : null,
      !G.common.trim() ? h('p', { class: 'hint' }, '공통 특징을 먼저 적어 주세요.') : null,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-primary', 'data-make': 'shared', disabled: !canMake, onclick: makeShared }, icon('spark'), G.candBusy ? '만드는 중' : (G.cands.length ? `후보 ${remain}개 더 만들기` : `후보 ${target}개 만들기`)),
        G.cands.length ? h('button', { type: 'button', class: 'btn btn-ghost', disabled: G.candBusy, onclick: () => { G.cands = []; G.assign = new Map(); renderPanel(); } }, '후보 모두 지우기') : null,
        ctx.isFakeAI() ? badge('가짜 AI', 'warn') : null),
      G.cands.length >= target ? h('p', { class: 'hint' }, `후보가 ${G.cands.length}개 있습니다.`) : null),
    h('section', { class: 'stack', 'aria-labelledby': 'gp-4' },
      h('h3', { class: 'section-title', id: 'gp-4' }, `4 후보 수정과 학생 배정 (후보 ${G.cands.length}개)`),
      G.cands.length ? h('div', { class: 'row' },
        h('p', { class: 'small', role: 'status' }, `배정 ${assigned.length}명 · 미배정 ${sel.length - assigned.length}명`),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled: !sel.length, onclick: () => { G.assign = autoAssign(sel.map((r) => r.rec.id), G.assign, G.cands.length); renderPanel(); } }, '배정 안 된 학생에게 후보를 차례로 하나씩')) : null,
      G.cands.length ? G.cands.map((t, i) => candCard(i, sel)) : h('p', { class: 'hint' }, '후보를 만들면 여기에 나옵니다. 고쳐 쓰고, 이름 칩을 눌러 그 후보를 붙일 학생을 고르세요.')),
    pasteSection(assigned.length, pasteShared, '표의 명렬 순서대로 배정된 학생의 최종본 칸에 후보 글을 넣습니다. 같은 후보를 여러 학생에게 붙이면 표의 점검에 비슷한 글 경고가 뜨니 학생마다 한 줄씩 고쳐 주세요. 붙인 학생은 선택에서 빠집니다 (다음 무리를 이어서 고르세요).'),
  ];
}

function candCard(i, sel) {
  const meta = h('span', { class: 'small muted grid-draft-meta' });
  const ta = h('textarea', {
    class: 'textarea grid-ta', rows: '4', value: G.cands[i], 'aria-label': `후보 ${i + 1}`,
    oninput: (e) => { autosize(e.target); G.cands[i] = e.target.value; paint(); },
  });
  const first = sel[0] ? (store.state.records.get(sel[0].rec.id) || sel[0].rec) : null;
  function paint() {
    const text = ta.value;
    const chk = first ? checkOfText(first, text) : null;
    const n = [...G.assign.values()].filter((x) => x === i).length;
    clear(meta, `${byteLength(text)}바이트 · 붙일 학생 ${n}명`, chk && chk.count ? ` · 문제 ${chk.count}건: ${chk.issues.slice(0, 2).map((x) => x.message).join(', ')}` : '');
    meta.classList.toggle('text-danger', !!(chk && chk.count));
  }
  setTimeout(() => { autosize(ta); paint(); }, 0);
  const chips = sel.map((r) => {
    const id = r.rec.id;
    const cur = G.assign.get(id);
    const on = cur === i;
    return chip(`${r.student.name}${cur !== undefined && !on ? ` (후보${cur + 1})` : ''}`, on, (flag) => {
      if (flag) G.assign.set(id, i); else G.assign.delete(id);
      renderPanel();
    });
  });
  return h('div', { class: 'stack gap-1 grid-draft' },
    h('div', { class: 'row-between' }, h('strong', {}, `후보 ${i + 1}`),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { ta.value = tidyText(ta.value); G.cands[i] = ta.value; autosize(ta); paint(); } }, '정리'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { G.cands.splice(i, 1); G.assign = removeCandidate(G.assign, i); renderPanel(); } }, '삭제'))),
    ta, meta,
    h('div', { class: 'field' }, h('span', { class: 'label' }, '이 후보를 붙일 학생'),
      h('div', { class: 'row chips', role: 'group', 'aria-label': `후보 ${i + 1}을 붙일 학생` }, chips)),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { for (const r of sel) if (!G.assign.has(r.rec.id)) G.assign.set(r.rec.id, i); renderPanel(); } }, '배정 안 된 학생 모두'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { for (const [id, x] of [...G.assign]) if (x === i) G.assign.delete(id); renderPanel(); } }, '이 후보 배정 풀기')));
}

// 후보 만들기: (고른 학생 수 + 5)개를 3개씩 여러 번 불러 채운다. 멈추기·이어서 하기가 된다
function makeShared() {
  const sel = selectedRows();
  if (!sel.length) { toast('표에서 학생을 먼저 고르세요'); return; }
  if (!G.common.trim()) { toast('공통 특징을 먼저 적어 주세요'); return; }
  const need = candidateTarget(sel.length) - G.cands.length;
  if (need <= 0) { toast('후보가 이미 충분합니다'); return; }
  flushEdits();
  const first = sel[0];
  const rec = store.state.records.get(first.rec.id) || first.rec;
  const settings = store.state.settings;
  const roster = rosterAll();
  const common = G.common; const traits = [...G.traits]; const length = G.length; const stdText = G.stds.size ? standardsText(G.stds) : ''; const request = G.request; const events = pickedEvents(first);
  const calls = Math.ceil(need / 3);
  const job = { label: '후보 만들기', total: calls, done: 0, failed: [], short: 0, stopReason: '', batch: null, summary: () => `후보 ${G.cands.length}개` };
  const target = candidateTarget(sel.length);
  job.batch = createBatch({
    targets: Array.from({ length: calls }, (_, i) => String(i)),
    intervalMs: (Number(settings.batchIntervalSec) || 5) * 1000,
    onProgress: (st) => { job.done = st.done + st.skipped + st.failed.length; job.failed = st.failed; job.stopReason = st.stopReason ? (st.stopMessage || '오류로 멈췄습니다') : ''; renderJob(); },
    run: async () => {
      const left = target - G.cands.length;
      if (left <= 0) return 'skipped';
      const res = await generateDrafts({
        record: { ...rec, memo: common, traits, length, achievement: stdText || first.cls.achievement || '', achievementReached: !!stdText, events, request }, // 후보는 여러 학생이 같이 쓰니 학생별 성취기준은 넣지 않는다
        studentName: '', roster, settings, apiKey: store.getApiKey(), count: Math.min(3, left), fake: ctx.isFakeAI(), style: styleFor(rec),
      });
      const drafts = (res?.drafts || []).filter((d) => d && d.trim()).map((d) => d.trim());
      if (res?.insufficient || !drafts.length) { job.short += 1; return 'skipped'; }
      G.cands = [...G.cands, ...drafts].slice(0, target);
      if (G.panel) renderPanel();
    },
  });
  G.job = job; G.candBusy = true;
  renderBar(); renderJob(); renderPanel();
  Promise.resolve(job.batch.start()).catch((e) => { if (!(e instanceof AiError)) console.warn('후보 만들기 중 예상 못 한 오류:', e?.name || 'Error'); }).finally(() => {
    if (G.job === job && !job.batch.state.running && job.batch.state.next >= job.total) finishJob(); else renderJob();
  });
}

function pasteShared() {
  flushEdits();
  const sel = selectedRows();
  const drafts = assignedDrafts(G.cands, G.assign);
  const target = sel.filter((r) => drafts[r.rec.id]);
  applyPaste(target, drafts, (patched) => {
    for (const id of patched) { G.assign.delete(id); G.selected.delete(id); }
    syncChecks(); renderBar(); renderPanel();
  });
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
    const miss = missingEventLabels(text, pickedEventList(r));
    clear(meta, `${byteLength(text)}바이트`, chk.count ? ` · 문제 ${chk.count}건: ${chk.issues.slice(0, 2).map((i) => i.message).join(', ')}` : '', miss.length ? ` · 행사 표기 빠짐: ${miss.join(', ')}` : '');
    meta.classList.toggle('text-danger', chk.count > 0 || miss.length > 0);
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
  const common = G.common; const withOwn = G.withOwn; const traits = [...G.traits]; const length = G.length; const stdText = G.stds.size ? standardsText(G.stds) : ''; const request = G.request;
  G.generated = new Set([...G.generated].filter((id) => !sel.some((r) => r.rec.id === id)));
  startJob({
    ids: sel.map((r) => r.rec.id), label: '초안 만들기',
    makeRecord: (rec, row) => ({ ...rec, memo: memoFor(rec, row, common, withOwn), traits, length, achievement: stdText || rec.achievement || row?.cls?.achievement || '', achievementReached: !!(stdText || rec.achievement), events: pickedEvents(row), request }),
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
  for (const r of sel) drafts[r.rec.id] = (store.state.records.get(r.rec.id) || r.rec).draft;
  applyPaste(sel, drafts);
}

/** 표의 명렬 순서대로 최종본 칸에 붙인다. after(붙은 기록 id 목록) 는 붙인 뒤 화면 정리용 */
function applyPaste(sel, drafts, after) {
  const plan = planPaste(sel.map((r) => { const l = store.state.records.get(r.rec.id) || r.rec; return { id: l.id, final: l.final, status: l.status }; }), drafts, { mode: G.mode });
  if (!plan.patches.length) { toast(plan.summary.keptExisting ? '최종본이 이미 있어 붙이지 않았습니다. 위에서 이어쓰기나 덮어쓰기를 고르세요.' : '붙일 글이 없습니다'); return; }
  const before = new Map(plan.patches.map((p) => [p.id, (store.state.records.get(p.id) || {}).final || '']));
  for (const p of plan.patches) { store.updateRecord(p.id, { final: p.final }); refreshRow(p.id, { setText: true }); }
  const s = plan.summary;
  const parts = [s.pasted && `새로 ${s.pasted}`, s.appended && `이어씀 ${s.appended}`, s.overwritten && `덮어씀 ${s.overwritten}`, s.keptExisting && `그대로 ${s.keptExisting}`, s.done && `완료 건너뜀 ${s.done}`].filter(Boolean);
  toast(`표에 붙였습니다: ${parts.join(', ')}`, { action: '되돌리기', onAction: () => { for (const [id, f] of before) { store.updateRecord(id, { final: f }); refreshRow(id, { setText: true }); } toast('붙이기를 되돌렸습니다'); } });
  announce(`${plan.patches.length}명의 최종본에 붙였습니다`);
  resizeAll();
  if (after) after(plan.patches.map((p) => p.id));
}

// ---------- 전체 ----------
function pickDefaults(params) {
  const areas = allAreas();
  const pa = params?.get('area');
  if (pa && areas.includes(pa)) G.area = pa;
  if (!areas.includes(G.area)) G.area = areas[0] || null;
  if (!G.inited) { G.inited = true; G.hidden = defaultHidden(); G.method = G.area === 'subject' ? 'shared' : 'each'; G.onlySelected = G.area === 'subject'; }
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
  els.board = h('section', { class: 'card stack grid-board', hidden: true });
  els.tableHost = h('div', { class: 'write-table-host' });
  els.panel = h('aside', { class: 'panel write-panel', 'aria-label': '일괄 작성 패널', hidden: !G.panel });
  els.layout = h('div', { class: ['write-layout', G.panel && 'has-panel'] }, els.tableHost, els.panel);
  const classChips = classesForArea().map((c) => chip(`${c.name}${c.subject ? ` (${c.subject})` : ''}`, !G.hidden.has(c.id), (on) => {
    if (on) G.hidden.delete(c.id); else G.hidden.add(c.id);
    for (const id of [...G.selected]) { /* 숨긴 반의 선택은 그대로 둔다 */ void id; }
    renderTable(); renderBoard(); renderBar(); if (G.panel) renderPanel();
  }));
  const onlyChip = chip('체크한 학생만', G.onlySelected, (on) => { G.onlySelected = on; renderTable(); renderBar(); if (G.panel) renderPanel(); });
  clear(root,
    h('div', { class: 'view-head row-between' }, h('h1', { class: 'view-title', tabindex: '-1' }, '작성'), els.save),
    noKey() ? alertBox('info', h('p', {}, 'AI 초안을 만들려면 설정에서 Gemini API 키를 넣어 주세요. 표에서 직접 쓰기와 점검은 키 없이도 됩니다. ', h('a', { href: '#settings' }, '설정으로 가기'))) : null,
    h('div', { class: 'write-toolbar' },
      h('div', { class: 'tabs', role: 'tablist', 'aria-label': '영역' }, areas.map((a) => h('button', {
        type: 'button', class: 'tab', role: 'tab', 'aria-selected': a === G.area, tabindex: a === G.area ? '0' : '-1',
        onclick: () => { flushEdits(); G.area = a; G.selected.clear(); G.generated.clear(); G.cands = []; G.assign = new Map(); G.hidden = defaultHidden(); G.method = a === 'subject' ? 'shared' : 'each'; G.stds.clear(); G.onlySelected = a === 'subject'; ctx.setParams('write', { area: a }); renderAll(); },
      }, AREA_LABELS[a]))),
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: sendToChecker }, icon('send'), '점검기로 보내기'),
      h('div', { class: 'field' }, h('span', { class: 'label', id: 'grid-class-label' }, G.area === 'subject' ? '명단을 불러올 반 (체크)' : '보이는 반'),
        h('div', { class: 'row chips', role: 'group', 'aria-labelledby': 'grid-class-label' }, classChips, onlyChip))),
    els.bar, els.job, els.board,
    els.layout);
  renderTable(); renderBoard(); renderBar(); renderJob(); renderPanel(); setSave();
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
    if (kind === 'classes' && quietClass) return;
    if (['classes', 'students', 'settings', 'all', 'styles'].includes(kind)) {
      if (typing() || edits.size) { staleAll = true; return; }
      pickDefaults(null); renderAll();
    }
  },
  flush() { flushEdits(); },
  unmount() { flushEdits(); window.removeEventListener('resize', resizeAll); root = null; els = {}; cellRefs.clear(); staleAll = false; },
};
