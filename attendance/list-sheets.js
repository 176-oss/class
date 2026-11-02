// 설정의 목록 편집 시트: 구분 순서, 자주 쓰는 사유 (spec 14.3)
// 설정 화면에는 한 줄 요약만 두고, 목록은 시트(휴대폰 바텀시트, 600px 이상 가운데 대화상자)에서 편집한다.
// 시트 안에서 바꾼 내용은 [완료]를 누를 때 한 번에 저장(settings.updatedAt 1회).
// [취소]·닫기·바깥 누르기·Esc·뒤로 가기는 저장하지 않으며, 바뀐 것이 있으면 먼저 확인한다.
import { DIVS, DIV_ORDER, orderedDivs } from './shared/model.js';
import { store, updateSettings } from './store.js';
import { esc, icon, toast, openSheet, closeSheet, josa } from './ui.js';

// ---------- 사유 구분 선택지 ----------
// div 또는 div:tag(:kind). 구분 다섯 개는 설정 순서로 앞에 둔다
const REASON_TYPES = [
  ...DIV_ORDER.map((d) => [d, DIVS[d].ko]),
  ['keep', '구분 그대로 (사유만 채움)'],
  ['injung:periodPain', '출석인정 (생리통, 월 한도)'],
  ['injung:fieldTrip:absent', '출석인정 결석 (교외체험학습, 서류 2개)'],
];
export const reasonTypeKey = (q) => [q.div || 'keep', q.tag, q.tag === 'fieldTrip' ? (q.kind || 'absent') : null].filter(Boolean).join(':');
export const reasonTypeLabel = (q) => (REASON_TYPES.find(([k]) => k === reasonTypeKey(q)) || [null, DIVS[q.div]?.ko || ''])[1];
function reasonTypeOptions(settings) {
  const order = orderedDivs(settings);
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  return REASON_TYPES.map((t, i) => [t, i]).sort((a, b) => (rank(a[0][0]) - rank(b[0][0])) || (a[1] - b[1])).map(([t]) => t);
}
// 선택지 키 → 사유 항목 (label은 따로)
function reasonFromKey(label, key) {
  const [div, tag, kind] = key.split(':');
  const q = { label };
  if (div !== 'keep') q.div = div; // 'keep' = 사유만 채우고 구분은 바꾸지 않음
  if (kind) q.kind = kind;
  if (tag) q.tag = tag;
  return q;
}
const typeOptionsHtml = (selected) => reasonTypeOptions(store.data.settings)
  .map(([k, t]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(t)}</option>`).join('');

// ---------- 설정 화면 요약 ----------
export function divOrderSummary(settings) {
  return orderedDivs(settings).map((d) => DIVS[d].ko).join(', ');
}
export function reasonsSummary(settings) {
  const qs = settings.quickReasons || [];
  if (!qs.length) return '등록된 사유가 없습니다';
  const head = qs.slice(0, 3).map((q) => q.label).join(', ');
  return qs.length > 3 ? `${head} 외 ${qs.length - 3}개` : head;
}

// ---------- 공통 ----------
function orderBtns(i, n, name) {
  return `<span class="order-btns">
    <button type="button" class="icon-btn" data-move="-1" data-i="${i}" aria-label="${esc(name)} 위로 이동"${i === 0 ? ' disabled' : ''}>${icon('up')}</button>
    <button type="button" class="icon-btn" data-move="1" data-i="${i}" aria-label="${esc(name)} 아래로 이동"${i === n - 1 ? ' disabled' : ''}>${icon('down')}</button>
  </span>`;
}
function moveItem(arr, i, dir) {
  const j = i + dir;
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return true;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 목록 편집 시트 틀. spec: {id, title, lead, initial, list(draft), extra, after(ctx), save(draft), savedMsg, onClick(e, ctx)}
function listSheet(spec) {
  const titleId = `${spec.id}-title`;
  const ctx = { draft: structuredClone(spec.initial), closing: false };
  const dirty = () => !same(ctx.draft, spec.initial);
  let popped = false;

  const sheet = openSheet(`
    <div class="sheet-head">
      <h2 class="sheet-title" id="${titleId}">${esc(spec.title)}</h2>
      <button type="button" class="icon-btn" data-close aria-label="닫기">${icon('close')}</button>
    </div>
    <p class="small muted" style="margin: 0 0 var(--sp-3)">${esc(spec.lead)}</p>
    <div class="list-box" data-list></div>
    ${spec.extra || ''}
    <p class="sr-only" role="status" aria-live="polite" data-status></p>
    <div data-confirm></div>
    <div class="sheet-actions" data-actions>
      <button type="button" class="btn btn-secondary" data-cancel>취소</button>
      <button type="button" class="btn btn-primary" data-done>완료</button>
    </div>`, {
    labelledby: titleId,
    beforeClose: () => {
      if (ctx.closing || !dirty()) return true;
      askDiscard();
      return false;
    },
    onClose: () => {
      window.removeEventListener('popstate', onPop);
      // 열 때 넣은 기록 단계를 걷어 냄 (뒤로 가기로 닫힌 경우는 이미 빠짐)
      if (!popped && history.state && history.state.ahSheet === spec.id) history.back();
    },
  });
  sheet.dataset.listSheet = spec.id;

  // 뒤로 가기: 열 때 같은 주소로 기록 한 단계를 넣어 두고, 뒤로 가면 시트만 닫음
  history.pushState({ ...(history.state || {}), ahSheet: spec.id }, '');
  function onPop() {
    if (!sheet.isConnected) return;
    if (history.state && history.state.ahSheet === spec.id) return;
    if (dirty() && !ctx.closing) {
      history.pushState({ ...(history.state || {}), ahSheet: spec.id }, '');
      askDiscard();
      return;
    }
    popped = true;
    ctx.closing = true;
    closeSheet({ force: true });
  }
  window.addEventListener('popstate', onPop);

  const actions = sheet.querySelector('[data-actions]');
  const confirmBox = sheet.querySelector('[data-confirm]');
  function askDiscard() {
    if (confirmBox.firstElementChild) { confirmBox.querySelector('[data-keep]').focus(); return; }
    actions.hidden = true;
    confirmBox.innerHTML = `<div class="alert alert-block" role="alertdialog" aria-labelledby="${spec.id}-discard" aria-describedby="${spec.id}-discard-body" style="margin-top: var(--sp-4)">${icon('alert')}
      <div class="alert-body"><strong class="alert-title" id="${spec.id}-discard">저장하지 않고 닫을까요?</strong>
      <span id="${spec.id}-discard-body">바꾼 내용은 [완료]를 눌러야 저장됩니다.</span>
      <div class="alert-actions">
        <button type="button" class="btn btn-secondary" data-keep>계속 편집</button>
        <button type="button" class="btn btn-danger" data-discard>저장하지 않고 닫기</button>
      </div></div></div>`;
    confirmBox.scrollIntoView({ block: 'nearest' });
    confirmBox.querySelector('[data-keep]').focus();
  }
  function keepEditing() {
    confirmBox.innerHTML = '';
    actions.hidden = false;
    actions.querySelector('[data-done]').focus();
  }

  ctx.sheet = sheet;
  ctx.status = (msg) => { const el = sheet.querySelector('[data-status]'); el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; }); };
  ctx.render = () => {
    sheet.querySelector('[data-list]').innerHTML = spec.list(ctx.draft);
    spec.after?.(ctx);
  };
  // 위로·아래로 뒤 초점: 옮긴 항목의 같은 방향 버튼, 끝에 닿았으면 반대 방향
  ctx.focusMoved = (j, dir) => {
    const list = sheet.querySelector('[data-list]');
    const a = list.querySelector(`[data-move="${dir}"][data-i="${j}"]`);
    const b = list.querySelector(`[data-move="${-dir}"][data-i="${j}"]`);
    (a && !a.disabled ? a : b)?.focus();
  };
  ctx.render();

  sheet.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.matches('[data-close], [data-cancel]')) { closeSheet(); return; }
    if (t.matches('[data-keep]')) { keepEditing(); return; }
    if (t.matches('[data-discard]')) { ctx.closing = true; closeSheet(); return; }
    if (t.matches('[data-done]')) {
      const changed = dirty();
      if (changed) spec.save(ctx.draft);
      ctx.closing = true;
      closeSheet();
      if (changed) toast(spec.savedMsg);
      return;
    }
    if (t.matches('[data-move]')) {
      const i = Number(t.dataset.i), dir = Number(t.dataset.move);
      const arr = spec.items(ctx.draft);
      const name = spec.nameOf(arr[i]);
      if (!moveItem(arr, i, dir)) return;
      ctx.render();
      ctx.focusMoved(i + dir, dir);
      ctx.status(`${josa(name, '을', '를')} ${i + dir + 1}번째로 옮겼습니다`);
      return;
    }
    spec.onClick?.(t, ctx);
  });
  spec.bind?.(ctx);
  return ctx;
}

// ---------- 구분 순서 ----------
export function openDivOrderSheet() {
  return listSheet({
    id: 'div-order',
    title: '구분 순서',
    lead: '오늘 입력, 기록 수정, 학교 PC 확장프로그램의 구분 버튼이 이 순서로 나옵니다.',
    initial: orderedDivs(store.data.settings),
    items: (draft) => draft,
    nameOf: (d) => DIVS[d].ko,
    list: (draft) => `<ul class="list order-list" data-testid="div-order-list">${draft.map((d, i) => `
      <li class="list-row" data-div="${d}">
        <span class="order-pos num" aria-hidden="true">${i + 1}</span>
        <div class="list-main"><div class="list-title">${esc(DIVS[d].ko)}</div>${d === 'undecided' ? '<div class="list-meta">나이스에 넣기 전에 정하는 임시 구분</div>' : ''}</div>
        ${orderBtns(i, draft.length, DIVS[d].ko)}
      </li>`).join('')}</ul>`,
    extra: '<button type="button" class="btn btn-secondary btn-block" data-default style="margin-top: var(--sp-3)">기본 순서로</button>',
    after: (ctx) => { ctx.sheet.querySelector('[data-default]').disabled = same(ctx.draft, DIV_ORDER); },
    onClick: (t, ctx) => {
      if (!t.matches('[data-default]')) return;
      ctx.draft.splice(0, ctx.draft.length, ...DIV_ORDER);
      ctx.render();
      ctx.sheet.querySelector('[data-done]').focus();
      ctx.status('기본 순서로 되돌렸습니다. [완료]를 누르면 저장됩니다.');
    },
    save: (draft) => updateSettings({ divOrder: draft.slice() }),
    savedMsg: '구분 순서를 저장했습니다',
  });
}

// ---------- 자주 쓰는 사유 ----------
export function openReasonsSheet() {
  return listSheet({
    id: 'qr',
    title: '자주 쓰는 사유',
    lead: '오늘 입력 화면의 사유 버튼입니다. 누르면 고른 구분과 서류가 함께 선택됩니다.',
    initial: (store.data.settings.quickReasons || []).map((q) => ({ ...q })),
    items: (draft) => draft,
    nameOf: (q) => q.label,
    list: (draft) => draft.length ? `<ul class="list order-list" data-testid="qr-list">${draft.map((q, i) => `
      <li class="list-row reason-row">
        <div class="list-main"><div class="list-title">${esc(q.label)}</div></div>
        <select class="select" data-type="${i}" aria-label="${esc(q.label)} 구분">${typeOptionsHtml(reasonTypeKey(q))}</select>
        <span class="reason-row-btns">${orderBtns(i, draft.length, q.label)}<button type="button" class="icon-btn" data-del="${i}" aria-label="${esc(q.label)} 삭제">${icon('trash')}</button></span>
      </li>`).join('')}</ul>`
      : '<ul class="list" data-testid="qr-list"><li class="list-row"><span class="small muted">등록된 사유가 없습니다.</span></li></ul>',
    extra: `<div class="stack-sm" style="margin-top: var(--sp-4)">
        <div class="grid-2">
          <div class="field"><label class="label" for="qr-label">새 사유</label><input class="input" id="qr-label" type="text" maxlength="20" placeholder="예: 두통" aria-describedby="qr-add-err"></div>
          <div class="field"><label class="label" for="qr-type">구분</label><select class="select" id="qr-type">${typeOptionsHtml('ill')}</select></div>
        </div>
        <div class="error-text" id="qr-add-err" aria-live="polite"></div>
        <button type="button" class="btn btn-secondary btn-block" data-add>${icon('plus')}사유 추가</button>
      </div>`,
    onClick: (t, ctx) => {
      if (t.matches('[data-del]')) {
        const i = Number(t.dataset.del);
        const [removed] = ctx.draft.splice(i, 1);
        ctx.render();
        const list = ctx.sheet.querySelector('[data-list]');
        const next = list.querySelector(`[data-del="${Math.min(i, ctx.draft.length - 1)}"]`);
        (next || ctx.sheet.querySelector('#qr-label')).focus();
        ctx.status(`${josa(removed.label, '을', '를')} 지웠습니다. [완료]를 누르면 저장됩니다.`);
      } else if (t.matches('[data-add]')) {
        const input = ctx.sheet.querySelector('#qr-label');
        const err = ctx.sheet.querySelector('#qr-add-err');
        const label = input.value.trim();
        const fail = (msg) => { err.textContent = msg; input.setAttribute('aria-invalid', 'true'); input.focus(); };
        if (!label) return fail('사유를 입력하세요.');
        if (ctx.draft.some((q) => q.label === label)) return fail('이미 있는 사유입니다.');
        err.textContent = '';
        input.removeAttribute('aria-invalid');
        ctx.draft.push(reasonFromKey(label, ctx.sheet.querySelector('#qr-type').value));
        ctx.render();
        input.value = '';
        input.focus();
        ctx.status(`${josa(label, '을', '를')} 추가했습니다. [완료]를 누르면 저장됩니다.`);
      }
    },
    bind: (ctx) => {
      ctx.sheet.addEventListener('change', (e) => {
        const sel = e.target.closest('[data-type]');
        if (!sel) return;
        const i = Number(sel.dataset.type);
        ctx.draft[i] = reasonFromKey(ctx.draft[i].label, sel.value);
      });
      ctx.sheet.querySelector('#qr-label').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); ctx.sheet.querySelector('[data-add]').click(); }
      });
    },
    save: (draft) => updateSettings({ quickReasons: draft.map((q) => ({ ...q })) }),
    savedMsg: '자주 쓰는 사유를 저장했습니다',
  });
}
