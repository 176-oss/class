// 시작 준비 팝업 (작성 도우미와 같은 방식): API 키가 없으면 처음 들어올 때 한 번 묻는다.
// 점검기는 글을 저장하지 않아 구글 드라이브 연결은 필요 없다. 키는 작성 도우미와 함께 쓰는 자리에 저장한다.
// [나중에]는 이번 창에서만 다시 묻지 않는다.
import { h } from './dom.js';
import { keys, settings, saveSettings } from './state.js';
import { ask, announce } from './ui.js';

const LATER = 'sgb-checker-setup-later';
const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* 넘어감 */ } };

export function needsSetup() {
  return !keys.read() && !settings.fakeAi && !ssGet(LATER);
}

export async function setupDialog({ render }) {
  if (!needsSetup() || document.querySelector('dialog[open]')) return;
  let draft = '';
  const err = h('p', { class: 'alert alert-danger', role: 'alert', hidden: true });
  const input = h('input', { type: 'password', id: 'setup-key', autocomplete: 'off', spellcheck: 'false', placeholder: 'AIza로 시작하는 키를 붙여 넣으세요', 'aria-describedby': 'setup-key-help', oninput: (e) => { draft = e.target.value; err.hidden = true; } });
  const aiBox = h('input', { type: 'checkbox', id: 'setup-ai', checked: true });
  const v = await ask({
    title: '점검기 시작 준비',
    body: [
      h('p', null, '규칙 점검(바이트, 금지 내용, 띄어쓰기 등)은 키 없이도 됩니다. AI 점검(맞춤법, 영역에 맞는 내용, 나열식 문장)까지 쓰려면 Gemini API 키를 넣어 주세요.'),
      h('p', { class: 'muted' }, '점검기는 글을 저장하지 않아 구글 드라이브 연결은 필요 없습니다. 작성 도우미에서 키를 넣었다면 이 창은 뜨지 않습니다.'),
      h('div', { class: 'field' },
        h('label', { for: 'setup-key' }, 'Gemini API 키 (작성 도우미와 함께 씀)'),
        input,
        h('span', { id: 'setup-key-help', class: 'muted' }, '개인 구글 계정으로 Google AI Studio(aistudio.google.com)에서 [API 키 만들기]로 받습니다. 결제를 연결하지 않은 무료 키를 쓰세요. 자세한 방법은 작성 도우미 사용 안내에 있습니다.')),
      h('label', { class: 'check', for: 'setup-ai' }, aiBox, 'AI 점검도 쓰기'),
      err,
    ],
    buttons: [
      { label: '나중에', value: 'later' },
      {
        label: '키 저장하고 시작', primary: true,
        value: () => {
          if (!keys.save(draft)) {
            err.textContent = 'API 키 모양이 아닙니다. 공백 없이 30~100자로 된 키를 붙여 넣으세요.';
            err.hidden = false;
            input.focus();
            return undefined; // 창을 닫지 않음
          }
          return 'saved';
        },
      },
    ],
    init: (d) => d.querySelector('#setup-key')?.focus(),
  });
  if (v === 'saved') {
    settings.aiOn = aiBox.checked;
    saveSettings();
    render();
    announce('API 키를 저장했습니다. 작성 도우미와 함께 씁니다.');
  } else {
    ssSet(LATER, '1');
  }
}
