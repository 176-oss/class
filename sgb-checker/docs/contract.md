# 생기부 점검기 계약 (contract)

기준: `docs/sgb-checker/생기부-점검기-기획서.md` v0.4.1, 2026 기재요령 중학교판·고등학교판(쪽수는 책자에 인쇄된 쪽 번호). 작성일 2026-11-08.

## 1. 모듈

| 파일 | 하는 일 | DOM |
|---|---|---|
| `rules/areas.js` | 항목 목록, 글자 한도, 시트 이름으로 항목 알아보기, 공통과목·소논문 과목 목록 | 없음 |
| `rules/bytes.js` | NEIS 바이트 (한글 3, 그 밖 1, 엔터 1, `\r`은 0) | 없음 |
| `rules/text.js` | 명사형 어미, 관찰자 시점, 마침표, 공백, 문단 구분 기호, 특수문자, NEIS 깨짐 문자, 날짜, 과장 표현 | 없음 |
| `rules/forbidden.js` + `rules/data/forbidden.json` | 금지 내용 (학교급·항목·과목별) | 없음 |
| `rules/check.js` | 입구: `checkText(text, ctx)`, `checkClass(rows, ctx)`, 규칙 이름표 `RULES`, `finish` | 없음 |
| `rules/fix.js` | `applyFix`, `tidy`([정리]), `diff`(전후 비교) | 없음 |
| `shared/key-store.js` | Gemini 키 함께 쓰기 (5절) | 없음 |
| `shared/handoff.js` | 작성 도우미와 글 주고받기 (6절) | 없음 |
| `js/sheet.js` | 엑셀·CSV·붙여넣기 읽기 (XLSX 주입) | 없음 |
| `js/report.js` | 보고서 표와 xlsx 파일 (XLSX 주입) | 없음 |
| `js/ai.js` | 이름 가림, 프롬프트, Gemini 호출, 응답 검사, 재점검, 가짜 AI | 없음 |
| `js/state.js` | 설정(localStorage), 학생 목록(메모리), 다시 점검, 상태 | localStorage만 |
| `js/app.js`, `js/detail.js`, `js/settings.js`, `js/ui.js`, `js/dom.js` | 화면 | 있음 |

`rules/`와 `shared/`는 DOM과 브라우저 저장소에 의존하지 않으므로 작성 도우미가 파일을 복사해 쓸 수 있다 (폴더 사이 import는 하지 않는다). `rules/check.js`는 `import ... with { type: 'json' }`을 쓴다 (Chrome·Edge 123 이상, Safari 17.2 이상, Firefox 138 이상, Node 22 이상).

## 2. 데이터

### 점검 ctx
```js
{ school: 'mid' | 'high', grade: 1 | 2 | 3, area, subject, limitBytes, names: [명단 이름], schoolWords: [학교 이름·별칭·축제명], schoolYear: 2026 }
```

### 항목 id (작성 도우미와 같은 이름)
`autonomy`(자율·자치), `club`, `career`, `subject`(과목별 세특), `individual`(개인별 세특), `behavior`(행특). 자유학기 4개 항목과 일상생활 활동상황은 2026-11-13에 뺐다 (선생님 결정).
한도(글자): 창체 3영역·세특·개세특 500, 행특 300 (중 162, 고 208). 바이트 한도 = 글자 x 3. 설정에서 항목별로 바꿀 수 있음.

### 학생 한 명 (메모리에만)
```js
{ key, studentId, name, area, subject, original, current, history: [이전 글], excepted: Map(지적 key -> 사유), dismissed: Set(지적 key), ai: [AI 지적], aiNote, tooLong }
```

### 지적 하나
```js
{
  ruleId, label, level: 'error' | 'warn',   // 화면 글자: 오류 / 확인
  start, end,                                 // current 기준 위치. 글 전체에 대한 지적은 0, 0
  text,                                       // 원문 조각 (start~end)
  reason,                                     // 이유
  basis,                                      // 근거 쪽수 (예: '중 18', '고 19'). 학교급별로 고른 값
  fix?,                                       // 바꿀 문장 (start~end를 이 글로). ''이면 지움
  hint?,                                      // 금지 내용의 바꿀 방향
  needsConfirm?,                              // 연도 없는 날짜처럼 적용 전에 확인
  ai?, noFix?,                                // AI 지적, AI 문구가 재점검을 통과하지 못함
  key                                         // `${ruleId}|${text}`. 예외 처리·그대로 둠을 글이 바뀌어도 유지
}
```
상태: 남은 지적에 오류가 있으면 `error`(오류), 확인만 있으면 `warn`(확인), 없으면 `pass`(통과), 글이 비면 `empty`(미작성).

## 3. 규칙 id

| id | 등급 | 근거 |
|---|---|---|
| `bytes-over` / `bytes-near` | 오류 / 확인(95% 이상) | 중 162, 고 208 |
| `ending` / `ending-noun` | 오류(~다, ~요 등) / 확인(명사로 끝남) | 중 30, 고 30 |
| `viewpoint-first`, `viewpoint-pronoun`, `viewpoint-name` | 오류 ('우리는'은 확인) | 선생님 기준 |
| `viewpoint-teacher` | 확인 | 선생님 기준 |
| `period`, `space-double` | 오류 | 선생님 기준 |
| `space-edge` | 확인 | 선생님 기준 |
| `bullet` / `special-char` | 오류 / 확인 | 중 30, 고 30 |
| `neis-char` | 확인 | NEIS 입력 |
| `date-format` | 확인 | 중 77, 고 82 |
| `exaggeration` | 확인 | 중 19, 고 19 |
| `club-name-repeat` | 확인 | 중 79, 고 84 (동아리명은 NEIS가 자동 표기) |
| `club-intro-length` | 확인 | 중 79, 고 84 |
| `behavior-negative` | 확인 | 중 115, 고 158 |
| `similar` (90% 이상), `repeat-sentence` (3명 이상) | 확인 | 중 77, 고 82 |
| `common-sum` (고 공통과목 1·2 합산 1,500바이트. 공통과목은 2022 개정 1·2학년에만 있어 학년은 보지 않음) | 오류 | 고 208 |
| `forbidden-<id>` | `forbidden.json` 항목별 | 항목별 |
| `forbidden-school-word` (설정의 학교 이름, 고등학교) | 오류 | 고 19 |
| `too-long` (엑셀 셀 5,000자 넘음) | 오류 | - |
| `ai-spelling`, `ai-area`, `ai-listing`, `ai-rewrite` | 확인 | AI |

유사도는 글자 두 개 묶음의 다이스 계수(공백·문장부호 무시). 같은 항목(세특은 같은 과목) 안에서만 비교한다.

## 4. 금지 목록 (`rules/data/forbidden.json`)
항목마다 `id, cat(분류), label, terms(찾는 말), patterns(정규식), except(예외어), level, schools, areas, basis{mid,high}, desc, fix(바꿀 방향)`. 일부는 `exceptSubjects, exceptSchools, exceptLevel, exceptDesc`(고등학교 연구보고서 작성 가능 과목).
예외어와 겹치는 곳은 지적하지 않는다 (예: '대회의실', '인상을 받', '방과후학교스포츠클럽'). 영문 낱말은 앞뒤가 영문·숫자가 아닐 때만 찾는다.
교육관련기관 예외: 교육부 소속기관 6곳(중 19, 고 19)과 이름에 '교육청', '교육지원청'이 들어간 기관. 시도교육청 직속기관 목록([참고자료 4], 고 [참고자료 5])은 받은 PDF에 들어 있지 않아 넣지 않았다. 그래서 기관명은 '확인'으로만 표시하고 선생님이 [예외 처리]를 고른다.

## 5. API 키 함께 쓰기 (기획서 10-1절)

- **공용 자리**: localStorage `class:gemini-key` = `{"key": "...", "savedBy": "textgenerator-v2" | "sgb-checker", "savedAt": 밀리초}`.
- **작성 도우미의 지금 자리 (2026-11-08 확인)**: localStorage `sgb-v2-api-key` = 키 문자열 그대로. `textgenerator-v2/js/store.js` 9행 `KEY_STORAGE_NAME`, 486~509행 `loadKeyFromStorage`, `setApiKey(key, 'local' | 'session')`, `clearApiKey`. '이번에만'이면 메모리에만 두고 이 자리를 지운다. 드라이브에 키를 저장하는 기능은 IndexedDB의 `secrets`(드라이브 동기화용)이며 점검기는 읽지 않는다.
- **찾는 순서**: 이번에만 쓰는 키(메모리) -> 공용 자리 -> 작성 도우미 자리. 작성 도우미 자리에서 찾으면 공용 자리에 `savedBy: 'textgenerator-v2'`로 복사한다. 작성 도우미 자리는 읽기만 한다.
- **형식 검사**: 키는 공백 없는 30~100자, `savedBy`는 두 값 중 하나, `savedAt`은 숫자. 틀리면 없는 것으로 본다(지우지 않음).
- **지우기**: 공용 자리만 지운다. 작성 도우미 자리에 키가 남아 있으면 '작성 도우미 설정에 키가 남아 있습니다'라고 알리고, 그 키의 끝 4자리를 `sgb-checker:skip-legacy-key`에 적어 같은 키를 다시 복사해 오지 않는다. 작성 도우미에 다른 키를 넣으면 다시 가져온다. 점검기에서 키를 저장하면 이 표시를 지운다.
- 화면에는 끝 4자리만(`****1234`). 키는 콘솔, 오류 메시지, 보고서에 넣지 않는다.
- 후속 작업(프롬프트 C)에서 작성 도우미가 공용 자리를 읽고 쓰게 바뀌면 `LEGACY_KEYS`는 비어도 된다.

## 6. 작성 도우미와 글 주고받기 (`sgb-handoff`)

localStorage `sgb-handoff` = 
```json
{ "source": "sgb-checker" | "textgenerator-v2", "studentId": "10101", "area": "club", "subject": "", "text": "...", "at": 1794118215498 }
```
- 쓰기: 점검기 [작성 도우미에서 고치기] -> `source: 'sgb-checker'`로 쓰고 `../textgenerator-v2/`를 새 탭으로 연다 (`noopener`). 주소창에는 글을 넣지 않는다.
- 받기: 점검기를 열 때 `source: 'textgenerator-v2'`이고 5분 안이면 읽고 바로 지운 뒤 붙여넣기 칸에 넣는다(학번·항목·과목도 채움).
- 검사: 전체 20KB 이하, `source`·`area`는 정해진 값, `studentId` 20자, `subject` 40자, `text` 1~6,000자, `at`은 5분 안(1분 넘는 미래도 거부). 틀리거나 지난 값은 지운다. 우리가 쓴 값은 작성 도우미가 읽도록 남긴다.
- 화면에는 글자로만 넣는다.

## 7. 엑셀

- 양식: `학번 | 이름 | 과목 | 내용`. 시트 이름이 항목 이름이면 저절로 고른다 (`자율`, `동아리`, `진로`, `행특`, `세특_과목명`, `개세특` 등. `자유학기...` 시트는 항목을 정하지 않는다).
- 머리글: 첫 10행 안에서 '학번'(없으면 '번호'), '이름'/'성명', '과목', '내용'/'특기사항'/'세부능력'/'종합의견'을 찾는다. 내용 열과 학번·이름 중 하나가 있어야 한다.
- 제한: `.xlsx .xls .csv`, 5MB, 시트 30개, 모든 시트 행 합계 3,000개, 셀 5,000자(넘으면 잘라서 '너무 김'). 값만 읽는다 (`cellFormula: false, cellHTML: false, cellStyles: false`). 정해진 열만 꺼내 새 객체를 만든다. CSV는 UTF-8, 아니면 EUC-KR.
- 보고서: 시트 `요약`, `학생별`, `수정본`. 모든 셀을 문자열 셀(`t: 's'`)로 쓴다. CSV 내보내기는 없다.

## 8. AI

- 주소 상수 `https://generativelanguage.googleapis.com/v1beta/models/{모델}:generateContent` 하나. 모델 이름은 `^[a-z0-9][a-z0-9.\-]{1,60}$`. 키는 `x-goog-api-key` 헤더.
- 보내는 것: `{ 학교급, 항목, 과목, 점검할_자료 }`. 명단 이름(성까지 쓴 이름, 세 글자 이름의 이름 부분 + 조사)은 '학생'으로 가린다. 가린 뒤에도 이름이 남아 있으면 보내지 않는다. 학번은 보내지 않는다.
- 받는 것(JSON): `spelling[{original, suggestion, reason}]`, `area[{original, reason, moveTo}]`, `listing[{original, reason}]`, `rewrites[{original, suggestion}]`. 각 30개까지, `original`은 보낸 글에 그대로 있어야 하고(위치를 주면 범위 안이어야 함) 400자 이하, `suggestion` 1,000자 이하, `moveTo`는 항목 이름 중 하나. 틀리면 그 항목을 버린다.
- 수정 문구는 `checkText`를 다시 통과(오류 없음, 바꾼 글이 한도 안)해야 [적용]이 생긴다. 아니면 '자동 제안 없음'.
- 처음 AI 제안을 적용할 때 '학생의 실제 활동과 맞는지 확인했습니다'에 표시해야 한다 (중 19, 고 19).
- 모델 목록 순서대로, 429·5xx·모델 없음이면 다음 모델. 35초 제한. 글이 바뀌면 AI 결과는 위치가 틀어지므로 지운다.
- 개발용 가짜 AI(설정 > 개발용)는 호출 없이 정해진 모양의 답을 만든다.

## 9. 기획서와 원문이 다른 곳

| 기획서 | 원문 확인 결과 | 따른 것 |
|---|---|---|
| 행특 부정적 행동특성 '고 159' (2-3절) | 고등학교판은 158쪽(제16조 ① 붙임). 159쪽은 행특 기재 방법(방과후, 영재교육) | 부정적 표현은 고 158, 방과후·영재교육은 고 159 |
| 자율동아리 소개 30자는 고등학교만 '(고) ... (고 84)' (2-3절) | 중학교판 79쪽에도 같은 규정이 있음 | 중·고 모두 점검 (중 79, 고 84) |
| 청소년단체 '중: 단체명만, 고: 입력 불가' (근거 쪽 없음) | 중 74 ⑪, 중 80 바 / 고 78 ⑪ | 그 쪽수를 근거로 씀 |
| 교육관련기관 예외 목록은 '참고자료'로 만든다 (4절) | 중학교판 [참고자료 4], 고등학교판 [참고자료 5]가 받은 PDF에 없음 (본문 쪽까지만 들어 있음) | 6개 기관과 '교육청'·'교육지원청'만 예외. 기관명은 '확인'으로 |
| AI 관련 유의사항 '19쪽' | 중학교는 4항 다, 고등학교는 5항 다 (둘 다 19쪽) | 같음 |
| 금지 내용 '마' (고등학교만) | 중학교판에는 '(고등학교 관련 내용으로 생략)' | 같음 |
| 학교명 점검 (고 19, 4항) | 중학교판 19쪽에는 이 항이 없음 | 고등학교만 |

## 10. 정한 것 (기획서에 없던 것)

- 날짜·특수문자·NEIS 깨짐·과장 표현은 기재요령이 '예시' 또는 '지양'이라 '확인'으로, 문단 구분 번호·기호는 '오류'로 둔다.
- 마침표 점검은 줄 단위다. 괄호 덩어리만 있는 줄(`(영어회화반)(34시간)`)은 건너뛴다.
- 명사로 끝나는 문장('성실한 학생.')은 '확인'으로만 표시한다.
- 연도 없는 날짜에는 학년도를 붙인다(1~2월은 다음 해). 적용 전에 확인을 받는다.
- [정리]는 연속 공백, 줄 앞뒤 공백, 깨짐 문자, 날짜 형식(연도를 붙여야 하는 것 제외)을 한 번에 바꾼다.
- 상업 진로검사 이름(MBTI 등)은 상호명(타)에 해당할 수 있어 '확인'.
- '특허'라는 낱말만 있으면 '확인', 출원·등록·실용신안은 '오류'.
- 번호·기호 문단 구분은 기재요령이 '지양'이라고 쓰지만 '오류'로 둔다 (고칠 것이 분명하므로).
- '그의', '나의', '저의', '우리는'은 다른 인물이나 활동 제목일 수 있어 '확인'. '나는', '그녀는' 등은 '오류'.
- 체육대회·합창대회는 학교 행사일 수 있어 '확인'. 그 밖의 '대회'는 '오류'.
- AI로 보낼 때 세 글자 이름의 이름 부분은 앞이 한글이 아니면 뒤와 상관없이 가린다 ('하늘' 같은 낱말도 가려질 수 있음. 개인정보를 먼저).
- 작성 도우미 자리에서 복사해 온 키는 작성 도우미에서 지워도 공용 자리에 남는다. 작성 도우미가 공용 자리를 쓰게 바뀐 뒤에는 한쪽에서 지우면 둘 다 지워진다 (프롬프트 C).

## 11. 학교 행사 목록 점검 (2026-11-13)
- `rules/events.js` (순수): `canonDate`(하루 `2026.03.04.`, 기간 `2026.03.04.-2026.03.06.`), `parseEventList`(붙여넣기 줄 또는 표 -> `{ events, errors }`, 최대 300개), `checkEvents(text, events, year)`.
- 지적: `event-date`(이름 같고 날짜 다름, fix=목록 날짜), `event-name`(날짜는 목록에 있고 이름 다름), `event-unknown`(목록에 없는 괄호 속 날짜), `event-no-date`(목록 이름 뒤 날짜 없음, fix=`행사명(날짜)`). 모두 '확인'. 자율·진로(`EVENT_AREAS`)에서 목록이 있을 때만.
- 목록은 설정 `settings.events` 로 localStorage 에만 둔다 (불러올 때 `canonDate` 로 다시 검사). `itemCtx.events` 로 넘긴다.

## 12. 학교급·학년·과목 입력 빼기 (2026-11-13)
- 시작 화면에서 학교급, 학년, 과목 칸을 뺐다. 학교급은 설정 값(`settings.school`)을 쓰고 설정에서 바꾸면 바로 다시 점검한다. 작성 도우미에서 받은 글은 보낸 학교급을 쓴다.
- 학년 규칙 `grade3-autonomy`(3학년 '자율·자치' 표기)는 지웠다 (선생님: 글에 영역 이름을 쓰지 않음). `checkClass` 는 `grade` 를 받지 않는다.
- 세특 과목은 엑셀의 과목 칸이나 `세특_과목` 시트 이름에서만 읽는다. 과목 없이 붙여넣은 세특은 한 과목으로 보고 비교한다.
