// 설정 화면과 첫 실행 화면
import { DIVS, defaultSettings, createEmptyData, normalizeData, compactDate, todayStr } from './shared/model.js';
import { store, updateSettings, importData, initData, connectDrive, disconnectDrive, syncNow, pollMs, autoCheckOn } from './store.js';
import { driveConfigured } from './drive.js';
import { APP_VERSION } from './version.js';
import { countParentNotes, countPeriodPain } from './shared/rules.js';
import { esc, icon, toast, confirmDialog, openSheet, closeSheet } from './ui.js';

// 가져온 뒤 한도를 넘은 학생·달 목록 (가져오기는 막지 않고 알림)
function overLimitList(data) {
  const s = data.settings;
  const seen = new Set();
  const out = [];
  for (const r of data.records) {
    const key = `${r.no}|${r.date.slice(0, 7)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ym = r.date.slice(0, 7);
    const m = `${Number(ym.slice(5))}월`;
    const p = countParentNotes(data.records, r.no, ym);
    if (p > Number(s.parentNoteLimit)) out.push(`${r.no}번 ${m} 학부모확인서 ${p}/${s.parentNoteLimit}회`);
    const pp = countPeriodPain(data.records, r.no, ym);
    if (pp > Number(s.periodPainLimit)) out.push(`${r.no}번 ${m} 생리통 출석인정 ${pp}/${s.periodPainLimit}회`);
  }
  return out.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

// 백업 파일에 계약 외 필드(이름 등)가 있었는지
const hadExtraFields = (json) => (json.records || []).some((r) => r && Object.keys(r).some((k) => !RECORD_KEYS.has(k)));
const RECORD_KEYS = new Set(['id', 'date', 'no', 'kind', 'div', 'period', 'periods', 'reason', 'tag', 'docs', 'groupId', 'neis', 'createdAt', 'updatedAt']);

function showImportResult(added, over, stripped = false) {
  let head = added ? `기록 ${added}건을 새로 가져왔습니다.` : '가져온 파일과 합쳤습니다. 새 기록은 없습니다.';
  if (stripped) head += ' 이름 등 저장하지 않는 항목은 지웠습니다.';
  if (!over.length) { toast(head.replace(/\.$/, '')); return; }
  const el = openSheet(`
    <div class="modal-head"><h2 class="modal-title" id="import-title">가져오기 완료</h2></div>
    <p class="small" style="margin:0 0 var(--sp-3)">${esc(head)} 아래 학생은 한도를 넘었습니다. 기록은 그대로 두었으니 서류를 확인하세요.</p>
    <div class="alert alert-block" role="alert">${icon('alert')}<div class="alert-body"><ul class="guide-list" id="import-over">${over.map((x) => `<li class="num">${esc(x)}</li>`).join('')}</ul></div></div>
    <div class="modal-actions"><button type="button" class="btn btn-primary" data-ok>확인</button></div>`, { center: true, labelledby: 'import-title' });
  el.querySelector('[data-ok]').addEventListener('click', () => closeSheet());
}

const PRIVACY = '온라인에는 학생 번호만 저장됩니다. 사유도 저장되므로 학교 개인정보 지침을 확인하세요.';

// 사유 구분 선택지: div 또는 div:tag
const REASON_TYPES = [
  ['ill', '질병'], ['sago', '미인정'], ['etc', '기타'], ['injung', '출석인정'], ['undecided', '미정'],
  ['keep', '구분 그대로 (사유만 채움)'],
  ['injung:periodPain', '출석인정 (생리통, 월 한도)'],
  ['injung:fieldTrip:absent', '출석인정 결석 (교외체험학습, 서류 2개)'],
];
const reasonTypeKey = (q) => [q.div || 'keep', q.tag, q.tag === 'fieldTrip' ? (q.kind || 'absent') : null].filter(Boolean).join(':');
const reasonTypeLabel = (q) => (REASON_TYPES.find(([k]) => k === reasonTypeKey(q)) || [null, DIVS[q.div]?.ko || ''])[1];

const installGuide = `
  <section class="card stack-sm" aria-labelledby="install-title">
    <h2 class="card-title" id="install-title">홈 화면에 추가하기</h2>
    <p class="small muted" style="margin:0">앱처럼 바로 열고 인터넷이 없어도 쓸 수 있습니다.</p>
    <ul class="guide-list small">
      <li><strong>아이폰·아이패드 (사파리)</strong> 아래쪽 공유 버튼 → 홈 화면에 추가</li>
      <li><strong>안드로이드 (크롬)</strong> 오른쪽 위 메뉴 → 앱 설치 (또는 홈 화면에 추가)</li>
      <li><strong>PC (크롬·엣지)</strong> 주소창 오른쪽 설치 아이콘 → 설치</li>
    </ul>
  </section>`;

function numField(id, label, value, min, max, hint = '') {
  return `<div class="field">
    <label class="label" for="${id}">${label}</label>
    <input class="input num" id="${id}" type="number" inputmode="numeric" min="${min}" max="${max}" value="${esc(value)}" required>
    ${hint ? `<div class="hint">${hint}</div>` : ''}
  </div>`;
}

function readNum(root, id, min, max, name) {
  const el = root.querySelector('#' + id);
  const v = Number(el.value);
  if (!Number.isInteger(v) || v < min || v > max) {
    el.setAttribute('aria-invalid', 'true');
    el.focus();
    throw new Error(`${name}은(는) ${min}~${max} 사이로 입력하세요.`);
  }
  el.removeAttribute('aria-invalid');
  return v;
}

function readClassFields(root) {
  return {
    schoolYear: readNum(root, 'set-year', 2000, 2100, '학년도'),
    grade: readNum(root, 'set-grade', 1, 6, '학년'),
    classNo: readNum(root, 'set-class', 1, 30, '반'),
    studentCount: readNum(root, 'set-count', 1, 60, '학생 수'),
    periodsPerDay: readNum(root, 'set-periods', 1, 10, '하루 교시 수'),
  };
}

function classFields(s) {
  return `<div class="grid-2">
    ${numField('set-year', '학년도', s.schoolYear, 2000, 2100)}
    ${numField('set-grade', '학년', s.grade, 1, 6)}
    ${numField('set-class', '반', s.classNo, 1, 30)}
    ${numField('set-count', '학생 수', s.studentCount, 1, 60)}
    ${numField('set-periods', '하루 교시 수', s.periodsPerDay, 1, 10)}
  </div>`;
}

export function exportBackup() {
  const json = JSON.stringify(store.data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance-data-${compactDate(todayStr())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('백업 파일을 내보냈습니다');
}

async function readBackupFile(file) {
  const text = await file.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('백업 파일을 읽을 수 없습니다.'); }
  if (!json || typeof json !== 'object' || !Array.isArray(json.records)) throw new Error('출결관리 도우미 백업 파일이 아닙니다.');
  return json;
}

function syncStatusHtml() {
  if (!driveConfigured()) {
    return { badge: '<span class="badge">이 기기에만 저장</span>', text: '구글 연결은 관리자 설정(Client ID)이 필요합니다. 지금은 이 기기에만 저장되므로 백업 파일을 자주 내보내세요.' };
  }
  const s = store.sync;
  if (s.status === 'local') return { badge: '<span class="badge">이 기기에만 저장</span>', text: '연결하면 내 구글 드라이브의 앱 전용 공간에 저장되어 휴대폰과 학교 PC가 같은 기록을 씁니다.' };
  const at = store.local.lastSyncAt ? new Date(store.local.lastSyncAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const map = {
    idle: ['<span class="badge badge-done">연결됨</span>', at ? `마지막 동기화 ${at}` : '연결되어 있습니다.'],
    syncing: ['<span class="badge badge-info">동기화 중</span>', '잠시만 기다리세요.'],
    offline: ['<span class="badge">오프라인</span>', '인터넷이 연결되면 자동으로 동기화합니다.'],
    auth: ['<span class="badge badge-missing">다시 연결 필요</span>', s.message || '[지금 동기화]를 눌러 구글 계정을 확인하세요.'],
    error: ['<span class="badge badge-missing">동기화 실패</span>', `${s.message || ''} 기록은 이 기기에 저장되어 있습니다.`],
  };
  const [badge, text] = map[s.status] || map.idle;
  return { badge, text };
}

// 자동 확인 안내: '자동 확인 켜짐 (20초마다) · 마지막 확인 14:05'
function autoCheckText() {
  const sec = Math.max(1, Math.round(pollMs() / 1000));
  const at = store.poll.lastCheckAt ? new Date(store.poll.lastCheckAt) : null;
  const hhmm = at ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '';
  return `자동 확인 켜짐 (${sec}초마다)${hhmm ? ` · 마지막 확인 ${hhmm}` : ''}`;
}

// ---------- 설정 ----------
export const settingsView = {
  title: '설정',
  mount(main) {
    const s = store.data.settings;
    // 태블릿 이상에서는 카드를 2열로 흘려 배치 (app.css .masonry)
    main.innerHTML = `<div class="masonry">
      <section class="card stack" aria-labelledby="cls-title">
        <h2 class="card-title" id="cls-title">학급</h2>
        ${classFields(s)}
        <div class="grid-2">
          ${numField('set-pn', '학부모확인서 월 한도', s.parentNoteLimit, 0, 10, '초과하면 저장을 막습니다.')}
          ${numField('set-pp', '생리통 월 한도', s.periodPainLimit, 0, 10, '초과하면 확인 후 저장합니다.')}
        </div>
        <button type="button" class="btn btn-primary btn-block" data-act="save-settings">설정 저장</button>
      </section>

      <section class="card card-flush" aria-labelledby="qr-title">
        <div class="card-head"><h2 class="card-title" id="qr-title">자주 쓰는 사유</h2></div>
        <ul class="list" id="qr-list"></ul>
        <div class="card-note stack-sm">
          <div class="grid-2">
            <div class="field"><label class="label" for="qr-label">사유</label><input class="input" id="qr-label" type="text" maxlength="20" placeholder="예: 두통"></div>
            <div class="field"><label class="label" for="qr-type">구분</label>
              <select class="select" id="qr-type">${REASON_TYPES.map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></div>
          </div>
          <button type="button" class="btn btn-secondary btn-block" data-act="add-reason">${icon('plus')}사유 추가</button>
        </div>
      </section>

      <section class="card stack-sm" aria-labelledby="drive-title" id="drive-card"></section>

      <section class="card stack-sm" aria-labelledby="backup-title">
        <h2 class="card-title" id="backup-title">백업</h2>
        <p class="small muted" style="margin:0">기록 전체를 파일로 내보내거나, 내보낸 파일을 지금 기록과 합칩니다.</p>
        <div class="grid-2">
          <button type="button" class="btn btn-secondary" data-act="export">백업 파일 내보내기</button>
          <button type="button" class="btn btn-secondary" data-act="import">가져오기</button>
        </div>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </section>

      <div class="alert alert-info">${icon('info')}<div class="alert-body"><strong class="alert-title">개인정보 안내</strong>${PRIVACY}</div></div>
      ${installGuide}
      </div>
      <p class="tiny muted" style="text-align:center; margin:0"><a href="guide.html">사용 안내</a> · <a href="../index.html">스마트 도구함</a></p>
      <p class="tiny muted" style="text-align:center; margin:0">출결관리 도우미 버전 <span class="num" id="app-version">${APP_VERSION}</span></p>`;
    main.addEventListener('click', (e) => this.onClick(e));
    main.querySelector('#import-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const json = await readBackupFile(f);
        const added = importData(json);
        this.mount(main);
        showImportResult(added, overLimitList(store.data), hadExtraFields(json));
      } catch (err) { toast(err.message, { danger: true }); }
    });
    this.renderReasons();
    this.renderDrive();
  },
  update(kind) {
    if (kind === 'poll') {
      const el = document.getElementById('auto-check');
      if (el) el.textContent = autoCheckText(); else this.renderDrive();
      return;
    }
    if (kind === 'sync') { this.renderDrive(); return; }
    this.renderReasons();
    this.renderDrive();
    // 동기화로 설정이 바뀌면 입력칸도 맞춤 (입력 중인 칸은 그대로)
    const s = store.data.settings;
    const map = { 'set-year': s.schoolYear, 'set-grade': s.grade, 'set-class': s.classNo, 'set-count': s.studentCount, 'set-periods': s.periodsPerDay, 'set-pn': s.parentNoteLimit, 'set-pp': s.periodPainLimit };
    for (const [id, v] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el && el !== document.activeElement && el.value !== String(v)) el.value = v;
    }
  },
  renderReasons() {
    const el = document.getElementById('qr-list');
    if (!el) return;
    const qs = store.data.settings.quickReasons || [];
    el.innerHTML = qs.length ? qs.map((q, i) => `
      <li class="list-row">
        <div class="list-main"><div class="list-title">${esc(q.label)}</div><div class="list-meta">${esc(reasonTypeLabel(q))}</div></div>
        <button type="button" class="icon-btn" data-del-reason="${i}" aria-label="${esc(q.label)} 삭제">${icon('trash')}</button>
      </li>`).join('') : '<li class="list-row"><span class="small muted">등록된 사유가 없습니다.</span></li>';
  },
  renderDrive() {
    const el = document.getElementById('drive-card');
    if (!el) return;
    const { badge, text } = syncStatusHtml();
    const connected = driveConfigured() && store.local.driveConnected;
    el.innerHTML = `
      <div class="row-between"><h2 class="card-title" id="drive-title">구글 드라이브</h2>${badge}</div>
      <p class="small muted" style="margin:0" aria-live="polite">${esc(text)}</p>
      ${connected && autoCheckOn() ? `<p class="tiny muted num" style="margin:0" id="auto-check">${esc(autoCheckText())}</p>` : ''}
      ${!driveConfigured() ? `<button type="button" class="btn btn-secondary btn-block" data-act="drive-help">구글 드라이브 연결</button>`
        : connected ? `<div class="grid-2">
            <button type="button" class="btn btn-primary" data-act="sync"${store.sync.status === 'syncing' ? ' disabled' : ''}>${icon('sync')}지금 동기화</button>
            <button type="button" class="btn btn-danger-outline" data-act="disconnect">연결 해제</button></div>`
        : `<button type="button" class="btn btn-primary btn-block" data-act="connect">구글 드라이브 연결</button>`}`;
  },
  async onClick(e) {
    const del = e.target.closest('[data-del-reason]');
    if (del) {
      const i = Number(del.dataset.delReason);
      const qs = store.data.settings.quickReasons.slice();
      const [removed] = qs.splice(i, 1);
      updateSettings({ quickReasons: qs });
      toast(`'${removed.label}' 사유를 지웠습니다`, { action: '되돌리기', onAction: () => {
        const again = store.data.settings.quickReasons.slice();
        again.splice(i, 0, removed);
        updateSettings({ quickReasons: again });
      } });
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const root = b.closest('main');
    const act = b.dataset.act;
    try {
      if (act === 'save-settings') {
        const v = readClassFields(root);
        v.parentNoteLimit = readNum(root, 'set-pn', 0, 10, '학부모확인서 한도');
        v.periodPainLimit = readNum(root, 'set-pp', 0, 10, '생리통 한도');
        updateSettings(v);
        toast('설정을 저장했습니다');
      } else if (act === 'add-reason') {
        const input = root.querySelector('#qr-label');
        const label = input.value.trim();
        if (!label) { input.focus(); throw new Error('사유를 입력하세요.'); }
        if (store.data.settings.quickReasons.some((q) => q.label === label)) throw new Error('이미 있는 사유입니다.');
        const [div, tag, kind] = root.querySelector('#qr-type').value.split(':');
        const q = { label };
        if (div !== 'keep') q.div = div; // 'keep' = 사유만 채우고 구분은 바꾸지 않음
        if (kind) q.kind = kind;
        if (tag) q.tag = tag;
        updateSettings({ quickReasons: [...store.data.settings.quickReasons, q] });
        input.value = '';
        toast(`'${label}' 사유를 추가했습니다`);
      } else if (act === 'export') {
        exportBackup();
      } else if (act === 'import') {
        root.querySelector('#import-file').click();
      } else if (act === 'drive-help') {
        await confirmDialog({ title: '관리자 설정 필요', body: '구글 드라이브 연결에는 Google Cloud에서 발급한 OAuth Client ID가 필요합니다. 앱 폴더의 config.js에 GOOGLE_CLIENT_ID를 넣은 뒤 다시 배포하세요. 그전까지는 이 기기에만 저장됩니다.', ok: '확인', cancel: '닫기' });
      } else if (act === 'connect') {
        const ok = await connectDrive();
        toast(ok ? '구글 드라이브에 연결했습니다' : (store.sync.message || '연결했지만 동기화하지 못했습니다'), { danger: !ok });
      } else if (act === 'sync') {
        const ok = await syncNow({ interactive: true });
        toast(ok ? '동기화했습니다' : (store.sync.message || '동기화하지 못했습니다'), { danger: !ok });
      } else if (act === 'disconnect') {
        if (await confirmDialog({ title: '연결 해제', body: '이 기기의 기록은 그대로 남고, 구글 드라이브와 더 이상 동기화하지 않습니다.', ok: '연결 해제', danger: true })) {
          await disconnectDrive();
          toast('구글 드라이브 연결을 해제했습니다');
        }
      }
    } catch (err) {
      toast(err.message || '처리하지 못했습니다', { danger: true });
    }
  },
};

// ---------- 첫 실행 ----------
export const setupView = {
  title: '출결관리 도우미',
  mount(main, onDone) {
    const s = defaultSettings();
    main.innerHTML = `
      <section class="card stack" aria-labelledby="setup-title">
        <div class="stack-sm">
          <h2 class="title" id="setup-title">처음 설정</h2>
          <p class="small muted" style="margin:0">담임 학급 정보를 입력하세요. 나중에 설정에서 바꿀 수 있습니다.</p>
        </div>
        ${classFields({ ...s, grade: '', classNo: '', studentCount: '' })}
        <div class="alert alert-info">${icon('info')}<div class="alert-body"><strong class="alert-title">개인정보 안내</strong>${PRIVACY} 이 앱에는 학생 이름을 입력하지 않습니다.</div></div>
        <button type="button" class="btn btn-primary btn-block btn-lg" data-act="start">시작하기</button>
      </section>
      <section class="card stack-sm" aria-labelledby="restore-title">
        <h2 class="card-title" id="restore-title">다른 기기에서 쓰던 기록이 있나요?</h2>
        ${driveConfigured() ? '<button type="button" class="btn btn-secondary btn-block" data-act="drive">구글 드라이브에서 불러오기</button>' : ''}
        <button type="button" class="btn btn-secondary btn-block" data-act="file">백업 파일로 시작하기</button>
        <input type="file" id="setup-file" accept="application/json,.json" hidden>
      </section>
      ${installGuide}`;
    main.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      try {
        if (b.dataset.act === 'start') {
          const v = readClassFields(main);
          // settings.updatedAt은 비워 둠: 나중에 드라이브를 연결하면 기존 드라이브 설정이 우선 (계약 2절)
          initData(createEmptyData({ ...defaultSettings(), ...v }));
          onDone();
        } else if (b.dataset.act === 'file') {
          main.querySelector('#setup-file').click();
        } else if (b.dataset.act === 'drive') {
          // 설정 시각 없이 빈 데이터를 만든 뒤 연결 → 드라이브 설정 채택
          initData(createEmptyData(defaultSettings()));
          const ok = await connectDrive();
          if (!ok) throw new Error(store.sync.message || '구글 드라이브에서 불러오지 못했습니다.');
          toast(`기록 ${store.data.records.length}건을 불러왔습니다`);
          onDone();
        }
      } catch (err) {
        if (b.dataset.act === 'drive') { try { localStorage.removeItem('ah.data'); } catch { /* 무시 */ } store.data = null; }
        toast(err.message || '처리하지 못했습니다', { danger: true });
      }
    });
    main.querySelector('#setup-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const json = await readBackupFile(f);
        initData(normalizeData(json));
        onDone();
        showImportResult(store.data.records.length, overLimitList(store.data), hadExtraFields(json));
      } catch (err) { toast(err.message, { danger: true }); }
    });
  },
};

