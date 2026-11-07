// 내 스타일 (#style): 영역 탭 + 예시 목록(붙여넣기, .txt, .xlsx/.csv) + 스타일 규칙 + AI로 스타일 정리 (contract 16-4)
import { h, clear, debounce, focusEl } from '../dom.js';
import { toast, announce, openDialog, alertBox, badge, viewHeader, field, readFileText } from '../ui.js';
import * as store from '../store.js';
import { STYLE_AREAS, AREA_LABELS } from '../core/model.js';
import { byteLength } from '../core/bytes.js';
import {
  MAX_EXAMPLES, styleKey, exampleLimit, maskExample, addExample, removeExample, setAreaRules,
} from '../core/style.js';
import { summarizeStyle, AiError } from '../core/gemini.js';
import { readSheetFile, XlsxMissingError, XLSX_MISSING_TEXT } from '../xlsx-io.js';

const S = {
  key: 'common',
  aiDraft: new Map(), // 영역 키별 AI 정리 결과 (아직 쓰지 않음)
  busy: false,
  error: '',
};

let ctx = null;
let root = null;
let stale = false; // 입력 중에 바뀐 알림이 와서 미뤄 둔 다시 그리기

// ---------- 공통 ----------
const rosterAll = () => [...store.state.students.values()].map((s) => ({ studentId: s.studentId, name: s.name }));
const rosterNames = () => rosterAll().map((s) => s.name);
const areaOf = (key = S.key) => store.getStyles()?.areas?.[key] || { examples: [], rules: '', aiRules: '' };
const limitOf = (key = S.key) => exampleLimit(key, store.state.settings?.limits);
const noKey = () => !ctx.isFakeAI() && !ctx.hasKey();

function areaTabs() {
  const subjects = new Set(store.listClasses().filter((c) => c.kind === 'subject' && c.subject).map((c) => c.subject));
  for (const k of Object.keys(store.getStyles()?.areas || {})) if (k.startsWith('subject:') && k.length > 8) subjects.add(k.slice(8));
  return [
    ...STYLE_AREAS.map((k) => ({ key: k, label: k === 'common' ? '공통' : AREA_LABELS[k] })),
    ...[...subjects].map((s) => ({ key: styleKey('subject', s), label: `${AREA_LABELS.subject}(${s})` })),
  ];
}

// ---------- 스타일 규칙 자동 저장 (0.6초) ----------
let pendingRules = null; // { key, rules }
const commitRules = debounce(() => {
  if (!pendingRules) return;
  const { key, rules } = pendingRules;
  pendingRules = null;
  store.setStyles(setAreaRules(store.getStyles(), key, { rules }));
}, 600);
function flushRules() { commitRules.flush(); }

function typing() {
  const ae = document.activeElement;
  return !!root && root.contains(ae) && ae.matches('textarea,input');
}

/** 다시 그리고 포커스를 같은 id 또는 data-fkey 요소로 되돌림 */
function rerender() {
  const ae = document.activeElement;
  const had = root && root.contains(ae);
  const fkey = had ? (ae.id || ae.dataset.fkey || null) : null;
  render();
  if (had && !root.contains(document.activeElement)) {
    const t = (fkey && (document.getElementById(fkey) || root.querySelector(`[data-fkey="${CSS.escape(fkey)}"]`))) || root.querySelector('.view-title');
    if (t) focusEl(t, { scroll: false });
  }
}

// ---------- 탭 (화살표 키) ----------
function tabList(items) {
  const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': '영역' });
  const select = (key) => { flushRules(); S.key = key; S.error = ''; ctx.setParams('style', { area: key }); render(); document.getElementById(tabId(key))?.focus(); };
  const btns = items.map((it) => h('button', {
    type: 'button', class: 'tab', role: 'tab', id: tabId(it.key),
    'aria-selected': it.key === S.key, 'aria-controls': 'style-tabpanel', tabindex: it.key === S.key ? '0' : '-1',
    onclick: () => select(it.key),
  }, it.label));
  list.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    let n = i;
    if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = btns.length - 1;
    else n = (i + (e.key === 'ArrowLeft' ? -1 : 1) + btns.length) % btns.length;
    select(items[n].key);
  });
  list.append(...btns);
  return list;
}
function tabId(key) { return `style-tab-${key.replace(/[^\w가-힣-]/g, '_')}`; }

// ---------- 예시 넣기: 가리기 미리보기 -> 확인 -> 저장 ----------
async function confirmExamples(texts) {
  const key = S.key;
  const limit = limitOf(key);
  const room = MAX_EXAMPLES - areaOf(key).examples.length;
  const names = rosterNames();
  const ok = [];
  const skipped = [];
  for (const raw of texts.map((t) => String(t ?? '').trim()).filter(Boolean)) {
    const m = maskExample(raw, names);
    const bytes = byteLength(m.text);
    if (bytes > limit) skipped.push({ ...m, reason: `${bytes} byte로 한도 ${limit} byte보다 깁니다` });
    else if (ok.length >= room) skipped.push({ ...m, reason: `예시는 영역마다 ${MAX_EXAMPLES}개까지입니다` });
    else ok.push(m);
  }
  if (!ok.length && !skipped.length) { toast('넣을 글이 없습니다'); return false; }
  const total = ok.reduce((n, m) => n + m.replaced.length, 0);
  const where = (m) => (m.replaced.length
    ? `OO으로 바꾼 곳 ${m.replaced.length}개: ${m.replaced.map((r) => `${r.from}(${r.index + 1}번째 글자)`).join(', ')}`
    : '바꾼 곳 없음');
  const dlg = openDialog({
    title: '넣기 전에 확인해 주세요',
    wide: true,
    body: [
      h('p', {}, `넣을 예시 ${ok.length}개, OO으로 바꾼 곳 모두 ${total}개.`),
      ok.length ? h('ol', { class: 'stack style-preview-list' }, ok.map((m) => h('li', { class: 'stack gap-1' },
        h('p', { class: 'style-example-text' }, m.text),
        h('p', { class: ['small', m.replaced.length ? 'text-warn' : 'muted'] }, where(m))))) : null,
      skipped.length ? alertBox('warn', h('div', { class: 'stack gap-1' },
        h('p', {}, `넣지 않는 글 ${skipped.length}개`),
        h('ul', { class: 'issue-list' }, skipped.map((m) => h('li', { class: 'is-warn' }, `${m.text.slice(0, 30)}: ${m.reason}`))))) : null,
      h('p', { class: 'hint' }, '이름과 학번 말고도 알아볼 수 있는 내용(다른 학생 이름, 별명, 학교 밖 단체 이름 등)은 직접 지운 뒤 넣어 주세요.'),
    ],
    actions: [
      { label: '취소', variant: 'secondary', value: false },
      { label: '이대로 저장', variant: 'primary', value: true, disabled: !ok.length },
    ],
  });
  if ((await dlg.closed) !== true) return false;
  let next = store.getStyles();
  let added = 0;
  for (const m of ok) {
    const r = addExample(next, key, m.text, new Date(), limit);
    if (r.error) { toast(r.error, { danger: true }); break; }
    next = r.styles;
    added += 1;
  }
  if (added) {
    store.setStyles(next);
    toast(`예시 ${added}개를 넣었습니다`);
  }
  return added > 0;
}

function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** 엑셀/CSV: 열을 골라 칸마다 예시 후보로 */
async function pickColumn(rows) {
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (!width) { toast('파일에 글이 없습니다'); return; }
  let col = 0;
  let header = true;
  const count = h('p', { class: 'small', 'aria-live': 'polite' });
  const textsOf = () => rows.slice(header ? 1 : 0).map((r) => String(r[col] ?? '').trim()).filter(Boolean);
  const refresh = () => { count.textContent = `이 열의 글 ${textsOf().length}개 (한 칸이 예시 하나)`; };
  const select = h('select', { class: 'select', id: 'style-col', onchange: (e) => { col = Number(e.target.value); refresh(); } },
    Array.from({ length: width }, (_, i) => h('option', { value: String(i) }, `${colName(i)}열${rows[0]?.[i] ? `: ${String(rows[0][i]).slice(0, 20)}` : ''}`)));
  const headerBox = h('input', { type: 'checkbox', id: 'style-col-header', checked: true, onchange: (e) => { header = e.target.checked; refresh(); } });
  refresh();
  const dlg = openDialog({
    title: '예시가 있는 열 고르기',
    body: [
      field('열', select),
      h('label', { class: 'row check-row', for: 'style-col-header' }, headerBox, '첫 행은 제목이라 넣지 않음'),
      count,
    ],
    actions: [
      { label: '취소', variant: 'secondary', value: false },
      { label: '다음', variant: 'primary', value: true },
    ],
  });
  if ((await dlg.closed) === true) await confirmExamples(textsOf());
}

async function onFile(file) {
  try {
    if (/\.txt$/i.test(file.name)) await confirmExamples([await readFileText(file)]);
    else if (/\.(xlsx|xls|csv)$/i.test(file.name)) await pickColumn(await readSheetFile(file));
    else toast('.txt, .xlsx, .csv 파일만 넣을 수 있습니다', { danger: true });
  } catch (e) {
    toast(e instanceof XlsxMissingError ? XLSX_MISSING_TEXT : '파일을 읽지 못했습니다. 다른 파일로 다시 시도해 주세요.', { danger: true });
  }
}

// ---------- AI로 스타일 정리 ----------
async function summarize() {
  const key = S.key;
  const examples = areaOf(key).examples.map((e) => e.text);
  if (!examples.length) return;
  S.busy = true;
  S.error = '';
  rerender();
  announce('스타일을 정리하고 있습니다');
  try {
    const res = await summarizeStyle({
      examples, roster: rosterAll(), settings: store.state.settings, apiKey: store.getApiKey(), fake: ctx.isFakeAI(),
    });
    S.aiDraft.set(key, res.rules.join('\n'));
    announce('정리 결과가 나왔습니다. 고친 뒤 이 규칙 쓰기를 눌러 주세요.');
  } catch (e) {
    if (!(e instanceof AiError)) console.warn('스타일 정리 중 예상 못 한 오류:', e?.name || 'Error');
    S.error = e?.userMessage || '스타일을 정리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
    toast(S.error, { danger: true });
  } finally {
    S.busy = false;
    if (root) {
      render();
      document.getElementById(S.aiDraft.has(key) && S.key === key ? 'style-ai-draft' : 'style-summarize')?.focus();
    }
  }
}

function useAiRules() {
  const key = S.key;
  const text = (S.aiDraft.get(key) || '').trim();
  if (!text) { toast('규칙이 비어 있습니다'); return; }
  flushRules();
  store.setStyles(setAreaRules(store.getStyles(), key, { aiRules: text }));
  S.aiDraft.delete(key);
  render();
  document.getElementById('style-summarize')?.focus();
  toast('AI 정리 규칙을 저장했습니다. 이제 초안에 함께 씁니다.');
}

/** 되돌리기: 그 영역을 이전 상태로 하되 updatedAt은 지금 (동기화에서 지지 않게) */
function undoTo(prev, key) {
  store.setStyles(setAreaRules(prev, key, {}));
}

// ---------- 그리기 ----------
function examplesCard() {
  const key = S.key;
  const list = areaOf(key).examples;
  const limit = limitOf(key);
  const full = list.length >= MAX_EXAMPLES;
  const paste = h('textarea', { class: 'textarea', id: 'style-paste', rows: '5', placeholder: '예전에 쓴 글이나 마음에 드는 예시를 붙여 넣으세요.' });
  const fileInput = h('input', {
    type: 'file', accept: '.txt,.xlsx,.xls,.csv', hidden: true, id: 'style-file',
    onchange: async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) await onFile(file);
    },
  });
  return h('section', { class: 'card stack', 'aria-labelledby': 'style-ex-title' },
    h('h2', { class: 'card-title', id: 'style-ex-title' }, `예시 ${list.length}/${MAX_EXAMPLES}`),
    h('p', { class: 'hint' }, `예시 하나는 ${limit} byte까지 넣을 수 있습니다. 초안에는 짧은 예시 1~2개만 문체 참고로 보냅니다.`),
    list.length
      ? h('ol', { class: 'stack style-example-list' }, list.map((ex, i) => h('li', { class: 'stack gap-1 style-example' },
        h('p', { class: 'style-example-text' }, ex.text),
        h('div', { class: 'row-between' },
          h('span', { class: 'small muted num' }, `${byteLength(ex.text)} byte`),
          h('button', {
            type: 'button', class: 'btn btn-ghost btn-sm', 'data-fkey': `style-del-${i}`, 'aria-label': `예시 ${i + 1} 지우기`,
            onclick: () => {
              const prev = store.getStyles();
              store.setStyles(removeExample(prev, key, ex.id));
              toast('예시를 지웠습니다', { action: '되돌리기', onAction: () => undoTo(prev, key) });
            },
          }, '지우기')))))
      : h('p', { class: 'muted small' }, '아직 예시가 없습니다.'),
    field('예시 붙여넣기', paste, '넣기 전에 명단 이름, 5자리 학번, n학년 n반 n번을 OO으로 바꾼 결과를 보여 드립니다.'),
    h('div', { class: 'row' },
      h('button', {
        type: 'button', class: 'btn btn-primary', disabled: full,
        onclick: async () => {
          if (!paste.value.trim()) { toast('붙여 넣은 글이 없습니다'); paste.focus(); return; }
          if (await confirmExamples([paste.value])) paste.value = '';
        },
      }, '예시 넣기'),
      h('button', { type: 'button', class: 'btn btn-secondary', disabled: full, onclick: () => fileInput.click() }, '파일에서 넣기 (.txt, .xlsx, .csv)'),
      fileInput),
    full ? h('p', { class: 'hint' }, `예시가 ${MAX_EXAMPLES}개라 더 넣을 수 없습니다. 하나를 지운 뒤 넣어 주세요.`) : null);
}

function rulesCard() {
  const key = S.key;
  const ta = h('textarea', {
    class: 'textarea', id: 'style-rules', rows: '5',
    value: pendingRules?.key === key ? pendingRules.rules : areaOf(key).rules || '',
    placeholder: '예: 한 문장은 짧게\n평가어는 마지막 문장에 한 번',
    oninput: (e) => { pendingRules = { key, rules: e.target.value }; commitRules(); },
  });
  return h('section', { class: 'card stack', 'aria-labelledby': 'style-rules-title' },
    h('h2', { class: 'card-title', id: 'style-rules-title' }, '스타일 규칙'),
    field('직접 쓰는 규칙 (한 줄에 하나)', ta, key === 'common' ? '공통 규칙은 모든 영역 초안에 함께 씁니다.' : '이 영역 초안에 공통 규칙과 함께 씁니다. 메모에 있는 사실만 쓴다는 원칙이 언제나 먼저입니다.'));
}

function aiCard() {
  const key = S.key;
  const area = areaOf(key);
  const hasEx = area.examples.length > 0;
  const aiLines = String(area.aiRules || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const draft = S.aiDraft.get(key);
  const reason = !hasEx ? '예시를 하나 이상 넣으면 정리할 수 있습니다.' : noKey() ? '설정에서 API 키를 넣으면 정리할 수 있습니다.' : '';
  return h('section', { class: 'card stack', 'aria-labelledby': 'style-ai-title' },
    h('h2', { class: 'card-title', id: 'style-ai-title' }, 'AI로 스타일 정리'),
    h('p', { class: 'hint' }, '이 영역 예시를 AI에 보내 문체 특징(문장 길이, 끝맺음, 구성 순서, 자주 쓰는 표현 유형)을 짧은 규칙으로 받습니다. 보내기 직전에 이름과 학번을 한 번 더 가립니다.'),
    aiLines.length
      ? h('div', { class: 'stack gap-1' },
        h('h3', { class: 'section-title' }, '지금 쓰는 AI 정리 규칙'),
        h('ul', { class: 'style-rule-list' }, aiLines.map((l) => h('li', {}, l))),
        h('div', { class: 'row' }, h('button', {
          type: 'button', class: 'btn btn-ghost btn-sm', id: 'style-ai-clear',
          onclick: () => {
            const prev = store.getStyles();
            store.setStyles(setAreaRules(prev, key, { aiRules: '' }));
            toast('AI 정리 규칙을 지웠습니다', { action: '되돌리기', onAction: () => undoTo(prev, key) });
          },
        }, 'AI 규칙 지우기')))
      : null,
    h('div', { class: 'row' },
      h('button', {
        type: 'button', class: 'btn btn-secondary', id: 'style-summarize', disabled: !!reason || S.busy,
        'aria-describedby': reason ? 'style-ai-reason' : null, onclick: summarize,
      }, S.busy ? '정리하는 중' : 'AI로 스타일 정리'),
      ctx.isFakeAI() ? badge('가짜 AI', 'warn') : null),
    reason ? h('p', { class: 'hint', id: 'style-ai-reason' }, reason) : null,
    S.busy ? h('p', { class: 'small muted', role: 'status' }, 'AI가 예시를 읽고 규칙을 정리하고 있습니다.') : null,
    S.error ? alertBox('danger', S.error, { role: 'alert' }) : null,
    draft !== undefined
      ? h('div', { class: 'stack' },
        field('AI 정리 결과 (고칠 수 있음, 한 줄에 하나)', h('textarea', {
          class: 'textarea', id: 'style-ai-draft', rows: '7', value: draft,
          oninput: (e) => S.aiDraft.set(key, e.target.value),
        })),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: useAiRules }, '이 규칙 쓰기'),
          h('button', {
            type: 'button', class: 'btn btn-ghost',
            onclick: () => { S.aiDraft.delete(key); render(); document.getElementById('style-summarize')?.focus(); },
          }, '버리기')))
      : null);
}

function render() {
  if (!root) return;
  const tabs = areaTabs();
  if (!tabs.some((t) => t.key === S.key)) S.key = 'common';
  const hasSubject = tabs.some((t) => t.key.startsWith('subject:'));
  clear(root,
    viewHeader('내 스타일', '예전에 쓴 글이나 마음에 드는 예시를 넣어 두면 AI 초안이 그 문체를 따릅니다. 예시의 내용은 쓰지 않고 문체만 참고합니다.'),
    alertBox('warn', '다른 학생 이름이나 알아볼 수 있는 내용은 지우고 넣으세요. 넣을 때 명단에 있는 이름, 5자리 학번, n학년 n반 n번은 OO으로 바꿉니다.'),
    tabList(tabs),
    hasSubject ? null : h('p', { class: 'hint' }, '교과반을 만들면 과목별 교과세특 탭이 생깁니다.'),
    h('div', { class: 'stack', id: 'style-tabpanel', role: 'tabpanel', 'aria-labelledby': tabId(S.key) },
      examplesCard(), rulesCard(), aiCard()));
}

export const styleView = {
  mount(el, params, c) {
    ctx = c;
    root = h('div', { class: 'view view-style stack' });
    el.appendChild(root);
    const pa = params?.get('area');
    if (pa) S.key = pa;
    root.addEventListener('focusout', () => {
      setTimeout(() => { if (stale && root && !typing()) { stale = false; rerender(); } }, 0);
    });
    render();
  },
  update(kind) {
    if (!root || !['styles', 'all', 'classes', 'settings', 'key', 'students'].includes(kind)) return;
    // 입력 중이면 포커스와 입력을 잃지 않게 미뤘다가 칸을 벗어날 때 그림
    if (typing() || commitRules.pending()) { stale = true; return; }
    rerender();
  },
  flush() { flushRules(); },
  unmount() { flushRules(); root = null; stale = false; },
};
