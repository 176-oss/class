// 확장 업데이트 알림 판단 (순수 모듈)

/** '0.4.10' 과 '0.4.9' 같은 버전 비교: a<b 이면 음수 */
export function compareVersions(a, b) {
  const pa = String(a ?? '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b ?? '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] || 0; const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 알림을 띄울지: 설치됨 < 최신, 이 버전 건너뛰기·오늘 나중에가 아님 */
export function shouldNotify({ installed, latest, skip, later, todayStr }) {
  if (!installed || !latest || compareVersions(installed, latest.version) >= 0) return false;
  if (skip === latest.version) return false;
  if (later === todayStr) return false;
  return true;
}
