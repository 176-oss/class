/* 생기부 도우미 - 중계 스크립트 (출결 확장 bridge.js 복사, 채널 이름과 메시지 꼬리표만 다름) (격리 world)
   사이드 패널(chrome.runtime 메시지) <-> page.js(window.postMessage) 사이를 이어 준다.
   - event.source === window 인 메시지만 받는다.
   - 고유 채널 이름과 이 문서에서 새로 만든 세션 nonce 가 맞는 메시지만 처리한다. */
(function () {
  'use strict';
  const CHANNEL = 'sgb-neis-bridge-v1';
  const nonce = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
  const pending = new Map();
  let inited = false;
  let initWaiters = [];
  let reqSeq = 0;

  function sendInit() { window.postMessage({ channel: CHANNEL, from: 'bridge', type: 'init', nonce }, '*'); }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.channel !== CHANNEL || d.from !== 'page') return;
    if (d.type === 'ready') { if (!inited) sendInit(); return; }
    if (d.nonce !== nonce) return;
    if (d.type === 'inited') {
      inited = true;
      initWaiters.forEach((f) => f());
      initWaiters = [];
      return;
    }
    if (d.type === 'response') {
      const cb = pending.get(d.reqId);
      if (cb) { pending.delete(d.reqId); cb({ ok: d.ok, result: d.result, error: d.error }); }
      return;
    }
    if (d.type === 'event') {
      try { chrome.runtime.sendMessage({ sgb: 'neis-event', event: d.event }).catch(() => {}); } catch (e) { /* 확장이 다시 로드됨 */ }
    }
  });

  // page.js 가 먼저 'ready' 를 보냈을 수도 있으므로 연결될 때까지 몇 번 다시 보냄
  let tries = 0;
  const timer = setInterval(() => {
    if (inited || ++tries > 30) { clearInterval(timer); return; }
    sendInit();
  }, 200);
  sendInit();

  function waitInit(ms) {
    if (inited) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), ms);
      initWaiters.push(() => { clearTimeout(t); resolve(true); });
      sendInit();
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || sender.id !== chrome.runtime.id) return false;
    if (msg.sgb === 'ping') { sendResponse({ ok: true, inited, url: location.href }); return false; }
    if (msg.sgb !== 'neis-cmd') return false;
    (async () => {
      const ok = await waitInit(3000);
      if (!ok) {
        sendResponse({ ok: false, error: { code: 'no_page_script', message: '나이스 화면 스크립트와 연결하지 못했습니다. 나이스 페이지를 새로고침(F5)한 뒤 다시 시도하세요.' } });
        return;
      }
      const reqId = `q${++reqSeq}_${Date.now()}`;
      pending.set(reqId, sendResponse);
      window.postMessage({ channel: CHANNEL, from: 'bridge', type: 'request', nonce, reqId, cmd: msg.cmd, args: msg.args || {} }, '*');
    })();
    return true; // 비동기 응답
  });
})();
