# 생기부 작성 도우미 v2 검수 보고서

검수: 품질 담당 / 날짜: 2026-11-06 / 대상: `textgenerator-v2/` (브랜치 `claude/textgenerator-v2-webapp-6d13a7`)
기준: `docs/contract.md`(11절 포함), `docs/textgenerator-v2/생기부-작성도우미-업그레이드-기획서.md`, `생기부-NEIS-확장프로그램-기획초안.md` 3절.
방법: 코드 전부 읽기, node 테스트, 로컬 서버에서 내장 브라우저(Chrome 152)로 직접 조작. 1차는 포트 8124, 재검수는 포트 8126(새 출처라 캐시와 저장소가 비어 있음)에 `?dev=1&v=2`. 검수 담당은 코드를 고치지 않았다.

## 요약 (재검수 반영)

**통과 36 / 문제 1 / 확인 못 함 4** (모두 41항목)
1차 결과는 통과 32 / 문제 5 / 확인 못 함 4. 1차 문제 5개 가운데 4개는 다 고쳐졌다. 남은 1개(10-2 묶음)도 6개 중 5개가 고쳐졌다.

### 남은 문제

| # | 심각도 | 담당 | 문제 | 위치 |
|---|---|---|---|---|
| 10-2 | 낮음 | 화면 / 디자인 | (a) SheetJS 스크립트에 `integrity`(SRI)와 `crossorigin`이 아직 없음. (b) 새로 찾음: [가져오기 전 상태로 되돌리기]를 하면 개발용 '가짜 AI 켜기'가 꺼짐. 스냅숏이 `makeBackup`을 거치면서 `devFakeAI`가 빠지고, 되돌릴 때 현재 값을 넣어 주지 않아 기본값 false가 됨. `?dev=1` 개발용에만 영향이 있음 | (a) `index.html:15` (b) `js/views/backup.js:140` (keyStorage처럼 `devFakeAI: store.state.settings.devFakeAI`도 넣으면 됨) |

높음과 중간 문제는 없음. 데이터 손실(새로고침, 바로 새로고침, 가져오기, 되돌리기)과 개인정보(이름·학번 전송, 키 노출) 쪽에서 문제를 찾지 못했다.

### 1차에서 고친 문제 (재검수 통과)

| # | 1차 심각도 | 내용 | 재검수 결과 |
|---|---|---|---|
| 8-7 | 중간 | 백업을 타고 가짜 AI 설정이 옮겨 감 | 통과. 백업 파일에 `devFakeAI` 없음, 병합은 현재 값 유지, `?dev=1` 없이 열면 설정값이 true여도 실제 AI로 보냄 |
| 9-1 | 중간 | 작성 표 체크박스 22px | 통과. 누르는 곳 `label.check-hit` 52x48, 상자 24x24. 여백을 눌러도 체크가 바뀌고 패널은 안 열림 |
| 2 | 낮음 | 반 지우기 null 오류, 예상된 AI 오류의 콘솔 출력 | 통과. 확인창 연 채 화면을 바꾼 뒤 확인해도 오류 없음. 429 오류 때 콘솔 0건 |
| 9-2 | 낮음 | 표 Tab 순서에 체크박스 30개 | 통과. 행 하나만 Tab 순서에 있고(로빙 tabindex), 화살표로 이동, Space로 고름, Tab 한 번에 표를 빠져나감 |
| 10-2 | 낮음 | 작은 문제 6개 | 5개 통과, SRI 1개 남음 (위 표) |

### 검수 환경 메모 (앱 문제 아님)
- 1차 때 브라우저 창이 그려지지 않으면 `<dialog>`의 `close` 이벤트가 늦게 왔다. 이제 `ui.js`가 닫을 때 바로 마무리해서, 재검수에서는 창이 그려지지 않을 때도 대화상자가 바로 지워졌다(남은 dialog 0개).
- 한글 글자 입력은 `javascript_tool`로 값을 넣고 `input`/`change` 이벤트를 보냈다. 클릭, 화살표, Enter, Esc, Tab, Space는 실제 키 입력으로 확인했다.

---

## 항목별 결과

### 1. node 테스트 전부 통과: 통과
- `"/c/Program Files/nodejs/node.exe" textgenerator-v2/tests/run.mjs` 결과 1차 78/78, 재검수 79/79 통과 (`tests/backup-format.test.mjs:122` devFakeAI 테스트 추가).

### 2. 로컬 서버에서 콘솔 오류 없이 모든 화면 동작: 통과 (1차 문제, 재검수 통과)
- 1차: `roster.js:125` TypeError와 AI 오류 `console.error`가 있었음.
- 재검수: 30명 흐름 전체, 429 오류, 반 지우기 확인창을 연 채 `#status`로 옮긴 뒤 [반 지우기]를 모두 해 본 뒤 `read_console_messages` 결과 0건. 반은 지워지고 화면은 현황 그대로 (`roster.js:128-132`의 `!root.isConnected` 검사). 예상 못 한 오류만 `console.warn`(write.js:481, 728, 744).

### 3. 가상 학생 30명 흐름

| 항목 | 결과 | 확인 방법 (재검수 기준, 1차도 같은 결과) |
|---|---|---|
| 3-1 명단 등록 | 통과 | '3학년 9반'에 `roster-30.csv` 붙여넣기로 30명 등록. 개발용 [가상 학생 30명 반 만들기]를 두 번 누르니 '시험용 3학년 90반'(39001~), '91반'(39101~)으로 빈 번호만 씀. 같은 이름 '3학년 9반'을 다시 만들면 "'3학년 9반' 반이 이미 있습니다. 다른 이름을 적어 주세요"로 막힘. 1차에서 동아리반에 같은 학생을 넣어 한 학생 여러 반도 확인함 |
| 3-2 학번 오류 안내 | 통과 | 1차: `3051`, `30a01`, `70101`에 "2행: 학번 "3051"이 4자리입니다. 학년 1자리 + 반 2자리 + 번호 2자리로 고쳐 주세요 (예: 30501)." 등 행 번호, '고치는 방법' 안내, [오류 없는 행만 등록] 확인창 |
| 3-3 메모 입력·자동 저장 | 통과 | 5명 메모 입력 뒤 새로고침해도 남음. 1차에서 디바운스 0.6초 안에 바로 새로고침해도 남음 |
| 3-4 일괄 초안 | 통과 | 가짜 AI, 간격 1초, [미작성 학생] > [시작하기] > [멈추기] "5명 중 2명 완료. 멈췄습니다." > [이어서 하기] "5명 중 4명 완료, 메모 부족 1명. 모두 끝났습니다." 메모 부족 학생은 '실패'가 아닌 따로 된 목록(30904 정푸름)에 나옴. 최종본은 그대로. 완료 학생은 건너뜀(1차 '고른 학생 3명 중 완료 2명은 건너뜁니다'). '고른 학생' 모드 안내에 "이미 있는 초안은 새 초안으로 바뀝니다(최종본은 그대로). 초안이 있는 학생: 1명" |
| 3-5 한 학생 초안 3개 | 통과 | [초안 만들기] 후보 3개, [초안 칸에 저장], [최종본 끝에 붙이기], 토스트 [되돌리기] |
| 3-6 검사 | 통과 | 1차: 금지 표현(학원, TOEIC), NEIS 문자, [정리], 한도 초과. 두 학생 최종본을 같게 하니 재검수에서 "같은 영역 다른 학생 글과 90% 이상 비슷합니다: 30901 이아라" (학번과 이름) |
| 3-7 완료로 표시 | 통과 | 완료 뒤 최종본 읽기 전용, [완료 풀기], 붙이기 비활성 |
| 3-8 현황 | 통과 | '자율·자치 완료 2/30', 칸을 누르니 `#write?class=..&area=autonomy&student=30901` |
| 3-9 NEIS 옮기기와 확장 연결 | 통과 | [옮김, 다음] 뒤 진행률 '2개 중 1개'. [확장프로그램으로 보내기] 3초 뒤 '확장프로그램이 설치된 학교 PC 크롬에서 눌러 주세요...'와 [NEIS 입력 파일 내려받기]. `sgb-batch-received` 흉내 > "받았습니다 2명". `sgb-done-list`에 맞는 hash 1개와 틀린 hash 1개를 보내니 맞는 것만 '나이스 입력 완료'. 1차에서 파일 이름 `NEIS입력_2026-2_<시각>.json`, item 필드, 최종본을 고친 뒤 '입력 후 수정됨'도 확인 |
| 3-10 백업 왕복 | 통과 | 내보낸 파일(학생 90, 반 3, 기록 21)에 키와 `devFakeAI` 없음. 메모를 바꾼 뒤 같은 파일을 file input에 `DataTransfer`로 넣으니 미리보기 "새로 들어올 학생 0 / 파일 내용으로 바뀔 기록 1 / 완료라서 그대로 둘 기록 2". [가져오기] 뒤 메모가 파일 것으로, [가져오기 전 상태로 되돌리기] 뒤 '바뀐 메모'로 돌아옴. 새로고침 뒤 반, 완료, NEIS 표시, 키, 메모 모두 남음. 모듈 직접 호출 `makeBackup > validateBackup > previewImport > mergeBackup`도 1차에서 확인 |

### 4. AI 요청에 이름·학번 없음

| 항목 | 결과 | 확인 방법 |
|---|---|---|
| 4-1 테스트가 확인하는지 | 통과 | `tests/gemini.test.mjs:57-88`이 명단 30명의 전체 이름, 성을 뺀 이름, 학번이 URL과 body에 없음과 5자리 숫자가 없음을 확인. `:41-55`에서 키가 헤더에만 있음을 확인 |
| 4-2 다른 길로 보낼 수 있는지 | 통과 | 네트워크 호출은 `gemini.js`의 fetch 하나뿐이고, 화면은 `generateDrafts`만 부름. 보내기 직전에 `containsIdentity`가 막음. 재검수 실제 캡처(`?dev=1` 없이, 키 `test-key...`, 메모에 '최로운(30903)', '이아라', '30902 박슬기', '로운이'): 요청 3회(모델 3개 전환), URL에 키 없음, `x-goog-api-key` 헤더에 키, body에 이름·학번 0개 |

### 5. 금지 API와 기호

| 항목 | 결과 | 확인 방법 |
|---|---|---|
| 5-1 HTML 문자열 직접 넣기 0곳 | 통과 | `grep -rnE "inner[H]TML\|outer[H]TML\|insertAdjacent[H]TML\|document\.[w]rite" textgenerator-v2` 결과 0건 (이 보고서 포함 폴더 전체) |
| 5-2 이모지·장식 기호 0개 | 통과 | python으로 `textgenerator-v2/` 아래 모든 파일에서 U+2190–U+2BFF, U+2600–U+27BF, U+1F000 이상, U+FE0F 검색, 0건 |

### 6. 기존 파일 변경 0개: 통과
- `git status --short`는 `?? docs/textgenerator-v2/`, `?? textgenerator-v2/` 두 줄뿐, `git diff --stat`은 비어 있음 (1차, 재검수 모두).

### 7. 절대 규칙

| 항목 | 결과 | 확인 방법 |
|---|---|---|
| 7-1 API 키가 URL에 없음 | 통과 | `buildRequest`, 테스트, 4-2 실제 캡처 |
| 7-2 키 저장 선택 | 통과 | '이 브라우저에 저장' / '이번에만 사용'. '이번에만 사용'으로 바꾸면 localStorage 키를 바로 지움. IndexedDB에 키 없음 |
| 7-3 백업 파일에 키 없음 | 통과 | 키를 넣은 채 내보낸 파일에 키 문자열 없음. 스냅숏도 `makeBackup`을 거침 |
| 7-4 외부 라이브러리 | 통과 | 외부 스크립트는 SheetJS cdnjs 0.18.5 하나, 글꼴은 이제 `css/tokens.css:5`에서 한 번만 읽음. (SRI 없음은 10-2) |
| 7-5 금지 표현마다 근거 | 통과 | `DEFAULT_FORBIDDEN` 57개 모두 basis 있음, `docs/forbidden-basis.md`에 빠진 id 0, 정규식 오류 0 |
| 7-6 v1.14를 베낀 흔적 | 확인 못 함 | 원본이 저장소에 없어 대조하지 못함. 목록과 프롬프트에서 베낀 흔적은 찾지 못함. id 체계와 경계 처리가 이 도구에 맞게 짜였고, 새로 작성했다는 설명이 있음(`forbidden.js:1-3`, `forbidden-basis.md:6-7`, `prompt.js:2`). 원본과 한 줄씩 대조하는 일은 사람이 해야 함 |

### 8. 기능 1~12

| 항목 | 결과 | 확인 방법 |
|---|---|---|
| 8-1 모델 자동 전환, 35초 제한, 쉬운 오류 문구 | 통과 | 429에서 모델 3개 차례로 시도. 분당 "잠시 1분쯤 기다렸다가 다시 눌러 주세요.", 하루 "오늘 쓸 수 있는 양을 다 썼어요. 내일 다시 하거나...". 키 오류는 바로 멈춤. 35초는 `DEFAULT_TIMEOUT_MS`와 테스트로 확인 |
| 8-2 바이트 한도 기본값과 안내 | 통과 | 1500/1500/900/1500/1500, "학교 기준을 확인하세요..." 경고 |
| 8-3 금지 표현 편집 | 통과 | 추가, 수정, 지우기([되돌리기]), 기본값으로, 찾기. 추가한 말을 검사에서 바로 찾음 |
| 8-4 모든 데이터 지우기 | 통과 | 확인 2번 > DB와 키 삭제 > 빈 상태로 새로고침 (1차) |
| 8-5 스키마 버전과 마이그레이션 자리 | 통과 | `SCHEMA_VERSION`, `MIGRATIONS`, `migrate()`, `db.js` 버전 비교, 높은 버전 백업 거절 |
| 8-6 최종본 덮어쓰기 버튼 없음 | 통과 | 최종본으로 가는 버튼은 '끝에 붙이기'뿐. 일괄은 draft만 씀 |
| 8-7 가짜 AI 설정과 백업 | 통과 (1차 문제, 재검수 통과) | 내보낸 파일에 `devFakeAI` 없음. `mergeBackup({devFakeAI:false}, 들어온 것 devFakeAI:true)` 결과 false. `validateBackup`도 들어온 값을 버림. 설정에서 `devFakeAI`를 켜 두고 `?dev=1` 없이 열면 배지가 없고, [초안 만들기]는 실제 fetch를 부름 (`app.js:53` `devMode && devFakeAI`) |
| 8-8 엑셀 양식·올리기·영역별 내보내기 | 확인 못 함 | 실제 .xlsx 파일로는 시험하지 못함. 코드를 보니 `xlsx-io.js:70-75`가 시트 범위와 관계없이 0행부터 읽어 빈 행이 있어도 엑셀 행 번호가 맞음. 파싱 테스트는 통과. 실제 NEIS 출석부 파일로 한 번 시험할 것 |
| 8-9 실제 Gemini 응답 | 확인 못 함 | 진짜 키가 없어 실제 답 모양은 보지 못함 |

### 9. 접근성

| 항목 | 결과 | 확인 방법 |
|---|---|---|
| 9-1 버튼 44px 이상 | 통과 (1차 문제, 재검수 통과) | 6개 화면의 button, a.btn, navtab, select, input, 현황 칸 버튼, summary, `label.check-hit`를 `getBoundingClientRect`로 잼. 44px 미만 0개. 작성 표 체크 칸 52x48, 상자 24x24. 칸 여백을 누르면 체크가 켜지고 패널은 열리지 않음 |
| 9-2 키보드만으로 주요 기능 | 통과 (1차 문제, 재검수 통과) | 실제 키 입력: '모두 고르기'에서 Tab 한 번에 열린 행(30902), ArrowDown + Space로 30903 고름, 다시 Tab 한 번에 표를 빠져나가 [패널 닫기]로 감. 1차에서 영역 탭 화살표, Enter로 패널 열기, Esc로 닫고 행으로 돌아오기, 확인창 Esc와 포커스 복귀 확인. 표 위에 키보드 사용 안내 문구 있음 |
| 9-3 포커스 보임 | 통과 | `:focus-visible` 3px 외곽선, 행과 체크 칸에서 확인 |
| 9-4 th scope, aria-live | 통과 | 모든 th에 scope. `#live` polite, 토스트 announce, 오류 role=alert |
| 9-5 prefers-reduced-motion | 통과 | `css/app.css`에 `@media (prefers-reduced-motion: reduce)` |
| 9-6 360px 폭 | 통과 | 재검수 360x740: 6개 화면 모두 문서 폭 360(넘침 없음), 표 `.table-wrap` overflow-x auto, 머리 탭 가로 스크롤 |

### 10. 그 밖의 버그

| 항목 | 결과 | 확인 방법 |
|---|---|---|
| 10-1 새로고침 뒤 데이터 유지 | 통과 | 3-3, 3-10. 반, 학생, 메모, 초안, 완료, NEIS 표시, 설정, 키(이 브라우저에 저장)가 새로고침 뒤 남음 |
| 10-2 작은 문제 묶음 | 문제 (낮음) | 아래 표 |
| 10-3 클립보드 실제 복사 | 확인 못 함 | 도구 환경에서 클립보드가 막혀 대체 안내만 확인. 학교 PC 크롬에서 [복사]를 한 번 눌러 볼 것 |

10-2 묶음 상태:

| 문제 | 1차 위치 | 재검수 |
|---|---|---|
| 일괄 '고른 학생' 모드가 있던 초안을 덮어쓴다는 안내가 없음 | `write.js:698`, `:625` | 고침. "이미 있는 초안은 새 초안으로 바뀝니다... 초안이 있는 학생: N명" |
| 비슷한 글 알림에 학번만 보임 | `write.js:493` | 고침. '30901 이아라' |
| 같은 이름 반을 여러 개 만들 수 있음 | `roster.js:41` | 고침. 만들기에서 막힘 (고치기 대화상자도 `nameTaken`을 씀) |
| 개발용 가상 반이 기존 기록을 덮어쓸 수 있음 | `settings.js:331`, `:350` | 고침. 90~99반 중 빈 번호만 쓰고, 다 차면 안내 |
| 글꼴 CSS 두 번 읽음 / SheetJS SRI 없음 | `index.html:12`, `tokens.css:5` / `index.html:16` | 글꼴은 고침. **SRI는 남음** (`index.html:15`) |
| 메모 부족을 '실패'로 셈 | `write.js:695` | 고침. '메모 부족 N명'으로 따로 셈 |
| (새로 찾음) 되돌리기 뒤 개발용 '가짜 AI 켜기'가 꺼짐 | - | **남음**. `backup.js:140`이 스냅숏 설정에 keyStorage만 현재 값으로 넣고 `devFakeAI`는 넣지 않음. 재현: `?dev=1`에서 가짜 AI 켬 > 백업 가져오기 > [가져오기 전 상태로 되돌리기] > 가짜 AI 꺼짐. 개발용에만 영향, 데이터는 잃지 않음 |

---

## 재검수 (2026-11-06)

대상: 담당 보고에 따라 고친 파일 `core/backup-format.js`, `app.js`, `css/app.css`, `views/write.js`, `views/roster.js`, `views/settings.js`, `index.html`, `xlsx-io.js`, `ui.js`.

방법:
1. `node tests/run.mjs` 79/79 통과. 이모지 검사 0건, `git status`는 새 폴더 2개뿐.
2. `python -m http.server 8126`(새 출처라 옛 캐시와 저장소 없음)에서 `?dev=1&v=2`로 30명 흐름을 한 번 더 돌림: 반 만들기와 같은 이름 막기 > 붙여넣기 30명 > 가상 반 2개(90, 91반) > 메모 5명 > 일괄 초안(가짜 AI, 1초, 멈추기와 이어서 하기, 메모 부족 따로 셈) > 후보 3개와 최종본 붙이기 > 완료 2명 > 비슷한 글 알림(학번+이름) > 현황 칸에서 작성으로 > NEIS [옮김, 다음], 응답 없음 3초 안내, 확장 응답 흉내, hash가 다른 항목은 반영 안 됨 > 백업 왕복(미리보기, 가져오기, 되돌리기) > 새로고침 유지.
3. `?dev=1` 없이 다시 열어 가짜 AI가 꺼진 채 실제 요청이 나가는지, 요청 본문 개인정보를 확인.
4. 6개 화면의 44px 측정, 360px 넘침, 실제 키 입력으로 표 키보드 조작, 콘솔 오류 0건 확인.
5. 서버를 끄고 포트가 닫힌 것을 확인.

결과: 1차 문제 5개 중 4개가 완전히 고쳐졌고, 10-2 묶음은 SRI 하나가 남음. 고치면서 새로 깨진 흐름은 없음. 새로 찾은 문제는 개발용 설정 하나(되돌리기 뒤 가짜 AI 꺼짐, 낮음).

## 확인한 명령과 도구
- `"/c/Program Files/nodejs/node.exe" textgenerator-v2/tests/run.mjs`
- `grep -rnE "inner[H]TML|outer[H]TML|insertAdjacent[H]TML|document\.[w]rite" textgenerator-v2`
- python 유니코드 범위 검사 (U+2190–U+2BFF, U+2600–U+27BF, U+1F000 이상, U+FE0F)
- `git status --short`, `git diff --stat`
- node로 `DEFAULT_FORBIDDEN` 근거·문서·정규식 검사
- `python -m http.server 8124`(1차), `8126`(재검수). 둘 다 끝난 뒤 종료
- 내장 브라우저: 클릭, 키 입력, `javascript_tool`(값 넣기, fetch 감싸기, postMessage 흉내, file input에 DataTransfer, 모듈 직접 import), `resize_window` 360x740, `read_console_messages`

## 개발 책임자 후속 조치
- 10-2 (b) 되돌리기 뒤 가짜 AI 꺼짐: `js/views/backup.js:140`에서 되돌릴 때 `devFakeAI`도 현재 값을 넣도록 고침.
- 10-2 (a) SheetJS SRI: 남김. 지금 버전(textgenerator/)과 같은 cdnjs 주소를 쓰며, 무결성 값은 배포 전에 cdnjs에 표시된 값을 확인해 넣기로 함 (PR 확인 필요 목록).

---

## 드라이브·내 스타일 검수 (2026-11-07)

대상: 브랜치 `feat/textgenerator-v2-drive-style` (origin/main 이후 커밋 14개, `27afaba`..`fb100e8`). 검수 담당은 이번 코드를 쓰지 않았고 앱 코드는 고치지 않음.
방법: 저장소 루트에서 `python -m http.server 8767`, 내장 브라우저로 `http://localhost:8767/textgenerator-v2/?dev=1` (새 포트라 옛 저장소 없음). 실제 입력(Tab, Enter, 글자 입력, 클릭)과 `javascript_tool`(값 넣기, store 상태 읽기)을 함께 씀. 끝난 뒤 서버 종료(`curl` 응답 없음 확인), 탭 닫음.

### 8장 완료 기준

| 번호 | 결과 | 근거 |
|---|---|---|
| 1 node 테스트 | 통과 | `node textgenerator-v2/tests/run.mjs` -> `tests 137 / pass 137 / fail 0` (sync-merge, sync, secrets, style, candidates, privacy 포함) |
| 2 콘솔 오류 없음 | 통과 (조건부 1건) | 7개 화면(명단, 작성, 내 스타일, 현황, NEIS, 백업, 설정)을 데스크톱과 375px 폭에서 모두 옮겨 다니고 아래 3·4·6 흐름을 돌린 뒤 `read_console_messages`: 오류 0건 (시험용 `console.info` 한 줄만). 예외 1건: 가짜 드라이브로 연결한 채 `?dev=1` 없이 열면 `[GSI_LOGGER]: Failed to open popup window ... prompt=none` 오류. 개발용 상태가 진짜 모드로 새는 문제(A-1) |
| 3 가짜 드라이브 복원 | 통과 | 가짜 드라이브 켜고 새로고침 -> 머리 배지 '가짜 드라이브 모드' -> 머리 줄 버튼을 Enter로 연결('구글 드라이브에 연결했습니다. 저장됨 14:48') -> 가상 반 1개·학생 30명, 기록 8건(후보 3개, 최종본), 설정(2학기, `updatedAt`), 스타일(자율·자치 예시 3개, 규칙, AI 규칙)을 만들고 상태를 sessionStorage에 적어 둠 -> 가짜 드라이브 파일에 `settings`(기기별 값 `keyStorage`·`devFakeAI`·`publicPC` 없음), `styles`, 최종본이 있고 `secrets: null` -> 개발용 [사본만 지우기] -> 새로고침 뒤 학생 0, 반 0, '드라이브 연결 안 됨' -> 머리 줄 버튼 Enter로 다시 연결 -> `studentsSame`, `classesSame`, `recsSame`, `stylesSame`, `settings` 모두 `true` (기록은 memo·draft·final·candidates까지 JSON 비교) |
| 4 가짜 AI 흐름 | 통과 (문제 1건) | 내 스타일 자율·자치에 예시 3개(이름·학번·'3학년 5반 2번' 섞음) -> 넣기 전 확인 'OO으로 바꾼 곳 2개: 이아라(1번째 글자), 3학년 5반 2번(9번째 글자)' -> [이대로 저장] -> 규칙 2줄 -> [AI로 스타일 정리] 규칙 5줄 -> [이 규칙 쓰기] (`aiRules` 저장 확인) -> 작성 패널 '내 스타일 적용' 켜짐, '적용 중: 규칙 7개, 예시 2개' -> [초안 만들기] 후보 3개(라벨 '후보 1~3') -> 후보 1에 실제 글자 입력: '고침' 배지, 바이트 `aria-live="polite"` '297 / 1500 byte', store `edited: true` -> 칩 [더 짧게]와 다듬기 칸 Enter 요청 -> 새 판, '후보 n을 다듬었습니다' -> [이전 판] 실제 클릭(versions 2 -> 1) -> [최종본 끝에 붙이기] 실제 클릭, `final`에 들어감. 다듬는 동안 다른 글 칸에 포커스가 있으면 카드가 '다듬는 중'으로 멈춤(B-1) |
| 5 머리 줄 저장 버튼 | 통과 | 7개 화면 모두 `#sync-save` 보임(183x44). 페이지 처음부터 실제 Tab 3번 -> '본문으로 건너뛰기', 상태 글, `#sync-save` 순서, `:focus-visible` 3px 외곽선, Enter로 연결·저장. `resize_window` mobile(375x812): 7개 화면 모두 44x44, SVG 아이콘 + `aria-label="구글 드라이브에 저장"`, 문서 폭 375(넘침 없음). 같은 폭에서 button·tab·select·input·summary와 작성 패널 후보 카드 버튼·칩 중 44px 미만 0개. 끝난 뒤 preset desktop으로 되돌림. 설정 맨 아래 [설정을 구글 드라이브에 저장]과 '저장 안 된 설정이 있습니다' 표시도 확인 |
| 6 연결 안 한 상태 | 통과 | 처음 실행 대화상자 '구글 드라이브에 연결 (추천)' -> [나중에] -> 7개 화면 모두 경고 배너 '드라이브 연결 안 됨'과 머리 줄 '드라이브 연결 안 됨: 이 브라우저에만 저장', 버튼 [구글 드라이브 연결]. 가상 반 만들기 뒤 새로고침해도 남음. 연결 끊기('사본은 남기기') + 가짜 드라이브 끄고 `?dev=1` 없이 열어 메모를 실제로 입력 -> 새로고침 -> 메모 남음, GIS 스크립트 안 붙음, `google` 주소 요청 0건 |
| 7 innerHTML·이모지 | 통과 | `grep -rnE "inner[H]TML|outer[H]TML|insertAdjacent|document\.[w]rite" textgenerator-v2 --exclude-dir=lib --exclude-dir=docs` -> 0곳. python 유니코드 검사(U+2190–U+2BFF, U+2600–U+27BF, U+FE0F, U+1F000 이상; .js .mjs .html .css .md .json; lib 제외) -> 코드·CSS·HTML 0개. 걸린 것은 `docs/수정지시서.md`의 화살표(U+2192) 29개뿐(선생님이 쓴 지시서 본문, 화면에 안 나옴) |
| 8 밖의 파일 변경 | 통과 | `git diff --stat origin/main -- . ':!textgenerator-v2'` -> 출력 없음(0개). `git status --short` 깨끗함 |
| 9 외부 코드 | 통과 | `grep -rnE "src=\"http|href=\"http|from ['\"]http|import\(['\"]http|\.src *= *['\"]http" textgenerator-v2 --exclude-dir=docs` -> 0건. `index.html`의 script·link는 `css/*.css`, `../lib/xlsx.full.min.js`, `js/app.js`뿐. GIS는 `js/drive.js:7` `GIS_SRC = 'https://accounts.google.com/gsi/client'`를 `:23-24`에서 `createElement('script')`로 연결할 때만 붙임(동적 로드). 그 밖의 http 문자열은 API 주소(`drive.js:8-9` Drive, `gemini.js:12` Gemini, `drive-common.js:3` scope), 안내 링크(`settings.js:80,84`), SVG 이름공간뿐. 글꼴은 `tokens.css:6-8`이 `../lib/fonts/*.woff2`. `lib/README.md`: IBM Plex Sans KR 1.1.0, OFL 1.1(`fonts/OFL-LICENSE.txt`), 받은 곳 npm `@ibm/plex-sans-kr`. SheetJS는 루트 `lib/README.md`에 0.18.5와 원래 주소(선생님 결정으로 공용 파일 사용). 브라우저 네트워크 기록에도 localhost 밖 요청 0건(가짜 드라이브·가짜 AI) |

### 절대 규칙 점검

| 항목 | 결과 | 근거 |
|---|---|---|
| API 키: 백업·엑셀·자동 백업 | 통과 | `tests/secrets.test.mjs`: `makeBackup`(settings에 `apiKey`·`geminiKey`가 섞여도), `excelRows`(모든 영역), `withoutSecrets`(`secrets: null`)에 키 없음. 브라우저에서 가짜 드라이브 파일 `settings` 키 목록에 키 칸 없음 |
| API 키: console·오류 문구 | 통과 | `grep -rn "console\." textgenerator-v2/js` 29곳: `console.error(e)`는 화면·저장·동기화 예외 객체, `console.warn`은 고정 문구 + `e.name`만. `AiError` 문구는 HTTP 상태와 응답 본문 300자(`gemini.js:39-41`), 요청 헤더·URL은 넣지 않음. 키는 `x-goog-api-key` 헤더에만(`gemini.js:32`). `DriveError` 문구는 `DRIVE_MESSAGES` 고정 문구만. secrets 테스트에 '드라이브 오류 문구에 키·토큰 없음' 있음 |
| 학생 이름·학번이 AI로 안 감 | 통과 | `tests/privacy.test.mjs` 6개: 초안·일괄·다듬기·스타일 정리 요청 본문을 `fetchImpl`로 잡아 이름(성 뺀 이름 포함)·학번·'3학년 5반 2번'·키가 없고 키는 헤더에만 있음. 화면에서도 예시 넣기 때 이름·학번·반 번호가 'OO'으로 바뀜 |
| 버튼 44px (CSS) | 통과 | `tokens.css:129 --touch-min: 44px`. `.btn`·`.btn-sm`·탭·입력이 `min-height: var(--touch-min)`, `.appbar .sync-save`는 `min-width`도. 실측은 5번 |

### 문제 목록

| 번호 | 담당 | 파일:줄 | 증상 | 재현 |
|---|---|---|---|---|
| B-1 (중간) | B | `js/views/write.js:557-559` | 다듬기가 끝날 때 다른 글 칸(또는 같은 카드 textarea)에 포커스가 있으면 `staleAll`만 세우고 다시 그리지 않음. 결과는 store에 들어갔는데 그 카드는 '다듬는 중', textarea `readonly`, 칩·버튼 `disabled`, 옛 글로 남고 칸을 벗어나야(focusout) 풀림. 맥 Safari처럼 버튼을 눌러도 포커스가 옮겨지지 않는 브라우저에서는 같은 카드 textarea에 커서를 둔 채 칩을 누르면 늘 생김 | `?dev=1` 가짜 AI. 후보 1 칩을 누른 직후(2초 안에) 후보 2 textarea를 눌러 입력 시작 -> 후보 1이 '다듬는 중'으로 남음. 검수에서는 후보 1 textarea에 포커스를 둔 채 칩을 `click()`해 재현: store `text` 134자, 화면 81자, `readOnly: true`, 버튼 모두 disabled -> `blur()` 뒤 풀림 |
| A-1 (낮음, 개발용) | A | `js/app.js:36-37`, meta.sync 상태 | 가짜 드라이브로 연결한 상태(`connected: true`, 가짜 `fileId`)가 IndexedDB에 남아, `?dev=1` 없이 열면 진짜 드라이브로 조용한 토큰을 시도함: GIS 스크립트를 붙이고 콘솔 오류 `[GSI_LOGGER] Failed to open popup window`, 배너 '구글 연결 확인'. 진짜로 연결하면 가짜 `fileId`로 `getMeta`를 부를 수 있음 | `?dev=1`에서 가짜 드라이브 켜기 -> 연결 -> 주소에서 `?dev=1`을 빼고 열기 |
| A-2 (낮음) | A | `js/app.js:157`, `js/sync.js:217` | 사본을 지운 뒤 [구글 드라이브 연결]로 복원하면 '드라이브에서 학생 N명, 기록 N건을 불러왔습니다'가 보이지 않고 '구글 드라이브에 연결했습니다'만 남음(뒤 토스트가 덮었거나 안 나옴). 데이터는 모두 돌아옴 | 3번 흐름의 다시 연결 단계. `#live`와 `.toast` 모두 연결 문구 하나 |
| B-2 (낮음, 문구) | B | `js/views/write.js:466, 504, 549` 등 | '후보 2을 다듬었습니다', aria-label '후보 2을 최종본 끝에 붙이기'. 2·4·5 뒤에는 '를'이 맞음 | 후보 2 다듬기 |
| A-3 (확인 필요) | A | `js/drive.js:91` | 시작할 때 조용한 재요청이 `prompt: 'none'` 팝업이라, 사용자 동작 없이 부르면 팝업 차단으로 실패할 수 있음(A-1 재현에서 'Failed to open popup window'). 그러면 토큰이 끝난(약 1시간) 뒤 새로 열 때마다 '구글 연결 확인' 배너와 [다시 연결]이 필요함. 출결 앱도 같은 방식이면 알려진 동작일 수 있음 | 진짜 구글 계정으로 연결 -> 1시간 뒤 새 탭에서 열기 (검수 환경에서는 확인 못 함) |

### 확인 못 한 것
- 진짜 구글 계정 연결, 동의 화면, 401·403·학교 계정 차단 문구, 토큰 1시간 뒤 조용한 재요청(A-3), 두 PC 사이 동기화, 'secrets-offer' 대화상자. 모두 가짜 드라이브와 node 테스트로만 봄.
- 실제 Gemini 응답 (가짜 AI만).
- 처음 연결 고르기 화면([합치기] 등)과 드라이브 백업 되돌리기는 화면에서 누르지 않음(sync 테스트로만 확인).
- 맥 Safari, 휴대폰 실제 기기.

### 확인한 명령과 도구
- `node textgenerator-v2/tests/run.mjs`
- `grep -rnE "inner[H]TML|outer[H]TML|insertAdjacent|document\.[w]rite" textgenerator-v2 --exclude-dir=lib --exclude-dir=docs`
- python 유니코드 범위 검사 (위 7번)
- `git diff --stat origin/main -- . ':!textgenerator-v2'`, `git status --short`
- 외부 주소 grep (위 9번), `grep -rn "console\." textgenerator-v2/js`
- `python -m http.server 8767` (끝난 뒤 종료), 내장 브라우저: 실제 Tab·Enter·글자 입력, 실제 클릭(이전 판, 최종본 붙이기), `javascript_tool`, `resize_window` mobile/desktop, `read_console_messages`, `read_network_requests`
