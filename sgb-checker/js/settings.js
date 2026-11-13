// 설정: 학교급 기본값, 영역별 한도, 학교 이름·별칭·축제명, 금지 목록 보기, AI 사용·키·모델.
import { h } from './dom.js';
import { S, settings, saveSettings, keys, recheck, schoolYear } from './state.js';
import { parseEventList, eventLabel } from '../rules/events.js';
import { EXTENSIONS, LIMITS } from './sheet.js';
import { areasFor } from '../rules/areas.js';
import { FORBIDDEN } from '../rules/check.js';
import { maskKey } from '../shared/key-store.js';
import { validModel, DEFAULT_MODELS } from './ai.js';
import { announce, confirmBox } from './ui.js';

let keyFormOpen = false;
let keyNote = '';
let eventNote = null; // { kind, text, errors }

export function renderSettings({ render }) {
  const save = (msg) => { saveSettings(); if (S.items.length) recheck(); render(); if (msg) announce(msg); };
  const school = S.school;
  return h('div', null,
    h('h2', '설정'),
    h('p', { class: 'muted' }, '설정은 이 브라우저에만 저장됩니다. 학생 글은 저장하지 않습니다.'),

    h('section', { class: 'card stack', 'aria-labelledby': 'st-school' },
      h('h3', { id: 'st-school' }, '학교급 기본값'),
      h('div', { class: 'row' }, [['mid', '중학교'], ['high', '고등학교']].map(([v, l]) => h('label', { class: 'check' },
        h('input', { type: 'radio', name: 'def-school', value: v, checked: settings.school === v, onchange: () => { settings.school = v; if (!S.items.length) S.school = v; save('학교급 기본값을 바꿨습니다.'); } }), l)))),

    h('section', { class: 'card stack', 'aria-labelledby': 'st-limit' },
      h('h3', { id: 'st-limit' }, `영역별 한도 (${school === 'high' ? '고등학교' : '중학교'}, 글자 수)`),
      h('p', { class: 'alert alert-warn' }, '기본값은 2026 기재요령(중 162쪽, 고 208쪽)입니다. 바꾸기 전에 학교 기준을 확인하세요. 1글자 = 3바이트로 계산합니다.'),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, '항목'), h('th', { scope: 'col' }, '기본'), h('th', { scope: 'col' }, '바꾼 값 (비우면 기본)'))),
        h('tbody', null, areasFor(school).map((a) => h('tr', null,
          h('th', { scope: 'row' }, a.label),
          h('td', { class: 'num' }, `${a.chars[school]}자`),
          h('td', null, h('input', {
            type: 'number', min: 1, max: 5000, 'aria-label': `${a.label} 한도`, value: settings.limits[a.id] ? String(settings.limits[a.id]) : '',
            onchange: (e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n > 0 && n <= 5000) settings.limits[a.id] = n; else delete settings.limits[a.id]; save('한도를 바꿨습니다.'); },
          })))))))),

    h('section', { class: 'card stack', 'aria-labelledby': 'st-words' },
      h('h3', { id: 'st-words' }, '우리 학교 이름·별칭·축제명 (고등학교 점검용)'),
      h('p', { class: 'muted' }, '한 줄에 하나씩. 고등학교는 학교를 알 수 있는 내용을 쓸 수 없어서(고 19쪽) 이 말이 글에 있으면 잡습니다.'),
      h('label', { for: 'school-words', class: 'sr-only' }, '학교 이름·별칭·축제명'),
      h('textarea', { id: 'school-words', value: settings.schoolWords.join('\n'), onchange: (e) => { settings.schoolWords = e.target.value.split('\n').map((s) => s.trim()).filter((s) => s.length >= 2).slice(0, 30); save('학교 이름 목록을 저장했습니다.'); } })),

    eventSection(save),

    h('section', { class: 'card stack', 'aria-labelledby': 'st-list' },
      h('h3', { id: 'st-list' }, '금지 목록 보기'),
      h('details', null, h('summary', `${school === 'high' ? '고등학교' : '중학교'} 금지 목록 (${FORBIDDEN.filter((e) => e.schools.includes(school)).length}개)`),
        h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, ['분류', '이름', '등급', '찾는 말', '근거', '설명'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', null, FORBIDDEN.filter((e) => e.schools.includes(school)).map((e) => h('tr', null,
            h('td', null, e.cat), h('th', { scope: 'row' }, e.label), h('td', null, e.level === 'error' ? '오류' : '확인'),
            h('td', null, [...(e.terms || []), ...(e.patterns?.length ? ['(정해진 꼴)'] : [])].join(', ')),
            h('td', null, e.basis[school]), h('td', null, e.desc)))))))),

    aiSection(save, render));
}

// 우리 학교 행사 목록 (자율·진로 점검용): 붙여넣기 또는 엑셀·CSV 첫 시트 (앞 칸 행사명, 뒤 칸 날짜)
function eventSection(save) {
  let draft = settings.events.map((e) => `${e.name}\t${e.date}`).join('\n');
  const apply = (input, how) => {
    const r = parseEventList(input, schoolYear());
    if (!r.events.length) { eventNote = { kind: 'error', text: '읽은 행사가 없습니다. 한 줄에 행사명과 날짜를 적어 주세요.', errors: r.errors }; save(); return; }
    settings.events = r.events;
    eventNote = { kind: r.errors.length ? 'warn' : 'ok', text: `${how} 행사 ${r.events.length}개를 저장했습니다.${r.errors.length ? ` 읽지 못한 줄 ${r.errors.length}개는 뺐습니다.` : ''}`, errors: r.errors };
    save(`행사 ${r.events.length}개를 저장했습니다.`);
  };
  const onFile = async (input) => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const ext = f.name.toLowerCase().split('.').pop();
    if (!EXTENSIONS.includes(ext) || f.size > LIMITS.bytes) { eventNote = { kind: 'error', text: '5MB 이하의 엑셀(.xlsx, .xls) 또는 .csv 파일만 열 수 있습니다.', errors: [] }; save(); return; }
    try {
      const X = window.XLSX;
      const buf = new Uint8Array(await f.arrayBuffer());
      const wb = ext === 'csv' ? X.read(new TextDecoder().decode(buf), { type: 'string', sheetRows: 1000 }) : X.read(buf, { type: 'array', sheetRows: 1000, cellFormula: false, cellHTML: false });
      const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '', blankrows: false });
      apply(rows, '파일에서');
    } catch { eventNote = { kind: 'error', text: '파일을 읽지 못했습니다. 엑셀에서 다시 저장한 뒤 올려 주세요.', errors: [] }; save(); }
  };
  const fileIn = h('input', { type: 'file', id: 'event-file', accept: '.xlsx,.xls,.csv', hidden: true, 'aria-label': '행사 목록 파일', onchange: (e) => onFile(e.target) });
  return h('section', { class: 'card stack', 'aria-labelledby': 'st-events' },
    h('h3', { id: 'st-events' }, '우리 학교 행사 목록 (자율·진로 점검용)'),
    h('p', { class: 'muted' }, '한 줄에 행사 하나: 행사명과 날짜(또는 기간). 자율·진로 글의 행사명(날짜)가 이 목록과 이름·날짜 모두 같은지 봅니다. 날짜는 2026.03.04., 기간은 2026.03.04.-2026.03.06.으로 맞춰 저장합니다.'),
    eventNote ? h('div', { class: `alert ${eventNote.kind === 'error' ? 'alert-danger' : eventNote.kind === 'warn' ? 'alert-warn' : ''}`, role: 'status' },
      eventNote.text, eventNote.errors?.length ? h('ul', null, eventNote.errors.slice(0, 10).map((x) => h('li', null, x))) : null) : null,
    h('label', { for: 'event-list' }, '행사 목록 붙여넣기 (엑셀에서 행사명·날짜 두 열을 복사해도 됩니다)'),
    h('textarea', { id: 'event-list', rows: 6, value: draft, placeholder: '학생자치회 임원 선거\t2026.03.15.\n체육대회\t2026.05.14.-2026.05.15.', oninput: (e) => { draft = e.target.value; } }),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => apply(draft, '붙여넣은') }, '행사 목록 저장'),
      h('button', { type: 'button', class: 'btn', onclick: () => fileIn.click() }, '엑셀·CSV 파일 올리기'), fileIn,
      settings.events.length ? h('button', { type: 'button', class: 'btn', onclick: async () => {
        if (!(await confirmBox('행사 목록 지우기', '이 브라우저에 저장한 행사 목록을 지웁니다.', '지우기'))) return;
        settings.events = []; eventNote = null; save('행사 목록을 지웠습니다.');
      } }, '목록 지우기') : null),
    settings.events.length ? h('details', null, h('summary', `저장된 행사 ${settings.events.length}개`),
      h('ul', null, settings.events.map((e) => h('li', null, eventLabel(e))))) : h('p', { class: 'muted' }, '저장된 행사가 없습니다. 없으면 행사 점검을 하지 않습니다.'));
}

function keyStatus() {
  const k = keys.read();
  if (!k) return null;
  const who = k.source === 'session' ? '이번에만 사용하는 키' : k.savedBy === 'textgenerator-v2' ? '작성 도우미에서 저장한 키' : '점검기에서 저장한 키';
  return `${who}를 쓰는 중입니다 (${maskKey(k.key)})`;
}

function aiSection(save, render) {
  const status = keyStatus();
  let draft = '';
  const keyInput = h('input', { type: 'password', id: 'api-key', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'key-help', oninput: (e) => { draft = e.target.value; } });
  const done = (msg) => { keyFormOpen = false; keyNote = msg; render(); announce(msg); };
  const bad = 'API 키 모양이 아닙니다. 공백 없이 30~100자로 된 키를 붙여넣으세요.';
  return h('section', { class: 'card stack', 'aria-labelledby': 'st-ai' },
    h('h3', { id: 'st-ai' }, 'AI 점검 (맞춤법, 영역 적합성, 나열식, 수정 문구)'),
    h('p', { class: 'alert alert-warn' }, '학교 개인정보 지침을 확인한 뒤 켜세요. 학번과 이름은 보내지 않고, 글 안의 명단 이름은 \'학생\'으로 가려서 보냅니다. 꺼져 있어도 규칙 점검은 모두 됩니다.'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: settings.aiOn, onchange: (e) => { settings.aiOn = e.target.checked; save(settings.aiOn ? 'AI 점검을 켰습니다.' : 'AI 점검을 껐습니다.'); } }), 'AI 점검 쓰기'),
    h('div', { class: 'stack', role: 'group', 'aria-labelledby': 'key-h' },
      h('h4', { id: 'key-h' }, 'Gemini API 키 (작성 도우미와 함께 씀)'),
      keyNote ? h('p', { class: 'alert', role: 'status' }, keyNote) : null,
      status ? h('p', null, status) : h('p', null, '저장된 키가 없습니다.'),
      status && !keyFormOpen ? h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: () => { keyFormOpen = true; keyNote = ''; render(); document.getElementById('api-key')?.focus(); } }, '다른 키 넣기'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
          if (!(await confirmBox('키 지우기', '이 브라우저에서 키를 지웁니다. 작성 도우미에서도 지워집니다.', '지우기'))) return;
          const r = keys.clear();
          done(r.legacyRemains ? '키를 지웠습니다. 작성 도우미 설정에 키가 남아 있습니다. 작성 도우미 설정에서도 지워 주세요.' : '키를 지웠습니다.');
        } }, '이 브라우저에서 키 지우기')) : null,
      !status || keyFormOpen ? h('div', { class: 'stack' },
        h('div', { class: 'field' }, h('label', { for: 'api-key' }, 'API 키'), keyInput,
          h('span', { id: 'key-help', class: 'muted' }, '결제가 연결되지 않은 무료 키를 쓰고, Google AI Studio에서 키 제한(웹사이트 https://176-oss.github.io/*, API는 Generative Language API만)을 걸어 두세요. 키 전체는 화면에 다시 보이지 않습니다.')),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => (keys.save(draft) ? done('키를 이 브라우저에 저장했습니다. 작성 도우미가 공용 키 자리를 읽도록 바뀌면 작성 도우미에서도 이 키를 씁니다.') : done(bad)) }, '이 브라우저에 저장'),
          h('button', { type: 'button', class: 'btn', onclick: () => (keys.useForSession(draft) ? done('이번에만 쓰는 키를 넣었습니다. 페이지를 닫으면 사라지고 작성 도우미와 함께 쓰지 않습니다.') : done(bad)) }, '이번에만 사용'),
          keyFormOpen ? h('button', { type: 'button', class: 'btn', onclick: () => { keyFormOpen = false; render(); } }, '취소') : null)) : null),
    h('div', { class: 'field' }, h('label', { for: 'models' }, '모델 (한 줄에 하나, 위에서부터 쓰고 한도 초과·혼잡이면 다음 모델)'),
      h('textarea', { id: 'models', value: settings.models.join('\n'), onchange: (e) => {
        const m = e.target.value.split('\n').map((s) => s.trim()).filter(validModel).slice(0, 8);
        settings.models = m.length ? m : [...DEFAULT_MODELS];
        save('모델 목록을 저장했습니다.');
      } })),
    h('details', null, h('summary', '개발용'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: settings.fakeAi, onchange: (e) => { settings.fakeAi = e.target.checked; save(settings.fakeAi ? '가짜 AI를 켰습니다. 실제로 호출하지 않습니다.' : '가짜 AI를 껐습니다.'); } }), '가짜 AI (실제 호출 없이 시험)')));
}
