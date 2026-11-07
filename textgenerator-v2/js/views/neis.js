// NEIS 옮기기: 완료 기록을 한 명씩 [복사] 다음 [옮김, 다음]. 드라이브 경로 안내와 확장프로그램으로 보내기(예비)
import { h, clear, icon, focusEl } from '../dom.js';
import { toast, announce, badge, alertBox, emptyState, viewHeader, progressBar, downloadJSON, stamp } from '../ui.js';
import * as store from '../store.js';
import { KIND_LABELS } from '../core/model.js';
import { byteLength, byteLevel } from '../core/bytes.js';
import { buildNeisBatch, textHash } from '../core/neis-export.js';
import { sendBatch, requestDone } from '../ext-bridge.js';
import { copyText } from './write.js';

let root = null;
let classId = null;
let area = null;
const positions = new Map(); // `${classId}|${area}` 별 지금 위치 (세션 동안 유지)
const hashCache = new Map(); // 글별 hash
let sendResult = null; // { ok, count } | { ok: false, batch }
let ctx = null;
let lastConnected = false;

async function hashOf(text) {
  if (hashCache.has(text)) return hashCache.get(text);
  const v = await textHash(text);
  hashCache.set(text, v);
  return v;
}

/** 'none' | 'done' | 'changed' */
async function neisState(rec) {
  if (!rec.neis || !rec.final) return 'none';
  return (await hashOf(rec.final)) === rec.neis.hash ? 'done' : 'changed';
}
function neisBadge(state) {
  if (state === 'done') return badge('나이스 입력 완료', 'done');
  if (state === 'changed') return badge('입력 후 수정됨', 'warn');
  return badge('나이스 입력 전', 'empty');
}
function fillNeisBadge(el, rec) {
  neisState(rec).then((st) => clear(el, neisBadge(st))).catch(() => {});
}

const cls = () => store.getClass(classId);
const areaInfo = () => store.areasOfClass(cls()).find((a) => a.area === area) || null;
const posKey = () => `${classId}|${area}`;

function doneItems() {
  const a = areaInfo();
  if (!a) return [];
  return store.studentsOf(cls()).map((s) => ({ s, rec: store.findRecord(s.studentId, a.area, a.subject) }))
    .filter((x) => x.rec && x.rec.status === 'done' && (x.rec.final || '').trim());
}

function pickDefaults(params) {
  const classes = store.listClasses();
  const pc = params?.get('class');
  if (pc && store.getClass(pc)) classId = pc;
  if (!classId || !store.getClass(classId)) classId = classes[0]?.id || null;
  const areas = store.areasOfClass(cls());
  const pa = params?.get('area');
  if (pa && areas.some((x) => x.area === pa)) area = pa;
  if (!areas.some((x) => x.area === area)) area = areas[0]?.area || null;
}

async function sendToExtension() {
  const a = areaInfo();
  const items = doneItems();
  if (!items.length) { toast('보낼 완료 기록이 없습니다'); return; }
  const records = items.map((x) => x.rec);
  const students = items.map((x) => x.s);
  let batch;
  try {
    batch = await buildNeisBatch({ records, students, settings: store.state.settings, now: new Date().toISOString() });
  } catch (e) {
    console.error(e);
    toast('보낼 데이터를 만들지 못했습니다', { danger: true });
    return;
  }
  sendResult = { waiting: true };
  renderSend();
  announce('확장프로그램에 보내는 중입니다');
  const res = await sendBatch(batch, { timeoutMs: 3000 });
  sendResult = res.received ? { ok: true, count: res.count } : { ok: false, batch, label: `${cls()?.name || ''} ${a?.label || ''}` };
  renderSend();
  if (res.received) toast(`확장프로그램이 받았습니다: ${res.count}명`);
  else announce('확장프로그램의 답이 없습니다. NEIS 입력 파일을 내려받을 수 있습니다.');
}

let sendHost = null;
function renderSend() {
  if (!sendHost) return;
  let msg = null;
  if (sendResult?.waiting) msg = h('p', { class: 'small muted' }, '보내는 중입니다.');
  else if (sendResult?.ok) msg = alertBox('ok', `받았습니다 ${sendResult.count}명. 학교 PC 크롬에서 나이스 화면을 열고 확장프로그램 사이드 패널에서 입력을 시작하세요.`);
  else if (sendResult && !sendResult.ok) {
    const b = sendResult.batch;
    msg = alertBox('warn', h('div', { class: 'stack' },
      h('p', {}, '확장프로그램이 설치된 학교 PC 크롬에서 눌러 주세요. 다른 PC라면 NEIS 입력 파일을 내려받아 확장프로그램 사이드 패널에서 [파일 불러오기]로 열 수 있습니다.'),
      h('div', { class: 'row' }, h('button', {
        type: 'button', class: 'btn btn-secondary',
        onclick: () => downloadJSON(b, `NEIS입력_${b.schoolYear}-${b.semester}_${stamp()}.json`),
      }, icon('download'), 'NEIS 입력 파일 내려받기')),
      h('p', { class: 'small' }, '이 파일에는 학생 이름과 글이 들어 있습니다. 메신저나 메일로 다른 사람에게 보내지 마세요.')));
  }
  clear(sendHost, msg);
}

function currentCard(items, pos) {
  if (!items.length) return emptyState('send', '이 반과 영역에 완료로 표시한 기록이 없습니다. 작성 화면 검사 단계에서 [완료로 표시]를 누르면 여기에 나옵니다.',
    h('a', { class: 'btn btn-primary', href: `#write?class=${encodeURIComponent(classId)}&area=${area}` }, '작성으로 가기'));
  if (pos >= items.length) {
    return h('section', { class: 'card stack', 'aria-labelledby': 'neis-card-title' },
      h('h2', { class: 'card-title', id: 'neis-card-title', tabindex: '-1' }, '모두 옮겼습니다'),
      h('p', {}, `${items.length}명의 글을 모두 옮겼습니다. 나이스에서 저장을 눌렀는지 확인하세요.`),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => go(0) }, '처음부터 다시 보기')));
  }
  const { s, rec } = items[pos];
  const limit = store.limitOf(rec.area);
  const bytes = byteLength(rec.final);
  const level = byteLevel(bytes, limit);
  const ta = h('textarea', { class: 'textarea', id: 'neis-text', rows: '8', readonly: true, value: rec.final, 'aria-label': `${s.name} 최종본` });
  const stateEl = h('span', {});
  fillNeisBadge(stateEl, rec);
  return h('section', { class: 'card stack neis-card', 'aria-labelledby': 'neis-card-title' },
    h('div', { class: 'row-between' },
      h('h2', { class: 'card-title', id: 'neis-card-title', tabindex: '-1' }, `${s.studentId} ${s.name}`),
      h('div', { class: 'row' },
        h('span', { class: ['small', 'num', level === 'over' && 'text-danger'] }, `${bytes} / ${limit} byte`),
        stateEl)),
    ta,
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-primary', id: 'neis-copy', onclick: () => copyText(rec.final, ta) }, icon('copy'), '복사'),
      h('button', { type: 'button', class: 'btn btn-secondary', id: 'neis-next', onclick: () => go(pos + 1, true) }, '옮김, 다음', icon('right')),
      h('button', { type: 'button', class: 'btn btn-ghost', disabled: pos === 0, onclick: () => go(pos - 1) }, icon('left'), '이전')));
}

function go(pos, announceNext = false) {
  positions.set(posKey(), Math.max(0, pos));
  render();
  const items = doneItems();
  if (announceNext && pos < items.length) announce(`${pos + 1}번째: ${items[pos].s.name}`);
  focusEl(root?.querySelector('#neis-card-title'));
}

function listTable(items, pos) {
  if (!items.length) return null;
  return h('div', { class: 'table-wrap is-scroll' },
    h('table', { class: 'table' },
      h('caption', { class: 'sr-only' }, '완료 기록 목록. 학생을 누르면 그 학생으로 이동합니다.'),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col', class: 'num' }, '순서'), h('th', { scope: 'col' }, '학번'), h('th', { scope: 'col' }, '이름'),
        h('th', { scope: 'col', class: 'num' }, '바이트'), h('th', { scope: 'col' }, 'NEIS 입력'))),
      h('tbody', {}, items.map(({ s, rec }, i) => {
        const st = h('span', {});
        fillNeisBadge(st, rec);
        return h('tr', { class: i === pos ? 'is-selected' : null, 'aria-current': i === pos ? 'true' : null },
          h('td', { class: 'num' }, String(i + 1)),
          h('th', { scope: 'row', class: 'num' }, s.studentId),
          h('td', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => go(i) }, s.name)),
          h('td', { class: 'num' }, String(byteLength(rec.final))),
          h('td', {}, st));
      }))));
}

// 드라이브에 연결되어 있으면 확장이 드라이브에서 바로 가져가고, 보내기·파일은 예비 경로 (contract 9절)
function extCard(items) {
  const connected = !!ctx?.syncConnected();
  return h('section', { class: 'card stack', 'aria-labelledby': 'ext-title' },
    h('h2', { class: 'card-title', id: 'ext-title' }, '확장프로그램으로 옮기기'),
    connected
      ? alertBox('ok', '학교 PC 확장프로그램이 드라이브에서 완료 기록을 바로 가져갑니다. 나이스에 저장한 뒤 이 화면을 다시 열면 입력 완료가 표시됩니다.')
      : h('p', { class: 'small' }, '구글 드라이브에 연결하면 학교 PC 확장프로그램이 드라이브에서 완료 기록을 바로 가져갑니다. 지금은 아래의 드라이브 없이 보내기를 쓰세요.'),
    h('details', { class: 'key-guide', open: !connected },
      h('summary', {}, '드라이브 없이 보내기'),
      h('div', { class: 'stack' },
        h('p', { class: 'small' }, '학교 PC 크롬에 생기부 NEIS 확장프로그램이 있으면, 이 반과 영역의 완료 글을 한 번에 넘겨 자동 입력할 수 있습니다. 데이터는 이 PC 안에서만 오갑니다.'),
        h('div', { class: 'row' }, h('button', {
          type: 'button', class: 'btn btn-primary', disabled: !items.length, onclick: sendToExtension,
        }, icon('send'), `확장프로그램으로 보내기 (${items.length}명)`)),
        sendHost,
        h('p', { class: 'small muted' }, '나이스에 저장한 뒤 이 화면을 다시 열면 확장프로그램이 알려 준 입력 완료가 표시됩니다.'))));
}

function render() {
  if (!root) return;
  lastConnected = !!ctx?.syncConnected();
  const head = viewHeader('NEIS 옮기기', '완료로 표시한 글만 학번 순서로 보여 줍니다. [복사]한 뒤 나이스에 붙여 넣고 [옮김, 다음]을 누르세요.');
  const classes = store.listClasses();
  if (!classes.length) {
    clear(root, head, emptyState('users', '아직 반이 없습니다.', h('a', { class: 'btn btn-primary', href: '#roster' }, '명단으로 가기')));
    return;
  }
  const areas = store.areasOfClass(cls());
  const classSel = h('select', {
    class: 'select', id: 'neis-class', value: classId,
    onchange: (e) => { classId = e.target.value; pickDefaults(null); sendResult = null; render(); document.getElementById('neis-class')?.focus(); },
  }, classes.map((c) => h('option', { value: c.id }, `${c.name} (${KIND_LABELS[c.kind]})`)));
  const areaSel = h('select', {
    class: 'select', id: 'neis-area', value: area,
    onchange: (e) => { area = e.target.value; sendResult = null; render(); document.getElementById('neis-area')?.focus(); },
  }, areas.map((a) => h('option', { value: a.area }, a.label)));
  const items = doneItems();
  let pos = positions.get(posKey()) || 0;
  if (pos > items.length) pos = items.length;
  const prog = progressBar('옮긴 학생 수');
  prog.set(Math.min(pos, items.length), items.length);
  sendHost = h('div', { class: 'stack', 'aria-live': 'polite' });
  clear(root, head,
    h('div', { class: 'row neis-pickers' },
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'neis-class' }, '반'), classSel),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'neis-area' }, '영역'), areaSel)),
    items.length ? h('div', { class: 'stack gap-1' }, prog, h('p', { class: 'small num' }, `${items.length}명 중 ${Math.min(pos, items.length)}명 옮김`)) : null,
    h('div', { class: 'neis-layout' },
      h('div', { class: 'stack' }, currentCard(items, pos), listTable(items, pos)),
      extCard(items)));
  renderSend();
}

export const neisView = {
  mount(el, params, c) {
    ctx = c;
    root = h('div', { class: 'view view-neis stack' });
    el.appendChild(root);
    pickDefaults(params);
    render();
    requestDone();
  },
  update(kind) {
    if (['save', 'key', 'styles', 'secrets'].includes(kind)) return;
    if (kind === 'sync' && lastConnected === !!ctx?.syncConnected()) return;
    const active = document.activeElement?.id;
    render();
    if (active) document.getElementById(active)?.focus();
  },
  unmount() { root = null; sendHost = null; },
};
