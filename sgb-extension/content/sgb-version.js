/* 생기부 도우미 - 버전 알림 스크립트 (격리 world, 출결 확장 content/version.js 와 같은 방식)
   생기부 작성 도우미 웹앱(https://176-oss.github.io/class/textgenerator-v2/)에서만 동작한다.
   웹앱이 '이 PC에 설치된 확장 버전'을 알아 업데이트 알림을 띄울 수 있도록 버전 문자열 하나만 알려 준다.
   - <html data-sgb-ext-version="0.4.8">
   - window.postMessage({ source: 'sgb-ext', type: 'version', version })
   그 밖의 데이터(글, 명단, 토큰 등)는 페이지에 절대 주지 않는다. 페이지에서 받는 메시지는 버전 재요청(ping)뿐이다. */
(function () {
  'use strict';
  if (window.__sgbExtVersionLoaded) return;
  window.__sgbExtVersionLoaded = true;
  const version = chrome.runtime.getManifest().version;
  const send = () => window.postMessage({ source: 'sgb-ext', type: 'version', version }, location.origin);
  try { document.documentElement.dataset.sgbExtVersion = version; } catch (e) { /* 무시 */ }
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (d && d.source === 'sgb-app' && d.type === 'ping') send();
  });
  send();
})();
