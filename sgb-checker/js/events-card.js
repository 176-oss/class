// 시작 화면의 '우리 학교 행사 목록' (자율·진로 점검용). 날짜는 어떤 꼴로 넣어도 기재요령 꼴(2026.03.04., 기간 2026.03.04.-2026.03.06.)로 바꿔 보여 준다.
import { h, clear } from './dom.js';
import { S, settings, saveSettings, recheck, schoolYear } from './state.js';
import { parseEventList, eventLabel } from '../rules/events.js';
import { EXTENSIONS, LIMITS } from './sheet.js';
import { announce, confirmBox } from './ui.js';

let draft = null; // 고치는 중인 글 (null 이면 저장된 목록)
let note = null; // { kind, text }

export function eventCard({ render }) {
  if (draft === null) draft = settings.events.map((e) => `${e.name}\t${e.date}`).join('\n');
  const preview = h('div', { class: 'stack', 'aria-live': 'polite' });
  const paint = () => {
    const r = parseEventList(draft, schoolYear());
    clear(preview,
      r.events.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('caption', { class: 'sr-only' }, '읽은 행사 미리 보기'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, '행사명'), h('th', { scope: 'col' }, '날짜 (기재요령 꼴로 바꿈)'))),
        h('tbody', null, r.events.map((e) => h('tr', null, h('td', null, e.name), h('td', { class: 'num' }, e.date)))))) : null,
      r.errors.length ? h('div', { class: 'alert alert-warn' }, h('p', null, `읽지 못한 줄 ${r.errors.length}개`), h('ul', null, r.errors.slice(0, 8).map((x) => h('li', null, x)))) : null,
      draft.trim() && !r.events.length && !r.errors.length ? h('p', { class: 'muted' }, '읽은 행사가 없습니다.') : null);
    return r;
  };
  const save = (r, how) => {
    if (!r.events.length) { note = { kind: 'error', text: '읽은 행사가 없습니다. 한 줄에 행사명과 날짜를 적어 주세요.' }; render(); return; }
    settings.events = r.events;
    saveSettings();
    if (S.items.length) recheck();
    draft = r.events.map((e) => `${e.name}\t${e.date}`).join('\n');
    note = { kind: r.errors.length ? 'warn' : 'ok', text: `${how} 행사 ${r.events.length}개를 저장했습니다. 날짜는 기재요령 꼴로 바꿨습니다.${r.errors.length ? ` 읽지 못한 줄 ${r.errors.length}개는 뺐습니다.` : ''}` };
    render();
    announce(`행사 ${r.events.length}개를 저장했습니다.`);
  };
  const onFile = async (input) => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const ext = f.name.toLowerCase().split('.').pop();
    if (!EXTENSIONS.includes(ext) || f.size > LIMITS.bytes) { note = { kind: 'error', text: '5MB 이하의 엑셀(.xlsx, .xls) 또는 .csv 파일만 열 수 있습니다.' }; render(); return; }
    try {
      const X = window.XLSX;
      const buf = new Uint8Array(await f.arrayBuffer());
      const wb = ext === 'csv' ? X.read(new TextDecoder().decode(buf), { type: 'string', sheetRows: 1000 }) : X.read(buf, { type: 'array', sheetRows: 1000, cellFormula: false, cellHTML: false });
      const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '', blankrows: false });
      save(parseEventList(rows, schoolYear()), '파일에서');
    } catch { note = { kind: 'error', text: '파일을 읽지 못했습니다. 엑셀에서 다시 저장한 뒤 올려 주세요.' }; render(); }
  };
  const fileIn = h('input', { type: 'file', id: 'event-file', accept: '.xlsx,.xls,.csv', hidden: true, 'aria-label': '행사 목록 파일', onchange: (e) => onFile(e.target) });
  const area = h('textarea', {
    id: 'event-list', rows: 5, value: draft,
    placeholder: '학생자치회 임원 선거\t3/15\n체육대회 2026.5.14~15\n진로의 날(26.6.3 수)',
    oninput: (e) => { draft = e.target.value; paint(); },
  });
  const card = h('details', { class: 'card stack', open: !settings.events.length || null },
    h('summary', null, `3. 우리 학교 행사 목록 (자율·진로 점검용, 선택) · 저장된 행사 ${settings.events.length}개`),
    h('p', { class: 'muted' }, '한 줄에 행사 하나: 행사명과 날짜(또는 기간). 날짜는 3/15, 2026-5-14, 5월 14일, 26.6.3(수), 5.14~15처럼 섞여 있어도 2026.03.15., 2026.05.14.-2026.05.15. 꼴로 저절로 바꿉니다. 자율·진로 글의 행사명(날짜)가 이 목록과 같은지 봅니다.'),
    note ? h('div', { class: `alert ${note.kind === 'error' ? 'alert-danger' : note.kind === 'warn' ? 'alert-warn' : ''}`, role: 'status' }, note.text) : null,
    h('label', { for: 'event-list' }, '행사 목록 붙여넣기 (엑셀에서 행사명·날짜 두 열을 복사해도 됩니다)'),
    area,
    preview,
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => save(parseEventList(draft, schoolYear()), '붙여넣은') }, '행사 목록 저장'),
      h('button', { type: 'button', class: 'btn', onclick: () => fileIn.click() }, '엑셀·CSV 파일 올리기'), fileIn,
      settings.events.length ? h('button', { type: 'button', class: 'btn', onclick: async () => {
        if (!(await confirmBox('행사 목록 지우기', '이 브라우저에 저장한 행사 목록을 지웁니다.', '지우기'))) return;
        settings.events = []; saveSettings(); if (S.items.length) recheck(); draft = ''; note = null; render(); announce('행사 목록을 지웠습니다.');
      } }, '목록 지우기') : null),
    settings.events.length ? h('p', { class: 'muted' }, `저장된 행사: ${settings.events.slice(0, 5).map(eventLabel).join(', ')}${settings.events.length > 5 ? ` 외 ${settings.events.length - 5}개` : ''}`) : h('p', { class: 'muted' }, '저장된 행사가 없으면 행사 점검은 하지 않습니다.'));
  paint();
  return card;
}
