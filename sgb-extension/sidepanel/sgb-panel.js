// 생기부 탭: 데이터 받기 -> 나이스 화면 감지 -> 입력 -> 선생님 확인 -> 저장
// 나중에 출결 확장에 합칠 때는 mount(root) 를 출결 사이드 패널의 '생기부' 탭에서 부른다.
import { neisBytes, parseBatch, fromDriveData, applyNeisDone, itemsFor, limitFor, condLabel, groupSummary } from '../shared/sgb-model.js';
import { hasClientId, redirectUrl, getToken, forgetToken, download, upload, getMeta, metaStamp } from './sgb-drive.js';

// shortcut: localhost 주소는 가상 나이스 시험용. 학교 배포 전 manifest 와 여기서 뺀다.
const NEIS_URLS = ['https://*.neis.go.kr/*', 'http://localhost/*', 'http://127.0.0.1/*'];
const K = { data: 'sgb.data', done: 'sgb.done', drive: 'sgb.drive' };

const S = {
  data: null,        // { schoolYear, semester, source, receivedAt, items }
  done: {},          // { [id]: { hash, doneAt } } 나이스 저장 완료 (이 PC). 드라이브에 연결되면 records[].neis 로 올린다
  drive: { connected: false },
  tabId: null,
  det: null,         // page detect 결과
  phase: 'idle',     // idle | filling | review | confirm | saving
  run: null,         // { cond, targets }
  results: {},       // { [id]: { status, neisText } }
  progress: null,
  notice: null,      // { kind: 'info'|'block', title, body }
  logs: [],
  survey: '',
  values: '',
};

let root;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const timeStr = (t) => (t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3000);
}
function addLog(msg, level) {
  S.logs.push({ at: Date.now(), msg: String(msg), level: level || 'info' });
  if (S.logs.length > 300) S.logs.shift();
}

// ---------- 저장소 ----------
async function loadState() {
  const o = await chrome.storage.local.get([K.data, K.done, K.drive]);
  S.data = o[K.data] || null;
  S.done = o[K.done] || {};
  S.drive = o[K.drive] || { connected: false };
}
const saveKey = (k, v) => chrome.storage.local.set({ [k]: v });

// ---------- 나이스 탭 ----------
async function findTab() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: NEIS_URLS }); } catch (e) { tabs = []; }
  if (!tabs.length) return null;
  let cur = null;
  try { [cur] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); } catch (e) { /* 없음 */ }
  return (cur && tabs.find((t) => t.id === cur.id)) || tabs.find((t) => t.active) || tabs[0];
}
class CmdError extends Error { constructor(e) { super(e.message); this.code = e.code; this.data = e.data || null; } }
async function cmd(name, args) {
  if (S.tabId == null) throw new CmdError({ code: 'no_tab', message: '나이스 탭을 찾지 못했습니다.' });
  let res;
  try {
    res = await chrome.tabs.sendMessage(S.tabId, { sgb: 'neis-cmd', cmd: name, args: args || {} }, { frameId: 0 });
  } catch (e) {
    throw new CmdError({ code: 'no_bridge', message: '나이스 페이지와 연결하지 못했습니다. 나이스 페이지를 새로고침(F5)한 뒤 다시 시도하세요.' });
  }
  if (!res) throw new CmdError({ code: 'no_bridge', message: '나이스 페이지가 응답하지 않았습니다.' });
  if (!res.ok) throw new CmdError(res.error || { code: 'error', message: '알 수 없는 오류' });
  return res.result;
}

let detecting = false;
async function detect() {
  if (detecting || S.phase !== 'idle') return;
  detecting = true;
  const before = JSON.stringify([S.tabId, S.det]);
  try {
    const tab = await findTab();
    S.tabId = tab ? tab.id : null;
    S.det = tab ? await cmd('detect').catch(() => null) : null;
  } finally {
    detecting = false;
    if (JSON.stringify([S.tabId, S.det]) !== before) render(); // 2초마다 다시 그리면 선택·스크롤이 풀리므로 바뀐 때만
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || sender.id !== chrome.runtime.id || msg.sgb !== 'neis-event' || !msg.event) return;
  const ev = msg.event;
  if (ev.type === 'log') addLog(ev.msg, ev.level);
  if (ev.type === 'progress') S.progress = ev;
  render();
});

// ---------- 학생별 상태 ----------
function itemState(it) {
  const d = S.done[it.id];
  if ((d && d.hash === it.hash) || it.neisHash === it.hash) return { key: 'saved', label: '저장됨', cls: 'badge-neis-done' };
  if (it.dup) return { key: 'manual', label: '직접 확인', why: '같은 학생 글이 2개 이상입니다.', cls: 'badge-missing' };
  const limit = limitFor(S.data, it.area);
  if (it.bytes > limit) return { key: 'manual', label: '직접 확인', why: `한도(${limit}바이트)를 넘습니다.`, cls: 'badge-missing' };
  const r = S.results[it.id];
  if (!r) return { key: 'wait', label: '대기', cls: '' };
  if (r.status === 'existing') return { key: 'choose', label: '선택 필요', why: '나이스에 이미 글이 있어 넣지 않았습니다. 덮어쓸지 뒤에 이어쓸지 고르세요.', cls: 'badge-missing' };
  if (r.status === 'contained') return { key: 'contained', label: '이미 포함됨', why: '나이스 글에 새 글이 이미 들어 있습니다.', cls: 'badge-info' };
  const why = {
    name_mismatch: '나이스 이름과 다릅니다.',
    not_found: '나이스 표에 없는 번호입니다.',
    mismatch: '넣은 뒤 나이스 값이 보낸 글과 다릅니다.',
    locked: '나이스에서 입력할 수 없는 행입니다 (학생부 반영 또는 마감).',
    too_long: `바이트 한도(${r.capacity})를 넘습니다. 교과세특은 다른 학기 입력분 때문에 한도가 줄었을 수 있습니다.`,
  }[r.status];
  if (why) return { key: 'manual', label: '직접 확인', why, cls: 'badge-missing' };
  if (r.status === 'already') return { key: 'already', label: '나이스에 같은 글', cls: 'badge-info' };
  return { key: 'entered', label: r.mode === 'append' ? '이어씀' : r.mode === 'overwrite' ? '덮어씀' : '입력됨', cls: 'badge-neis-wait' };
}

// 지금 화면에서 입력을 시작할 수 있는지. 안 되면 이유 문장
function blockReason(list) {
  const det = S.det;
  if (!det || det.state === 'none') return '나이스 생기부 입력 화면이 열려 있지 않습니다.';
  if (det.state === 'hidden') return `'${det.hiddenLabel}' 화면이 열려 있지만 지금 보이지 않습니다. 입력하려는 탭(학생부 자료 기록)을 화면에 띄우세요.`;
  if (!det.cond) return '나이스 조회 조건을 읽지 못했습니다. 나이스에서 [조회]를 눌러 학생 표가 나온 뒤 다시 확인하세요.';
  if (!det.writeAllowed) return '실제 나이스 생기부 입력 방식을 아직 시험하지 않아 입력할 수 없습니다. 지금은 화면 감지와 값 읽기만 합니다.';
  if (det.closed) return det.closed;
  if (!S.data) return '먼저 생기부 글을 불러오세요.';
  const c = det.cond;
  if (S.data.schoolYear && c.schoolYear && S.data.schoolYear !== c.schoolYear) return `나이스 화면은 ${c.schoolYear}학년도, 불러온 글은 ${S.data.schoolYear}학년도입니다.`;
  if (S.data.semester && c.semester && S.data.semester !== c.semester) return `나이스 화면은 ${c.semester}학기, 불러온 글은 ${S.data.semester}학기입니다.`;
  if (!list.length) return `불러온 글 중 이 화면 조건(${condLabel(c)})에 맞는 글이 없습니다. 나이스에서 조회 조건을 바꾸세요.`;
  if (det.dirtyRows) return `나이스 표에 저장하지 않은 변경이 ${det.dirtyRows}행 있습니다. 나이스 [조회]로 되돌린 뒤 시작하세요.`;
  if (det.dialog) return `나이스 창이 떠 있습니다: ${det.dialog}`;
  if (!list.some((it) => itemState(it).key === 'wait')) return '이 조건에서 입력할 글이 없습니다 (모두 저장됨 또는 직접 확인).';
  return null;
}

// ---------- 동작 ----------
async function startFill() {
  let list = itemsFor(S.data.items, S.det.cond);
  const reason = blockReason(list);
  if (reason) { toast(reason); return; }
  // 드라이브 글이면 입력 직전에 다시 받는다. 그 사이 웹앱에서 바뀐 글은 입력하지 않고 새 글을 보여 준 뒤 멈춘다 (계약 19절)
  if (S.data.source === 'drive') {
    let fresh;
    try { fresh = await fromDriveData((await download(await getToken(false))).data); } catch (e) {
      S.notice = { kind: 'block', title: '시작하지 않았습니다', body: `드라이브에서 최신 글을 받지 못했습니다. [드라이브에서 다시 받기]를 누르세요.\n${e.message}` };
      render();
      return;
    }
    const sig = (items) => itemsFor(items, S.det.cond).map((it) => `${it.id}:${it.hash}`).join(',');
    if (sig(fresh.items) !== sig(S.data.items)) {
      await setData(fresh);
      S.notice = { kind: 'info', title: '웹앱에서 바뀐 글을 새로 받았습니다', body: '학생 목록을 확인한 뒤 [입력 시작]을 다시 누르세요.' };
      render();
      return;
    }
    list = itemsFor(S.data.items, S.det.cond);
  }
  const targets = list.filter((it) => itemState(it).key === 'wait');
  S.run = { cond: S.det.cond, targets };
  S.results = {};
  S.notice = null;
  S.phase = 'filling';
  S.progress = { done: 0, total: targets.length };
  addLog(`입력 시작: ${condLabel(S.run.cond)} ${targets.length}명`);
  render();
  try {
    const res = await cmd('fill', { cond: S.run.cond, items: targets.map((it) => fillItem(it)) });
    for (const r of res.results) S.results[r.id] = r;
    S.phase = 'review';
  } catch (e) {
    S.phase = 'review';
    if (e.code !== 'aborted') S.notice = { kind: 'block', title: '입력을 멈췄습니다', body: `${e.message}\n저장하지 않았습니다. 나이스 [조회]를 누르면 입력 전으로 돌아갑니다.` };
  }
  render();
}

async function stop() {
  await cmd('abort').catch(() => {});
  S.phase = 'idle';
  S.run = null;
  S.results = {};
  S.notice = { kind: 'info', title: '멈췄습니다', body: '나이스에는 저장하지 않았습니다. 나이스 [조회]를 누르면 입력 전으로 돌아갑니다.' };
  addLog('멈춤');
  render();
  detect();
}

// 나이스로 보내는 한 학생분 (mode: 이미 글이 있을 때 선생님이 고른 방식)
const fillItem = (it, mode) => ({ id: it.id, grade: it.grade, classNo: it.classNo, no: it.no, name: it.name, text: it.text, limit: limitFor(S.data, it.area), mode });
// 나이스에 이미 글이 있는 학생에게 선택한 방식으로 넣기 (ids 가 비면 선택 대기 중인 학생 모두)
async function applyExisting(mode, ids) {
  if (!S.run || S.phase !== 'review') return;
  const pending = S.run.targets.filter((it) => S.results[it.id] && S.results[it.id].status === 'existing' && (!ids || ids.includes(it.id)));
  if (!pending.length) return;
  if (mode === 'overwrite' && !confirm(`나이스에 있는 글 ${pending.length}명분을 지우고 새 글로 바꿉니다.
저장하기 전에는 나이스 [조회]로 원래대로 되돌릴 수 있습니다. 계속할까요?`)) return;
  if (mode === 'append' && pending.length > 1 && !confirm(`나이스에 있는 글 ${pending.length}명분 뒤에 새 글을 이어 씁니다. 계속할까요?`)) return;
  S.phase = 'filling';
  S.progress = { done: 0, total: pending.length };
  render();
  try {
    const res = await cmd('fill', { cond: S.run.cond, items: pending.map((it) => fillItem(it, mode)) });
    for (const r of res.results) S.results[r.id] = r;
    S.notice = null;
  } catch (e) {
    if (e.code !== 'aborted') S.notice = { kind: 'block', title: '입력을 멈췄습니다', body: `${e.message}
저장하지 않았습니다. 나이스 [조회]를 누르면 입력 전으로 돌아갑니다.` };
  }
  S.phase = 'review';
  render();
}

const enteredItems = () => (S.run ? S.run.targets.filter((it) => S.results[it.id] && S.results[it.id].status === 'entered') : []);
const enteredText = (it) => { const r = S.results[it.id]; return r && r.entered != null ? r.entered : it.text; };
const alreadyItems = () => (S.run ? S.run.targets.filter((it) => S.results[it.id] && S.results[it.id].status === 'already') : []);

async function saveNow() {
  const list = enteredItems();
  S.phase = 'saving';
  S.notice = null;
  render();
  try {
    await cmd('save', { cond: S.run.cond, expect: list.map((it) => ({ grade: it.grade, classNo: it.classNo, no: it.no, text: enteredText(it) })) });
    const doneAt = new Date().toISOString();
    // 이어쓴 학생은 나이스 글이 웹앱 최종본과 달라서 '입력 완료'로 표시하지 않는다
    const saved = [...list.filter((it) => S.results[it.id].mode !== 'append'), ...alreadyItems()].map((it) => ({ id: it.id, hash: it.hash, doneAt }));
    for (const s of saved) S.done[s.id] = { hash: s.hash, doneAt };
    await saveKey(K.done, S.done);
    addLog(`저장 완료 ${list.length}명`);
    S.notice = { kind: 'info', title: `${list.length}명 저장했습니다`, body: '다른 영역이나 반은 나이스에서 조회 조건을 바꾸면 다시 감지합니다.' };
    S.phase = 'idle';
    S.run = null;
    for (const s of saved) delete S.results[s.id]; // '직접 확인' 표시는 남긴다 (다시 받거나 패널을 열면 초기화)
    await pushDoneToDrive();
  } catch (e) {
    const after = e.data && e.data.afterConfirm;
    S.phase = 'review';
    S.notice = after
      ? { kind: 'block', title: '저장됐을 수 있습니다', body: `${e.message}\n나이스 표를 직접 확인하세요. 확장프로그램은 더 진행하지 않았습니다.` }
      : { kind: 'block', title: '저장하지 않았습니다', body: e.message };
    addLog(`저장 실패: ${e.message}`, 'error');
  }
  render();
  detect();
}

// ---------- 데이터 ----------
async function setData(d) {
  S.data = d;
  await saveKey(K.data, d);
  S.results = {};
  toast(`글 ${d.items.length}개를 불러왔습니다.`);
  addLog(`데이터 불러옴 (${d.source}, ${d.items.length}개)`);
  render();
}
async function importFile(file) {
  try {
    const d = await parseBatch(await file.text());
    await setData(d);
    if (d.skipped) toast(`글 ${d.items.length}개를 불러왔습니다. 학생 이름이 없는 ${d.skipped}개는 뺐습니다.`);
  } catch (e) { toast(e.message); }
}
async function pullDrive(interactive) {
  try {
    const token = await getToken(interactive);
    const { fileId, data } = await download(token);
    if (!fileId) { toast('드라이브에 생기부 데이터(sgb-data.json)가 없습니다. 웹앱에서 드라이브 연결을 먼저 하세요.'); return; }
    S.drive = { connected: true, lastSyncAt: Date.now() };
    await saveKey(K.drive, S.drive);
    const d = await fromDriveData(data);
    await setData(d);
    if (d.skipped) toast(`글 ${d.items.length}개를 불러왔습니다. 학생 이름이나 번호가 없는 ${d.skipped}개는 뺐습니다.`);
    await pushDoneToDrive(); // 전에 못 올린 입력 완료가 있으면 이때 올린다
  } catch (e) { toast(e.message); }
}
// 이 PC의 입력 완료를 드라이브에 반영 (계약 19절): 받기 -> 해당 기록 neis 만 고치기 -> 올리기 직전 version 확인 -> 바뀌었으면 처음부터 (최대 3번)
async function pushDoneToDrive() {
  const saved = Object.entries(S.done).map(([id, d]) => ({ id, hash: d.hash, doneAt: d.doneAt || new Date(d.at || Date.now()).toISOString() }));
  if (!S.drive.connected || !saved.length) return;
  try {
    const token = await getToken(false);
    for (let i = 0; i < 3; i++) {
      const { fileId, data, stamp } = await download(token);
      if (!fileId) return;
      const n = await applyNeisDone(data, saved);
      if (!n) return;
      if (metaStamp(await getMeta(token, fileId)) !== stamp) continue; // 받은 뒤 다른 기기가 올림
      await upload(token, fileId, data);
      addLog(`드라이브에 입력 완료 ${n}건 반영`);
      return;
    }
    throw new Error('다른 기기에서 동시에 고치고 있습니다.');
  } catch (e) {
    addLog(`드라이브 반영 실패: ${e.message}`, 'warn');
    toast('나이스 저장은 끝났지만 드라이브에 입력 완료 표시를 못 했습니다. 다음에 드라이브에서 받을 때 다시 올립니다.');
  }
}
async function clearAll() {
  if (!confirm('이 PC에 저장된 생기부 글과 입력 기록을 모두 지울까요? 나이스와 드라이브의 내용은 그대로입니다.')) return;
  await chrome.storage.local.remove([K.data, K.done]);
  S.data = null; S.done = {}; S.results = {};
  toast('이 PC의 생기부 데이터를 지웠습니다.');
  render();
}
async function doSurvey() {
  try { S.survey = JSON.stringify(await cmd('survey'), null, 2); } catch (e) { toast(e.message); }
  render();
}
async function doSurveyValues() {
  try { S.values = JSON.stringify(await cmd('surveyValues'), null, 2); } catch (e) { toast(e.message); }
  render();
}

// ---------- 화면 ----------
function noticeHtml(n) {
  if (!n) return '';
  return `<div class="alert ${n.kind === 'block' ? 'alert-block' : 'alert-info'}" role="status"><div class="alert-body">
    <span class="alert-title">${esc(n.title)}</span><div class="pre">${esc(n.body)}</div></div></div>`;
}
function screenCard() {
  const det = S.det;
  let body;
  if (S.tabId == null) body = '<div class="muted">나이스 탭이 없습니다. 나이스에 로그인한 뒤 생기부 입력 화면을 여세요.</div>';
  else if (!det) body = '<div class="muted">나이스 페이지와 연결하지 못했습니다. 나이스 페이지를 새로고침(F5)하세요.</div>';
  else if (det.state === 'hidden') body = `<div class="strong">'${esc(det.hiddenLabel)}' 화면이 열려 있지만 지금 보이지 않습니다.</div><div class="small muted">입력하려는 탭(학생부 자료 기록)을 화면에 띄우면 활성화됩니다.</div>`;
  else if (det.state !== 'active') body = '<div class="muted">나이스 생기부 입력 화면을 찾지 못했습니다. 입력하려는 화면을 열어 주세요.</div>';
  else if (!det.cond) body = '<div class="muted">나이스 생기부 화면이 보이지만 조회 조건을 읽지 못했습니다. 나이스에서 [조회]를 눌러 주세요.</div>';
  else {
    const c = det.cond;
    body = `<div class="strong">나이스 생기부 화면 감지됨: ${esc(c.screenLabel)}</div>
      <div class="small">${esc([c.schoolYear && `${c.schoolYear}학년도`, c.semester && `${c.semester}학기`, condLabel(c)].filter(Boolean).join(' '))} · 학생 ${det.rowCount}명</div>${det.closed ? `<div class="small danger-text">${esc(det.closed)}</div>` : ''}`;
  }
  const verifyNote = det && !det.verified
    ? `<div class="hint">${det.mock ? '가상 나이스 화면입니다 (시험용).' : '실제 입력 방식 시험 전이라 읽기만 합니다.'}</div>` : '';
  return `<section class="card"><div class="section-title">나이스 화면</div>${body}${verifyNote}</section>`;
}
function dataCard() {
  const d = S.data;
  const summary = d
    ? `<div class="small">${esc([d.schoolYear && `${d.schoolYear}학년도`, d.semester && `${d.semester}학기`].filter(Boolean).join(' '))} · ${d.source === 'drive' ? '드라이브' : '파일'}에서 ${esc(timeStr(d.receivedAt))} 받음</div>
       <ul class="warn-list small">${groupSummary(d.items).map((g) => `<li>${esc(g)}</li>`).join('')}</ul>`
    : '<div class="muted small">불러온 글이 없습니다. 웹앱에서 상태가 \'완료\'인 글만 가져옵니다.</div>';
  const drive = hasClientId()
    ? `<button class="btn btn-secondary btn-sm" data-act="drive">${S.drive.connected ? '드라이브에서 다시 받기' : '구글 드라이브에서 받기'}</button>` : '';
  return `<section class="card stack-sm"><div class="section-title">생기부 글</div>${summary}
    <div class="btn-row">${drive}<button class="btn btn-secondary btn-sm" data-act="file">파일 불러오기</button>
    ${d ? '<button class="btn btn-ghost btn-sm" data-act="clear">이 PC의 생기부 데이터 모두 지우기</button>' : ''}</div></section>`;
}
function studentRow(it, showTexts) {
  const st = itemState(it);
  const r = S.results[it.id];
  const texts = showTexts && r && r.neisText != null
    ? `<details><summary class="small">두 글 비교</summary><div class="sgb-texts">
        <div><div class="sgb-text-label">보낸 글</div><div class="sgb-text">${esc(it.text)}</div></div>
        <div><div class="sgb-text-label">${r.status === 'entered' ? '나이스 원래 글 (바꾸기 전)' : '나이스 현재 값'}</div><div class="sgb-text">${esc(r.neisText)}</div></div></div></details>` : '';
  const choose = showTexts && r && r.status === 'existing'
    ? `<div class="btn-row"><button class="btn btn-secondary btn-sm" data-act="existing" data-id="${esc(it.id)}" data-mode="append">뒤에 이어쓰기</button>
       <button class="btn btn-secondary btn-sm" data-act="existing" data-id="${esc(it.id)}" data-mode="overwrite">덮어쓰기</button></div>` : '';
  return `<li class="list-row plan-row"><span class="list-no">${it.no}</span>
    <div class="list-main"><div class="list-title">${esc(it.name)}</div>
      <div class="list-meta wrap">${it.bytes}바이트${st.why ? ` · ${esc(st.why)}` : ''}</div>${texts}</div>
    <div class="list-side"><span class="badge ${st.cls}">${esc(st.label)}</span>${choose}</div></li>`;
}
function studentsCard(list) {
  if (!list.length) return '';
  const showTexts = S.phase === 'review';
  return `<section class="card card-flush"><div class="list-group-head"><span class="strong">이 화면 학생 ${list.length}명</span></div>
    <ul class="list">${list.map((it) => studentRow(it, showTexts)).join('')}</ul></section>`;
}
function actions(list) {
  if (S.phase === 'filling') {
    const p = S.progress;
    return `<div class="sgb-progress">입력 중 ${p ? `${p.done}/${p.total}` : ''}</div><button class="btn btn-danger-outline btn-block" data-act="stop">멈추기</button>`;
  }
  if (S.phase === 'review') {
    const n = enteredItems().length;
    const waiting = S.run ? S.run.targets.filter((it) => S.results[it.id] && S.results[it.id].status === 'existing').length : 0;
    const choose = waiting ? `<div class="callout"><div class="callout-who">나이스에 이미 글이 있는 학생 ${waiting}명</div>
      <div class="callout-what">바로 덮어쓰지 않았습니다. 학생마다 고르거나 한꺼번에 고르세요. '두 글 비교'로 나이스 글과 보낸 글을 볼 수 있고, 저장하기 전에는 나이스 [조회]로 되돌릴 수 있습니다.</div>
      <div class="btn-row"><button class="btn btn-secondary btn-sm" data-act="existing-all" data-mode="append">모두 뒤에 이어쓰기</button>
      <button class="btn btn-secondary btn-sm" data-act="existing-all" data-mode="overwrite">모두 덮어쓰기</button></div></div>` : '';
    return `${choose}<div class="callout"><div class="callout-who">선생님 확인</div>
      <div class="callout-what">나이스 표에서 입력된 글을 확인하세요. '직접 확인'과 '선택 필요' 학생은 자동으로 넣지 않았습니다.</div></div>
      <button class="btn btn-primary btn-block" data-act="confirm" ${n ? '' : 'disabled'}>확인 완료 · 저장 (${n}명)</button>
      <button class="btn btn-danger-outline btn-block" data-act="stop">멈추기</button>`;
  }
  if (S.phase === 'confirm') {
    const rows = enteredItems().map((it) => { const m = S.results[it.id].mode; return `<li>${it.no}번 ${esc(it.name)} (${neisBytes(enteredText(it))}바이트${m === 'append' ? ', 이어씀' : m === 'overwrite' ? ', 덮어씀' : ''})</li>`; }).join('');
    return `<div class="callout"><div class="callout-who">저장 목록 ${enteredItems().length}명</div><ul class="warn-list small">${rows}</ul>
      <div class="callout-what">이 학생들의 글만 나이스에 저장합니다. 마감·확정은 누르지 않습니다.</div></div>
      <button class="btn btn-primary btn-block" data-act="save">이대로 저장</button>
      <button class="btn btn-secondary btn-block" data-act="back">뒤로</button>`;
  }
  if (S.phase === 'saving') return '<div class="sgb-progress">나이스에 저장하는 중입니다. 나이스 화면을 건드리지 마세요.</div>';
  const reason = blockReason(list);
  return `${reason ? `<div class="hint">${esc(reason)}</div>` : ''}
    <button class="btn btn-primary btn-block" data-act="start" ${reason ? 'disabled' : ''}>입력 시작</button>`;
}
function toolsCard() {
  const drive = hasClientId()
    ? `<div class="small">구글 연결용 리디렉션 URI (구글 클라우드 콘솔에 한 번 등록)</div><input class="input" readonly value="${esc(redirectUrl())}">
       ${S.drive.connected ? '<button class="btn btn-ghost btn-sm" data-act="disconnect">구글 연결 끊기</button>' : ''}` : '';
  const survey = S.det && S.det.cpr
    ? `<button class="btn btn-secondary btn-sm" data-act="survey">화면 구조 기록 (읽기 전용)</button>
       ${S.survey ? `<div class="small">아래 내용을 복사해 분석 문서에 붙이세요. 학생 정보 값은 들어 있지 않습니다.</div><textarea class="textarea sgb-survey" readonly>${esc(S.survey)}</textarea>` : ''}
       <button class="btn btn-secondary btn-sm" data-act="values">값 읽기 (읽기 전용)</button>
       ${S.values ? `<div class="small">조회 조건 값, 마감 표시, 나이스 안내 메시지, 본문 길이 비교가 들어 있습니다. 학생 이름·번호·본문 글자는 들어 있지 않습니다. 나이스에서 조회를 마친 화면에서 누르세요.</div><textarea class="textarea sgb-values" readonly>${esc(S.values)}</textarea>` : ''}` : '';
  const logs = S.logs.slice(-80).map((l) => `<li class="is-${l.level}">${esc(timeStr(l.at))} ${esc(l.msg)}</li>`).join('');
  return `<details class="log"><summary>도구와 작업 기록</summary><div class="stack-sm">${survey}${drive}
    <ul class="log-lines">${logs || '<li>기록 없음</li>'}</ul></div></details>`;
}
function render() {
  if (!root) return;
  const list = S.data && S.det && S.det.cond ? itemsFor(S.data.items, (S.run && S.run.cond) || S.det.cond) : [];
  const open = root.querySelector('details.log') && root.querySelector('details.log').open;
  root.innerHTML = `${noticeHtml(S.notice)}${screenCard()}${dataCard()}${studentsCard(list)}<section class="stack-sm">${actions(list)}</section>${toolsCard()}`;
  if (open) root.querySelector('details.log').open = true;
}

async function onClick(ev) {
  const b = ev.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  if (act === 'start') startFill();
  else if (act === 'stop') stop();
  else if (act === 'confirm') { S.phase = 'confirm'; render(); }
  else if (act === 'back') { S.phase = 'review'; render(); }
  else if (act === 'save') saveNow();
  else if (act === 'file') document.getElementById('sgbFile').click();
  else if (act === 'drive') pullDrive(true);
  else if (act === 'clear') clearAll();
  else if (act === 'survey') doSurvey();
  else if (act === 'values') doSurveyValues();
  else if (act === 'existing') applyExisting(b.dataset.mode, [b.dataset.id]);
  else if (act === 'existing-all') applyExisting(b.dataset.mode, null);
  else if (act === 'disconnect') { await forgetToken(); S.drive = { connected: false }; await saveKey(K.drive, S.drive); render(); }
}

export async function mount(el) {
  root = el;
  root.addEventListener('click', onClick);
  document.getElementById('sgbFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
  await loadState();
  render();
  await detect();
  chrome.tabs.onActivated.addListener(() => detect());
  chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') detect(); });
  setInterval(detect, 2000); // 나이스 조회 조건은 페이지 이동 없이 바뀌므로 대기 중에만 가볍게 확인
}

const el = document.getElementById('sgb-root');
if (el) mount(el);
