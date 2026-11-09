// NEIS 바이트: 한글 3, 그 밖의 문자 1, 엔터 1 (중 162, 고 208). \r은 세지 않는다 (\r\n도 엔터 하나).

function isHangul(code) {
  return (code >= 0xac00 && code <= 0xd7a3) || (code >= 0x3131 && code <= 0x318e) || (code >= 0x1100 && code <= 0x11ff);
}

export function byteLength(text) {
  let n = 0;
  for (const ch of String(text ?? '')) {
    if (ch === '\r') continue;
    n += isHangul(ch.codePointAt(0)) ? 3 : 1;
  }
  return n;
}
