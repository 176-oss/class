// 출결 입력 폼 (오늘 탭 빠른 입력, 기록 수정 시트 공용)
import {
  KINDS, KIND_ORDER, DIVS, DIV_ORDER, DOC_TYPES, ILL_DOC_TYPES, createRecord, newId, todayStr,
  weekdayKo, yearMonthOf, formatDateKo, isDateStr, describeKind,
} from './shared/model.js';
import {
  requiredDocs, checkParentNoteLimit, checkPeriodPainLimit, countParentNotes, parentNoteRecords,
  countPeriodPain, expandRange, validateRecord,
} from './shared/rules.js';
import { store, addRecords, updateRecord } from './store.js';
import { esc, icon, seg, quota, toast } from './ui.js';

// 교시 안내: 고르기 전에는 규칙, 고른 뒤에는 실제로 표시될 범위
function periodHint(kind, period, periods, n) {
  if (kind === 'late') return period ? `조회~${period}교시 없음 (${period}교시까지)` : '지각: 고른 교시까지 없음';
  if (kind === 'early') return period ? `${period}교시~종례 없음 (${period}교시부터)` : '조퇴: 고른 교시부터 없음';
  if (kind === 'result') return periods.length ? `${periods.join(', ')}교시만 없음` : '결과: 빠진 교시를 모두 고르세요';
  return '';
}

// 구분·태그가 바뀔 때 서류 배열을 다시 만들되, 이전에 고른 종류·제출 여부는 최대한 유지
export function docsFor(div, tag, prev = []) {
  const req = requiredDocs(div, tag);
  if (div === 'ill' && !tag && prev[0] && ILL_DOC_TYPES.includes(prev[0].type)) return [{ ...prev[0] }];
  return req.map((d) => {
    const same = prev.find((p) => p.type === d.type);
    return same ? { ...d, ...same } : d;
  });
}

export function monthWord(date) {
  return yearMonthOf(date) === yearMonthOf(todayStr()) ? '이번 달' : `${Number(date.slice(5, 7))}월`;
}

export class RecordForm {
  constructor(el, { prefix = 't', record = null, onDone = null, keepNo = false } = {}) {
    this.el = el;
    this.p = prefix;
    this.onDone = onDone;
    this.keepNo = keepNo;
    this.editId = record?.id || null;
    this.state = record ? this.fromRecord(record) : this.blank();
    this.showErrors = false;
    el.addEventListener('click', (e) => this.onClick(e));
    el.addEventListener('input', (e) => this.onInput(e));
    el.addEventListener('change', (e) => this.onChange(e));
    el.addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input[type=text], input[inputmode]')) { e.preventDefault(); e.target.blur(); }
    });
  }

  get settings() { return store.data.settings; }

  blank(prev) {
    return {
      date: prev?.date || todayStr(),
      range: false,
      endDate: '',
      no: prev && this.keepNo ? prev.no : '',
      kind: 'absent',
      div: 'ill',
      period: null,
      periods: [],
      reason: '',
      tag: null,
      docs: requiredDocs('ill', null),
      confirmPain: false,
      confirmDup: false,
    };
  }

  fromRecord(r) {
    return {
      date: r.date, range: false, endDate: '', no: r.no, kind: r.kind, div: r.div,
      period: r.period, periods: [...(r.periods || [])], reason: r.reason || '', tag: r.tag || null,
      docs: (r.docs || []).map((d) => ({ ...d })), confirmPain: false, confirmDup: false,
    };
  }

  id(name) { return `${this.p}-${name}`; }

  // 저장할 기록들 (기간이면 날짜별로)
  drafts() {
    const s = this.state;
    const dates = s.range && !this.editId ? expandRange(s.date, s.endDate) : [s.date];
    const groupId = dates.length > 1 ? newId('g') : null;
    const original = this.editId ? store.data.records.find((r) => r.id === this.editId) : null;
    return dates.map((date) => createRecord({
      id: this.editId || undefined,
      date, no: Number(s.no), kind: s.kind, div: s.div,
      period: s.period, periods: s.periods, reason: s.reason, tag: s.tag,
      docs: s.docs.map((d) => ({ ...d })),
      groupId: original ? original.groupId : groupId,
    }));
  }

  checks() {
    const records = store.data.records;
    const drafts = this.drafts().filter((d) => d.no >= 1);
    // 기간이 여러 달에 걸치면 문구에 '이번 달' 대신 'N월'로 어느 달인지 표시
    const months = new Set(drafts.map((d) => yearMonthOf(d.date)));
    const today = months.size > 1 ? null : todayStr();
    return {
      drafts,
      parent: checkParentNoteLimit(records, drafts, this.settings, today),
      pain: checkPeriodPainLimit(records, drafts, this.settings, today),
      dup: this.duplicates(drafts),
    };
  }

  // 같은 학생·같은 날짜의 다른 기록 (나이스는 하루 한 가지 마감 구분만 입력됨)
  duplicates(drafts) {
    const out = [];
    const original = this.editId ? store.data.records.find((r) => r.id === this.editId) : null;
    for (const d of drafts) {
      if (original && original.no === d.no && original.date === d.date) continue; // 원래 있던 상태는 다시 묻지 않음
      const same = store.data.records.filter((r) => r.id !== this.editId && r.no === d.no && r.date === d.date);
      if (same.length) out.push({ date: d.date, kinds: [...new Set(same.map((r) => KINDS[r.kind].ko))] });
    }
    return out;
  }

  dupMessage(dup) {
    const first = dup[0];
    const kinds = first.kinds.join('·');
    const when = dup.length > 1 ? `${formatDateKo(first.date, false)} 등 ${dup.length}일에` : (first.date === this.state.date && !this.state.range ? '같은 날' : `${formatDateKo(first.date, false)}에`);
    return `${when} 이미 ${kinds} 기록이 있습니다. 나이스에는 한 가지 구분만 입력됩니다. 그래도 저장할까요?`;
  }

  // ---------- 렌더 ----------
  render() {
    const active = document.activeElement;
    const focusId = active && this.el.contains(active) ? active.id : null;
    const selStart = focusId && 'selectionStart' in active ? safeSel(active) : null;
    this.el.innerHTML = this.html();
    if (focusId) {
      const again = document.getElementById(focusId);
      if (again) {
        again.focus({ preventScroll: true });
        if (selStart != null) { try { again.setSelectionRange(selStart, selStart); } catch { /* 무시 */ } }
      }
    }
  }

  html() {
    const s = this.state;
    const set = this.settings;
    const { parent, pain, dup } = this.checks();
    const parentBlocked = !parent.ok && s.docs.some((d) => d.type === 'parentNote');
    const painWarn = !pain.ok && s.tag === 'periodPain' && !s.confirmPain;
    const dupWarn = dup.length > 0 && !s.confirmDup;
    const errors = this.showErrors ? this.errors() : [];
    const noInvalid = this.showErrors && !(Number(s.no) >= 1 && Number(s.no) <= set.studentCount);

    const kindOpts = KIND_ORDER.map((k) => [k, KINDS[k].ko]);
    const divOpts = DIV_ORDER.map((d) => [d, DIVS[d].ko]);

    let rangeHtml = '';
    if (!this.editId) {
      const days = s.range ? expandRange(s.date, s.endDate).length : 0;
      rangeHtml = `
        <label class="switch">
          <input type="checkbox" id="${this.id('range')}" data-f="range"${s.range ? ' checked' : ''}>
          <span class="switch-track"></span><span class="small strong">기간으로 입력</span>
        </label>
        ${s.range ? `<div class="field">
          <div class="label-row"><label class="label" for="${this.id('end')}">종료일</label>${s.endDate ? `<span class="tiny muted">(${weekdayKo(s.endDate)})</span>` : ''}</div>
          <input id="${this.id('end')}" class="input num" type="date" data-f="endDate" value="${esc(s.endDate)}" min="${esc(s.date)}"${this.showErrors && !days ? ' aria-invalid="true"' : ''}>
          <div class="hint num">${days ? `주말을 빼고 ${days}일 · 날짜별로 따로 저장됩니다` : '종료일을 고르세요. 주말은 빠집니다.'}</div>
        </div>` : ''}`;
    }

    // 교시
    let periodHtml = '';
    if (s.kind !== 'absent') {
      const n = Number(set.periodsPerDay) || 7;
      let chips = '';
      for (let i = 1; i <= n; i++) {
        const on = s.kind === 'result' ? s.periods.includes(i) : s.period === i;
        chips += `<button type="button" class="chip chip-num" id="${this.id('p' + i)}" data-period="${i}" aria-pressed="${on}" aria-label="${i}교시">${i}</button>`;
      }
      periodHtml = `<div class="field">
        <div class="label-row"><span class="label" id="${this.id('plabel')}">교시</span><span class="tiny muted" id="${this.id('phint')}" aria-live="polite">${periodHint(s.kind, s.period, s.periods, n)}</span></div>
        <div class="chips chips-period" role="group" aria-labelledby="${this.id('plabel')}" style="grid-template-columns: repeat(${Math.min(n, 10)}, 1fr)">${chips}</div>
      </div>`;
    }

    // 사유
    const qr = (set.quickReasons || []).map((q, i) => {
      const on = s.reason === q.label && (q.tag || null) === (s.tag || null);
      return `<button type="button" class="chip" id="${this.id('qr' + i)}" data-qr="${i}" aria-pressed="${on}">${esc(q.label)}</button>`;
    }).join('');

    return `
      <div class="grid-2">
        <div class="field">
          <div class="label-row"><label class="label" for="${this.id('date')}">${s.range ? '시작일' : '날짜'}</label><span class="tiny muted">${isDateStr(s.date) ? `(${weekdayKo(s.date)})` : ''}</span></div>
          <input id="${this.id('date')}" class="input num" type="date" data-f="date" value="${esc(s.date)}" required>
        </div>
        <div class="field">
          <label class="label" for="${this.id('no')}">번호</label>
          <div class="stepper"${noInvalid ? ' style="border-color: var(--color-danger)"' : ''}>
            <button type="button" class="stepper-btn" id="${this.id('dec')}" data-act="no-dec" aria-label="번호 하나 내리기">${icon('minus')}</button>
            <input id="${this.id('no')}" class="stepper-value" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-f="no" value="${esc(s.no)}" placeholder="-" aria-describedby="${this.id('nohint')}"${noInvalid ? ' aria-invalid="true"' : ''}>
            <button type="button" class="stepper-btn" id="${this.id('inc')}" data-act="no-inc" aria-label="번호 하나 올리기">${icon('plus')}</button>
          </div>
          <span class="sr-only" id="${this.id('nohint')}">1부터 ${set.studentCount}까지</span>
        </div>
      </div>
      ${rangeHtml}
      <div class="field">
        <span class="label">종류</span>
        ${seg('kind', '종류', kindOpts, s.kind).replace(/data-seg-value="(\w+)"/g, (m, v) => `${m} id="${this.id('kind-' + v)}"`)}
      </div>
      <div class="field">
        <span class="label">구분</span>
        ${seg('div', '구분', divOpts, s.div).replace(/data-seg-value="(\w+)"/g, (m, v) => `${m} id="${this.id('div-' + v)}"`)}
      </div>
      ${periodHtml}
      <div class="field">
        <label class="label" for="${this.id('reason')}">사유</label>
        ${qr ? `<div class="chips" style="margin-bottom: var(--sp-2)">${qr}</div>` : ''}
        <input id="${this.id('reason')}" class="input" type="text" data-f="reason" value="${esc(s.reason)}" placeholder="사유 직접 입력" maxlength="60">
      </div>
      ${this.docsHtml(parent, parentBlocked)}
      ${parentBlocked ? `<div class="alert alert-block" role="alert">
        ${icon('alert')}
        <div class="alert-body">
          <strong class="alert-title">저장할 수 없습니다</strong>
          ${esc(parent.message)}
          <div class="alert-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-act="to-prescription">처방전으로 바꾸기</button>
            <button type="button" class="btn btn-secondary btn-sm" data-act="to-sago">미인정으로 바꾸기</button>
          </div>
        </div>
      </div>` : ''}
      ${painWarn ? `<div class="alert alert-info" role="alert">
        ${icon('info')}
        <div class="alert-body">
          <strong class="alert-title">확인이 필요합니다</strong>
          ${esc(pain.message)} 학교 규정을 확인하고 저장하세요.
          <div class="alert-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-act="confirm-pain">그래도 저장</button>
          </div>
        </div>
      </div>` : ''}
      ${dupWarn && !parentBlocked ? `<div class="alert alert-info" role="alert">
        ${icon('info')}
        <div class="alert-body">
          <strong class="alert-title">같은 날 기록이 있습니다</strong>
          ${esc(this.dupMessage(dup))}
          <div class="alert-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-act="confirm-dup">그래도 저장</button>
          </div>
        </div>
      </div>` : ''}
      ${errors.length ? `<div class="error-text" role="alert">${errors.map(esc).join('<br>')}</div>` : ''}
      <div class="form-footer">
        <button type="submit" class="btn btn-primary btn-block btn-lg" id="${this.id('save')}"${parentBlocked || painWarn || dupWarn ? ' disabled' : ''}>${this.editId ? '수정 저장' : '저장'}</button>
      </div>`;
  }

  docsHtml(parent, blocked) {
    const s = this.state;
    const set = this.settings;
    const no = Number(s.no);
    const validNo = no >= 1 && no <= set.studentCount;
    const ym = yearMonthOf(s.date);
    const mw = monthWord(s.date);
    const check = (i, label) => {
      const d = s.docs[i];
      return `<label class="check">
        <input type="checkbox" id="${this.id('doc' + i)}" data-doc-check="${i}"${d.submitted ? ' checked' : ''}>
        <span class="check-box"></span><span class="check-label">${esc(label)}</span></label>`;
    };

    if (s.tag === 'fieldTrip') {
      return `<div class="field" role="group" aria-labelledby="${this.id('dlabel')}">
        <span class="label" id="${this.id('dlabel')}">증빙서류</span>
        ${check(0, '체험학습 신청서 받음')}
        ${check(1, '체험학습 보고서 받음')}
        <div class="hint">보고서는 체험이 끝난 다음 날부터 미제출로 표시됩니다.</div>
      </div>`;
    }
    if (s.tag === 'periodPain') {
      const used = validNo ? countPeriodPain(store.data.records, no, ym, this.editId) : 0;
      const limit = Number(set.periodPainLimit ?? 1);
      return `<div class="field">
        <div class="label-row"><span class="label">증빙서류</span>${validNo ? quota(used, limit, `${mw} 생리통 ${used}/${limit}회`) : ''}</div>
        <div class="hint" style="margin-top:0">생리통 출석인정은 기본 서류가 없습니다. 학교 규정을 따르세요.</div>
      </div>`;
    }
    if (s.div === 'ill') {
      const used = validNo ? countParentNotes(store.data.records, no, ym, this.editId) : 0;
      const limit = Number(set.parentNoteLimit ?? 2);
      const usedRecs = validNo && used >= limit ? parentNoteRecords(store.data.records, no, ym, this.editId) : [];
      const type = s.docs[0]?.type || 'parentNote';
      return `<div class="field">
        <div class="label-row">
          <label class="label" for="${this.id('doctype')}">증빙서류</label>
          ${validNo ? quota(used, limit, `${mw} 학부모확인서 ${used}/${limit}회`) : ''}
        </div>
        <select id="${this.id('doctype')}" class="select" data-f="doctype"${blocked ? ' aria-invalid="true" style="border-color: var(--color-danger)"' : ''}>
          ${ILL_DOC_TYPES.map((t) => `<option value="${t}"${t === type ? ' selected' : ''}>${DOC_TYPES[t].ko}</option>`).join('')}
        </select>
        ${usedRecs.length ? `<div class="hint num">${no}번 사용: ${usedRecs.map((r) => formatDateKo(r.date, false)).join(', ')}</div>` : ''}
        ${check(0, '서류 받음')}
      </div>`;
    }
    if (s.div === 'sago') {
      return `<div class="field"><span class="label">증빙서류</span><div class="hint" style="margin-top:0">미인정은 증빙서류가 없습니다.</div></div>`;
    }
    // 기타, 출석인정(태그 없음)
    const d = s.docs[0] || { name: '' };
    return `<div class="field">
      <label class="label" for="${this.id('docname')}">증빙서류</label>
      <input id="${this.id('docname')}" class="input" type="text" data-f="docname" value="${esc(d.name || '')}" placeholder="서류 이름 (예: 경조사 확인서)" maxlength="40">
      ${s.docs.length ? check(0, '서류 받음') : ''}
    </div>`;
  }

  errors() {
    const out = [];
    const s = this.state;
    if (s.range && !this.editId && !expandRange(s.date, s.endDate).length) out.push('종료일을 확인하세요. 주말만 고르면 저장할 수 없습니다.');
    const d = this.drafts()[0] || createRecord({ date: s.date, no: Number(s.no), kind: s.kind, div: s.div });
    for (const m of validateRecord(d, this.settings)) if (!out.includes(m)) out.push(m);
    return out;
  }

  // ---------- 이벤트 ----------
  onClick(e) {
    const t = e.target.closest('button');
    if (!t || !this.el.contains(t)) return;
    const s = this.state;
    if (!t.dataset.act || !t.dataset.act.startsWith('confirm-')) { s.confirmPain = false; s.confirmDup = false; }
    if (t.dataset.segValue) {
      const name = t.closest('[data-seg]').dataset.seg;
      const v = t.dataset.segValue;
      if (name === 'kind' && v !== s.kind) {
        s.kind = v; s.period = null; s.periods = [];
      } else if (name === 'div' && v !== s.div) {
        s.div = v;
        if (v !== 'injung') s.tag = null;
        s.docs = docsFor(s.div, s.tag, s.docs);
      }
      this.render();
      return;
    }
    if (t.dataset.period) {
      const p = Number(t.dataset.period);
      if (s.kind === 'result') {
        s.periods = s.periods.includes(p) ? s.periods.filter((x) => x !== p) : [...s.periods, p].sort((a, b) => a - b);
      } else {
        s.period = s.period === p ? null : p;
      }
      this.render();
      return;
    }
    if (t.dataset.qr != null) {
      const q = this.settings.quickReasons[Number(t.dataset.qr)];
      const on = s.reason === q.label && (q.tag || null) === (s.tag || null);
      if (on) {
        s.reason = ''; s.tag = null;
      } else {
        s.reason = q.label;
        if (q.div) s.div = q.div;
        if (q.kind && q.kind !== s.kind) { s.kind = q.kind; s.period = null; s.periods = []; }
        s.tag = q.tag || null;
      }
      s.confirmPain = false;
      s.docs = docsFor(s.div, s.tag, s.docs);
      this.render();
      return;
    }
    const act = t.dataset.act;
    if (!act) return;
    const max = this.settings.studentCount;
    if (act === 'no-dec' || act === 'no-inc') {
      const cur = Number(s.no) || 0;
      let n = act === 'no-inc' ? cur + 1 : cur - 1;
      if (n < 1) n = act === 'no-inc' ? 1 : max;
      if (n > max) n = 1;
      s.no = n;
      this.render();
    } else if (act === 'to-prescription') {
      s.docs = [{ type: 'prescription', submitted: s.docs[0]?.submitted || false, submittedAt: null }];
      this.render();
      document.getElementById(this.id('doctype'))?.focus();
    } else if (act === 'to-sago') {
      s.div = 'sago'; s.tag = null; s.docs = [];
      this.render();
      document.getElementById(this.id('div-sago'))?.focus();
    } else if (act === 'confirm-pain' || act === 'confirm-dup') {
      // 보이는 확인형 경고(생리통 한도, 같은 날 기록)를 한 번에 확인
      s.confirmPain = true;
      s.confirmDup = true;
      this.save();
    }
  }

  onInput(e) {
    const f = e.target.dataset.f;
    const s = this.state;
    if (f === 'reason') {
      s.reason = e.target.value;
      // 사유 글자와 태그 맞추기: 태그 붙은 칩 이름과 똑같이 쓰면 그 칩을 누른 것과 같게,
      // 태그 칩 이름이 사유에서 빠지면 태그 해제 (예: '생리통' → '두통')
      const text = s.reason.trim();
      const tagged = (this.settings.quickReasons || []).filter((q) => q.tag);
      const exact = tagged.find((q) => q.label === text);
      let retag = false;
      if (exact && s.tag !== exact.tag) {
        s.div = exact.div || 'injung';
        if (exact.kind && exact.kind !== s.kind) { s.kind = exact.kind; s.period = null; s.periods = []; }
        s.tag = exact.tag;
        retag = true;
      } else if (s.tag && !tagged.some((q) => q.tag === s.tag && text.includes(q.label))) {
        s.tag = null;
        retag = true;
      }
      if (retag) {
        s.confirmPain = false;
        s.docs = docsFor(s.div, s.tag, s.docs);
        this.render();
        return;
      }
      // 칩 눌림 상태만 갱신 (다시 그리지 않음)
      this.el.querySelectorAll('[data-qr]').forEach((b) => {
        const q = this.settings.quickReasons[Number(b.dataset.qr)];
        b.setAttribute('aria-pressed', String(s.reason.trim() === q.label && (q.tag || null) === (s.tag || null)));
      });
    } else if (f === 'no') {
      const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
      s.no = digits ? Number(digits) : '';
      this.render();
    } else if (f === 'docname') {
      if (s.docs[0]) s.docs[0].name = e.target.value;
    }
  }

  onChange(e) {
    const f = e.target.dataset.f;
    const s = this.state;
    if (f === 'date' || f === 'endDate' || f === 'range' || f === 'no') { s.confirmPain = false; s.confirmDup = false; }
    if (f === 'date') { s.date = e.target.value || todayStr(); if (s.endDate && s.endDate < s.date) s.endDate = s.date; this.render(); }
    else if (f === 'endDate') { s.endDate = e.target.value; this.render(); }
    else if (f === 'range') { s.range = e.target.checked; if (s.range && !s.endDate) s.endDate = s.date; this.render(); }
    else if (f === 'doctype') { s.docs = [{ type: e.target.value, submitted: s.docs[0]?.submitted || false, submittedAt: null }]; this.render(); }
    else if (f === 'no') {
      if (s.no !== '' && s.no > this.settings.studentCount) { s.no = this.settings.studentCount; this.render(); }
    } else if (e.target.dataset.docCheck != null) {
      const d = s.docs[Number(e.target.dataset.docCheck)];
      if (d) { d.submitted = e.target.checked; d.submittedAt = e.target.checked ? new Date().toISOString() : null; d.updatedAt = new Date().toISOString(); }
    }
  }

  save() {
    const errs = this.errors();
    if (errs.length) {
      this.showErrors = true;
      this.render();
      toast(errs[0], { danger: true });
      return;
    }
    const { drafts, parent, pain, dup } = this.checks();
    if (!parent.ok && this.state.docs.some((d) => d.type === 'parentNote')) { this.render(); return; }
    if (!pain.ok && this.state.tag === 'periodPain' && !this.state.confirmPain) { this.render(); return; }
    if (dup.length && !this.state.confirmDup) { this.render(); return; }
    const failMsg = '이 기기에 저장하지 못했습니다. 저장 공간을 확인하세요.';
    const first = drafts[0];
    const label = `${first.no}번 ${describeKind(first)}`;
    if (this.editId) {
      const { id, createdAt, groupId, neis, ...fields } = first;
      if (!updateRecord(this.editId, fields)) { toast(failMsg, { danger: true }); return; }
      toast(`${label} 기록을 수정했습니다`);
      this.onDone?.('updated');
      return;
    }
    // 새 서류 항목에 시각 표시
    const now = new Date().toISOString();
    for (const d of drafts) d.docs = d.docs.map((x) => ({ ...x, updatedAt: x.updatedAt || now }));
    if (!addRecords(drafts)) { toast(failMsg, { danger: true }); return; }
    toast(drafts.length > 1 ? `${label} ${drafts.length}일 기록을 저장했습니다` : `${label} 기록을 저장했습니다`);
    this.state = this.blank(this.state);
    this.showErrors = false;
    this.render();
    this.onDone?.('added', drafts);
  }
}

function safeSel(el) {
  try { return el.selectionStart; } catch { return null; }
}
