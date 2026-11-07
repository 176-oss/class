// 생기부 도우미 - 백그라운드 서비스 워커 (출결 확장과 같음)
// 도구 모음의 확장 아이콘을 누르면 사이드 패널을 연다.
function enablePanelOnClick() {
  if (!chrome.sidePanel || !chrome.sidePanel.setPanelBehavior) return;
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => console.warn('사이드 패널 설정 실패', e));
}
chrome.runtime.onInstalled.addListener(enablePanelOnClick);
chrome.runtime.onStartup.addListener(enablePanelOnClick);
enablePanelOnClick();
