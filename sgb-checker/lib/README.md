# sgb-checker/lib/

외부 주소 대신 저장소에 넣어 쓰는 파일입니다. 라이선스 주석과 라이선스 파일을 지우지 마세요.
이 파일을 바꾸면 `tests/lib.test.mjs`가 실패합니다. 새 버전으로 바꿀 때는 아래 표의 버전, 날짜, SHA-256도 같이 고치세요.

| 파일 | 이름 | 버전 | 라이선스 | 받은 주소 | 받은 날짜 | SHA-256 |
|---|---|---|---|---|---|---|
| `xlsx.full.min.js` | SheetJS Community Edition | 0.20.3 | Apache-2.0 (`LICENSE`) | https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js | 2026-11-08 | `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` |
| `LICENSE` | SheetJS 라이선스 전문 | 0.20.3 | - | https://cdn.sheetjs.com/xlsx-0.20.3/package/LICENSE | 2026-11-08 | `4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64` |
| `fonts/IBMPlexSansKR-*.woff2` (400, 500, 600) | IBM Plex Sans KR | 1.1.0 | SIL OFL 1.1 (`fonts/OFL-LICENSE.txt`) | `textgenerator-v2/lib/fonts/`에서 복사 (원래 npm `@ibm/plex-sans-kr` 1.1.0) | 2026-11-08 | - |

SheetJS는 npm의 `xlsx`(0.18.5에서 멈춤, 알려진 취약점 CVE-2023-30533, CVE-2024-22363)가 아니라 공식 배포처에서 받은 0.20.3입니다.
