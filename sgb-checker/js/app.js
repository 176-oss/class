// 생기부 점검기 화면: 시작, 결과 목록, 보고서. 상세는 detail.js, 설정은 settings.js.
import { h, clear } from './dom.js';
import { S, recheck, loadGroups, statusOf, activeIssues, issuesOf, areaLabel, STATUS_LABEL, LEVEL_LABEL } from './state.js';
import { readWorkbook, parseSheets, parseTsv, SheetError } from './sheet.js';
import { buildReport, reportFile, textSheet } from './report.js';
import { areasFor, areaById } from '../rules/areas.js';
import { takeHandoff } from '../shared/handoff.js';
import { announce, ask, download, badge } from './ui.js';
import { renderDetail } from './detail.js';
import { renderSettings } from './settings.js';

const main = document.getElementById('main');
const XLSX = () => window.XLSX;
let pending = null; // 읽었지만 아직 점검하지 않은 묶음 { groups, problems }
let pasteText = '';
let pasteMeta = null; // 작성 도우미에서 넘어온 글의 { studentId, area, subject }

export function go(view, opts = {}) {
  S.view = view;
  if (opts.index != null) S.current = opts.index;
  render();
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

export function render() {
  for (const t of document.querySelectorAll('.tab')) {
    const on = t.dataset.view === S.view || (t.dataset.view === 'results' && S.view === 'detail');
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  }
  if (S.view === 'results') clear(main, resultsView());
  else if (S.view === 'detail' && S.items[S.current]) clear(main, renderDetail(S.items[S.current], { go, render }));
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
  const schoolOpts = [['mid', '중학교'], ['high', '고등학교']];
  const areaSelect = h('select', { id: 'pick-area' },
    h('option', { value: '' }, '자동 (시트 이름으로)'),
    areasFor(S.school).map((a) => h('option', { value: a.id }, a.label)));
  if (pasteMeta?.area && areaById(pasteMeta.area)) areaSelect.value = pasteMeta.area;
  const subjectInput = h('input', { type: 'text', id: 'pick-subject', maxlength: 40, value: pasteMeta?.subject || '', placeholder: '세특일 때 과목 이름 (예: 공통국어1)' });
  const paste = h('textarea', { id: 'paste', 'aria-describedby': 'paste-help', value: pasteText, oninput: (e) => { pasteText = e.target.value; } });
  const file = h('input', { type: 'file', id: 'file', accept: '.xlsx,.xls,.csv', onchange: (e) => onFile(e.target.files?.[0], e.target) });

  return h('div', null,
    h('h2', '생기부 점검'),
    h('p', { class: 'muted' }, '올린 엑셀과 글은 이 페이지 안에서만 다루고 저장하지 않습니다. 페이지를 닫으면 사라집니다.'),
    notice(),
    h('section', { class: 'card stack', 'aria-labelledby': 's1' },
      h('h3', { id: 's1' }, '1. 학교급과 학년'),
      h('fieldset', null, h('legend', '학교급'),
        h('div', { class: 'row' }, schoolOpts.map(([v, l]) => h('label', { class: 'check' },
          h('input', { type: 'radio', name: 'school', value: v, checked: S.school === v, onchange: () => { S.school = v; if (S.items.length) recheck(); render(); } }), l)))),
      h('div', { class: 'field' }, h('label', { for: 'grade' }, '학년'),
        h('select', { id: 'grade', value: String(S.grade), onchange: (e) => { S.grade = Number(e.target.value); if (S.items.length) recheck(); } },
          [1, 2, 3].map((g) => h('option', { value: String(g) }, `${g}학년`))))),
    h('section', { class: 'card stack', 'aria-labelledby': 's2' },
      h('h3', { id: 's2' }, '2. 항목'),
      h('div', { class: 'field' }, h('label', { for: 'pick-area' }, '점검할 항목'), areaSelect,
        h('span', { class: 'muted' }, '엑셀 시트 이름이 자율, 동아리, 진로, 행특, 세특_국어처럼 되어 있으면 저절로 고릅니다.')),
      h('div', { class: 'field' }, h('label', { for: 'pick-subject' }, '과목 (세특)'), subjectInput)),
    h('section', { class: 'card stack', 'aria-labelledby': 's3' },
      h('h3', { id: 's3' }, '3. 글 넣기'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: downloadTemplate }, '양식 내려받기'),
        h('span', { class: 'muted' }, '학번 | 이름 | 과목 | 내용. 과목은 세특에서만 씁니다.')),
      h('div', { class: 'field' }, h('label', { for: 'file' }, '엑셀 올리기 (.xlsx, .xls, .csv, 5MB까지)'), file),
      pending ? pendingView() : null,
      h('div', { class: 'field' }, h('label', { for: 'paste' }, '또는 붙여넣기'),
        h('span', { id: 'paste-help', class: 'muted' }, '학생 한 명의 글을 붙여넣거나, 엑셀에서 머리글(학번, 이름, 내용)까지 표째로 복사해 붙여넣으세요.'), paste),
      h('div', null, h('button', { type: 'button', class: 'btn btn-primary', onclick: onPaste }, '붙여넣은 글 점검하기'))),
  );
}

async function onFile(f, input) {
  if (!f) return;
  S.notice = null;
  try {
    const buffer = f.size <= 5 * 1024 * 1024 ? await f.arrayBuffer() : new ArrayBuffer(0);
    pending = readWorkbook(XLSX(), { name: f.name, size: f.size, buffer });
    if (!pending.groups.length) { S.notice = { kind: 'error', text: pending.problems[0] || '읽을 수 있는 시트가 없습니다.' }; pending = null; }
  } catch (e) {
    pending = null;
    S.notice = { kind: 'error', text: e instanceof SheetError ? e.message : '파일을 읽지 못했습니다.' };
  }
  if (input) input.value = '';
  render();
  announce(S.notice ? S.notice.text : '파일을 읽었습니다. 시트와 항목을 확인한 뒤 점검을 시작하세요.');
}

function pendingView() {
  const pick = document.getElementById('pick-area')?.value || '';
  return h('div', { class: 'alert stack', role: 'group', 'aria-label': '읽은 시트' },
    h('p', null, h('b', '읽은 시트'), ' 항목이 맞는지 확인하세요.'),
    pending.problems.map((p) => h('p', { class: 'muted' }, p)),
    h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['시트', '학생 수', '항목', '과목'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, pending.groups.map((g, i) => {
        if (!g.area && pick) g.area = pick;
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
  const area = document.getElementById('pick-area').value;
  const subject = document.getElementById('pick-subject').value.trim();
  let groups;
  if (text.includes('\t')) {
    const r = parseSheets([{ name: '붙여넣기', rows: parseTsv(text) }]);
    if (!r.groups.length) { S.notice = { kind: 'error', text: '표에서 머리글(학번, 이름, 내용)을 찾지 못했습니다. 머리글 줄까지 복사해 주세요.' }; render(); return; }
    groups = r.groups;
  } else {
    groups = [{ sheetName: '붙여넣기', area: null, subject, rows: [{ studentId: pasteMeta?.studentId || '', name: '', subject, text: text.trim().slice(0, 5000), tooLong: text.trim().length > 5000 }] }];
  }
  for (const g of groups) { if (!g.area) g.area = area || null; if (!g.subject) g.subject = subject; }
  if (groups.some((g) => !g.area)) { S.notice = { kind: 'error', text: '점검할 항목을 골라 주세요.' }; render(); document.getElementById('pick-area')?.focus(); return; }
  startCheck(groups);
}

function startCheck(groups) {
  if (groups.some((g) => !g.area || !areaById(g.area)?.chars[S.school])) { S.notice = { kind: 'error', text: '모든 시트의 항목을 골라 주세요. (자유학기 항목은 중학교만)' }; render(); return; }
  loadGroups(groups);
  pending = null;
  S.notice = null;
  announce(`${S.items.length}명의 글을 점검했습니다.`);
  go('results');
}

function downloadTemplate() {
  const rows = [['학번', '이름', '과목', '내용'], ['10101', '가상학생', '', '(예시) 학급 회의에서 의견을 정리하여 발표함.']];
  const X = XLSX();
  const wb = X.utils.book_new();
  for (const n of ['자율', '동아리', '진로', '세특_국어', '행특']) X.utils.book_append_sheet(wb, textSheet(X, rows), n);
  download('생기부-점검-양식.xlsx', X.write(wb, { type: 'array', bookType: 'xlsx' }));
}

// ---------- 결과 ----------
const FILTERS = [
  ['all', '전체'], ['error', '오류만'], ['warn', '확인만'], ['bytes', '바이트 초과만'], ['forbidden', '금지 내용만'], ['empty', '미작성'],
];
function passes(it, f) {
  const st = statusOf(it);
  if (f === 'all') return true;
  if (f === 'error' || f === 'warn' || f === 'empty') return st === f;
  const act = activeIssues(it);
  if (f === 'bytes') return act.some((i) => i.ruleId === 'bytes-over' || i.ruleId === 'common-sum');
  if (f === 'forbidden') return act.some((i) => i.ruleId.startsWith('forbidden-'));
  return true;
}

function resultsView() {
  if (!S.items.length) {
    return h('div', null, h('h2', '결과'), h('div', { class: 'card' }, h('p', '아직 점검한 글이 없습니다.'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go('start') }, '시작 화면으로')));
  }
  const counts = { pass: 0, warn: 0, error: 0, empty: 0 };
  const labels = new Map();
  for (const it of S.items) {
    counts[statusOf(it)]++;
    for (const i of activeIssues(it)) labels.set(i.label, (labels.get(i.label) || 0) + 1);
  }
  const top = [...labels].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const rows = S.items.map((it, idx) => ({ it, idx })).filter(({ it }) => passes(it, S.filter));
  return h('div', null,
    h('div', { class: 'row' }, h('h2', '결과'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: downloadReport }, '보고서 내려받기')),
    h('section', { class: 'card', 'aria-labelledby': 'sum' },
      h('h3', { id: 'sum' }, `반 전체 요약 (${S.items.length}명)`),
      h('div', { class: 'stats' }, ['error', 'warn', 'pass', 'empty'].map((k) => h('div', { class: 'stat' }, h('b', counts[k]), badge(k === 'empty' ? 'empty' : k, STATUS_LABEL[k])))),
      top.length ? h('div', null, h('p', { class: 'muted' }, '많이 나온 지적'), h('ol', null, top.map(([l, n]) => h('li', null, `${l} `, h('span', { class: 'num' }, `${n}건`))))) : null),
    h('fieldset', { class: 'card' }, h('legend', '보기'),
      h('div', { class: 'row' }, FILTERS.map(([v, l]) => h('label', { class: 'check' },
        h('input', { type: 'radio', name: 'filter', value: v, checked: S.filter === v, onchange: () => { S.filter = v; render(); announce(`${l}: ${S.items.filter((x) => passes(x, v)).length}명`); } }), l)))),
    h('div', { class: 'table-wrap' }, h('table', null,
      h('caption', { class: 'sr-only' }, '학생별 점검 결과'),
      h('thead', null, h('tr', null, ['학번', '이름', '항목(과목)', '바이트', '상태', '지적', ''].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, rows.length ? rows.map(({ it, idx }) => {
        const st = statusOf(it);
        const r = S.results.get(it.key);
        const act = activeIssues(it);
        const ne = act.filter((i) => i.level === 'error').length;
        return h('tr', null,
          h('td', { class: 'num' }, it.studentId || '-'),
          h('th', { scope: 'row' }, it.name || '(이름 없음)'),
          h('td', null, areaLabel(it) + (it.subject ? ` (${it.subject})` : '')),
          h('td', { class: 'num' }, `${r?.bytes ?? 0}/${r?.limit || '-'}`),
          h('td', null, badge(st, STATUS_LABEL[st])),
          h('td', { class: 'num' }, act.length ? `${LEVEL_LABEL.error} ${ne}, ${LEVEL_LABEL.warn} ${act.length - ne}` : '-'),
          h('td', null, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => go('detail', { index: idx }), 'aria-label': `${it.name || it.studentId || '학생'} 상세 보기` }, '보기')));
      }) : h('tr', null, h('td', { colspan: 7 }, '조건에 맞는 학생이 없습니다.'))))));
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

// ---------- 시작 ----------
for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => go(t.dataset.view));
try {
  const got = takeHandoff(window.localStorage);
  if (got) {
    pasteText = got.text;
    pasteMeta = { studentId: got.studentId, area: got.area, subject: got.subject };
    S.notice = { kind: 'info', text: `작성 도우미에서 보낸 글을 붙여넣기 칸에 넣었습니다${got.studentId ? ` (학번 ${got.studentId})` : ''}. 항목을 확인하고 [붙여넣은 글 점검하기]를 누르세요.` };
  }
} catch { /* 저장소를 못 쓰면 넘어감 */ }
if (!window.XLSX) S.notice = { kind: 'error', text: '엑셀 도구를 불러오지 못했습니다. 붙여넣기는 쓸 수 있습니다.' };
render();
