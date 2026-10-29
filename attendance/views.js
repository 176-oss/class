// 오늘 · 기록 · 서류 · 학생 화면
import {
  KINDS, KIND_ORDER, describeKind, describeRecord, docLabel, formatDateKo, formatRangeKo, todayStr,
  yearMonthOf, toDateStr,
} from './shared/model.js';
import { missingDocs, countParentNotes, countPeriodPain } from './shared/rules.js';
import { store, deleteRecord, restoreRecord, setDocsSubmitted } from './store.js';
import { RecordForm } from './form.js';
import { esc, icon, quota, toast, openSheet, closeSheet, josa } from './ui.js';

const ymLabel = (ym) => `${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5, 7))}월`;
// 필터용 짧은 이름: 올해면 '10월', 아니면 '25년 10월'
const ymShort = (ym) => (ym.slice(0, 4) === todayStr().slice(0, 4) ? `${Number(ym.slice(5, 7))}월` : `${ym.slice(2, 4)}년 ${Number(ym.slice(5, 7))}월`);
const shiftMonth = (ym, n) => {
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1);
  return toDateStr(d).slice(0, 7);
};
const sortRecords = (list) => list.slice().sort((a, b) => (a.date === b.date ? a.no - b.no || (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? 1 : -1));
const missingOf = (r) => (r.docs || []).some((d) => !d.submitted);

function neisBadge(r) {
  return r.neis?.done
    ? '<span class="badge badge-neis-done">나이스 입력 완료</span>'
    : '<span class="badge badge-neis-wait">나이스 대기</span>';
}

// "학부모확인서 미제출", "신청서 받음, 보고서 미제출"
function docStatus(r) {
  return (r.docs || []).map((d) => `${docLabel(d, true)} ${d.submitted ? '받음' : '미제출'}`).join(', ');
}

export function recordRow(r, { showDate = false } = {}) {
  const meta = [showDate ? formatDateKo(r.date) : '', docStatus(r), r.reason ? `사유 ${r.reason}` : ''].filter(Boolean).join(' · ');
  const title = describeKind(r);
  return `<li class="list-row is-clickable${r.neis?.done ? ' is-done' : ''}" role="button" tabindex="0" data-open="${esc(r.id)}" aria-label="${esc(`${r.no}번 ${describeRecord(r)}, ${formatDateKo(r.date)}. 눌러서 수정`)}">
    <span class="list-no">${r.no}</span>
    <div class="list-main">
      <div class="list-title">${esc(title)}</div>
      ${meta ? `<div class="list-meta num">${esc(meta)}</div>` : ''}
    </div>
    <div class="list-side">${neisBadge(r)}${missingOf(r) ? '<span class="badge badge-missing">미제출</span>' : ''}</div>
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
export function openEditSheet(record) {
  const sheet = openSheet(`
    <div class="sheet-head">
      <h2 class="sheet-title" id="sheet-title">${record.no}번 기록 수정</h2>
      <button type="button" class="icon-btn" data-close aria-label="닫기">${icon('close')}</button>
    </div>
    <p class="small muted num" style="margin: 0 0 var(--sp-3)">${esc(formatDateKo(record.date))} · ${record.neis?.done ? '나이스 입력 완료' : '나이스 대기'}</p>
    ${record.neis?.done ? `<div class="alert alert-info" style="margin-bottom: var(--sp-4)">${icon('info')}<div class="alert-body">나이스에 이미 입력한 기록입니다. 여기서 고치면 나이스에서도 직접 고쳐야 합니다.</div></div>` : ''}
    <form class="stack" id="edit-form" novalidate></form>
    <div class="sheet-actions">
      <button type="button" class="btn btn-danger-outline" data-delete>${icon('trash')}삭제</button>
    </div>`);
  const form = new RecordForm(sheet.querySelector('#edit-form'), { prefix: 'e', record, onDone: () => closeSheet() });
  form.render();
  sheet.querySelector('[data-close]').addEventListener('click', () => closeSheet());
  sheet.querySelector('[data-delete]').addEventListener('click', () => {
    const copy = structuredClone(record);
    deleteRecord(record.id);
    closeSheet();
    toast(`${record.no}번 ${formatDateKo(record.date, false)} 기록을 삭제했습니다`, {
      action: '되돌리기',
      onAction: () => { restoreRecord(copy); toast('삭제를 취소했습니다'); },
    });
  });
}

// ---------- 오늘 ----------
export const todayView = {
  title: '오늘',
  mount(main) {
    main.innerHTML = `
      <section class="card">
        <h2 class="sr-only">출결 입력</h2>
        <form class="stack" id="today-form" novalidate aria-label="출결 입력"></form>
      </section>
      <section class="card card-flush" id="today-list" aria-live="polite"></section>
      <p class="tiny muted storage-note" id="storage-note"></p>`;
    this.form = new RecordForm(main.querySelector('#today-form'), { prefix: 't' });
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
const recFilter = { month: '', no: '', kind: '', neisWait: false };
export const recordsView = {
  title: '기록',
  mount(main) {
    if (!recFilter.month) recFilter.month = yearMonthOf(todayStr());
    main.innerHTML = `
      <section class="card stack-sm" aria-label="필터">
        <div class="grid-3">
          <div class="field"><label class="label" for="flt-month">월</label><select class="select" id="flt-month"></select></div>
          <div class="field"><label class="label" for="flt-no">번호</label><select class="select" id="flt-no"></select></div>
          <div class="field"><label class="label" for="flt-kind">종류</label><select class="select" id="flt-kind"></select></div>
        </div>
        <label class="check"><input type="checkbox" id="flt-neis"${recFilter.neisWait ? ' checked' : ''}><span class="check-box"></span><span class="check-label">나이스 미입력만</span></label>
      </section>
      <div id="records-body" class="stack"></div>`;
    main.querySelector('section').addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === 'flt-month') recFilter.month = e.target.value;
      if (id === 'flt-no') recFilter.no = e.target.value;
      if (id === 'flt-kind') recFilter.kind = e.target.value;
      if (id === 'flt-neis') recFilter.neisWait = e.target.checked;
      this.update();
    });
    bindOpen(main.querySelector('#records-body'));
    this.update();
  },
  update() {
    const recs = store.data.records;
    const months = [...new Set([yearMonthOf(todayStr()), ...recs.map((r) => yearMonthOf(r.date))])].sort().reverse();
    const mSel = document.getElementById('flt-month');
    if (!mSel) return;
    mSel.innerHTML = `<option value="all"${recFilter.month === 'all' ? ' selected' : ''}>전체</option>` + months.map((m) => `<option value="${m}"${m === recFilter.month ? ' selected' : ''}>${ymShort(m)}</option>`).join('');
    const n = store.data.settings.studentCount;
    let noOpts = '<option value="">전체</option>';
    for (let i = 1; i <= n; i++) noOpts += `<option value="${i}"${String(i) === recFilter.no ? ' selected' : ''}>${i}번</option>`;
    document.getElementById('flt-no').innerHTML = noOpts;
    document.getElementById('flt-kind').innerHTML = '<option value="">전체</option>' + KIND_ORDER.map((k) => `<option value="${k}"${k === recFilter.kind ? ' selected' : ''}>${KINDS[k].ko}</option>`).join('');

    const list = sortRecords(recs.filter((r) =>
      (recFilter.month === 'all' || yearMonthOf(r.date) === recFilter.month) &&
      (!recFilter.no || r.no === Number(recFilter.no)) &&
      (!recFilter.kind || r.kind === recFilter.kind) &&
      (!recFilter.neisWait || !r.neis?.done)));
    const body = document.getElementById('records-body');
    if (!list.length) {
      body.innerHTML = `<div class="card"><div class="empty">${icon('list')}<div class="empty-title">기록이 없습니다</div><div class="empty-text">조건을 바꾸거나 오늘 탭에서 기록을 입력하세요.</div></div></div>`;
      return;
    }
    const groups = new Map();
    for (const r of list) {
      if (!groups.has(r.date)) groups.set(r.date, []);
      groups.get(r.date).push(r);
    }
    const waiting = list.filter((r) => !r.neis?.done).length;
    body.innerHTML = `<p class="small muted num" style="margin:0">${list.length}건 · 나이스 대기 ${waiting}건</p>
      <section class="card card-flush">${[...groups].map(([date, rs]) => `
        <div class="list-group-head"><span class="num">${esc(formatDateKo(date))}</span><span class="num">${rs.length}건</span></div>
        <ul class="list">${rs.map((r) => recordRow(r)).join('')}</ul>`).join('')}</section>`;
  },
};

// ---------- 서류 ----------
function daysText(n) { return n === 0 ? '오늘' : `${n}일 지남`; }

export const docsView = {
  title: '서류',
  sub: () => `${Number(todayStr().slice(5, 7))}월`,
  mount(main) {
    main.innerHTML = '<div id="docs-body" class="stack"></div>';
    const body = main.querySelector('#docs-body');
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-receive]');
      if (b) { this.receive(b.dataset.receive); return; }
    });
    bindOpen(body);
    this.update();
  },
  receive(key) {
    const item = missingDocs(store.data.records, todayStr()).find((x) => x.key === key);
    if (!item) return;
    setDocsSubmitted(item.refs, true);
    toast(`${item.no}번 ${josa(item.docLabel, '을', '를')} 받음으로 표시했습니다`, {
      action: '되돌리기',
      onAction: () => { setDocsSubmitted(item.refs, false); toast('받음 표시를 취소했습니다'); },
    });
  },
  update() {
    const body = document.getElementById('docs-body');
    if (!body) return;
    const today = todayStr();
    const ym = yearMonthOf(today);
    const recs = store.data.records;
    const set = store.data.settings;
    const missing = missingDocs(recs, today);

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
    const thisMonthDone = submitted.filter((x) => (x.d.submittedAt ? yearMonthOf(toDateStr(new Date(x.d.submittedAt))) : yearMonthOf(x.r.date)) === ym).length;
    submitted.sort((a, b) => (b.d.submittedAt || '').localeCompare(a.d.submittedAt || ''));

    // 이번 달 사용 현황
    const usage = [];
    for (let no = 1; no <= set.studentCount; no++) {
      const p = countParentNotes(recs, no, ym);
      if (p) usage.push({ no, label: '학부모확인서', used: p, limit: Number(set.parentNoteLimit) });
      const pp = countPeriodPain(recs, no, ym);
      if (pp) usage.push({ no, label: '생리통 출석인정', used: pp, limit: Number(set.periodPainLimit) });
    }
    usage.sort((a, b) => b.used / b.limit - a.used / a.limit || a.no - b.no);

    body.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="stat-label">미제출 서류</div><div class="stat-value num${missing.length ? ' is-danger' : ''}">${missing.length}건</div></div>
        <div class="stat"><div class="stat-label">이번 달 제출 완료</div><div class="stat-value num">${thisMonthDone}건</div></div>
      </div>
      <section class="card card-flush" aria-labelledby="miss-title">
        <div class="card-head"><h2 class="card-title" id="miss-title">미제출</h2>${missing.length ? `<span class="badge badge-missing num">${missing.length}건</span>` : ''}</div>
        ${missing.length ? `<ul class="list">${missing.map((m) => `
          <li class="list-row${m.daysPassed >= 3 ? ' is-urgent' : ''}">
            <span class="list-no">${m.no}</span>
            <div class="list-main">
              <div class="list-title">${esc(describeKind(m.record))} · ${esc(m.docShort)}</div>
              <div class="list-meta num">${esc(m.startDate === m.endDate ? formatDateKo(m.startDate) : formatRangeKo(m.startDate, m.endDate))} · ${daysText(m.daysPassed)}</div>
            </div>
            <div class="list-side">
              <span class="badge badge-missing">미제출</span>
              <button type="button" class="btn btn-secondary btn-sm" data-receive="${esc(m.key)}" aria-label="${m.no}번 ${esc(m.docLabel)} 받음">받음</button>
            </div>
          </li>`).join('')}</ul>`
        : `<div class="empty">${icon('doc')}<div class="empty-title">미제출 서류가 없습니다</div><div class="empty-text">서류가 필요한 기록을 저장하면 여기에 표시됩니다.</div></div>`}
      </section>
      <section class="card card-flush" aria-labelledby="usage-title">
        <div class="card-head"><h2 class="card-title" id="usage-title">이번 달 사용 현황</h2></div>
        ${usage.length ? `<ul class="list">${usage.map((u) => `
          <li class="list-row">
            <span class="list-no">${u.no}</span>
            <div class="list-main"><div class="list-title">${esc(u.label)}</div></div>
            ${quota(u.used, u.limit, `${u.used}/${u.limit}회`)}
          </li>`).join('')}</ul>`
        : '<p class="small muted card-note">이번 달 학부모확인서·생리통 사용 기록이 없습니다.</p>'}
      </section>
      <section class="card card-flush" aria-labelledby="recent-title">
        <div class="card-head"><h2 class="card-title" id="recent-title">최근 제출</h2></div>
        ${submitted.length ? `<ul class="list">${submitted.slice(0, 8).map((x) => `
          <li class="list-row is-done is-clickable" role="button" tabindex="0" data-open="${esc(x.r.id)}">
            <span class="list-no">${x.r.no}</span>
            <div class="list-main">
              <div class="list-title">${esc(describeKind(x.r))} · ${esc(docLabel(x.d, true))}</div>
              <div class="list-meta num">${esc(x.start === x.end ? formatDateKo(x.start) : formatRangeKo(x.start, x.end))}</div>
            </div>
            <span class="badge badge-done">제출</span>
          </li>`).join('')}</ul>`
        : '<p class="small muted card-note">아직 제출된 서류가 없습니다.</p>'}
      </section>`;
  },
};

// ---------- 학생 ----------
const stuState = { no: null, ym: '' };
export const studentsView = {
  title: '학생',
  mount(main) {
    if (!stuState.ym) stuState.ym = yearMonthOf(todayStr());
    main.innerHTML = `
      <section class="card">
        <div class="row-between" style="margin-bottom: var(--sp-3)">
          <button type="button" class="icon-btn" data-month="-1" aria-label="이전 달">${icon('chev', 'icon flip')}</button>
          <h2 class="card-title num" id="stu-month" aria-live="polite"></h2>
          <button type="button" class="icon-btn" data-month="1" aria-label="다음 달">${icon('chev')}</button>
        </div>
        <div class="num-grid" id="stu-grid" role="group" aria-label="번호 선택"></div>
        <p class="tiny muted" style="margin: var(--sp-3) 0 0">진한 테두리 번호는 이 달에 기록이 있습니다.</p>
      </section>
      <div id="stu-body" class="stack"></div>`;
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
    let cells = '';
    for (let i = 1; i <= set.studentCount; i++) {
      cells += `<button type="button" class="chip chip-num${withRec.has(i) ? ' has-rec' : ''}" data-stu="${i}" aria-pressed="${stuState.no === i}" aria-label="${i}번${withRec.has(i) ? ', 기록 있음' : ''}">${i}</button>`;
    }
    grid.innerHTML = cells;
    const body = document.getElementById('stu-body');
    if (!stuState.no) {
      body.innerHTML = `<div class="card"><div class="empty">${icon('user')}<div class="empty-title">번호를 고르세요</div><div class="empty-text">고른 학생의 ${Number(ym.slice(5))}월 출결 요약이 표시됩니다.</div></div></div>`;
      return;
    }
    const no = stuState.no;
    const mine = sortRecords(monthRecs.filter((r) => r.no === no));
    const cnt = (k) => mine.filter((r) => r.kind === k).length;
    const pUsed = countParentNotes(store.data.records, no, ym);
    const ppUsed = countPeriodPain(store.data.records, no, ym);
    const miss = missingDocs(store.data.records, todayStr()).filter((m) => m.no === no && yearMonthOf(m.startDate) <= ym && yearMonthOf(m.endDate) >= ym);
    body.innerHTML = `
      <h2 class="subtitle">${no}번 · ${Number(ym.slice(5))}월 요약</h2>
      <div class="stats stats-4">
        ${KIND_ORDER.map((k) => `<div class="stat"><div class="stat-label">${KINDS[k].ko}</div><div class="stat-value num">${cnt(k)}</div></div>`).join('')}
      </div>
      <section class="card card-flush">
        <ul class="list">
          <li class="list-row"><div class="list-main"><div class="list-title">학부모확인서</div></div>${quota(pUsed, Number(set.parentNoteLimit), `${pUsed}/${set.parentNoteLimit}회`)}</li>
          <li class="list-row"><div class="list-main"><div class="list-title">생리통 출석인정</div></div>${quota(ppUsed, Number(set.periodPainLimit), `${ppUsed}/${set.periodPainLimit}회`)}</li>
          <li class="list-row"><div class="list-main"><div class="list-title">미제출 서류</div>${miss.length ? `<div class="list-meta">${esc(miss.map((m) => m.docLabel).join(', '))}</div>` : ''}</div>${miss.length ? `<span class="badge badge-missing num">${miss.length}건</span>` : '<span class="badge badge-done">없음</span>'}</li>
        </ul>
      </section>
      <section class="card card-flush">
        <div class="card-head"><h3 class="card-title">${Number(ym.slice(5))}월 기록</h3><span class="badge badge-info num">${mine.length}건</span></div>
        ${mine.length ? `<ul class="list">${mine.map((r) => recordRow(r, { showDate: true })).join('')}</ul>` : '<p class="small muted card-note">이 달 기록이 없습니다.</p>'}
      </section>`;
  },
};

