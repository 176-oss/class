# 같은 주소(https://176-oss.github.io) 보안 점검

점검일: 2026-11-08. 대상: 저장소 176-oss/class 전체 (sgb-checker/ 폴더는 따로 점검하므로 뺐습니다). 파일은 고치지 않고 읽기만 했습니다.

## 요약

- 제미나이 API 키를 `class:gemini-key`(앞으로)와 `sgb-v2-api-key`(지금 textgenerator-v2)에 넣으면, `https://176-oss.github.io` 아래의 모든 페이지가 이 키를 읽을 수 있습니다. 다른 저장소 페이지도 포함됩니다.
- 가장 큰 위험은 다른 저장소 `sciencelab`입니다. 버전을 정하지 않은 외부 스크립트(unpkg의 `@latest`, Tailwind Play CDN, Babel)를 그대로 불러옵니다. 그 서버나 패키지가 오염되면 키가 바로 새어 나갑니다.
- 이 저장소에서는 `textgenerator/index.html`(구버전 생기부 도우미)이 엑셀 칸 내용과 AI 답을 거르지 않고 `innerHTML`에 넣습니다. 조작된 엑셀 파일 하나로 같은 주소의 키를 훔칠 수 있습니다.
- SheetJS 0.18.5는 알려진 취약점 두 개가 있는 버전이고, 외부 엑셀 파일을 여는 두 페이지에서 씁니다.
- 출결 도우미(attendance), textgenerator-v2는 화면을 만들 때 글자를 거르는 방식(`esc()`, `h()`)을 써서 대체로 안전합니다.

## 위험 순서 표

| 순위 | 위치 | 문제 | 왜 위험한가 | 고치는 방법 한 줄 |
|---|---|---|---|---|
| 1 | 다른 저장소 sciencelab: `game1.html` 10, 13, 14, 17, 20줄, `index.html` 7줄 | `https://cdn.tailwindcss.com`, `unpkg.com/react@18`, `unpkg.com/@babel/standalone`(버전 없음), `unpkg.com/lucide@latest`를 그대로 불러옴 | 외부 서버에서 받은 코드가 같은 주소에서 실행됩니다. 그 코드가 바뀌면(서버 해킹, 패키지 탈취) 키를 읽어 갈 수 있습니다. 버전도 고정되어 있지 않아 언제든 다른 코드가 옵니다. | class처럼 `lib/`에 내려받아 저장소 안 파일로 불러오기 |
| 2 | `textgenerator/index.html` 455~458줄, 575~577줄 | AI 답(`v.title`, `v.content`, `v.review`, `parsed.content`)과 엑셀 칸(`studentId`, `subject`)을 거르지 않고 `innerHTML`/`insertAdjacentHTML`에 넣음 | 엑셀 칸에 `<img src=x onerror=...>` 같은 글을 넣은 파일을 열면 그 코드가 실행됩니다. AI 답도 활동내용에 숨긴 지시로 조작될 수 있습니다. 실행된 코드는 같은 주소의 키를 모두 읽습니다. | 값을 `textContent`로 넣거나 attendance의 `esc()` 같은 거르개를 거쳐 넣기 (또는 v2가 있으니 구버전 페이지를 내리기) |
| 3 | `lib/xlsx.full.min.js` (SheetJS 0.18.5), 사용처 `textgenerator/index.html` 501줄, `textgenerator-v2/js/xlsx-io.js` 63~64줄 | CVE-2023-30533(프로토타입 오염, 0.19.3에서 고침), CVE-2024-22363(정규식 지연, 0.20.2에서 고침) | 남이 만든 엑셀 파일을 열 때 페이지의 기본 객체가 오염되거나 화면이 멈출 수 있습니다. 오염은 다른 코드와 엮이면 더 큰 문제로 이어질 수 있습니다. | SheetJS 공식 배포처(cdn.sheetjs.com)에서 0.20.3 이상을 받아 `lib/`에 덮어쓰기 |
| 4 | `attendance/drive.js` 5, 21줄, `textgenerator-v2/js/drive.js` 7, 24줄 | 구글 로그인 스크립트 `https://accounts.google.com/gsi/client`를 실행 중에 불러옴 (드라이브 연결할 때) | 구글 코드라 믿을 만하지만, 같은 주소에서 실행되는 외부 코드라 키를 읽을 수 있는 위치에 있습니다. 버전 고정이나 무결성 확인(SRI)은 구글이 지원하지 않습니다. | 그대로 두되, 다른 외부 스크립트는 더 늘리지 않기 |
| 5 | `seating/index.html` 10, 21줄, 1536~1543줄, `textgenerator/index.html` 8줄 | Tailwind Play CDN(`lib/tailwindcss.js`)과 Babel(`lib/babel.min.js`)로 브라우저 안에서 코드를 만들어 실행 | 파일은 저장소 안에 있어 지금 당장 위험은 낮습니다. 다만 이 방식 때문에 보안 정책(CSP)으로 "모르는 코드 실행 막기"를 걸 수 없습니다. | 나중에 미리 빌드한 CSS와 JS로 바꾸기 |
| 6 | `textgenerator/index.html` 427, 564줄 | 키를 주소 뒤 `?key=`에 붙여 보냄 | 구글 서버로만 가지만, 주소에 붙은 키는 프록시나 기록에 남기 쉽습니다. | 헤더 `x-goog-api-key`로 보내기 (v2 방식과 맞추기) |
| 7 | `textgenerator-v2/js/drive.js` 10줄 `sgb-v2-token`, `attendance/drive.js` 8줄 `ah.token` | 구글 드라이브 접근 토큰도 localStorage에 저장 | 키와 마찬가지로 같은 주소의 다른 페이지가 읽을 수 있습니다. 약 1시간 뒤 만료되어 피해는 짧습니다. | 공용 PC 선택 시 sessionStorage로 두는 지금 방식 유지, 위 1~2번을 먼저 고치기 |
| 8 | 모든 페이지 | CSP(콘텐츠 보안 정책)와 SRI가 하나도 없음 | 위 문제가 생겼을 때 막아 줄 두 번째 방어선이 없습니다. | 페이지마다 `<meta http-equiv="Content-Security-Policy">`로 허용할 주소만 적기 (5번을 고친 뒤) |

## 페이지별 외부 불러오기 목록

글꼴 CSS는 스크립트를 실행하지 못하므로 키를 읽을 수는 없습니다. 다만 방문 사실(IP)이 그 서버에 남습니다.

| 페이지 | 외부 주소 | 종류 | 위험 |
|---|---|---|---|
| `index.html` 8~10줄 | fonts.googleapis.com, fonts.gstatic.com | 글꼴 CSS | 낮음 (Pretendard는 구글 글꼴에 없어 실제로는 안 받아질 수 있음) |
| `edutime/index.html` 8줄 | fonts.googleapis.com | 글꼴 CSS | 낮음 |
| `textgenerator/index.html` 11줄 | fonts.googleapis.com (`@import`) | 글꼴 CSS | 낮음 |
| `textgenerator/index.html` 427, 564줄 | generativelanguage.googleapis.com | API 호출 (코드 아님) | 6번 참고 |
| `attendance/tokens.css` 5줄 | cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9 (`@import`) | 글꼴 CSS | 낮음 (태그 고정, CSS라 코드 실행 없음) |
| `sgb-extension/sidepanel/tokens.css` 5줄 | 위와 같음 | 글꼴 CSS | 낮음 (확장 안에서는 확장 주소에서 열림) |
| `attendance/drive.js` 5~7줄 | accounts.google.com/gsi/client, www.googleapis.com | 외부 스크립트 + API | 4번 참고 |
| `textgenerator-v2/js/drive.js` 7~9줄 | 위와 같음 | 외부 스크립트 + API | 4번 참고 |
| `edutime/widget_code.js` 2줄 | edutime-api.vercel.app | API 주소 | 없음. 이 파일은 아이폰 Scriptable용 코드이고, 페이지에서는 `innerText`로 글자만 보여 줍니다(`edutime/index.html` 113줄). |
| `textgenerator-v2/css/tokens.css` 6~8줄 | 없음 (`textgenerator-v2/lib/fonts/` 저장소 안 글꼴) | 글꼴 | 없음 |

iframe, ES 모듈 `import ... from 'http...'`, 외부 주소의 동적 `import()`는 없습니다. (`textgenerator-v2/tests/run.mjs` 13줄의 `import()`는 컴퓨터에서 테스트할 때 쓰는 로컬 파일입니다.)

### 저장소에 넣어 둔 라이브러리 (`lib/`, `lib/README.md` 기준)

| 파일 | 버전 | 쓰는 곳 | 메모 |
|---|---|---|---|
| `xlsx.full.min.js` (SheetJS) | 0.18.5 | textgenerator, textgenerator-v2 | 취약점 두 개 (3번) |
| `tailwindcss.js` (Play CDN) | 3.4.17 | seating, textgenerator | 브라우저 안 컴파일 (5번) |
| `babel.min.js` | 8.1.1 | seating | 브라우저 안 컴파일 (5번) |
| `react`, `react-dom` | 18.3.1 | seating | 문제 없음 |
| `lucide.min.js` | 1.70.0 | index.html, edutime | 문제 없음 |
| `html2canvas.min.js` | 1.4.1 | seating | 문제 없음 |
| `jspdf.umd.min.js` | 2.5.1 | seating | 2.5.1에도 알려진 취약점이 있으나 seating은 남의 PDF를 읽지 않고 만들기만 해서 영향 작음 (확인 권장) |
| `font-awesome/` | 6.4.0 | seating | CSS와 글꼴, 문제 없음 |

## innerHTML 등 사용 목록

`eval`, `new Function`, `document.write`, 글자를 넘기는 `setTimeout("...")`는 이 저장소에 없습니다.

| 파일 | 줄 | 들어가는 값 | 판단 |
|---|---|---|---|
| `textgenerator/index.html` | 455, 456, 458 | AI 답 `v.title`, `v.content`, `v.review` 그대로 | 위험 (2번) |
| `textgenerator/index.html` | 575, 576, 577 | 엑셀 칸 `studentId`, `subject`, AI 답 `parsed.content` 그대로 | 위험 (2번) |
| `textgenerator/index.html` | 467, 582 | 오류 글 `e.message` | 낮음 (대부분 브라우저가 만든 글이지만 거르는 편이 안전) |
| `textgenerator/index.html` | 301, 303, 330, 396, 527, 557 | 코드 안에 적힌 고정 목록과 숫자 | 안전 |
| `textgenerator/index.html` | 444~447, 535~538 | `onclick="copyTableColumn(...)"` 고정 글 | 안전 (CSP를 걸기 어렵게 만듦) |
| `attendance/*.js` (app.js 45~121, views.js 100~581, settings.js 174~354, form.js 177, 281, list-sheets.js 121~436, ui.js 42, 60, ext.js 163, 170) | 여러 줄 | 학생 이름, 사유, 오류 글은 `esc()`(`attendance/ui.js` 2줄)로 거름. 거르지 않는 `${r.no}` 등은 숫자로 바꾼 값(`attendance/shared/model.js` 236, 353줄) | 안전 |
| `seating/index.html` | 1271~1273 | 고정 글 "복사완료!"를 넣었다가 되돌림 | 안전 |
| `seating/index.html` | 1536~1543 | Babel이 만든 코드를 `<script>`로 붙여 실행. 재료는 같은 파일 안의 코드 | 지금은 안전 (5번) |
| `sgb-extension/mock-neis/sgb.html` | 106, 128, 131 | 시험용 가짜 나이스 화면의 고정 자료 | 낮음 (시험용, 그러나 Pages에도 올라가 있음) |
| `sgb-extension/sidepanel/sgb-panel.js` | 370 | `esc()`(26줄)로 거른 값. 확장 주소에서 열림 | 안전 |
| `textgenerator-v2/js/` 전체 | 없음 | `h()`(`textgenerator-v2/js/dom.js`)가 글자를 텍스트 노드로만 넣음 | 안전 |
| `index.html` 41~102, `edutime/index.html` 63 | `onclick="..."` | 고정 글 | 안전 |

## localStorage 전체 읽기, 서비스 워커

- localStorage나 sessionStorage의 모든 키를 훑는 코드(`localStorage.key()`, `Object.keys(localStorage)`, `clear()`)는 없습니다. 각 페이지는 자기 키만 읽습니다 (`ah.*`, `sgb-v2-*`).
- 서비스 워커는 출결 도우미 하나입니다: `attendance/app.js` 188줄이 `attendance/sw.js`를 등록합니다. 범위가 `/class/attendance/`라 다른 페이지에는 끼어들지 않습니다. 같은 주소 요청만 캐시하고(`sw.js` 57~58줄 설명, `res.type === 'basic'` 확인) 다른 주소 요청은 건드리지 않습니다. 저장 이름은 `ah-app-버전`이고 자기 이름으로 시작하는 캐시만 지웁니다(47줄).
- 주의할 점: Cache API와 서비스 워커도 같은 주소 안에서는 공유됩니다. 다른 저장소 페이지에 나쁜 코드가 들어오면 `/class/` 범위에 서비스 워커를 새로 등록할 수는 없지만(경로가 달라 막힘), 캐시 내용은 읽고 바꿀 수 있습니다.

## 같은 주소의 다른 저장소

`gh` 명령은 잘 동작했습니다. 176-oss 계정의 저장소 7개 중 Pages가 켜진 곳은 4개이고, 모두 사용자 도메인(cname)이 없어 `https://176-oss.github.io`를 함께 씁니다.

| 저장소 | 공개 | Pages 주소 | 같은 주소 | 메모 |
|---|---|---|---|---|
| class | 공개 | https://176-oss.github.io/class/ | 예 | 이 저장소 |
| test | 공개 | https://176-oss.github.io/test/ | 예 | 지금은 README.md만 있음. 쓰지 않으면 Pages를 끄는 편이 안전 |
| celldivision | 공개 | https://176-oss.github.io/celldivision/ | 예 | 외부 스크립트 없음. `game.js`의 innerHTML은 이름 입력을 화면에 넣지 않아 지금은 문제 없어 보임 |
| sciencelab | 공개 | https://176-oss.github.io/sciencelab/ | 예 | 외부 CDN 스크립트 다수 (1번) |
| edutime-api | 비공개 | 없음 (Vercel) | 아니오 | |
| edutime | 공개 | 없음 (404) | 아니오 | |
| T-Time | 공개 | 없음 (404) | 아니오 | |

`176-oss.github.io`라는 이름의 저장소(주소 맨 위 페이지)는 없습니다. 이 이름으로 저장소를 만들면 그 페이지도 같은 주소가 됩니다.

## 확인하지 못한 것

- 다른 저장소(sciencelab, celldivision)는 외부 주소와 innerHTML이 있는 줄만 찾아봤고, 코드 전체를 읽지는 않았습니다.
- 출결 확장(`attendance/attendance-extension.zip` 0.4.3)은 manifest만 봤습니다. `https://176-oss.github.io/class/attendance/*`에 `content/version.js`를 넣는데, 그 스크립트의 내용은 읽지 않았습니다.
- sgb-extension 0.2.0의 manifest에는 `176-oss.github.io`가 없습니다(나이스, localhost만). 웹앱과 어떻게 이어지는지는 sgb-checker 점검에서 확인해야 합니다.
- jsPDF 2.5.1의 취약점이 seating 사용 방식에 해당하는지는 따로 확인하지 않았습니다.
- 실제 배포된 페이지를 브라우저로 열어 보지는 않았습니다. 저장소 파일만 보았습니다.
- 키 자체의 제한(웹사이트 제한 `https://176-oss.github.io/*`, API 제한)이 실제로 걸려 있는지는 확인할 수 없었습니다. 웹사이트 제한은 같은 주소의 다른 페이지를 막지 못합니다.
