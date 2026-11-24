// 생기부 점검기 화면: 시작, 결과 목록, 보고서. 상세는 detail.js, 설정은 settings.js.
import { h, clear, labelTableCells } from './dom.js';
import { S, recheck, loadGroups, statusOf, activeIssues, issuesOf, areaLabel, STATUS_LABEL, LEVEL_LABEL, settings, saveSettings, keys } from './state.js';
import { readWorkbook, parseSheets, parseTsv, SheetError } from './sheet.js';
import { buildReport, reportFile } from './report.js';
import { areasFor, areaById } from '../rules/areas.js';
import { takeHandoff } from '../shared/handoff.js';
import { takeBatch, BATCH_KEY } from '../shared/handoff-batch.js';
import { announce, ask, confirmBox, download, badge, enableDrop } from './ui.js';
import { renderDetail } from './detail.js';
import { eventCard } from './events-card.js';
import { setupDialog } from './setup.js';
import { renderSettings } from './settings.js';

const main = document.getElementById('main');
// 화면이 표를 새로 그릴 때마다 칸 이름을 붙인다 (휴대폰 폭 카드 보기)
new MutationObserver(() => { for (const t of main.querySelectorAll('.table-wrap > table')) labelTableCells(t); }).observe(main, { childList: true, subtree: true });
const XLSX = () => window.XLSX;
let pending = null; // 읽었지만 아직 점검하지 않은 묶음 { groups, problems }
let pasteText = '';
let pasteMeta = null; // 작성 도우미에서 넘어온 글의 { studentId, area, subject }

// 학생 상세는 결과 표 오른쪽 패널로 연다 (view 'detail' 은 결과 + 패널)
export function go(view, opts = {}) {
  if (opts.index != null) S.current = opts.index;
  if (view === 'detail') { S.view = 'results'; S.panel = true; } else { S.view = view; if (view === 'results') S.panel = false; }
  render();
  if (view !== 'detail') { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
}

export function render() {
  for (const t of document.querySelectorAll('.tab')) {
    const on = t.dataset.view === S.view;
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  }
  if (S.view === 'results' || S.view === 'detail') clear(main, resultsView());
  else if (S.view === 'settings') clear(main, renderSettings({ render }));
  else { S.view = 'start'; clear(main, startView()); }
}

function notice() {
  if (!S.notice) return null;
  const n = S.notice;
  return h('div', { class: `alert ${n.kind === 'error' ? 'alert-danger' : n.kind === 'warn' ? 'alert-warn' : ''}`, role: n.kind === 'error' ? 'alert' : 'status' }, n.text);
}

// ---------- 시작 ----------
function startView() {
  const paste = h('textarea', { id: 'paste', 'aria-describedby': 'paste-help', value: pasteText, oninput: (e) => { pasteText = e.target.value; } });
  const file = h('input', { type: 'file', id: 'file', accept: '.xlsx,.xls,.csv', multiple: true, onchange: (e) => onFiles(Array.from(e.target.files || []), e.target) });
  const fileField = h('div', { class: 'field' }, h('label', { for: 'file' }, '엑셀 올리기 (여러 파일을 한꺼번에 고르거나 끌어다 놓기, 파일마다 5MB까지)'), file,
    h('span', { class: 'muted' }, '나이스에서 내려받은 엑셀을 그대로 올리면 됩니다. 항목(자율, 동아리, 진로, 행특, 세특)은 시트 이름과 머리글을 보고 저절로 정합니다.'));
  enableDrop(fileField, (fs) => onFiles(fs, null), { accept: ['.xlsx', '.xls', '.csv'], multiple: true, onReject: () => { S.notice = { kind: 'error', text: '엑셀(.xlsx, .xls) 또는 CSV 파일을 놓아 주세요.' }; render(); } });

  return h('div', null,
    h('h2', '생기부 점검'),
    h('p', { class: 'muted' }, '올린 엑셀과 글은 이 페이지 안에서만 다루고 저장하지 않습니다. 페이지를 닫으면 사라집니다.'),
    notice(),
    h('section', { class: 'card stack', 'aria-labelledby': 's2' },
      h('h3', { id: 's2' }, '1. 점검 기준'),
      h('p', { class: 'muted' }, `${S.school === 'high' ? '고등학교' : '중학교'} 기준으로 점검합니다. `, h('button', { type: 'button', class: 'btn', onclick: () => go('settings') }, '설정에서 학교급 바꾸기')),
      aiChoice()),
    h('section', { class: 'card stack', 'aria-labelledby': 's3' },
      h('h3', { id: 's3' }, '2. 글 넣기'),
      fileField,
      pending ? pendingView() : null,
      h('div', { class: 'field' }, h('label', { for: 'paste' }, '또는 붙여넣기'),
        h('span', { id: 'paste-help', class: 'muted' }, '학생 한 명의 글을 붙여넣거나, 엑셀에서 머리글(학번, 이름, 내용)까지 표째로 복사해 붙여넣으세요. 항목을 알 수 없으면 점검 전에 고르게 합니다.'), paste),
      h('div', null, h('button', { type: 'button', class: 'btn btn-primary', onclick: onPaste }, '점검하기'))),
    eventCard({ render }),
  );
}

// AI 점검 쓰기 (맞춤법, 영역 적합성, 나열식, 수정 문구). 키와 모델은 설정에서
function aiChoice() {
  const noKey = !keys.read() && !settings.fakeAi;
  return h('div', { class: 'stack' },
    h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'ai-on', checked: settings.aiOn, onchange: (e) => {
      settings.aiOn = e.target.checked; saveSettings(); render(); announce(settings.aiOn ? 'AI 점검을 켰습니다.' : 'AI 점검을 껐습니다.');
      document.getElementById('ai-on')?.focus();
    } }), 'AI 점검도 쓰기 (맞춤법, 영역 적합성, 나열식)'),
    settings.aiOn ? h('p', { class: 'alert alert-warn' }, '학교 개인정보 지침을 확인한 뒤 쓰세요. 학번과 이름은 보내지 않고, 글 안의 명단 이름은 \'학생\'으로 가려서 보냅니다. 결과의 학생 상세에서 [AI로 점검]을 누르면 봅니다.') : null,
    settings.aiOn && noKey ? h('p', null, 'API 키가 없습니다. ', h('button', { type: 'button', class: 'btn', onclick: () => go('settings') }, '설정에서 키 넣기')) : null);
}

const MAX_FILES = 20;
async function onFiles(files, input) {
  if (input) input.value = '';
  files = files.filter(Boolean);
  if (!files.length) return;
  S.notice = null;
  const groups = [];
  const problems = [];
  if (files.length > MAX_FILES) problems.push(`파일은 한 번에 ${MAX_FILES}개까지 읽습니다. 나머지 ${files.length - MAX_FILES}개는 다시 올려 주세요.`);
  for (const f of files.slice(0, MAX_FILES)) {
    const tag = files.length > 1 ? `${f.name} · ` : '';
    try {
      const buffer = f.size <= 5 * 1024 * 1024 ? await f.arrayBuffer() : new ArrayBuffer(0);
      const r = readWorkbook(XLSX(), { name: f.name, size: f.size, buffer });
      for (const g of r.groups) groups.push({ ...g, sheetName: `${tag}${g.sheetName}` });
      for (const p of r.problems) problems.push(`${tag}${p}`);
      if (!r.groups.length && !r.problems.length) problems.push(`${f.name}: 읽을 수 있는 시트가 없습니다.`);
    } catch (e) {
      problems.push(`${f.name}: ${e instanceof SheetError ? e.message : '파일을 읽지 못했습니다.'}`);
    }
  }
  if (!groups.length) {
    pending = null;
    S.notice = { kind: 'error', text: problems.join(' ') || '읽을 수 있는 시트가 없습니다.' };
    render();
    announce(S.notice.text);
    return;
  }
  readyOrAsk(groups, problems, `파일 ${Math.min(files.length, MAX_FILES)}개`);
}

/** 항목을 모두 알면 바로 점검하고, 모르는 시트가 있으면 그것만 고르게 한다 */
function readyOrAsk(groups, problems, what) {
  if (groups.every((g) => g.area && areaById(g.area)?.chars[S.school])) {
    startCheck(groups);
    const n = groups.reduce((a, g) => a + g.rows.length, 0);
    S.notice = { kind: problems.length ? 'warn' : 'info', text: `${what}에서 시트 ${groups.length}개, ${n}명의 글을 읽어 점검했습니다. 항목은 시트 이름과 머리글로 정했습니다.${problems.length ? ` 읽지 못한 것: ${problems.join(' ')}` : ''}` };
    render();
    return;
  }
  pending = { groups, problems };
  render();
  announce('항목을 알 수 없는 시트가 있습니다. 항목을 골라 점검을 시작하세요.');
}

function pendingView() {
  return h('div', { class: 'alert stack', role: 'group', 'aria-label': '읽은 시트' },
    h('p', null, h('b', '항목을 골라 주세요'), ' 시트 이름과 머리글로 항목을 알 수 없는 것이 있습니다.'),
    pending.problems.map((p) => h('p', { class: 'muted' }, p)),
    h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['시트', '학생 수', '항목', '과목'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, pending.groups.map((g, i) => {
        return h('tr', null,
          h('th', { scope: 'row' }, g.sheetName),
          h('td', { class: 'num' }, g.rows.length),
          h('td', null, h('select', { 'aria-label': `${g.sheetName} 항목`, value: g.area || '', onchange: (e) => { g.area = e.target.value || null; render(); } },
            h('option', { value: '' }, '골라 주세요'), areasFor(S.school).map((a) => h('option', { value: a.id }, a.label)))),
          h('td', null, g.area === 'subject'
            ? h('input', { type: 'text', 'aria-label': `${g.sheetName} 과목`, maxlength: 40, value: g.subject, oninput: (e) => { g.subject = e.target.value.trim(); } })
            : h('span', { class: 'muted' }, '-')));
      })))),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => startCheck(pending.groups) }, '점검 시작'),
      h('button', { type: 'button', class: 'btn', onclick: () => { pending = null; render(); } }, '취소')));
}

function onPaste() {
  const text = pasteText.replace(/\r\n?/g, '\n');
  if (!text.trim()) { S.notice = { kind: 'error', text: '붙여넣은 글이 없습니다.' }; render(); return; }
  const area = pasteMeta?.area && areaById(pasteMeta.area) ? pasteMeta.area : '';
  const subject = pasteMeta?.subject || '';
  let groups;
  if (text.includes('\t')) {
    const r = parseSheets([{ name: '붙여넣기', rows: parseTsv(text) }]);
    if (!r.groups.length) { S.notice = { kind: 'error', text: '표에서 머리글(학번, 이름, 내용)을 찾지 못했습니다. 머리글 줄까지 복사해 주세요.' }; render(); return; }
    groups = r.groups;
  } else {
    groups = [{ sheetName: '붙여넣기', area: null, subject, rows: [{ studentId: pasteMeta?.studentId || '', name: '', subject, text: text.trim().slice(0, 5000), tooLong: text.trim().length > 5000 }] }];
  }
  for (const g of groups) { if (!g.area) g.area = area || null; if (!g.subject) g.subject = subject; }
  readyOrAsk(groups, [], '붙여넣은 글');
}

function startCheck(groups) {
  if (groups.some((g) => !g.area || !areaById(g.area)?.chars[S.school])) { S.notice = { kind: 'error', text: '모든 시트의 항목을 골라 주세요.' }; render(); return; }
  loadGroups(groups);
  pending = null;
  S.notice = null;
  announce(`${S.items.length}명의 글을 점검했습니다.`);
  go('results');
}

// ---------- 결과 ----------
const FILTERS = [
  ['all', '전체'], ['error', '오류만'], ['warn', '확인 필요만'], ['pass', '통과만'], ['bytes', '바이트 초과만'], ['forbidden', '금지 내용만'], ['empty', '미작성'],
];
function passes(it, f) {
  const st = statusOf(it);
  if (f === 'all') return true;
  if (f === 'error' || f === 'warn' || f === 'pass' || f === 'empty') return st === f;
  const act = activeIssues(it);
  if (f === 'bytes') return act.some((i) => i.ruleId === 'bytes-over' || i.ruleId === 'common-sum');
  if (f === 'forbidden') return act.some((i) => i.ruleId.startsWith('forbidden-'));
  return true;
}

const keyOf = (it) => `${it.area}|${it.subject || ''}`;

function resultsView() {
  if (!S.items.length) {
    return h('div', null, h('h2', '결과'), h('div', { class: 'card' }, h('p', '아직 점검한 글이 없습니다.'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go('start') }, '시작 화면으로')));
  }
  const labels = new Map();
  for (const it of S.items) for (const i of activeIssues(it)) labels.set(i.label, (labels.get(i.label) || 0) + 1);
  const top = [...labels].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const groups = new Map(S.items.map((it) => [keyOf(it), areaLabel(it) + (it.subject ? ` (${it.subject})` : '')]));
  if (S.areaKey !== 'all' && !groups.has(S.areaKey)) S.areaKey = 'all';
  const rows = S.items.map((it, idx) => ({ it, idx })).filter(({ it }) => passes(it, S.filter) && (S.areaKey === 'all' || keyOf(it) === S.areaKey));
  const filterSel = h('select', { id: 'res-filter', value: S.filter, onchange: (e) => { S.filter = e.target.value; render(); announce(`${S.items.filter((x) => passes(x, S.filter)).length}명`); } },
    FILTERS.map(([v, l]) => h('option', { value: v }, `${l} (${S.items.filter((x) => passes(x, v)).length}명)`)));
  filterSel.value = S.filter;

  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'results-table' },
    h('caption', { class: 'sr-only' }, '학생별 점검 결과 (명렬순)'),
    h('colgroup', null, ...(S.panel ? ['64px', '76px', 'auto', '64px', '68px'] : ['64px', '76px', 'auto', '80px', '64px', '200px', '68px']).map((w) => h('col', { style: { width: w } }))),
    h('thead', null, h('tr', null, (S.panel ? ['학번', '이름', '글', '상태', ''] : ['학번', '이름', '글', '바이트', '상태', '지적', '']).map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', null, rows.length ? rows.map(({ it, idx }) => {
      const st = statusOf(it);
      const r = S.results.get(it.key);
      const act = activeIssues(it);
      const ne = act.filter((i) => i.level === 'error').length;
      const uniq = [...new Set(act.map((i) => i.label))];
      const open = h('td', null, h('button', { type: 'button', class: 'btn btn-sm', 'aria-pressed': String(S.panel && S.current === idx), onclick: () => go('detail', { index: idx }), 'aria-label': `${it.name || it.studentId || '학생'} 상세 보기` }, '보기'));
      const cells = [
        h('td', { class: 'num' }, it.studentId || '-'),
        h('th', { scope: 'row' }, it.name || '(이름 없음)'),
        h('td', null, h('div', { class: 'cell-text' }, it.current.trim() ? it.current : '(미작성)')),
        S.panel ? null : h('td', { class: 'num' }, `${r?.bytes ?? 0}/${r?.limit || '-'}`),
        h('td', null, badge(st, STATUS_LABEL[st])),
        S.panel ? null : h('td', null, act.length ? h('div', null, h('span', { class: 'num' }, `${LEVEL_LABEL.error} ${ne}, ${LEVEL_LABEL.warn} ${act.length - ne}`), h('ul', { class: 'cell-issues' }, uniq.slice(0, 3).map((l) => h('li', l)), uniq.length > 3 ? h('li', { class: 'muted' }, `외 ${uniq.length - 3}건`) : null)) : '-'),
        open,
      ];
      return h('tr', { class: S.panel && S.current === idx ? 'is-selected' : '' }, cells);
    }) : h('tr', null, h('td', { colspan: S.panel ? 5 : 7 }, '조건에 맞는 학생이 없습니다.')))));

  const panel = S.panel && S.items[S.current] ? h('aside', { class: 'panel', 'aria-label': '학생 상세' }, renderDetail(S.items[S.current], { go, render })) : null;

  return h('div', null,
    h('div', { class: 'row' }, h('h2', `결과 (${S.items.length}명)`),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: downloadReport }, '보고서 내려받기')),
    notice(),
    top.length ? h('p', { class: 'muted' }, '많이 나온 지적: ', top.map(([l, n]) => `${l} ${n}건`).join(', ')) : null,
    h('div', { class: 'row' },
      groups.size > 1 ? h('div', { class: 'chips', role: 'group', 'aria-label': '보는 항목' },
        [['all', '전체'], ...groups].map(([k, l]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(S.areaKey === k), onclick: () => { S.areaKey = k; render(); } }, l))) : null,
      h('div', { class: 'field' }, h('label', { for: 'res-filter' }, '상태 거르기'), filterSel)),
    h('div', { class: `results-layout${panel ? ' has-panel' : ''}` }, table, panel));
}

async function downloadReport() {
  const ok = await ask({
    title: '보고서 내려받기',
    body: [h('p', '보고서에는 학생 이름과 글이 들어 있습니다. 교내에서만 주고받으세요.'), h('p', { class: 'muted' }, '요약, 학생별, 수정본 세 시트로 된 엑셀 파일입니다.')],
    buttons: [{ label: '취소', value: false }, { label: '내려받기', value: true, primary: true }],
  });
  if (!ok) return;
  const items = S.items.map((it) => {
    const r = S.results.get(it.key);
    const all = issuesOf(it);
    return {
      studentId: it.studentId, name: it.name, areaLabel: areaLabel(it), subject: it.subject,
      original: it.original, current: it.current, bytes: r?.bytes ?? 0, limit: r?.limit ?? 0, status: statusOf(it),
      issues: all.filter((i) => !i.off),
      excepted: all.filter((i) => i.off === 'except').map((i) => ({ issue: i, reason: it.excepted.get(i.key) })),
    };
  });
  const d = new Date();
  download(`생기부-점검-보고서-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.xlsx`, reportFile(XLSX(), buildReport(items)));
  announce('보고서를 내려받았습니다.');
}

// ---------- 작성 도우미에서 반 전체 받기 ----------
function receiveBatch() {
  let got = null;
  try { got = takeBatch(window.localStorage, 'textgenerator-v2'); } catch { return false; }
  if (!got) return false;
  if (got.school) S.school = got.school;
  const groups = got.groups.map((x) => ({
    sheetName: '작성 도우미', area: x.area, subject: x.subject,
    rows: x.items.map((i) => ({ studentId: i.studentId, name: i.name, subject: x.subject, text: i.text.slice(0, 5000), tooLong: i.text.length > 5000 })),
  }));
  startCheck(groups);
  if (!S.items.length) return true;
  const n = groups.reduce((a, x) => a + x.rows.length, 0);
  S.notice = { kind: 'info', text: `작성 도우미에서 ${n}명의 글을 받아 점검했습니다 (${S.school === 'high' ? '고등학교' : '중학교'} 기준). 학교급이 다르면 설정에서 바꾸세요.` };
  render();
  return true;
}
// 점검기가 이미 열려 있을 때 작성 도우미가 새 글을 보내면 (storage 이벤트) 지금 결과를 바꿀지 묻는다
window.addEventListener('storage', async (e) => {
  if (e.key !== BATCH_KEY || !e.newValue) return;
  if (S.items.length && !(await confirmBox('작성 도우미에서 새 글이 왔습니다', '지금 점검 중인 결과를 새로 받은 글의 점검 결과로 바꿉니다. 고친 내용은 사라집니다.', '새 글로 바꾸기'))) return;
  receiveBatch();
});

// ---------- 시작 ----------
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => go(t.dataset.view));
let gotBatch = false;
try { gotBatch = receiveBatch(); } catch { /* 넘어감 */ }
try {
  const got = gotBatch ? null : takeHandoff(window.localStorage);
  if (got) {
    pasteText = got.text;
    pasteMeta = { studentId: got.studentId, area: got.area, subject: got.subject };
    S.notice = { kind: 'info', text: `작성 도우미에서 보낸 글을 붙여넣기 칸에 넣었습니다${got.studentId ? ` (학번 ${got.studentId})` : ''}. 항목을 확인하고 [붙여넣은 글 점검하기]를 누르세요.` };
  }
} catch { /* 저장소를 못 쓰면 넘어감 */ }
if (!window.XLSX) S.notice = { kind: 'error', text: '엑셀 도구를 불러오지 못했습니다. 붙여넣기는 쓸 수 있습니다.' };
if (!gotBatch) render();
// 처음 들어올 때 API 키가 없으면 시작 준비 팝업 (작성 도우미와 같은 방식)
setTimeout(() => setupDialog({ render }), 0);
