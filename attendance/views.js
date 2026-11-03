// 오늘 · 기록 · 서류 · 학생 화면
import {
  KINDS, KIND_ORDER, describeKind, describeRecord, docLabel, formatDateKo, formatRangeKo, todayStr,
  yearMonthOf, toDateStr, neisBlockReason,
} from './shared/model.js';
import { missingDocs, countParentNotes, parentNoteRecords, countPeriodPain, periodPainWithoutDocs } from './shared/rules.js';
import { makeStudentFilter } from './shared/model.js';
import { getRoster, rosterOn, nameFor, stuLabel } from './roster.js';
import { store, deleteRecord, restoreRecord, setDocsSubmitted, addMissingPainDocs } from './store.js';
import { RecordForm } from './form.js';
import { esc, icon, quota, toast, openSheet, closeSheet, josa, seg } from './ui.js';

const ymLabel = (ym) => `${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5, 7))}월`;
// 필터용 짧은 이름: 올해면 '10월', 아니면 '25년 10월'
const ymShort = (ym) => (ym.slice(0, 4) === todayStr().slice(0, 4) ? `${Number(ym.slice(5, 7))}월` : `${ym.slice(2, 4)}년 ${Number(ym.slice(5, 7))}월`);
const shiftMonth = (ym, n) => {
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1);
  return toDateStr(d).slice(0, 7);
};
const sortRecords = (list) => list.slice().sort((a, b) => (a.date === b.date ? a.no - b.no || (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? 1 : -1));
const missingOf = (r) => (r.docs || []).some((d) => !d.submitted);

// 나이스 입력 전에 정해야 할 것 (구분 미정, 기타 사유 없음)
function blockBadge(r) {
  if (r.neis?.done) return '';
  if (r.div === 'undecided') return '<span class="badge badge-info">구분 미정</span>';
  const why = neisBlockReason(r);
  return why ? '<span class="badge badge-info">사유 필요</span>' : '';
}

function neisBadge(r) {
  return r.neis?.done
    ? '<span class="badge badge-neis-done">나이스 입력 완료</span>'
    : '<span class="badge badge-neis-wait">나이스 대기</span>';
}

// "학부모확인서 미제출", "신청서 받음, 보고서 미제출"
function docStatus(r) {
  return (r.docs || []).map((d) => `${docLabel(d, true)} ${d.submitted ? '받음' : '미제출'}`).join(', ');
}

export function recordRow(r, { showDate = false, showName = true } = {}) {
  const meta = [showDate ? formatDateKo(r.date) : '', docStatus(r), r.reason ? `사유 ${r.reason}` : ''].filter(Boolean).join(' · ');
  const nm = showName ? nameFor(r.no) : '';
  const title = nm ? `${nm} · ${describeKind(r)}` : describeKind(r);
  return `<li class="list-row is-clickable${r.neis?.done ? ' is-done' : ''}" role="button" tabindex="0" data-open="${esc(r.id)}" aria-label="${esc(`${stuLabel(r.no)} ${describeRecord(r)}, ${formatDateKo(r.date)}. 눌러서 수정`)}">
    <span class="list-no">${r.no}</span>
    <div class="list-main">
      <div class="list-title">${esc(title)}</div>
      ${meta ? `<div class="list-meta num">${esc(meta)}</div>` : ''}
    </div>
    <div class="list-side">${blockBadge(r) || neisBadge(r)}${missingOf(r) ? '<span class="badge badge-missing">미제출</span>' : ''}</div>
  </li>`;
}

function bindOpen(root) {
  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-open]');
    if (!row || !root.contains(row)) return;
    const rec = store.data.records.find((r) => r.id === row.dataset.open);
    if (rec) openEditSheet(rec);
  });
}

// ---------- 기록 수정 시트 ----------
let editing = null; // 열려 있는 수정 시트 {id, form, sheet}
export function openEditSheet(record) {
  const sheet = openSheet(`
    <div class="sheet-head">
      <h2 class="sheet-title" id="sheet-title">${esc(stuLabel(record.no))} 기록 수정</h2>
      <button type="button" class="icon-btn" data-close aria-label="닫기">${icon('close')}</button>
    </div>
    <p class="small muted num" style="margin: 0 0 var(--sp-3)">${esc(formatDateKo(record.date))} · ${record.neis?.done ? '나이스 입력 완료' : '나이스 대기'}</p>
    ${record.neis?.done ? `<div class="alert alert-info" style="margin-bottom: var(--sp-4)">${icon('info')}<div class="alert-body">나이스에 이미 입력한 기록입니다. 여기서 고치면 나이스에서도 직접 고쳐야 합니다.</div></div>` : ''}
    <div id="edit-remote"></div>
    <form class="stack" id="edit-form" novalidate></form>
    <div class="sheet-actions">
      <button type="button" class="btn btn-danger-outline" data-delete>${icon('trash')}삭제</button>
    </div>`, { onClose: () => { editing = null; } });
  const form = new RecordForm(sheet.querySelector('#edit-form'), { prefix: 'e', record, onDone: () => closeSheet() });
  form.render();
  editing = { id: record.id, form, sheet };
  sheet.querySelector('[data-close]').addEventListener('click', () => closeSheet());
  sheet.querySelector('[data-delete]').addEventListener('click', () => {
    const copy = structuredClone(record);
    deleteRecord(record.id);
    closeSheet();
    toast(`${stuLabel(record.no)} ${formatDateKo(record.date, false)} 기록을 삭제했습니다`, {
      action: '되돌리기',
      onAction: () => { restoreRecord(copy); toast('삭제를 취소했습니다'); },
    });
  });
}

// 자동 확인으로 수정 중인 기록이 바뀌면 시트 위에 안내 (작성 중 내용은 그대로, 누르면 새 내용으로)
export function notifyEditSheet(diff) {
  if (!editing || !editing.sheet.isConnected || !diff.kinds[editing.id]) return;
  const box = editing.sheet.querySelector('#edit-remote');
  const removed = diff.kinds[editing.id] === 'removed' || !store.data.records.some((r) => r.id === editing.id);
  box.innerHTML = `<div class="alert alert-info" role="status" data-testid="remote-changed" style="margin-bottom: var(--sp-4)">${icon('info')}<div class="alert-body">
    <strong class="alert-title">${removed ? '다른 기기에서 이 기록이 삭제되었습니다' : '다른 기기에서 이 기록이 바뀌었습니다'}</strong>
    ${removed ? '이 기록은 더 고칠 수 없습니다.' : '지금 저장하면 이 화면의 내용으로 덮어씁니다.'}
    <div class="alert-actions">${removed
      ? '<button type="button" class="btn btn-secondary btn-sm" data-remote-close>닫기</button>'
      : '<button type="button" class="btn btn-secondary btn-sm" data-remote-reload>새 내용 불러오기</button>'}</div></div></div>`;
  const cur = editing;
  box.querySelector('[data-remote-close]')?.addEventListener('click', () => closeSheet());
  box.querySelector('[data-remote-reload]')?.addEventListener('click', () => {
    const rec = store.data.records.find((r) => r.id === cur.id);
    if (!rec) { closeSheet(); return; }
    cur.form.state = cur.form.fromRecord(rec);
    cur.form.showErrors = false;
    cur.form.render();
    box.innerHTML = '';
    toast('새 내용을 불러왔습니다');
  });
}

// ---------- 오늘 ----------
export const todayView = {
  title: '오늘',
  mount(main) {
    // 넓은 화면(1024px 이상)에서는 왼쪽 입력, 오른쪽 오늘 기록 2단 (app.css .cols)
    main.innerHTML = `<div class="cols cols-today">
      <div class="col">
        <section class="card">
          <h2 class="sr-only">출결 입력</h2>
          <form class="stack" id="today-form" novalidate aria-label="출결 입력"></form>
        </section>
      </div>
      <div class="col col-sticky">
        <section class="card card-flush" id="today-list" aria-live="polite"></section>
        <p class="tiny muted storage-note" id="storage-note"></p>
      </div></div>`;
    this.form = new RecordForm(main.querySelector('#today-form'), { prefix: 't', search: true });
    this.form.render();
    bindOpen(main.querySelector('#today-list'));
    this.updateList();
  },
  update(kind) {
    if (kind === 'data') {
      // 폼 입력 중이면 포커스를 잃지 않게 폼은 다시 그리되 상태는 유지
      this.form.render();
    }
    this.updateList();
  },
  updateList() {
    const el = document.getElementById('today-list');
    if (!el) return;
    const today = todayStr();
    const list = store.data.records.filter((r) => r.date === today).sort((a, b) => a.no - b.no || (a.createdAt < b.createdAt ? -1 : 1));
    el.innerHTML = `<div class="card-head"><h2 class="card-title">오늘 기록</h2><span class="badge badge-info num">${list.length}건</span></div>
      ${list.length ? `<ul class="list">${list.map((r) => recordRow(r)).join('')}</ul>`
        : `<div class="empty">${icon('today')}<div class="empty-title">오늘 기록이 없습니다</div><div class="empty-text">위에서 입력하면 여기에 표시됩니다.</div></div>`}`;
    const note = document.getElementById('storage-note');
    if (note) note.textContent = storageText();
  },
};

export function storageText() {
  const s = store.sync;
  if (s.status === 'local') return '이 기기에만 저장 중입니다. 설정에서 구글 드라이브를 연결하면 다른 기기와 함께 쓸 수 있습니다.';
  if (s.status === 'syncing') return '구글 드라이브와 동기화하는 중입니다.';
  if (s.status === 'offline') return '오프라인입니다. 이 기기에 저장되며 인터넷이 연결되면 동기화합니다.';
  if (s.status === 'auth') return '구글 연결이 필요합니다. 위쪽 동기화 버튼을 누르세요. 기록은 이 기기에 저장되어 있습니다.';
  if (s.status === 'error') return `동기화하지 못했습니다 (${s.message}). 기록은 이 기기에 저장되어 있습니다.`;
  const at = store.local.lastSyncAt ? new Date(store.local.lastSyncAt) : null;
  return at ? `구글 드라이브와 동기화됨 · ${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}` : '구글 드라이브에 연결되어 있습니다.';
}

// ---------- 기록 ----------
// 보기(전체 / 미제출 서류)와 정렬은 기기별로만 기억한다 (localStorage ah.ui, 드라이브에 올리지 않음)
const UI_KEY = 'ah.ui';
const SORTS = ['new', 'old'];
function readUi() {
  try { const o = JSON.parse(localStorage.getItem(UI_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
function saveUi(patch) {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ ...readUi(), ...patch })); } catch { /* 무시 */ }
}
// 보기별 기본 정렬: 전체는 최신순, 미제출은 오래된순(오래된 것이 가장 급함)
const defaultSort = (view) => (view === 'unpaid' ? 'old' : 'new');
function sortOf(view) {
  const v = readUi().recSort?.[view];
  return SORTS.includes(v) ? v : defaultSort(view);
}
function saveSort(view, v) {
  saveUi({ recSort: { ...(readUi().recSort || {}), [view]: v } });
}

const recFilter = { view: 'all', months: {}, no: '', q: '', kind: '', neisWait: false, undecided: false };
// 미제출 보기에서는 월 기본값 '전체'(이전 달 미제출이 보여야 함), 전체 보기는 이번 달.
// 월 선택은 보기별로 따로 두고, 화면을 떠났다 와도 앱을 닫기 전까지 유지한다 (저장하지 않음).
const defaultMonth = (view) => (view === 'unpaid' ? 'all' : yearMonthOf(todayStr()));
const curMonth = () => recFilter.months[recFilter.view] || defaultMonth(recFilter.view);

function unpaidRow(m) {
  const nm = nameFor(m.no);
  const rec = m.record;
  const title = nm ? `${nm} · ${describeKind(rec)}` : describeKind(rec);
  const span = m.startDate === m.endDate ? '' : formatRangeKo(m.startDate, m.endDate);
  const meta = [span, daysText(m.daysPassed)].filter(Boolean).join(' · ');
  return `<li class="list-row is-clickable${m.daysPassed >= 3 ? ' is-urgent' : ''}" role="button" tabindex="0" data-open="${esc(rec.id)}" data-unpaid="${esc(m.key)}" aria-label="${esc(`${stuLabel(m.no)} ${describeRecord(rec)}, ${m.docLabel} 미제출, ${daysText(m.daysPassed)}. 눌러서 수정`)}">
    <span class="list-no">${m.no}</span>
    <div class="list-main">
      <div class="list-title">${esc(title)}</div>
      <div class="list-meta num${m.daysPassed >= 3 ? ' is-late' : ''}">${esc(meta)}</div>
    </div>
    <div class="list-side">
      <span class="badge badge-missing">${esc(m.docShort)} 미제출</span>
      <button type="button" class="btn btn-secondary btn-sm" data-receive="${esc(m.key)}" aria-label="${esc(stuLabel(m.no))} ${esc(m.docLabel)} 받음">받음</button>
    </div>
  </li>`;
}

export const recordsView = {
  title: '기록',
  mount(main) {
    recFilter.view = 'all'; // 탭에 들어올 때는 늘 [전체] (정렬만 기기에 기억)
    main.innerHTML = `<div class="cols cols-side"><div class="col col-sticky">
      <section class="card stack-sm" aria-label="필터">
        <div class="rec-modes" id="rec-modes"></div>
        <div class="field" id="flt-q-wrap" hidden><label class="label" for="flt-q">번호 또는 이름</label><input class="input" id="flt-q" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="번호 또는 이름, 초성도 가능" value="${esc(recFilter.q)}"></div>
        <div class="grid-3" id="flt-grid">
          <div class="field"><label class="label" for="flt-month">월</label><select class="select" id="flt-month"></select></div>
          <div class="field" id="flt-no-wrap"><label class="label" for="flt-no">번호</label><select class="select" id="flt-no"></select></div>
          <div class="field"><label class="label" for="flt-kind">종류</label><select class="select" id="flt-kind"></select></div>
        </div>
        <div class="stack-sm" id="flt-checks">
          <label class="check"><input type="checkbox" id="flt-neis"${recFilter.neisWait ? ' checked' : ''}><span class="check-box"></span><span class="check-label">나이스 미입력만</span></label>
          <label class="check"><input type="checkbox" id="flt-undecided"${recFilter.undecided ? ' checked' : ''}><span class="check-box"></span><span class="check-label">구분 미정만</span></label>
        </div>
      </section></div>
      <div id="records-body" class="col"></div></div>`;
    const filters = main.querySelector('section');
    filters.addEventListener('input', (e) => {
      if (e.target.id !== 'flt-q') return;
      recFilter.q = e.target.value;
      this.update();
    });
    filters.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === 'flt-q') return; // 검색칸은 input 에서 이미 반영. 여기서 다시 그리면 목록을 누르는 첫 탭이 사라짐
      if (id === 'flt-month') recFilter.months[recFilter.view] = e.target.value;
      if (id === 'flt-no') recFilter.no = e.target.value;
      if (id === 'flt-kind') recFilter.kind = e.target.value;
      if (id === 'flt-neis') recFilter.neisWait = e.target.checked;
      if (id === 'flt-undecided') recFilter.undecided = e.target.checked;
      this.update();
    });
    // 보기·정렬 세그먼트
    filters.addEventListener('click', (e) => {
      const it = e.target.closest('[data-seg-value]');
      if (!it || !filters.contains(it)) return;
      const name = it.parentElement.dataset.seg;
      const v = it.dataset.segValue;
      if (name === 'rec-view' && v !== recFilter.view) {
        recFilter.view = v;
        this.update();
      } else if (name === 'rec-sort') {
        saveSort(recFilter.view, v);
        this.update();
      }
    });
    const body = main.querySelector('#records-body');
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-receive]');
      if (!b) return;
      e.stopPropagation();
      this.receive(b.dataset.receive);
    }, true);
    bindOpen(body);
    this.update();
  },
  receive(key) {
    const item = missingDocs(store.data.records, todayStr()).find((x) => x.key === key);
    if (!item) return;
    setDocsSubmitted(item.refs, true);
    toast(`${stuLabel(item.no)} ${josa(item.docLabel, '을', '를')} 받음으로 표시했습니다`, {
      action: '되돌리기',
      onAction: () => { setDocsSubmitted(item.refs, false); toast('받음 표시를 취소했습니다'); },
    });
  },
  update() {
    const recs = store.data.records;
    const unpaid = recFilter.view === 'unpaid';
    const months = [...new Set([yearMonthOf(todayStr()), ...recs.map((r) => yearMonthOf(r.date))])].sort().reverse();
    const mSel = document.getElementById('flt-month');
    if (!mSel) return;
    const today = todayStr();
    const missingAll = missingDocs(recs, today);

    // 보기·정렬 세그먼트 (미제출 건수 배지, 0이면 숨김)
    const sort = sortOf(recFilter.view);
    const modes = document.getElementById('rec-modes');
    const modeSeg = `<div class="seg" role="radiogroup" aria-label="보기" data-seg="rec-view">${[['all', '전체'], ['unpaid', '미제출 서류']].map(([v, t]) =>
      `<button type="button" class="seg-item" role="radio" aria-checked="${v === recFilter.view}" tabindex="${v === recFilter.view ? 0 : -1}" data-seg-value="${v}">${t}${v === 'unpaid' && missingAll.length ? `<span class="seg-count num" aria-label="${missingAll.length}건">${missingAll.length}</span>` : ''}</button>`).join('')}</div>`;
    const sortSeg = seg('rec-sort', '정렬', [['new', '최신순'], ['old', '오래된순']], sort);
    // 포커스 중인 세그먼트를 다시 그리다 잃지 않도록, 바뀐 경우에만 교체
    const html = modeSeg + sortSeg;
    if (modes.dataset.html !== html) {
      const had = modes.contains(document.activeElement) ? document.activeElement.parentElement.dataset.seg + '|' + document.activeElement.dataset.segValue : '';
      modes.innerHTML = html;
      modes.dataset.html = html;
      if (had) { const [n, v] = had.split('|'); modes.querySelector(`[data-seg="${n}"] [data-seg-value="${v}"]`)?.focus({ preventScroll: true }); }
    }
    document.getElementById('flt-checks').hidden = unpaid;

    const month = curMonth();
    mSel.innerHTML = `<option value="all"${month === 'all' ? ' selected' : ''}>전체</option>` + months.map((m) => `<option value="${m}"${m === month ? ' selected' : ''}>${ymShort(m)}</option>`).join('');
    // 명단이 있으면 번호 선택 대신 '번호 또는 이름' 검색칸 (입력칸은 다시 그리지 않음)
    const byName = rosterOn();
    document.getElementById('flt-q-wrap').hidden = !byName;
    document.getElementById('flt-no-wrap').hidden = byName;
    document.getElementById('flt-grid').className = byName ? 'grid-2' : 'grid-3';
    const nameFilter = byName ? makeStudentFilter(getRoster(), recFilter.q) : null;
    const n = store.data.settings.studentCount;
    let noOpts = '<option value="">전체</option>';
    for (let i = 1; i <= n; i++) noOpts += `<option value="${i}"${String(i) === recFilter.no ? ' selected' : ''}>${i}번</option>`;
    document.getElementById('flt-no').innerHTML = noOpts;
    document.getElementById('flt-kind').innerHTML = '<option value="">전체</option>' + KIND_ORDER.map((k) => `<option value="${k}"${k === recFilter.kind ? ' selected' : ''}>${KINDS[k].ko}</option>`).join('');

    const okNo = (r) => (byName ? (!nameFilter || nameFilter(r.no)) : (!recFilter.no || r.no === Number(recFilter.no)));
    const body = document.getElementById('records-body');
    const emptyCard = (title, text) => `<div class="card"><div class="empty">${icon(unpaid ? 'doc' : 'list')}<div class="empty-title">${title}</div><div class="empty-text">${text}</div></div></div>`;

    if (unpaid) {
      // 미제출 서류가 있는 기록만. 같은 groupId 묶음은 한 줄(기준일 = 묶음 시작일, 보고서는 종료일)
      const items = missingAll.filter((m) =>
        (month === 'all' || yearMonthOf(m.baseDate) === month) &&
        okNo(m.record) && (!recFilter.kind || m.record.kind === recFilter.kind));
      if (!items.length) {
        const filtered = missingAll.length > 0;
        body.innerHTML = emptyCard(filtered ? '조건에 맞는 미제출 서류가 없습니다' : '미제출 서류가 없습니다', filtered ? '월이나 검색 조건을 바꿔 보세요.' : '서류가 필요한 기록을 저장하면 여기에 표시됩니다.');
        return;
      }
      const dir = sort === 'old' ? 1 : -1;
      items.sort((a, b) => dir * (a.baseDate < b.baseDate ? -1 : a.baseDate > b.baseDate ? 1 : 0) || a.no - b.no || (a.key < b.key ? -1 : 1));
      const groups = new Map();
      for (const m of items) {
        if (!groups.has(m.baseDate)) groups.set(m.baseDate, []);
        groups.get(m.baseDate).push(m);
      }
      body.innerHTML = `<p class="small muted num" style="margin:0" data-testid="unpaid-count">미제출 서류 ${items.length}건</p>
        <section class="card card-flush" data-testid="unpaid-list">${[...groups].map(([date, ms]) => `
          <div class="list-group-head"><span class="num">${esc(formatDateKo(date))}</span><span class="num">${ms.length}건</span></div>
          <ul class="list">${ms.map(unpaidRow).join('')}</ul>`).join('')}</section>`;
      return;
    }

    const list = recs.filter((r) =>
      (month === 'all' || yearMonthOf(r.date) === month) &&
      okNo(r) &&
      (!recFilter.kind || r.kind === recFilter.kind) &&
      (!recFilter.neisWait || !r.neis?.done) &&
      (!recFilter.undecided || r.div === 'undecided'));
    if (!list.length) {
      body.innerHTML = emptyCard('기록이 없습니다', '조건을 바꾸거나 오늘 탭에서 기록을 입력하세요.');
      return;
    }
    const groups = new Map();
    for (const r of sortRecords(list)) {
      if (!groups.has(r.date)) groups.set(r.date, []);
      groups.get(r.date).push(r);
    }
    // 오래된순이면 날짜 묶음과 묶음 안 순서를 함께 뒤집는다
    const ordered = sort === 'old' ? [...groups].reverse().map(([d, rs]) => [d, rs.slice().reverse()]) : [...groups];
    const waiting = list.filter((r) => !r.neis?.done).length;
    body.innerHTML = `<p class="small muted num" style="margin:0">${list.length}건 · 나이스 대기 ${waiting}건</p>
      <section class="card card-flush">${ordered.map(([date, rs]) => `
        <div class="list-group-head"><span class="num">${esc(formatDateKo(date))}</span><span class="num">${rs.length}건</span></div>
        <ul class="list">${rs.map((r) => recordRow(r)).join('')}</ul>`).join('')}</section>`;
  },
};

// ---------- 서류 ----------
function daysText(n) { return n === 0 ? '오늘' : `${n}일 지남`; }

const docsQ = { q: '' };
const docsOpen = new Set(); // 펼친 학생 번호
export const docsView = {
  title: '서류',
  sub: () => `${Number(todayStr().slice(5, 7))}월`,
  mount(main) {
    main.innerHTML = `<div class="stack">
      <div class="field" id="docs-q-wrap" hidden><label class="label" for="docs-q">번호 또는 이름</label><input class="input" id="docs-q" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="번호 또는 이름, 초성도 가능" value="${esc(docsQ.q)}"></div>
      <div id="docs-body" class="stack"></div></div>`;
    main.querySelector('#docs-q').addEventListener('input', (e) => { docsQ.q = e.target.value; this.update(); });
    const body = main.querySelector('#docs-body');
    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="pain-docs"]')) { this.addPainDocs(); return; }
      const t = e.target.closest('[data-usage-toggle]');
      if (t) {
        const no = Number(t.dataset.usageToggle);
        if (docsOpen.has(no)) docsOpen.delete(no); else docsOpen.add(no);
        this.update();
        body.querySelector(`[data-usage-toggle="${no}"]`)?.focus({ preventScroll: true });
      }
    });
    bindOpen(body);
    this.update();
  },
  addPainDocs() {
    const ids = periodPainWithoutDocs(store.data.records).map((r) => r.id);
    if (!ids.length) return;
    const n = addMissingPainDocs(ids);
    if (n < 0) { toast('이 기기에 저장하지 못했습니다. 저장 공간을 확인하세요.', { danger: true }); return; }
    toast(`생리통 기록 ${n}건에 학부모확인서(미제출)를 추가했습니다`);
  },
  update() {
    const body = document.getElementById('docs-body');
    if (!body) return;
    const today = todayStr();
    const ym = yearMonthOf(today);
    const recs = store.data.records;
    const set = store.data.settings;
    const byName = rosterOn();
    const qWrap = document.getElementById('docs-q-wrap');
    if (qWrap) qWrap.hidden = !byName;
    const nf = byName ? makeStudentFilter(getRoster(), docsQ.q) : null; // 검색어에 맞는 학생만 (요약 숫자는 전체 학생)
    const mine = (no) => !nf || nf(no);
    const nameTitle = (no, text) => { const n = nameFor(no); return n ? `${n} · ${text}` : text; };

    // 이번 달 제출 완료 (서류 제출일 기준), 묶음은 한 건으로
    const submitted = [];
    const seen = new Set();
    for (const r of recs) {
      (r.docs || []).forEach((d, i) => {
        if (!d.submitted) return;
        const key = r.groupId ? `${r.groupId}:${d.type}` : `${r.id}:${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        const group = r.groupId ? recs.filter((x) => x.groupId === r.groupId).map((x) => x.date).sort() : [r.date];
        submitted.push({ r, d, key, start: group[0], end: group[group.length - 1] });
      });
    }
    submitted.sort((a, b) => (b.d.submittedAt || '').localeCompare(a.d.submittedAt || ''));
    const submittedShown = submitted.filter((x) => mine(x.r.no));

    // 이번 달 사용 현황: 학생 한 명당 한 행 (생리통 + 학부모확인서). 한쪽만 쓴 학생도 다른 쪽은 0회로 표시
    const pLimit = Number(set.parentNoteLimit);
    const ppLimit = Number(set.periodPainLimit);
    const usageAll = [];
    for (let no = 1; no <= set.studentCount; no++) {
      const pRecs = parentNoteRecords(recs, no, ym, null, set);
      const ppRecs = recs.filter((r) => Number(r.no) === no && yearMonthOf(r.date) === ym && r.tag === 'periodPain' && r.div !== 'undecided').sort((a, b) => (a.date < b.date ? -1 : 1));
      const pp = countPeriodPain(recs, no, ym);
      const p = pRecs.length;
      if (!p && !pp) continue;
      usageAll.push({ no, p, pp, pRecs, ppRecs, full: (p >= pLimit) || (pp >= ppLimit) });
    }
    const usage = usageAll.filter((u) => mine(u.no));
    const fullCount = usageAll.filter((u) => u.full).length;

    const oldPain = periodPainWithoutDocs(recs);
    const painNote = oldPain.length ? `<div class="alert alert-info" role="status" id="pain-docs-note">${icon('info')}<div class="alert-body">
        <strong class="alert-title num">생리통 기록 ${oldPain.length}건에 서류 정보가 없습니다</strong>
        생리통 출석인정도 학부모확인서를 받습니다. 추가하면 기록 탭의 [미제출 서류]에 나옵니다.
        <div class="alert-actions"><button type="button" class="btn btn-secondary btn-sm" data-act="pain-docs">한 번에 추가</button></div>
      </div></div>` : '';

    const usageItem = (label, used, limit) => `
      <div class="usage-item">
        <span class="usage-label">${label}</span>
        ${quota(used, limit, `${used}/${limit}회`).replace('class="quota', `class="quota${used ? '' : ' is-zero'}`)}
      </div>`;
    const dateLinks = (label, list) => `<div class="usage-dates"><span class="usage-label">${label}</span>${list.length
      ? list.map((r) => `<button type="button" class="link-btn num" data-open="${esc(r.id)}" aria-label="${esc(`${stuLabel(r.no)} ${label} ${formatDateKo(r.date, false)} 기록 수정`)}">${esc(formatDateKo(r.date, false))}</button>`).join('')
      : '<span class="muted small">없음</span>'}</div>`;

    body.innerHTML = `<div class="cols cols-tablet"><div class="col">
      ${painNote}
      <section class="card card-flush" aria-labelledby="usage-title">
        <div class="card-head"><h2 class="card-title" id="usage-title">이번 달 사용 현황</h2></div>
        <p class="usage-summary num" data-testid="usage-summary">이번 달 사용 ${usageAll.length}명 · 한도 도달 <span class="${fullCount ? 'is-danger' : ''}">${fullCount}명</span></p>
        ${usage.length ? `<ul class="list">${usage.map((u) => {
          const open = docsOpen.has(u.no);
          const nm = nameFor(u.no);
          return `<li class="usage-row${u.full ? ' is-full' : ''}" data-usage="${u.no}">
            <button type="button" class="usage-head" data-usage-toggle="${u.no}" aria-expanded="${open}" aria-controls="usage-d-${u.no}" aria-label="${esc(`${stuLabel(u.no)} 생리통 ${u.pp}/${ppLimit}회, 학부모확인서 ${u.p}/${pLimit}회. 날짜 보기`)}">
              <span class="list-no">${u.no}</span>
              <span class="usage-name">${nm ? esc(nm) : ''}</span>
              <span class="usage-chev" aria-hidden="true">${icon('chev', open ? 'icon rot' : 'icon')}</span>
            </button>
            <div class="usage-items">
              ${usageItem('생리통', u.pp, ppLimit)}
              ${usageItem('학부모확인서', u.p, pLimit)}
            </div>
            <div class="usage-detail" id="usage-d-${u.no}"${open ? '' : ' hidden'}>
              ${dateLinks('생리통', u.ppRecs)}
              ${dateLinks('학부모확인서', u.pRecs)}
            </div>
          </li>`;
        }).join('')}</ul>`
        : nf && usageAll.length ? '<p class="small muted card-note">검색한 학생의 사용 기록이 없습니다.</p>'
        : '<p class="small muted card-note">이번 달 학부모확인서·생리통 사용 기록이 없습니다.</p>'}
      </section></div>
      <div class="col">
      <section class="card card-flush" aria-labelledby="recent-title">
        <div class="card-head"><h2 class="card-title" id="recent-title">최근 제출</h2></div>
        ${submittedShown.length ? `<ul class="list">${submittedShown.slice(0, 8).map((x) => `
          <li class="list-row is-done is-clickable" role="button" tabindex="0" data-open="${esc(x.r.id)}">
            <span class="list-no">${x.r.no}</span>
            <div class="list-main">
              <div class="list-title">${esc(nameTitle(x.r.no, `${describeKind(x.r)} · ${docLabel(x.d, true)}`))}</div>
              <div class="list-meta num">${esc(x.start === x.end ? formatDateKo(x.start) : formatRangeKo(x.start, x.end))}</div>
            </div>
            <span class="badge badge-done">제출</span>
          </li>`).join('')}</ul>`
        : '<p class="small muted card-note">아직 제출된 서류가 없습니다.</p>'}
      </section></div></div>`;
  },
};

// ---------- 학생 ----------
const stuState = { no: null, ym: '', q: '' };
export const studentsView = {
  title: '학생',
  mount(main) {
    if (!stuState.ym) stuState.ym = yearMonthOf(todayStr());
    main.innerHTML = `<div class="cols cols-side"><div class="col col-sticky">
      <section class="card">
        <div class="row-between" style="margin-bottom: var(--sp-3)">
          <button type="button" class="icon-btn" data-month="-1" aria-label="이전 달">${icon('chev', 'icon flip')}</button>
          <h2 class="card-title num" id="stu-month" aria-live="polite"></h2>
          <button type="button" class="icon-btn" data-month="1" aria-label="다음 달">${icon('chev')}</button>
        </div>
        <div class="field" id="stu-q-wrap" hidden style="margin-bottom: var(--sp-3)"><label class="label" for="stu-q">번호 또는 이름</label><input class="input" id="stu-q" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="번호 또는 이름, 초성도 가능" value="${esc(stuState.q)}"></div>
        <div class="num-grid" id="stu-grid" role="group" aria-label="번호 선택"></div>
        <p class="tiny muted" style="margin: var(--sp-3) 0 0">진한 테두리 번호는 이 달에 기록이 있습니다.</p>
      </section></div>
      <div id="stu-body" class="col"></div></div>`;
    const qInput = main.querySelector('#stu-q');
    qInput.addEventListener('input', (e) => { stuState.q = e.target.value; this.update(); });
    qInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      main.querySelector('#stu-grid [data-stu]')?.click(); // 검색 결과 맨 위 학생 선택
    });
    main.addEventListener('click', (e) => {
      const m = e.target.closest('[data-month]');
      if (m) { stuState.ym = shiftMonth(stuState.ym, Number(m.dataset.month)); this.update(); return; }
      const s = e.target.closest('[data-stu]');
      if (s) { stuState.no = Number(s.dataset.stu); this.update(); document.getElementById('stu-body')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    });
    bindOpen(main.querySelector('#stu-body'));
    this.update();
  },
  update() {
    const grid = document.getElementById('stu-grid');
    if (!grid) return;
    const set = store.data.settings;
    const ym = stuState.ym;
    document.getElementById('stu-month').textContent = ymLabel(ym);
    const monthRecs = store.data.records.filter((r) => yearMonthOf(r.date) === ym);
    const withRec = new Set(monthRecs.map((r) => r.no));
    if (stuState.no > set.studentCount) stuState.no = null;
    const byName = rosterOn();
    document.getElementById('stu-q-wrap').hidden = !byName;
    const nf = byName ? makeStudentFilter(getRoster(), stuState.q) : null;
    grid.classList.toggle('has-names', byName);
    let cells = '';
    for (let i = 1; i <= set.studentCount; i++) {
      if (nf && !nf(i)) continue;
      const nm = nameFor(i);
      cells += `<button type="button" class="chip chip-num${withRec.has(i) ? ' has-rec' : ''}" data-stu="${i}" aria-pressed="${stuState.no === i}" aria-label="${esc(stuLabel(i))}${withRec.has(i) ? ', 기록 있음' : ''}"><span class="num">${i}</span>${nm ? `<span class="chip-name">${esc(nm)}</span>` : ''}</button>`;
    }
    grid.innerHTML = cells || '<p class="small muted" style="grid-column: 1 / -1; margin: 0" data-testid="stu-empty">일치하는 학생이 없습니다.</p>';
    const body = document.getElementById('stu-body');
    if (!stuState.no) {
      body.innerHTML = `<div class="card"><div class="empty">${icon('user')}<div class="empty-title">번호를 고르세요</div><div class="empty-text">고른 학생의 ${Number(ym.slice(5))}월 출결 요약이 표시됩니다.</div></div></div>`;
      return;
    }
    const no = stuState.no;
    const mine = sortRecords(monthRecs.filter((r) => r.no === no));
    const cnt = (k) => mine.filter((r) => r.kind === k).length;
    const undecided = mine.filter((r) => r.div === 'undecided').sort((a, b) => (a.date < b.date ? -1 : 1));
    const pUsed = countParentNotes(store.data.records, no, ym, null, set);
    const ppUsed = countPeriodPain(store.data.records, no, ym);
    const miss = missingDocs(store.data.records, todayStr()).filter((m) => m.no === no && yearMonthOf(m.startDate) <= ym && yearMonthOf(m.endDate) >= ym);
    body.innerHTML = `
      <h2 class="subtitle">${esc(stuLabel(no))} · ${Number(ym.slice(5))}월 요약</h2>
      <div class="stats stats-4">
        ${KIND_ORDER.map((k) => `<div class="stat"><div class="stat-label">${KINDS[k].ko}</div><div class="stat-value num">${cnt(k)}</div></div>`).join('')}
      </div>
      <section class="card card-flush">
        <ul class="list">
          <li class="list-row"><div class="list-main"><div class="list-title">학부모확인서</div></div>${quota(pUsed, Number(set.parentNoteLimit), `${pUsed}/${set.parentNoteLimit}회`)}</li>
          <li class="list-row"><div class="list-main"><div class="list-title">생리통 출석인정</div></div>${quota(ppUsed, Number(set.periodPainLimit), `${ppUsed}/${set.periodPainLimit}회`)}</li>
          ${undecided.length ? `<li class="list-row"><div class="list-main"><div class="list-title">구분 미정</div><div class="list-meta num">${esc(undecided.map((r) => formatDateKo(r.date, false)).join(', '))} · 나이스 입력 전에 정해야 합니다</div></div><span class="badge badge-info num">${undecided.length}건</span></li>` : ''}
          <li class="list-row"><div class="list-main"><div class="list-title">미제출 서류</div>${miss.length ? `<div class="list-meta">${esc(miss.map((m) => m.docLabel).join(', '))}</div>` : ''}</div>${miss.length ? `<span class="badge badge-missing num">${miss.length}건</span>` : '<span class="badge badge-done">없음</span>'}</li>
        </ul>
      </section>
      <section class="card card-flush">
        <div class="card-head"><h3 class="card-title">${Number(ym.slice(5))}월 기록</h3><span class="badge badge-info num">${mine.length}건</span></div>
        ${mine.length ? `<ul class="list">${mine.map((r) => recordRow(r, { showDate: true, showName: false })).join('')}</ul>` : '<p class="small muted card-note">이 달 기록이 없습니다.</p>'}
      </section>`;
  },
};

