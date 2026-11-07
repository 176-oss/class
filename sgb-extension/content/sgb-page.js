/* 생기부 도우미 - 나이스 페이지 스크립트 (MAIN world)
   화면별 id·이름은 sgb-config.js 에서 읽는다. cpr 접근·버튼 차단·확인창 처리 방식은 출결 확장 page.js 와 같다.
   확장이 누르는 것: 선생님이 [이대로 저장]을 누른 뒤의 [저장], 문구가 정확히 '저장하시겠습니까?'인 확인창과 '저장했습니다.' 알림의 [확인].
   그 밖의 버튼과 확인창은 누르지 않는다. 조회 조건도 바꾸지 않는다.
   설정의 verified 가 false 이면 진짜 나이스 주소에서는 읽기만 한다 (입력·저장 명령 거부).
   bridge(격리 world)와 window.postMessage 로만 통신하며, 나이스 콘솔에는 아무것도 출력하지 않는다. */
(function () {
  'use strict';
  if (window.__sgbNeisPageLoaded) return;
  window.__sgbNeisPageLoaded = true;

  const CFG = window.__sgbNeisConfig;
  delete window.__sgbNeisConfig;
  if (!CFG) return;
  const CHANNEL = 'sgb-neis-bridge-v1';
  const MOCK = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const WRITE_ALLOWED = MOCK || CFG.verified === true;

  let nonce = null;
  let abortSeq = 0;
  let busy = false;

  // ---------- 통신 ----------
  function post(msg) { window.postMessage(Object.assign({ channel: CHANNEL, from: 'page', nonce }, msg), '*'); }
  function emit(event) { if (nonce) post({ type: 'event', event }); }
  // 작업 기록에는 번호만 남긴다 (이름·본문 금지)
  function log(msg, level) { emit({ type: 'log', level: level || 'info', msg: String(msg), at: Date.now() }); }

  class NeisError extends Error {
    constructor(code, message, data) { super(message); this.code = code; this.data = data || null; }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function checkAbort(seq) { if (seq !== undefined && seq !== abortSeq) throw new NeisError('aborted', '작업을 멈췄습니다.'); }
  async function waitFor(fn, opt) {
    const timeout = opt.timeout || 5000, t0 = Date.now();
    for (;;) {
      checkAbort(opt.seq);
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new NeisError(opt.code || 'timeout', `${opt.what} (${Math.round(timeout / 1000)}초 동안 기다렸지만 확인되지 않았습니다.)`);
      await sleep(opt.interval || 100);
    }
  }

  // shared/sgb-model.js 의 normText·normName 과 같은 규칙이어야 한다 (나이스 값 비교용)
  const normText = (s) => String(s ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
  const normName = (s) => String(s ?? '').replace(/\s+/g, '');

  // ---------- cpr 접근 ----------
  function instances() {
    const P = window.cpr && window.cpr.core && window.cpr.core.Platform && window.cpr.core.Platform.INSTANCE;
    if (!P || typeof P.getAllRunningAppInstances !== 'function') return null;
    try { return P.getAllRunningAppInstances() || []; } catch (e) { return []; }
  }
  function findScreen() {
    for (const s of CFG.screens) {
      const inst = (instances() || []).find((i) => i && i.app && String(i.app.id || '').includes(s.appId));
      if (inst) return { s, inst };
    }
    return null;
  }
  function screen() {
    const f = findScreen();
    if (!f) throw new NeisError('no_screen', '나이스 생기부 입력 화면을 찾지 못했습니다. 생기부 입력 화면을 연 뒤 다시 시도하세요.');
    return f;
  }
  function ctrl(inst, id) {
    const c = inst && typeof inst.lookup === 'function' ? inst.lookup(id) : null;
    if (!c) throw new NeisError('no_control', `나이스 화면에서 '${id}' 요소를 찾지 못했습니다. 화면 구조가 바뀌었을 수 있습니다.`);
    return c;
  }
  function dataSet(inst) {
    const g = ctrl(inst, CFG.grid.id);
    const ds = g.dataSet || (typeof g.getDataSet === 'function' ? g.getDataSet() : null);
    if (!ds || typeof ds.getRowCount !== 'function') throw new NeisError('no_dataset', '학생 표의 데이터를 읽지 못했습니다.');
    return ds;
  }
  const val = (ds, r, c) => { const v = ds.getValue(r, c); return v == null ? '' : String(v); };
  const isClean = (st) => st === 1 || st === 0;
  const COL = CFG.grid.cols;

  // ---------- 조회 조건 ----------
  function readCond(f) {
    const dm = f.inst.lookup(CFG.search.dm);
    if (!dm || typeof dm.getValue !== 'function') return null;
    const get = (k) => { const c = CFG.search.cols[k]; const v = c ? dm.getValue(c) : null; return v == null ? '' : String(v); };
    let area = f.s.area || null;
    if (!area) {
      const code = get('area');
      area = Object.keys(CFG.search.areaCodes).find((k) => CFG.search.areaCodes[k] === code) || null;
    }
    return {
      screen: f.s.key, screenLabel: f.s.label,
      schoolYear: Number(get('schoolYear')) || null, semester: Number(get('semester')) || null,
      grade: Number(get('grade')) || null, classNo: Number(get('classNo')) || null,
      area, subject: area === 'subject' ? get('subject') : null,
    };
  }
  // 입력·저장 직전마다: 화면 조건이 사이드 패널이 보고 시작한 조건과 같은지
  function assertCond(f, want) {
    const now = readCond(f);
    if (!now || !want) throw new NeisError('no_cond', '나이스 조회 조건을 읽지 못했습니다.');
    for (const k of ['screen', 'schoolYear', 'semester', 'grade', 'classNo', 'area', 'subject']) {
      if (String(now[k] ?? '') !== String(want[k] ?? '')) {
        throw new NeisError('cond_changed', '나이스 조회 조건이 시작할 때와 달라져 멈췄습니다. 조건을 되돌리거나 사이드 패널을 다시 확인하세요.');
      }
    }
    return now;
  }
  function assertWrite() {
    if (!WRITE_ALLOWED) throw new NeisError('not_verified', '실제 나이스 생기부 화면 구조를 아직 확인하지 않아 입력하지 않습니다. 지금은 화면 감지와 구조 기록만 할 수 있습니다.');
  }

  // ---------- 버튼 ----------
  function assertClickable(id) {
    if (CFG.forbiddenIds.includes(id)) throw new NeisError('forbidden', `안전을 위해 '${id}' 버튼은 절대 누르지 않습니다.`);
    if (!CFG.clickableIds.includes(id)) throw new NeisError('forbidden', `'${id}' 버튼은 자동으로 누르지 않습니다.`);
  }
  function clickControl(inst, id) {
    assertClickable(id);
    const c = ctrl(inst, id);
    if (c.enabled === false) throw new NeisError('disabled', `나이스 '${id}' 버튼이 비활성 상태입니다.`);
    if (typeof c.click !== 'function') throw new NeisError('no_click', `나이스 '${id}' 버튼을 누를 수 없습니다.`);
    c.click();
    log(`${id} 버튼 누름`);
  }
  const D = CFG.dialogs;
  function cmnDialogs() {
    return (instances() || []).filter((i) => i && i.app && String(i.app.id || '').includes(D.appIdPart) && typeof i.lookup === 'function' && i.lookup(D.msgControl));
  }
  function cmnMessage(inst) {
    const o = inst.lookup(D.msgControl);
    return String(o.value != null && o.value !== '' ? o.value : (o.text != null ? o.text : ''));
  }
  const isConfirm = (inst) => String(inst.app.id).includes(D.confirmAppId);
  const normMsg = (m) => String(m || '').replace(/\s+/g, '');

  // ---------- 행 ----------
  function findRow(ds, no) {
    for (let r = 0; r < ds.getRowCount(); r++) if (Number(val(ds, r, COL.no)) === Number(no)) return r;
    return -1;
  }
  function setText(f, ds, r, text) {
    if (CFG.input.mode === 'control') {
      const g = ctrl(f.inst, CFG.grid.id);
      if (typeof g.selectRows !== 'function') throw new NeisError('no_select', '표에서 학생 행을 고르지 못했습니다.');
      g.selectRows([r]);
      ctrl(f.inst, CFG.input.textControl).value = text;
    } else {
      ds.setValue(r, COL.text, text);
    }
  }

  const commands = {
    async detect() {
      const list = instances();
      const f = findScreen();
      const out = { cpr: !!list, mock: MOCK, writeAllowed: WRITE_ALLOWED, verified: CFG.verified === true, cond: null, rowCount: 0, dirtyRows: 0, dialog: null };
      if (!f) return out;
      out.cond = readCond(f);
      try {
        const ds = dataSet(f.inst);
        out.rowCount = ds.getRowCount();
        for (let r = 0; r < out.rowCount; r++) if (!isClean(ds.getRowState(r))) out.dirtyRows++;
      } catch (e) { /* 표 없음 */ }
      const dlg = cmnDialogs()[0];
      if (dlg) out.dialog = cmnMessage(dlg);
      return out;
    },

    // 화면 구조 기록 (읽기 전용): 앱 id, 컨트롤 id·종류, 버튼 글자, 데이터 컬럼 이름. 데이터 값(학생 정보)은 읽지 않는다.
    async survey() {
      const out = { url: location.origin + location.pathname, at: new Date().toISOString(), apps: [] };
      for (const inst of instances() || []) {
        const app = { id: String(inst && inst.app && inst.app.id || ''), controls: [], data: [] };
        try {
          for (const c of inst.getContainer().getAllRecursiveChildren() || []) {
            if (!c || !c.id) continue;
            const item = { id: c.id, type: c.type || '' };
            if (c.type === 'button') item.label = String(c.value ?? c.text ?? '');
            app.controls.push(item);
          }
        } catch (e) { app.controlsError = true; }
        try {
          for (const d of (typeof inst.getAllDataControls === 'function' ? inst.getAllDataControls() : []) || []) {
            const cols = typeof d.getColumnNames === 'function' ? d.getColumnNames() : [];
            app.data.push({ id: d.id, type: d.type || '', columns: cols, rows: typeof d.getRowCount === 'function' ? d.getRowCount() : null });
          }
        } catch (e) { app.dataError = true; }
        out.apps.push(app);
      }
      return out;
    },

    // 조건에 맞는 학생들 본문 넣기. 이미 다른 글이 있는 학생, 이름 불일치, 표에 없는 학생은 넣지 않고 결과로 알린다.
    async fill(args, seq) {
      assertWrite();
      const f = screen();
      assertCond(f, args.cond);
      const ds = dataSet(f.inst);
      const results = [];
      for (const it of args.items || []) {
        checkAbort(seq);
        assertCond(f, args.cond);
        const r = findRow(ds, it.no);
        if (r < 0) { results.push({ id: it.id, status: 'not_found' }); log(`${it.no}번: 나이스 표에 없음`, 'warn'); continue; }
        if (normName(val(ds, r, COL.name)) !== normName(it.name)) { results.push({ id: it.id, status: 'name_mismatch' }); log(`${it.no}번: 이름이 다름`, 'warn'); continue; }
        const cur = normText(val(ds, r, COL.text));
        const want = normText(it.text);
        if (cur === want) { results.push({ id: it.id, status: isClean(ds.getRowState(r)) ? 'already' : 'entered' }); log(`${it.no}번: 나이스에 같은 글이 이미 있음`); continue; }
        if (cur) { results.push({ id: it.id, status: 'existing', neisText: cur }); log(`${it.no}번: 나이스에 다른 글이 있어 건너뜀`, 'warn'); continue; }
        setText(f, ds, r, it.text);
        await sleep(30);
        const after = normText(val(ds, r, COL.text));
        if (after !== want) { results.push({ id: it.id, status: 'mismatch', neisText: after }); log(`${it.no}번: 넣은 뒤 값이 보낸 글과 다름`, 'error'); continue; }
        results.push({ id: it.id, status: 'entered' });
        log(`${it.no}번 입력`);
        emit({ type: 'progress', done: results.length, total: args.items.length });
      }
      return { results };
    },

    // 저장: 바뀐 행이 모두 이번에 확장이 넣은 행이고 값이 확인한 글 그대로일 때만 [저장]. expect: [{ no, text }]
    async save(args, seq) {
      assertWrite();
      const f = screen();
      assertCond(f, args.cond);
      const ds = dataSet(f.inst);
      const expect = args.expect || [];
      const allowed = new Set(expect.map((e) => Number(e.no)));
      const stray = [];
      for (let r = 0; r < ds.getRowCount(); r++) {
        if (!isClean(ds.getRowState(r)) && !allowed.has(Number(val(ds, r, COL.no)))) stray.push(Number(val(ds, r, COL.no)));
      }
      if (stray.length) throw new NeisError('stray_change', `확장프로그램이 입력하지 않은 행이 바뀌어 있습니다 (${stray.join(', ')}번). 나이스에서 되돌리거나 [조회]로 처음부터 다시 하세요.`, { stray });
      for (const e of expect) {
        const r = findRow(ds, e.no);
        if (r < 0 || normText(val(ds, r, COL.text)) !== normText(e.text)) throw new NeisError('value_changed', `${e.no}번 본문이 확인한 글과 달라 저장하지 않았습니다.`);
      }
      checkAbort(seq);
      const before = new Set(cmnDialogs());
      clickControl(f.inst, 'btnSave');
      const dlg = await waitFor(() => cmnDialogs().find((d) => !before.has(d)), { timeout: 8000, what: '[저장] 뒤 나이스 확인창을 기다렸습니다.', code: 'save_no_confirm' });
      const q = cmnMessage(dlg);
      log(`[저장] 뒤 나이스 창: ${dlg.app.id}`);
      if (!isConfirm(dlg)) throw new NeisError('neis_alert', q, { message: q });
      if (normMsg(q) !== normMsg(D.saveConfirm)) throw new NeisError('neis_confirm', `예상하지 못한 확인창이 떠서 멈췄습니다: ${q}`, { message: q });
      clickControl(dlg, 'btnConfirm');
      try {
        const next = await waitFor(() => cmnDialogs().find((d) => d !== dlg && !before.has(d)), { timeout: 20000, what: '저장 결과 알림을 기다렸습니다.', code: 'save_no_alert' });
        const msg = cmnMessage(next);
        if (isConfirm(next)) throw new NeisError('neis_confirm', `저장 중 예상하지 못한 확인창이 떠서 멈췄습니다: ${msg}`, { message: msg });
        if (normMsg(msg).replace(/\.$/, '') !== normMsg(D.saveDone).replace(/\.$/, '')) throw new NeisError('neis_alert', msg, { message: msg });
        clickControl(next, 'btnConfirm');
        log('나이스가 "저장했습니다."를 알렸습니다.');
        // 저장 확인: 모든 행 상태 깨끗 + 넣은 글 유지 (저장 뒤 다시 조회되어도 같은 조건)
        let okCount = 0;
        await waitFor(() => {
          const d = dataSet(screen().inst);
          if (!d.getRowCount()) { okCount = 0; return false; }
          for (let r = 0; r < d.getRowCount(); r++) if (!isClean(d.getRowState(r))) { okCount = 0; return false; }
          okCount++;
          return okCount >= 2;
        }, { timeout: 15000, interval: 300, what: '나이스가 저장했다고 알렸지만 저장 뒤 표 상태를 확인하지 못했습니다.', code: 'save_verify' });
        const d = dataSet(screen().inst);
        for (const e of expect) {
          const r = findRow(d, e.no);
          if (r < 0 || normText(val(d, r, COL.text)) !== normText(e.text)) throw new NeisError('save_verify', `저장 뒤 ${e.no}번 본문이 확인한 글과 다릅니다. 나이스 표를 직접 확인하세요.`);
        }
      } catch (e) {
        if (e instanceof NeisError) e.data = Object.assign({}, e.data, { afterConfirm: true });
        throw e;
      }
      return { saved: true, count: expect.length };
    },

    // 차단 목록 확인 (아무것도 누르지 않음)
    async guardCheck() {
      const out = {};
      for (const id of CFG.forbiddenIds) { try { assertClickable(id); out[id] = false; } catch (e) { out[id] = true; } }
      return out;
    },

    async abort() { abortSeq++; return { ok: true }; },
  };

  // ---------- 메시지 처리 ----------
  window.addEventListener('message', async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.channel !== CHANNEL || d.from !== 'bridge') return;
    if (d.type === 'init') {
      if (nonce) return;
      if (typeof d.nonce !== 'string' || d.nonce.length < 16) return;
      nonce = d.nonce;
      post({ type: 'inited' });
      return;
    }
    if (!nonce || d.nonce !== nonce || d.type !== 'request') return;
    const { reqId, cmd, args } = d;
    const fn = Object.prototype.hasOwnProperty.call(commands, cmd) ? commands[cmd] : null;
    if (!fn) { post({ type: 'response', reqId, ok: false, error: { code: 'unknown', message: `알 수 없는 명령: ${cmd}` } }); return; }
    const exclusive = !['detect', 'abort', 'survey', 'guardCheck'].includes(cmd);
    if (exclusive && busy) for (let i = 0; i < 40 && busy; i++) await sleep(50);
    if (exclusive && busy) { post({ type: 'response', reqId, ok: false, error: { code: 'busy', message: '이전 작업이 아직 끝나지 않았습니다.' } }); return; }
    if (exclusive) busy = true;
    const seq = abortSeq;
    try {
      post({ type: 'response', reqId, ok: true, result: await fn(args || {}, seq) });
    } catch (e) {
      const err = e instanceof NeisError ? { code: e.code, message: e.message, data: e.data } : { code: 'error', message: `예상하지 못한 오류: ${e && e.message ? e.message : e}` };
      if (err.code !== 'aborted') log(err.message, 'error');
      post({ type: 'response', reqId, ok: false, error: err });
    } finally {
      if (exclusive) busy = false;
    }
  });

  post({ type: 'ready' });
})();
