// 설정: API 키, 구글 드라이브, 학교급, 학년도·학기, 바이트 한도, 모델 목록, 일괄 간격, 금지 표현, 모든 데이터 지우기, 개발용
import { h, clear, icon, focusEl, uid } from '../dom.js';
import { toast, confirmDialog, openDialog, seg, alertBox, viewHeader, field } from '../ui.js';
import * as store from '../store.js';
import { AREAS, AREA_LABELS, DEFAULT_LIMITS, DEFAULT_MODELS, recordKey, newRecord, deriveStatus } from '../core/model.js';
import { charsForBytes } from '../core/bytes.js';
import { DEFAULT_FORBIDDEN } from '../core/forbidden.js';

const FAKE_DRIVE_FLAG = 'sgb-v2-dev-fake-drive';
const CATEGORIES = ['교외 수상', '어학시험', '사교육', '부모 정보', '기관·상표명', '논문·출판', '지식재산권', '교외 활동', '기타'];
const MATCH_LABELS = [['word', '낱말'], ['prefix', '앞부분'], ['regex', '정규식']];

let root = null;
let ctx = null;
let forbiddenQuery = '';

const S = () => store.state.settings;
const clone = (x) => JSON.parse(JSON.stringify(x));

function section(id, title, ...children) {
  return h('section', { class: 'card stack', 'aria-labelledby': id },
    h('h2', { class: 'card-title', id }, title), children);
}

// ---------- API 키 ----------
function keySection() {
  const where = store.apiKeyWhere();
  const mode = S().keyStorage || 'local';
  const input = h('input', { class: 'input', type: 'password', id: 'api-key', autocomplete: 'off', spellcheck: 'false', placeholder: where ? '새 키로 바꾸려면 붙여 넣으세요' : 'AIza로 시작하는 키' });
  const status = where === 'local' ? '이 브라우저에 저장된 키가 있습니다.'
    : where === 'session' ? '이번에만 쓰는 키가 있습니다. 창을 닫으면 지워집니다.'
      : '키가 없습니다. 초안을 만들려면 키가 필요합니다.';
  return section('set-key-title', 'Gemini API 키',
    h('p', { class: ['small', where ? null : 'text-danger'], role: 'status' }, status),
    h('div', { class: 'field' },
      h('span', { class: 'label', id: 'key-mode-label' }, '보관 방식'),
      seg({
        labelledby: 'key-mode-label',
        options: [['local', '이 브라우저에 저장'], ['session', '이번에만 사용']],
        value: mode,
        onChange: (v) => {
          store.updateSettings({ keyStorage: v });
          const k = store.getApiKey();
          if (k) store.setApiKey(k, v);
          toast(v === 'local' ? '키를 이 브라우저에 저장합니다' : '키를 이번에만 씁니다. 저장된 키는 지웠습니다');
        },
      }),
      h('p', { class: 'hint' }, '여러 사람이 함께 쓰는 PC라면 [이번에만 사용]을 고르세요. 키는 백업 파일에 들어가지 않습니다.')),
    field('API 키', input),
    h('div', { class: 'row' },
      h('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => {
          const v = input.value.trim();
          if (!v) { toast('키를 붙여 넣어 주세요'); input.focus(); return; }
          if (/\s/.test(v) || v.length < 20) { toast('키 모양이 이상합니다. 다시 복사해 주세요', { danger: true }); input.focus(); return; }
          store.setApiKey(v, S().keyStorage || 'local');
          input.value = '';
          if (keyOnDrive()) store.setSecrets({ geminiKey: v, updatedAt: new Date().toISOString() });
          toast(keyOnDrive() ? 'API 키를 저장했습니다. 구글 드라이브의 키도 바꿉니다' : 'API 키를 저장했습니다');
          render();
          focusEl(root.querySelector('#set-key-title'));
        },
      }, icon('key'), '키 저장하기'),
      h('button', {
        type: 'button', class: 'btn btn-ghost', disabled: !where,
        onclick: () => {
          const onDrive = keyOnDrive();
          store.clearApiKey();
          if (onDrive) store.setSecrets({ geminiKey: '', updatedAt: new Date().toISOString() });
          toast(onDrive ? 'API 키를 이 브라우저와 구글 드라이브에서 지웠습니다' : 'API 키를 지웠습니다');
          render();
          focusEl(root.querySelector('#set-key-title'));
        },
      }, icon('trash'), '키 지우기')),
    keyDriveField(),
    h('details', { class: 'key-guide' },
      h('summary', {}, 'API 키 받는 방법'),
      h('ol', { class: 'stack small' },
        h('li', {}, '개인 구글 계정으로 Google AI Studio(', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer' }, 'aistudio.google.com'), ')에 들어갑니다. 학교 계정은 막혀 있을 수 있습니다.'),
        h('li', {}, '[Get API key] 또는 [API 키 만들기]를 눌러 새 키를 만듭니다.'),
        h('li', {}, '만든 키를 복사해 위 칸에 붙여 넣고 [키 저장하기]를 누릅니다.'),
        h('li', {}, '키는 비밀번호처럼 다루고 다른 사람과 나누지 마세요. 학생 이름과 학번은 AI로 보내지 않습니다.'),
        h('li', {}, '키 제한을 걸어 두면 더 안전합니다. 방법은 README의 \'API 키 제한하기\'에 있습니다: API 제한은 Generative Language API만, 웹사이트 제한은 https://176-oss.github.io/* 만.'))));
}

// ---------- API 키 드라이브 저장 (선택 기능, contract 18절) ----------
const keyOnDrive = () => !!store.getSecrets()?.geminiKey;
let keyConnected = null; // 키 칸을 그릴 때의 연결 상태 (바뀌면 다시 그림)

function keyDriveField() {
  if (!ctx.drive.isConfigured()) return null;
  const connected = ctx.syncConnected();
  keyConnected = connected;
  const pc = !!S().publicPC;
  const reason = pc ? '공용 PC에서는 키를 드라이브에 저장할 수 없습니다.'
    : !connected ? '구글 드라이브에 연결해야 쓸 수 있습니다.' : null;
  const box = h('input', {
    type: 'checkbox', id: 'key-drive', checked: keyOnDrive(), disabled: !!reason,
    'aria-describedby': 'key-drive-hint',
    onchange: async (e) => {
      const on = e.target.checked;
      e.target.checked = !on; // 확인이 끝날 때까지 그대로
      if (on) {
        const key = store.getApiKey();
        if (!key) { toast('먼저 API 키를 저장해 주세요'); return; }
        const ok = await confirmDialog({
          title: 'API 키를 구글 드라이브에도 저장할까요?',
          body: h('ul', { class: 'stack small' },
            h('li', {}, '결제를 연결하지 않은 무료 키만 쓰세요. 결제가 연결된 키가 새면 요금이 나올 수 있습니다.'),
            h('li', {}, 'Google AI Studio 또는 Cloud 콘솔에서 키 제한을 걸어 두세요: API 제한은 Generative Language API만, 웹사이트 제한은 https://176-oss.github.io/* 만.'),
            h('li', {}, '여러 사람이 쓰는 PC에서는 권하지 않습니다.'),
            h('li', {}, '키가 샌 것 같으면 AI Studio에서 그 키를 지우고 새로 만드세요.'),
            h('li', {}, '키는 백업 파일, 엑셀, 드라이브 자동 백업에는 들어가지 않습니다.')),
          ok: '켜기',
        });
        if (!ok) return;
        store.setSecrets({ geminiKey: key, updatedAt: new Date().toISOString() });
        toast('API 키를 구글 드라이브에도 저장합니다');
      } else {
        store.setSecrets({ geminiKey: '', updatedAt: new Date().toISOString() });
        toast('구글 드라이브에 저장한 API 키를 지웁니다');
      }
      render();
      document.getElementById('key-drive')?.focus();
    },
  });
  return h('div', { class: 'stack gap-1' },
    h('label', { class: 'row check-row', for: 'key-drive' }, box, h('span', {}, '드라이브에도 저장 (다른 PC에서도 쓰기)')),
    h('p', { class: 'hint', id: 'key-drive-hint' }, reason || '기본은 꺼짐입니다. 켜면 키가 구글 드라이브 앱 폴더의 데이터 파일에 함께 저장됩니다.'));
}

// ---------- 학교, 학기 ----------
function schoolSection() {
  const s = S();
  const year = h('input', {
    class: 'input', type: 'number', id: 'set-year', min: '2020', max: '2100', value: String(s.schoolYear || new Date().getFullYear()),
    onchange: (e) => {
      const v = parseInt(e.target.value, 10);
      if (!Number.isFinite(v) || v < 2020 || v > 2100) { e.target.setAttribute('aria-invalid', 'true'); toast('학년도를 확인해 주세요', { danger: true }); return; }
      e.target.removeAttribute('aria-invalid');
      store.updateSettings({ schoolYear: v });
    },
  });
  return section('set-school-title', '학교와 학기',
    h('div', { class: 'field' },
      h('span', { class: 'label', id: 'level-label' }, '학교급'),
      seg({
        labelledby: 'level-label',
        options: [['high', '고등학교'], ['middle', '중학교']],
        value: s.schoolLevel,
        onChange: async (v) => {
          store.updateSettings({ schoolLevel: v });
          const ok = await confirmDialog({
            title: '바이트 한도도 바꿀까요?',
            body: `영역별 바이트 한도를 ${v === 'high' ? '고등학교' : '중학교'} 기본값으로 바꿉니다. 직접 고친 한도가 있으면 사라집니다.`,
            ok: '기본값으로 바꾸기', cancel: '그대로 두기',
          });
          if (ok) { store.updateSettings({ limits: { ...DEFAULT_LIMITS[v] } }); toast('한도를 기본값으로 바꿨습니다'); }
          render();
        },
      })),
    h('div', { class: 'row align-end' },
      field('학년도', year),
      h('div', { class: 'field' },
        h('span', { class: 'label', id: 'sem-label' }, '학기'),
        seg({ labelledby: 'sem-label', options: [[1, '1학기'], [2, '2학기']], value: Number(s.semester) || 1, onChange: (v) => store.updateSettings({ semester: v }) }))));
}

// ---------- 한도 ----------
function limitSection() {
  const s = S();
  return section('set-limit-title', '영역별 바이트 한도',
    alertBox('warn', '학교 기준을 확인하세요. 기본값은 고·중 모두 1,500 byte, 행동특성 900 byte입니다. 한글 1자는 3 byte, 영문·숫자·띄어쓰기는 1 byte로 셉니다.'),
    h('div', { class: 'limit-grid' }, AREAS.map((a) => {
      const hintId = uid('lim');
      const hint = h('span', { class: 'hint', id: hintId }, `한글 약 ${charsForBytes(s.limits[a])}자`);
      return h('div', { class: 'field' },
        h('label', { class: 'label', for: `lim-${a}` }, AREA_LABELS[a]),
        h('input', {
          class: 'input', type: 'number', id: `lim-${a}`, min: '100', max: '10000', step: '1', value: String(s.limits[a]), 'aria-describedby': hintId,
          onchange: (e) => {
            const v = parseInt(e.target.value, 10);
            if (!Number.isFinite(v) || v < 100 || v > 10000) { e.target.setAttribute('aria-invalid', 'true'); toast('100에서 10000 사이 숫자로 적어 주세요', { danger: true }); return; }
            e.target.removeAttribute('aria-invalid');
            store.updateSettings({ limits: { ...S().limits, [a]: v } });
            hint.textContent = `한글 약 ${charsForBytes(v)}자`;
          },
        }),
        hint);
    })),
    h('div', { class: 'row' }, h('button', {
      type: 'button', class: 'btn btn-ghost',
      onclick: () => { store.updateSettings({ limits: { ...DEFAULT_LIMITS[S().schoolLevel || 'high'] } }); toast('한도를 기본값으로 되돌렸습니다'); render(); },
    }, icon('undo'), '기본값으로 되돌리기')));
}

// ---------- 모델, 간격 ----------
function modelSection() {
  const models = S().models || [];
  const setModels = (list, focusId) => { store.updateSettings({ models: list }); render(); if (focusId) document.getElementById(focusId)?.focus(); };
  const input = h('input', { class: 'input', type: 'text', id: 'model-new', autocomplete: 'off', spellcheck: 'false', placeholder: '예: gemini-2.5-flash' });
  const interval = h('input', {
    class: 'input', type: 'number', id: 'set-interval', min: '1', max: '120', value: String(S().batchIntervalSec ?? 5),
    onchange: (e) => {
      const v = parseInt(e.target.value, 10);
      if (!Number.isFinite(v) || v < 1 || v > 120) { e.target.setAttribute('aria-invalid', 'true'); toast('1에서 120 사이로 적어 주세요', { danger: true }); return; }
      e.target.removeAttribute('aria-invalid');
      store.updateSettings({ batchIntervalSec: v });
    },
  });
  return section('set-model-title', 'AI 모델과 일괄 간격',
    h('p', { class: 'small' }, '위에서부터 차례로 씁니다. 한도 초과나 혼잡이면 다음 모델로 넘어갑니다.'),
    h('ol', { class: 'model-list' }, models.map((m, i) => h('li', { class: 'row-between model-item' },
      h('span', { class: 'num' }, `${i + 1}. ${m}`),
      h('span', { class: 'row' },
        h('button', { type: 'button', class: 'icon-btn', id: `model-up-${i}`, disabled: i === 0, 'aria-label': `${m} 위로`, onclick: () => { const l = [...models]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; setModels(l, `model-up-${i - 1}`); } }, icon('up')),
        h('button', { type: 'button', class: 'icon-btn', id: `model-down-${i}`, disabled: i === models.length - 1, 'aria-label': `${m} 아래로`, onclick: () => { const l = [...models]; [l[i + 1], l[i]] = [l[i], l[i + 1]]; setModels(l, `model-down-${i + 1}`); } }, icon('down')),
        h('button', { type: 'button', class: 'icon-btn', disabled: models.length <= 1, 'aria-label': `${m} 지우기`, onclick: () => { setModels(models.filter((_, j) => j !== i), 'model-new'); toast(`${m}을 목록에서 뺐습니다`); } }, icon('trash')))))),
    h('div', { class: 'row align-end' },
      field('모델 추가', input),
      h('button', {
        type: 'button', class: 'btn btn-secondary',
        onclick: () => {
          const v = input.value.trim();
          if (!/^[a-z0-9][a-z0-9.\-]{2,60}$/i.test(v)) { toast('모델 이름을 확인해 주세요 (예: gemini-2.5-flash)', { danger: true }); input.focus(); return; }
          if (models.includes(v)) { toast('이미 있는 모델입니다'); return; }
          setModels([...models, v], 'model-new');
        },
      }, icon('plus'), '추가하기'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { setModels([...DEFAULT_MODELS], 'model-new'); toast('모델 목록을 기본값으로 되돌렸습니다'); } }, icon('undo'), '기본값으로')),
    field('일괄 초안 간격 (초)', interval, '한 명을 만든 뒤 쉬는 시간입니다. 무료 키는 분당 요청 수가 적으니 5초 이상을 권합니다.'));
}

// ---------- 금지 표현 ----------
function areaValue(areas) {
  if (!areas || !areas.length) return '';
  if (areas.length === 1) return areas[0];
  return `multi:${areas.join(',')}`;
}

function forbiddenSection() {
  const list = S().forbidden || [];
  const save = (next) => store.updateSettings({ forbidden: next });
  const patchEntry = (id, patch) => save((S().forbidden || []).map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const q = forbiddenQuery.trim();
  const shown = q ? list.filter((e) => [e.term, e.category, e.basis, e.replace].some((x) => String(x || '').includes(q))) : list;
  const rows = shown.map((e) => {
    const termInput = h('input', {
      class: 'input', type: 'text', value: e.term || '', id: `fb-term-${e.id}`, 'aria-label': '찾을 말', 'aria-invalid': validRegex(e) ? null : 'true',
      onchange: (ev) => {
        const term = ev.target.value.trim();
        const ok = validRegex({ ...e, term });
        ev.target.setAttribute('aria-invalid', ok ? 'false' : 'true');
        if (!ok) { toast('정규식이 올바르지 않습니다. 고치기 전까지 이 줄은 검사에 쓰이지 않을 수 있습니다', { danger: true }); }
        patchEntry(e.id, { term });
      },
    });
    const areaOpts = [h('option', { value: '' }, '모든 영역'), ...AREAS.map((a) => h('option', { value: a }, AREA_LABELS[a]))];
    const av = areaValue(e.areas);
    if (av.startsWith('multi:')) areaOpts.push(h('option', { value: av }, e.areas.map((a) => AREA_LABELS[a] || a).join(', ')));
    return h('tr', {},
      h('td', {}, termInput),
      h('td', {}, h('select', { class: 'select', 'aria-label': '찾는 방식', value: e.match || 'word', onchange: (ev) => patchEntry(e.id, { match: ev.target.value }) },
        MATCH_LABELS.map(([v, t]) => h('option', { value: v }, t)))),
      h('td', {}, h('select', { class: 'select', 'aria-label': '분류', value: CATEGORIES.includes(e.category) ? e.category : '기타', onchange: (ev) => patchEntry(e.id, { category: ev.target.value }) },
        CATEGORIES.map((c) => h('option', { value: c }, c)))),
      h('td', {}, h('input', { class: 'input', type: 'text', value: e.basis || '', 'aria-label': '근거', onchange: (ev) => patchEntry(e.id, { basis: ev.target.value }) })),
      h('td', {}, h('input', { class: 'input', type: 'text', value: e.replace || '', 'aria-label': '바꿀 표현', onchange: (ev) => patchEntry(e.id, { replace: ev.target.value }) })),
      h('td', {}, h('select', {
        class: 'select', 'aria-label': '적용 영역', value: av,
        onchange: (ev) => {
          const v = ev.target.value;
          patchEntry(e.id, { areas: !v ? [] : v.startsWith('multi:') ? v.slice(6).split(',') : [v] });
        },
      }, areaOpts)),
      h('td', {}, h('button', {
        type: 'button', class: 'icon-btn', 'aria-label': `${e.term || '빈 줄'} 지우기`,
        onclick: () => {
          const before = clone(S().forbidden);
          save(before.filter((x) => x.id !== e.id));
          renderForbiddenOnly();
          toast(`'${e.term}'을 지웠습니다`, { action: '되돌리기', onAction: () => { save(before); renderForbiddenOnly(); } });
          focusEl(document.getElementById('fb-add'));
        },
      }, icon('trash'))));
  });
  const search = h('input', {
    class: 'input', type: 'search', id: 'fb-search', value: forbiddenQuery, autocomplete: 'off', placeholder: '말, 분류, 근거로 찾기',
    oninput: (ev) => { forbiddenQuery = ev.target.value; renderForbiddenOnly(); document.getElementById('fb-search')?.focus(); },
  });
  return section('set-fb-title', `금지 표현 ${list.length}개`,
    h('p', { class: 'small' }, '작성 화면 검사에 쓰는 목록입니다. 학교생활기록부 기재요령을 바탕으로 만들었고, 원문 쪽수는 확인이 필요합니다. 학교 지침에 맞게 고쳐 쓰세요.'),
    h('div', { class: 'row align-end' },
      field('찾기', search),
      h('button', {
        type: 'button', class: 'btn btn-secondary', id: 'fb-add',
        onclick: () => {
          const entry = { id: `u_${Date.now().toString(36)}`, term: '', match: 'word', category: '기타', basis: '', replace: '', areas: [] };
          forbiddenQuery = '';
          save([entry, ...(S().forbidden || [])]);
          renderForbiddenOnly();
          document.getElementById(`fb-term-${entry.id}`)?.focus();
        },
      }, icon('plus'), '금지 표현 추가하기'),
      h('button', {
        type: 'button', class: 'btn btn-ghost',
        onclick: async () => {
          const ok = await confirmDialog({ title: '기본 목록으로 되돌릴까요?', body: '직접 추가하거나 고친 금지 표현이 모두 사라집니다.', ok: '기본값으로 되돌리기', danger: true });
          if (!ok) return;
          save(clone(DEFAULT_FORBIDDEN));
          forbiddenQuery = '';
          renderForbiddenOnly();
          toast('금지 표현을 기본 목록으로 되돌렸습니다');
        },
      }, icon('undo'), '기본값으로 되돌리기')),
    h('div', { class: 'table-wrap is-scroll' }, h('table', { class: 'table forbidden-table' },
      h('caption', { class: 'sr-only' }, `금지 표현 목록${q ? `, '${q}' 찾은 결과 ${shown.length}개` : ''}`),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, '말'), h('th', { scope: 'col' }, '방식'), h('th', { scope: 'col' }, '분류'),
        h('th', { scope: 'col' }, '근거'), h('th', { scope: 'col' }, '바꿀 표현'), h('th', { scope: 'col' }, '영역'),
        h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, '지우기')))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: '7', class: 'muted' }, '찾은 금지 표현이 없습니다.'))))));
}

function validRegex(e) {
  if (e.match !== 'regex') return true;
  try { new RegExp(e.term, 'i'); return true; } catch { return false; }
}

let fbHost = null;
function renderForbiddenOnly() {
  if (fbHost) clear(fbHost, forbiddenSection());
}

let driveHost = null;
let saveHost = null;
/** 동기화 상태가 바뀌면 드라이브 칸과 맨 아래 저장 칸만 다시 그림 (입력 중인 다른 칸은 그대로) */
function renderSyncOnly() {
  const active = document.activeElement?.id;
  if (driveHost) clear(driveHost, driveSection());
  if (saveHost) clear(saveHost, saveAllSection());
  const el = active ? document.getElementById(active) : null;
  if (el && document.activeElement !== el) el.focus();
}

// ---------- 구글 드라이브 (contract 14-5) ----------
const lastSync = () => ctx.sync()?.status.lastSyncAt || null;

function driveSection() {
  const sync = ctx.sync();
  const st = sync?.status || { state: 'off', connected: false };
  const pc = !!S().publicPC;
  if (!ctx.drive.isConfigured()) {
    return section('set-drive-title', '구글 드라이브', alertBox('info', '이 주소에서는 구글 드라이브 연결을 쓸 수 없습니다. 데이터는 이 브라우저에만 저장됩니다.'));
  }
  const statusText = st.connected
    ? `연결됨${lastSync() ? `, 마지막 저장 ${ctx.hhmm(lastSync())}` : ''}`
    : '연결 안 됨: 이 브라우저에만 저장됩니다.';
  const problem = ['auth', 'error', 'offline'].includes(st.state) && st.message ? alertBox(st.state === 'error' ? 'danger' : 'warn', st.message) : null;
  const pcBox = h('input', {
    type: 'checkbox', id: 'set-public-pc', checked: pc,
    onchange: (e) => {
      store.updateSettings({ publicPC: e.target.checked });
      toast(e.target.checked ? '공용 PC로 씁니다. 구글 연결은 이 창을 닫으면 지워집니다' : '공용 PC 설정을 껐습니다');
      render();
      document.getElementById('set-public-pc')?.focus();
    },
  });
  return section('set-drive-title', '구글 드라이브',
    h('p', { class: ['small', st.connected ? null : 'text-danger'], role: 'status' }, statusText),
    problem,
    h('p', { class: 'small' }, '명단, 반, 기록, 설정, 내 스타일을 선생님 구글 드라이브의 앱 전용 폴더(sgb-data.json)에 저장합니다. 이 폴더는 드라이브 목록에 보이지 않고 공유되지 않습니다. 이 브라우저의 사본은 인터넷이 끊겼을 때를 위한 임시 저장입니다.'),
    h('div', { class: 'row' },
      st.connected ? null : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => ctx.connectDrive() }, icon('drive'), '연결하기'),
      st.connected ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => ctx.saveToDrive() }, icon('drive'), '지금 동기화하기') : null,
      st.connected ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: disconnectDialog }, '연결 끊기') : null),
    h('label', { class: 'row check-row', for: 'set-public-pc' }, pcBox, h('span', {}, '공용 PC')),
    h('p', { class: 'hint' }, '켜면 구글 연결 정보를 이 창에만 두고(창을 닫으면 지워짐), API 키를 드라이브에 저장하지 않습니다.'),
    st.connected ? h('details', { class: 'key-guide' },
      h('summary', {}, '드라이브의 생기부 데이터 지우기'),
      h('div', { class: 'stack' },
        h('p', { class: 'small' }, '구글 드라이브 앱 폴더의 생기부 데이터 파일과 자동 백업을 지우고 연결을 끊습니다. 출결 앱 파일은 지우지 않습니다. 이 브라우저 사본은 남습니다.'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-danger', onclick: deleteDriveData }, icon('trash'), '드라이브의 생기부 데이터 지우기')))) : null);
}

async function disconnectDialog() {
  const dlg = openDialog({
    title: '구글 드라이브 연결을 끊을까요?',
    body: h('p', {}, '드라이브의 데이터는 그대로 남습니다. 이 브라우저의 사본을 어떻게 할지 고르세요.'),
    actions: [
      { label: '취소', variant: 'ghost', value: null },
      { label: '사본은 남기기', variant: 'secondary', value: 'keep' },
      { label: '이 브라우저 사본도 지우기 (공용 PC 추천)', variant: 'danger', value: 'wipe' },
    ],
  });
  const v = await dlg.closed;
  if (v !== 'keep' && v !== 'wipe') return;
  try {
    await ctx.sync().disconnect({ wipeLocal: v === 'wipe' });
    if (v === 'wipe') store.clearApiKey();
    toast(v === 'wipe' ? '연결을 끊고 이 브라우저 사본과 API 키를 지웠습니다' : '구글 드라이브 연결을 끊었습니다');
  } catch (e) {
    console.error(e);
    toast('연결을 끊지 못했습니다', { danger: true });
  }
  render();
  focusEl(root?.querySelector('#set-drive-title'));
}

async function deleteDriveData() {
  const ok1 = await confirmDialog({ title: '드라이브의 생기부 데이터를 지울까요?', body: '구글 드라이브에 저장된 명단, 기록, 설정, 자동 백업이 모두 지워집니다. 출결 앱 파일은 지우지 않습니다.', ok: '지우기', danger: true });
  if (!ok1) return;
  const ok2 = await confirmDialog({ title: '정말 지울까요?', body: '마지막 확인입니다. 이 브라우저 사본이나 백업 파일이 없으면 되살릴 수 없습니다.', ok: '드라이브에서 지우기', danger: true });
  if (!ok2) return;
  try {
    const n = await ctx.sync().deleteDriveData();
    toast(`드라이브에서 파일 ${n}개를 지우고 연결을 끊었습니다`);
  } catch (e) {
    toast(e?.userMessage || '드라이브에서 지우지 못했습니다', { danger: true });
  }
  render();
}

function saveAllSection() {
  if (!ctx.drive.isConfigured()) return null;
  const st = ctx.sync()?.status;
  const unsaved = st?.connected && S().updatedAt && (!lastSync() || S().updatedAt > lastSync());
  return h('section', { class: 'card stack', 'aria-labelledby': 'set-save-title' },
    h('h2', { class: 'card-title sr-only', id: 'set-save-title' }, '설정 저장'),
    h('p', { class: 'small', 'aria-live': 'polite' }, unsaved ? '저장 안 된 설정이 있습니다' : ''),
    h('div', { class: 'row' }, h('button', {
      type: 'button', class: 'btn btn-primary', id: 'set-save-drive', disabled: st?.state === 'saving',
      onclick: () => ctx.saveToDrive(),
    }, icon('drive'), st?.connected ? '설정을 구글 드라이브에 저장' : '구글 드라이브 연결')));
}

// ---------- 모든 데이터 지우기 ----------
function wipeSection() {
  return section('set-wipe-title', '모든 데이터 지우기',
    h('p', { class: 'small' }, '이 브라우저에 저장된 명단, 반, 기록, 설정과 API 키를 모두 지웁니다. 구글 드라이브의 데이터는 지우지 않습니다(위 구글 드라이브 칸에서 따로 지움). 드라이브에 연결하지 않았다면 되돌릴 수 없으니 먼저 백업 파일을 내보내 두세요.'),
    h('div', { class: 'row' }, h('button', {
      type: 'button', class: 'btn btn-danger',
      onclick: async () => {
        const ok1 = await confirmDialog({ title: '모든 데이터를 지울까요?', body: '명단, 반, 메모, 초안, 최종본, 설정, API 키가 모두 사라집니다.', ok: '지우기', danger: true });
        if (!ok1) return;
        const ok2 = await confirmDialog({ title: '정말 지울까요?', body: '마지막 확인입니다. 지운 뒤에는 백업 파일로만 되살릴 수 있습니다.', ok: '모두 지우기', danger: true });
        if (!ok2) return;
        try {
          await store.wipeAll();
          location.hash = '#roster';
          location.reload();
        } catch (e) {
          console.error(e);
          toast('지우지 못했습니다. 다른 탭을 닫고 다시 해 주세요.', { danger: true });
        }
      },
    }, icon('trash'), '모든 데이터 지우기')));
}

// ---------- 개발용 ----------
const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권'];
const GIVEN = ['가온', '나래', '다솜', '라온', '마루', '바다', '새봄', '아라', '자람', '하늘', '한결', '누리', '도담', '보람', '슬기', '여름', '은솔', '지음', '초롱', '해솔', '다온', '로운', '미르', '소리', '온유', '윤슬', '이든', '찬별', '푸름', '하람'];
const SAMPLE_MEMOS = [
  '학급 회의에서 체육대회 역할 분담 안을 정리해 칠판에 적고, 친구들 의견을 받아 두 번 고침. 준비물 목록을 만들어 반 게시판에 붙임.',
  '환경 캠페인 주간에 분리배출 안내문을 직접 만들어 복도에 붙이고, 점심시간마다 교실 재활용함을 점검함.',
  '진로 탐색 시간에 관심 있는 직업(간호사)을 조사하여 하는 일, 필요한 공부, 하루 일과를 표로 정리해 발표함.',
  '모둠 활동에서 말수가 적은 친구에게 먼저 역할을 묻고 자료 찾기를 함께 함. 발표 자료의 글자 크기와 배치를 고쳐 보기 쉽게 만듦.',
  '부족',
  '수업 시간에 실험 결과가 예상과 달라 그 까닭을 세 가지로 나누어 적고, 다시 실험하여 온도 조건이 원인임을 확인함.',
];

function devSection() {
  if (!ctx.devMode) return null;
  const s = S();
  const cb = h('input', {
    type: 'checkbox', id: 'dev-fake', checked: !!s.devFakeAI,
    onchange: (e) => { store.updateSettings({ devFakeAI: e.target.checked }); toast(e.target.checked ? '가짜 AI를 켰습니다. AI로 아무것도 보내지 않습니다.' : '가짜 AI를 껐습니다'); },
  });
  return section('set-dev-title', '개발용',
    alertBox('info', '주소에 ?dev=1 이 있을 때만 보이는 시험용 기능입니다.'),
    h('label', { class: 'row check-row', for: 'dev-fake' }, cb, h('span', {}, '가짜 AI 켜기 (키 없이 초안 흐름 시험)')),
    h('label', { class: 'row check-row', for: 'dev-fake-drive' }, h('input', {
      type: 'checkbox', id: 'dev-fake-drive', checked: ctx.fakeDrive,
      onchange: (e) => {
        try { if (e.target.checked) localStorage.setItem(FAKE_DRIVE_FLAG, '1'); else localStorage.removeItem(FAKE_DRIVE_FLAG); } catch { /* 넘어감 */ }
        toast('새로고침하면 바뀝니다. 가짜 드라이브는 구글로 아무것도 보내지 않습니다.', { action: '새로고침', onAction: () => location.reload() });
      },
    }), h('span', {}, '가짜 드라이브 켜기 (새로고침 필요)')),
    h('div', { class: 'row' },
      h('button', {
        type: 'button', class: 'btn btn-secondary',
        onclick: () => makeFakeClass(),
      }, icon('users'), '가상 학생 30명 반 만들기'),
      h('button', {
        type: 'button', class: 'btn btn-secondary',
        onclick: async () => {
          const ok = await confirmDialog({ title: '사본만 지울까요?', body: '사이트 데이터 지우기를 흉내 냅니다. 이 브라우저의 IndexedDB 사본과 동기화 상태만 지우고 새로고침합니다. 가짜 드라이브 파일과 API 키는 남습니다.', ok: '사본만 지우기', danger: true });
          if (!ok) return;
          await store.wipeLocalCopy();
          location.reload();
        },
      }, icon('trash'), '사본만 지우기')));
}

function makeFakeClass() {
  // 학번 3NN01~3NN30 이 하나도 쓰이지 않은 반 번호(90~99)만 씀. 기존 학생·기록은 덮어쓰지 않음
  const free = [];
  for (let n = 90; n <= 99; n += 1) {
    const used = [...store.state.students.keys()].some((id) => id.startsWith(`3${n}`));
    if (!used) free.push(String(n));
  }
  if (!free.length) { toast('가상 반에 쓸 반 번호(3학년 90~99반)가 모두 쓰이고 있습니다. 쓰지 않는 가상 반을 지운 뒤 다시 해 주세요.', { danger: true }); return; }
  const classNo = free[0];
  const students = [];
  for (let i = 1; i <= 30; i += 1) {
    const no = String(i).padStart(2, '0');
    // 학번: 학년 3 + 반 2자리 + 번호 2자리
    students.push({ studentId: `3${classNo}${no}`, name: `${SURNAMES[i % SURNAMES.length]}${GIVEN[(i * 7) % GIVEN.length]}` });
  }
  store.upsertStudents(students);
  const cls = store.createClass({ name: `시험용 3학년 ${Number(classNo)}반`, kind: 'homeroom' });
  store.addStudentsToClass(cls.id, students.map((x) => x.studentId));
  const t = new Date().toISOString();
  const recs = [];
  students.slice(0, 8).forEach((st, i) => {
    const area = i % 2 ? 'career' : 'autonomy';
    const r = { ...newRecord(st.studentId, area, null), memo: SAMPLE_MEMOS[i % SAMPLE_MEMOS.length], updatedAt: t };
    r.id = recordKey(st.studentId, area, null);
    r.status = deriveStatus(r);
    recs.push(r);
  });
  store.putRecords(recs.filter((r) => !store.state.records.has(r.id)));
  toast(`'${cls.name}'에 가상 학생 30명을 만들었습니다`);
}

// ---------- 그리기 ----------
function render() {
  if (!root) return;
  const y = window.scrollY;
  fbHost = h('div', {});
  driveHost = h('div', {});
  saveHost = h('div', {});
  clear(root,
    viewHeader('설정', '설정은 구글 드라이브(연결했을 때)와 백업 파일에 함께 저장됩니다. API 키는 백업 파일에 들어가지 않습니다.'),
    keySection(),
    driveHost,
    h('div', { class: 'grid-2' }, schoolSection(), modelSection()),
    limitSection(),
    fbHost,
    wipeSection(),
    devSection(),
    saveHost);
  renderForbiddenOnly();
  renderSyncOnly();
  window.scrollTo(0, y);
}

export const settingsView = {
  mount(el, params, c) {
    ctx = c;
    root = h('div', { class: 'view view-settings stack' });
    el.appendChild(root);
    render();
    if (params?.get('card') === 'drive') focusEl(root.querySelector('#set-drive-title'));
  },
  update(kind) {
    if (kind === 'all') render();
    if (kind === 'sync' || kind === 'settings') renderSyncOnly();
    if (kind === 'secrets' || (kind === 'sync' && keyConnected !== ctx.syncConnected())) {
      const active = document.activeElement?.id;
      render();
      if (active) document.getElementById(active)?.focus();
    }
    if (kind === 'key') {
      const active = document.activeElement?.id;
      render();
      if (active) document.getElementById(active)?.focus();
    }
  },
  unmount() { root = null; fbHost = null; driveHost = null; saveHost = null; },
};
