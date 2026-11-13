// 학생 한 명 상세: 원문 밑줄, 지적 목록([적용] [예외 처리] [그대로 둠]), [정리], [되돌리기], 전후 비교, AI 점검, 작성 도우미로 보내기.
import { h } from './dom.js';
import { S, settings, keys, itemCtx, issuesOf, statusOf, setText, undo, areaLabel, STATUS_LABEL, LEVEL_LABEL } from './state.js';
import { applyFix, tidy, diff } from '../rules/fix.js';
import { byteLength } from '../rules/bytes.js';
import { finish } from '../rules/check.js';
import { aiReview, AiError } from './ai.js';
import { writeHandoff } from '../shared/handoff.js';
import { announce, ask, confirmBox, badge } from './ui.js';

let mode = 'detail'; // 'detail' | 'compare'
let aiBusy = false;

const EXCEPT_REASONS = ['교육관련기관임', '고유명사임', '학교 기준상 허용', '직접 입력'];

/** 원문을 지적 범위대로 나눠 밑줄. 같은 곳에 오류와 확인이 겹치면 오류로 */
function marked(text, issues) {
  const spans = issues.filter((i) => i.end > i.start || (i.start === i.end && i.ruleId === 'period'));
  const cuts = new Set([0, text.length]);
  for (const i of spans) { cuts.add(i.start); cuts.add(i.end); }
  const pts = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    // 마침표가 빠진 자리 (길이 0)
    const gaps = spans.filter((i) => i.start === a && i.end === a);
    if (gaps.length) out.push(h('mark', { class: 'm-error' }, '\u00A0\u00A0', h('span', { class: 'sr-only' }, '(오류: 마침표 없음)')));
    if (b == null || b === a) continue;
    const cover = spans.filter((i) => i.start <= a && i.end >= b && i.end > i.start);
    const seg = text.slice(a, b);
    if (!cover.length) { out.push(seg); continue; }
    const lv = cover.some((i) => i.level === 'error') ? 'error' : 'warn';
    out.push(h('mark', { class: `m-${lv}` }, seg, h('span', { class: 'sr-only' }, `(${LEVEL_LABEL[lv]}: ${[...new Set(cover.map((i) => i.label))].join(', ')})`)));
  }
  return out;
}

function byteBar(bytes, limit) {
  const pct = limit ? Math.min(100, Math.round((bytes / limit) * 100)) : 0;
  return h('div', { class: 'stack' },
    h('div', { class: `bytebar${limit && bytes > limit ? ' is-over' : ''}`, role: 'img', 'aria-label': `${bytes}바이트, 한도 ${limit || '없음'}` }, h('span', { style: { width: `${pct}%` } })),
    h('p', { class: 'muted num' }, `${bytes} / ${limit || '-'}바이트${limit && bytes > limit ? ` (${bytes - limit} 초과)` : ''}`));
}

export function renderDetail(it, { go, render }) {
  const all = issuesOf(it);
  const on = all.filter((i) => !i.off);
  const off = all.filter((i) => i.off);
  const st = statusOf(it);
  const bytes = byteLength(it.current);
  const limit = itemCtx(it).limitBytes;
  const idx = S.current;
  const title = `${it.studentId || ''} ${it.name || ''}`.trim() || '학생';

  const after = (msg) => { render(); announce(msg); };

  async function apply(issue) {
    if (issue.ai && !S.aiConfirmed) {
      let checked = false;
      const ok = await ask({
        title: 'AI 제안 적용',
        body: [
          h('p', 'AI가 만든 글을 그대로 입력하면 안 됩니다 (기재요령 중·고 19쪽). 학생의 실제 활동과 맞는지, 과장이나 사실과 다른 내용이 없는지 확인한 뒤 적용하세요.'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { checked = e.target.checked; } }), '학생의 실제 활동과 맞는지 확인했습니다'),
        ],
        buttons: [{ label: '취소', value: false }, { label: '적용', primary: true, value: () => (checked ? true : undefined) }],
      });
      if (!ok) return;
      S.aiConfirmed = true;
    }
    if (issue.needsConfirm && !(await confirmBox('날짜 확인', `연도가 없는 날짜에 학년도를 붙여 '${issue.fix}'로 바꿉니다. 맞습니까?`, '바꾸기'))) return;
    setText(it, applyFix(it.current, issue));
    after(`'${issue.label}' 지적을 적용했습니다.`);
  }

  async function except(issue) {
    let reason = EXCEPT_REASONS[0];
    let custom = '';
    const ok = await ask({
      title: '예외 처리',
      body: [
        h('p', null, h('q', issue.text || issue.label), ` - ${issue.label}`),
        h('div', { class: 'field' }, h('label', { for: 'ex-reason' }, '사유'),
          h('select', { id: 'ex-reason', onchange: (e) => { reason = e.target.value; } }, EXCEPT_REASONS.map((r) => h('option', { value: r }, r)))),
        h('div', { class: 'field' }, h('label', { for: 'ex-custom' }, '직접 입력 (사유가 직접 입력일 때)'),
          h('input', { type: 'text', id: 'ex-custom', maxlength: 100, oninput: (e) => { custom = e.target.value.trim(); } })),
      ],
      buttons: [{ label: '취소', value: false }, { label: '예외 처리', primary: true, value: true }],
      init: (d) => d.querySelector('select')?.focus(),
    });
    if (!ok) return;
    it.excepted.set(issue.key, reason === '직접 입력' ? custom || '직접 입력' : reason);
    after('예외 처리했습니다. 보고서에 사유가 남습니다.');
  }

  async function runAi() {
    const k = keys.read();
    if (!k) { await confirmBox('API 키가 없습니다', '설정에서 Gemini API 키를 넣어 주세요. 작성 도우미에서 넣은 키가 있으면 저절로 씁니다.', '확인'); return; }
    aiBusy = true; render(); announce('AI로 점검하는 중입니다.');
    try {
      const raw = await aiReview(it.current, itemCtx(it), { apiKey: k.key, models: settings.models, fake: settings.fakeAi });
      it.ai = raw.map((i) => finish(i, it.current, S.school));
      it.aiNote = it.ai.length ? '' : 'AI가 더 찾은 문제가 없습니다.';
    } catch (e) {
      it.aiNote = e instanceof AiError ? e.message : '알 수 없는 문제가 생겼습니다.';
    }
    aiBusy = false;
    after(it.aiNote || `AI 지적 ${it.ai.length}개를 더했습니다.`);
  }

  function sendToWriter() {
    if (!writeHandoff(window.localStorage, { studentId: it.studentId, area: it.area, subject: it.subject, text: it.current })) {
      announce('글을 넘기지 못했습니다. 글이 너무 길거나 비어 있습니다.');
      return;
    }
    window.open('../textgenerator-v2/', '_blank', 'noopener');
    announce('작성 도우미를 새 탭으로 열었습니다. 5분 안에 열어야 글이 넘어갑니다.');
  }

  function issueCard(i) {
    const lv = i.level === 'error' ? 'error' : 'warn';
    const canFix = typeof i.fix === 'string' && !i.off;
    return h('li', { class: `issue${i.off ? ' is-off' : ''}` },
      h('div', { class: 'row' }, badge(i.off ? 'off' : lv, i.off ? (i.off === 'except' ? '예외' : '그대로 둠') : LEVEL_LABEL[lv]), h('b', i.label), i.basis ? h('span', { class: 'muted' }, `근거 ${i.basis}`) : null),
      i.text ? h('p', null, h('q', i.text)) : null,
      h('p', null, i.reason),
      i.hint ? h('p', { class: 'muted' }, `바꿀 방향: ${i.hint}`) : null,
      typeof i.fix === 'string' ? h('p', null, '바꿀 문장: ', h('span', { class: 'fix' }, i.fix === '' ? '(지움)' : i.fix === ' ' ? '(한 칸 띄어쓰기)' : i.fix)) : null,
      i.noFix ? h('p', { class: 'muted' }, '자동 제안 없음') : null,
      i.off === 'except' ? h('p', { class: 'muted' }, `사유: ${it.excepted.get(i.key)}`) : null,
      h('div', { class: 'row' },
        i.off
          ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { it.excepted.delete(i.key); it.dismissed.delete(i.key); after('지적을 다시 보이게 했습니다.'); } }, '되돌리기')
          : [
            canFix ? h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => apply(i) }, '적용') : null,
            h('button', { type: 'button', class: 'btn btn-sm', onclick: () => except(i) }, '예외 처리'),
            h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { it.dismissed.add(i.key); after('그대로 두었습니다.'); } }, '그대로 둠'),
          ]));
  }

  const tidyCount = on.filter((i) => ['space-double', 'space-edge', 'neis-char', 'date-format'].includes(i.ruleId) && typeof i.fix === 'string' && !i.needsConfirm).length;

  const toolbar = h('div', { class: 'row' },
    h('button', { type: 'button', class: 'btn', disabled: !tidyCount, onclick: () => { setText(it, tidy(it.current, on)); after(`연속 공백, 깨짐 문자, 날짜 형식 ${tidyCount}곳을 정리했습니다.`); } }, `정리 (${tidyCount})`),
    h('button', { type: 'button', class: 'btn', disabled: !it.history.length, onclick: () => { undo(it); after('한 단계 되돌렸습니다.'); } }, '되돌리기'),
    h('button', { type: 'button', class: 'btn', 'aria-pressed': String(mode === 'compare'), onclick: () => { mode = mode === 'compare' ? 'detail' : 'compare'; render(); } }, '전후 비교'),
    settings.aiOn ? h('button', { type: 'button', class: 'btn', disabled: aiBusy || !it.current.trim(), onclick: runAi }, aiBusy ? 'AI 점검 중' : 'AI로 점검') : null,
    h('button', { type: 'button', class: 'btn', disabled: !it.current.trim(), onclick: sendToWriter }, '작성 도우미에서 고치기'));

  let body;
  if (mode === 'compare') {
    const parts = diff(it.original, it.current);
    const before = byteLength(it.original);
    body = h('div', { class: 'stack' },
      h('p', { class: 'num' }, `바이트: ${before} -> ${bytes} (${bytes - before >= 0 ? '+' : ''}${bytes - before})`),
      h('div', { class: 'grid2' },
        h('section', { 'aria-labelledby': 'cmp-a' }, h('h3', { id: 'cmp-a' }, '원문'),
          h('div', { class: 'doc diff' }, parts.filter((p) => p.type !== 'ins').map((p) => (p.type === 'del' ? h('del', p.text) : p.text)))),
        h('section', { 'aria-labelledby': 'cmp-b' }, h('h3', { id: 'cmp-b' }, '수정본'),
          h('div', { class: 'doc diff' }, parts.filter((p) => p.type !== 'del').map((p) => (p.type === 'ins' ? h('ins', p.text) : p.text))))),
      h('p', { class: 'muted' }, '지운 글자는 취소선, 넣은 글자는 밑줄입니다.'));
  } else {
    body = h('div', { class: 'grid2' },
      h('section', { 'aria-labelledby': 'doc-h' },
        h('h3', { id: 'doc-h' }, '글'),
        it.current.trim() ? h('div', { class: 'doc' }, marked(it.current, on)) : h('p', { class: 'doc muted' }, '미작성'),
        h('div', { class: 'legend' }, h('span', null, h('mark', { class: 'm-error' }, '오류'), ' 굵은 실선'), h('span', null, h('mark', { class: 'm-warn' }, '확인'), ' 점선'))),
      h('section', { 'aria-labelledby': 'iss-h' },
        h('h3', { id: 'iss-h' }, `지적 ${on.length}개`),
        it.aiNote ? h('p', { class: 'alert', role: 'status' }, it.aiNote) : null,
        on.length ? h('ul', { class: 'issues' }, on.map(issueCard)) : h('p', { class: 'muted' }, '남은 지적이 없습니다.'),
        off.length ? h('details', null, h('summary', `처리한 지적 ${off.length}개`), h('ul', { class: 'issues' }, off.map(issueCard))) : null));
  }

  return h('div', { class: 'stack' },
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', onclick: () => { mode = 'detail'; go('results'); } }, '닫기'),
      h('button', { type: 'button', class: 'btn', disabled: idx <= 0, onclick: () => go('detail', { index: idx - 1 }) }, '이전 학생'),
      h('button', { type: 'button', class: 'btn', disabled: idx >= S.items.length - 1, onclick: () => go('detail', { index: idx + 1 }) }, '다음 학생'),
      h('span', { class: 'muted num' }, `${idx + 1} / ${S.items.length}`)),
    h('h2', null, title, ' ', h('span', { class: 'muted' }, `${areaLabel(it)}${it.subject ? ` (${it.subject})` : ''}`), ' ', badge(st, STATUS_LABEL[st])),
    byteBar(bytes, limit),
    toolbar,
    body);
}
