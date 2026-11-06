// 바이트 계산 (NEIS 기준에 맞춘 근사): 한글 3바이트, 그 밖의 문자 1바이트.
// 순수 모듈. DOM과 브라우저 저장소를 쓰지 않는다.

function isHangul(code) {
  return (
    (code >= 0xac00 && code <= 0xd7a3) || // 완성형 가-힣
    (code >= 0x3131 && code <= 0x3163) //   호환 자모 ㄱ-ㅎ, ㅏ-ㅣ
  );
}

/**
 * 글의 바이트 수. 한글(완성형, 호환 자모)은 3, 그 밖의 문자는 1 (줄바꿈 포함).
 * 서로게이트 쌍(이모지 등)은 1글자로 센다.
 */
export function byteLength(text) {
  if (text == null) return 0;
  let total = 0;
  for (const ch of String(text)) {
    total += isHangul(ch.codePointAt(0)) ? 3 : 1;
  }
  return total;
}

/** 'ok' | 'near'(한도의 95% 이상) | 'over'(한도 초과) */
export function byteLevel(bytes, limit) {
  if (!limit || limit <= 0) return 'ok';
  if (bytes > limit) return 'over';
  if (bytes >= limit * 0.95) return 'near';
  return 'ok';
}

/** 바이트 한도를 대략의 글자 수 (공백 포함 평균 2.6바이트로 봄) */
export function charsForBytes(bytes) {
  if (!bytes || bytes <= 0) return 0;
  return Math.floor(bytes / 2.6);
}
