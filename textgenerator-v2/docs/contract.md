# 생기부 작성 도우미 v2 계약 문서 (contract)

작성: 기획 담당 / 기준 문서: `docs/textgenerator-v2/생기부-작성도우미-업그레이드-기획서.md`(이하 기획서), `생기부-작성도우미-분석과-적용안.md`, `생기부-NEIS-확장프로그램-기획초안.md` 3절.
모든 담당은 이 문서의 이름, 모양, 함수 서명을 그대로 따른다. 바꿔야 하면 이 문서를 먼저 고친다.

## 0. 공통 규칙
- 정적 파일만. 빌드 도구 없음. ES 모듈(`<script type="module">`). 외부 라이브러리는 SheetJS 하나: `https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js` (전역 `XLSX`). 글꼴은 Google Fonts의 IBM Plex Sans KR(400/500/600).
- HTML 문자열을 요소에 직접 넣는 속성과 메서드(inner/outer HTML 속성, insertAdjacent 계열, document 쓰기) 사용 금지. 코드와 주석 어디에도 그 이름을 쓰지 않는다 (검사 명령에 걸린다). 화면은 `js/dom.js`의 `h()`로 만든다.
- 이모지, 장식 기호 문자(체크 표시, 곱하기 표시, 화살표, 별, 동그라미 등) 금지. 아이콘은 `index.html`의 단색 인라인 SVG `<symbol>`을 `icon(name)`으로 쓴다.
- 학생 이름과 학번은 AI 요청에 절대 넣지 않는다 (5절).
- `js/core/` 아래 모듈은 순수 함수만: DOM, `window`, `indexedDB`, `localStorage`, `XLSX`를 쓰지 않는다. node(v20 이상)에서 `import` 가능해야 한다. `crypto.subtle`, `TextEncoder`, `fetch`(주입 가능), `AbortController`는 써도 된다.
- 문구는 쉬운 한국어. 버튼 이름은 동사로 끝낸다 (예: '초안 만들기').

## 1. 폴더와 모듈
```
textgenerator-v2/
  index.html                 화면 뼈대, SVG symbol, 스크립트 로드
  README.md                  선생님용 사용 안내
  css/tokens.css             디자인 토큰 (디자인 담당)
  css/components.css         공통 컴포넌트 (디자인 담당)
  css/app.css                화면별 배치 (화면 담당)
  js/app.js                  시작, 라우팅(#roster 등), 전역 상태 연결 (화면)
  js/dom.js                  h(), icon(), clear(), 포커스 도우미 (화면)
  js/ui.js                   toast(), announce(), confirmDialog(), openDialog() (화면)
  js/db.js                   IndexedDB 열기, 읽기/쓰기, 마이그레이션 실행 (화면)
  js/store.js                메모리 상태 + 자동 저장(디바운스), 변경 알림 (화면)
  js/xlsx-io.js              SheetJS 감싸기: 파일 -> 2차원 배열, 배열 -> 파일 내려받기 (화면)
  js/ext-bridge.js           확장프로그램 postMessage 송수신 (화면)
  js/views/roster.js         명단
  js/views/write.js          작성 (표 + 오른쪽 패널, 일괄 초안 대화상자)
  js/views/status.js         현황
  js/views/neis.js           NEIS 옮기기
  js/views/backup.js         백업
  js/views/settings.js       설정
  js/core/model.js           상수, 영역, 기본 설정, 레코드 키, 상태 계산, 스키마 버전, 마이그레이션 (AI·검사)
  js/core/bytes.js           바이트 계산 (AI·검사)
  js/core/check.js           금지 표현, NEIS 문자, 연속 공백, 정리, 유사도, 종합 검사 (AI·검사)
  js/core/forbidden.js       금지 표현 기본 목록 (근거 포함) (AI·검사)
  js/core/roster-parse.js    학번 검사, 명단 파싱, NEIS 출석부 머리글 찾기 (AI·검사)
  js/core/prompt.js          이름 지우기, 프롬프트 만들기, 응답 정리 (AI·검사)
  js/core/gemini.js          Gemini 호출, 모델 자동 전환, 오류 분류 (AI·검사)
  js/core/fake-ai.js         가짜 AI (AI·검사)
  js/core/batch.js           일괄 초안 실행기 (AI·검사)
  js/core/neis-export.js     확장 보내기 데이터, hash, 입력 완료 반영 (AI·검사)
  js/core/backup-format.js   백업 만들기/검사/미리보기 통계/병합 (AI·검사)
  tests/run.mjs              모든 테스트 실행 (`node textgenerator-v2/tests/run.mjs`)
  tests/*.test.mjs           테스트 (node:test + node:assert)
  docs/contract.md           이 문서
  docs/review.md             검수 보고서 (검수 담당)
```

## 2. 데이터 구조 (기획서 3절)
IndexedDB 이름 `sgb-v2`, DB 버전 1. 객체 저장소:

| 저장소 | keyPath | 내용 |
|---|---|---|
| `meta` | `key` | `{ key: 'schemaVersion', value: 1 }` 등 |
| `students` | `studentId` | 학생 |
| `classes` | `id` | 반 |
| `records` | `id` | 기록 |
| `settings` | `key` | `{ key: 'app', value: Settings }` 하나 |
| `snapshots` | `id` | 가져오기 직전 자동 백업 1개 `{ id: 'before-import', createdAt, data: Backup }` |

API 키는 IndexedDB에 넣지 않는다. '이 브라우저에 저장'이면 `localStorage['sgb-v2-api-key']`, '이번에만 사용'이면 메모리에만.

### Student
```js
{ studentId: '30503', name: '박하늘', updatedAt: ISO }
```
학번은 5자리 문자열(학년 1 + 반 2 + 번호 2). 학번이 같으면 같은 학생.

### Class (반)
```js
{
  id: 'c_<랜덤>',
  name: '3학년 5반',           // 선생님이 짓는 이름
  kind: 'homeroom' | 'subject' | 'club',
  subject: '통합과학' | null,  // kind=subject 일 때만
  achievement: '',             // 교과반 기본 성취기준 (선택)
  studentIds: ['30501', ...],
  createdAt: ISO, updatedAt: ISO
}
```
영역 목록은 종류에서 정해진다: `AREAS_BY_KIND` (3절).

### Record (기록) = 학번 + 영역(+과목) 하나
```js
{
  id: recordKey(studentId, area, subject),   // '30503|autonomy', '30503|subject|통합과학'
  studentId: '30503',
  area: 'autonomy' | 'career' | 'behavior' | 'club' | 'subject',
  subject: null | '통합과학',
  memo: '',
  traits: [],                 // 드러낼 모습 칩 (문자열)
  length: 'concise' | 'standard' | 'full',   // 목표 분량, 기본 'standard'
  achievement: '',            // 교과세특 성취기준 (비면 반의 기본값 사용)
  candidates: [],             // 마지막 생성 결과 최대 3개 (문자열)
  draft: '',                  // AI 초안 칸
  final: '',                  // 최종본 (선생님이 씀)
  status: 'empty' | 'memo' | 'draft' | 'done',   // 미작성/메모/초안/완료
  neis: null | { hash: '16자리', doneAt: ISO },  // 확장이 알려 준 NEIS 입력 완료
  updatedAt: ISO
}
```
- 같은 학생이 담임반과 동아리반에 함께 있으면 `club` 기록은 하나를 같이 쓴다 (학번 + 영역이 같으므로).
- 상태: `done`은 선생님이 [완료로 표시]로만 정한다(최종본이 비면 불가). [완료 풀기]로 되돌린다. `done`이 아니면 `deriveStatus(record)`로 자동 계산 (final 또는 draft가 있으면 `draft`, memo만 있으면 `memo`, 아니면 `empty`).
- `done` 기록은 일괄 생성과 백업 가져오기에서 덮어쓰지 않는다.
- NEIS 입력 완료 표시는 `neis.hash === await textHash(record.final)` 일 때만 유효로 본다. 최종본을 고치면 화면에서 자동으로 '입력 후 수정됨'으로 보인다.

### Settings
```js
{
  schoolLevel: 'high' | 'middle',
  schoolYear: 2026, semester: 1 | 2,
  limits: { autonomy: 1500, career: 1500, behavior: 900, club: 1500, subject: 1500 },
  forbidden: ForbiddenEntry[],   // 4절. 처음에는 DEFAULT_FORBIDDEN 복사
  models: ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  batchIntervalSec: 5,
  keyStorage: 'local' | 'session',
  devFakeAI: false
}
```

### Backup (백업 파일)
```js
{ kind: 'sgb-v2-backup', schemaVersion: 1, exportedAt: ISO, app: 'textgenerator-v2',
  students: [], classes: [], records: [], settings: Settings }   // API 키 없음
```

## 3. `js/core/model.js`
```js
export const SCHEMA_VERSION = 1;
export const AREAS = ['autonomy', 'career', 'behavior', 'club', 'subject'];
export const AREA_LABELS = { autonomy: '자율·자치', career: '진로', behavior: '행동특성', club: '동아리', subject: '교과세특' };
export const AREAS_BY_KIND = { homeroom: ['autonomy', 'career', 'behavior', 'club'], subject: ['subject'], club: ['club'] };
export const KIND_LABELS = { homeroom: '담임', subject: '교과', club: '동아리' };
export const STATUS_LABELS = { empty: '미작성', memo: '메모', draft: '초안', done: '완료' };
export const LENGTHS = { concise: 0.5, standard: 0.7, full: 0.95 };
export const LENGTH_LABELS = { concise: '간결', standard: '표준', full: '충실' };
export const TRAITS_BY_AREA = { autonomy: [...], career: [...], behavior: [...], club: [...], subject: [...] }; // 영역별 8~10개, 새로 지음
export const DEFAULT_LIMITS = { high: {...}, middle: {...} };   // 둘 다 1500, behavior 900
export const DEFAULT_MODELS = [...];
export function defaultSettings(): Settings
export function recordKey(studentId, area, subject = null): string
export function newRecord(studentId, area, subject = null): Record
export function deriveStatus(record): 'empty'|'memo'|'draft'|'done'
export function splitStudentId(id): { grade, classNo, no }        // '30503' -> {3,5,3}
export function migrate(data, fromVersion): data                 // 버전별 함수 표 MIGRATIONS[n] 자리. 지금은 1뿐
```

## 4. 검사 (`bytes.js`, `check.js`, `forbidden.js`)
```js
// bytes.js
export function byteLength(text): number           // 한글(가-힣, ㄱ-ㅎ, ㅏ-ㅣ) 3, 그 밖 문자 1 (줄바꿈 포함). 서로게이트 쌍은 1글자로 셈
export function byteLevel(bytes, limit): 'ok' | 'near' | 'over'   // near: 95% 이상, over: 초과
export function charsForBytes(bytes): number        // 한도 -> 대략 글자 수 (bytes / 2.6, 내림)

// forbidden.js
export const DEFAULT_FORBIDDEN: ForbiddenEntry[]
// ForbiddenEntry = { id, term, match: 'word'|'prefix'|'regex', category, basis, replace, areas: [] | ['subject', ...] }
//  - term: 찾을 말. match='regex'면 정규식 원문(플래그 i)
//  - match 'word': 앞이 한글/영문/숫자가 아니어야 하고, 뒤에는 조사가 와도 됨(뒤 경계는 보지 않음). 영문 term은 앞뒤 모두 경계
//  - match 'prefix': 앞 경계만 (word와 같음, 이름만 다름. 호환용)
//  - areas가 빈 배열이면 모든 영역
//  - category: '교외 수상' | '어학시험' | '사교육' | '부모 정보' | '기관·상표명' | '논문·출판' | '지식재산권' | '교외 활동' | '기타'
//  - basis: 교육부 학교생활기록부 기재요령의 어느 원칙인지 짧게. 원문 쪽수는 '확인 필요'로 표시

// check.js
export function findForbidden(text, area, entries): Hit[]      // Hit = { entry, index, length, match }
export const NEIS_CHAR_RULES: { id, label, pattern(RegExp g), replace }[]  // 둥근 따옴표, 말줄임표, 긴 줄표, 줄바꿈, 탭, 특수 공백, 너비 0 문자, 이모지 등
export function findNeisIssues(text): Issue[]                  // Issue = { id, label, count }
export function cleanText(text): string                        // [정리]: NEIS 문자 바꿈 + 연속 공백 1칸 + 앞뒤 공백 제거
export function similarity(a, b): number                       // 0~1, 공백 뺀 2글자 묶음 Dice 계수
export function findSimilar(text, others: {id, text}[], threshold = 0.9): {id, score}[]   // 30자 미만은 검사 안 함
export function checkRecord(text, { area, limit, entries, others }): CheckResult
// CheckResult = { bytes, limit, level, forbidden: Hit[], neis: Issue[], similar: [], issueCount }
```
경고는 저장을 막지 않는다.

## 5. AI (`prompt.js`, `gemini.js`, `fake-ai.js`, `batch.js`)
```js
// prompt.js
export const INSUFFICIENT_TEXT = '메모에 쓸 내용이 부족하여 초안을 만들지 않음';   // 정해진 한 문장
export function scrubMemo(memo, roster: {studentId, name}[]): string
//  명단의 이름(전체 이름, 성을 뺀 2글자 이상 이름)과 5자리 숫자를 '학생'으로 바꿈. 긴 이름부터 바꿈
export function lengthPlan({ area, limit, length, memoChars }): { targetChars, maxChars, note }
//  targetChars = floor(charsForBytes(limit) * LENGTHS[length]); 메모가 짧으면(<60자 / <150자) 목표를 줄이고 note로 '메모에 없는 내용으로 채우지 말 것'
export function buildPrompt({ area, subject, achievement, memo, traits, length, limit, count }): { system: string, user: string }
//  memo는 scrubMemo를 거친 것만 받는다. 이름/학번 인자 자체가 없다
//  원칙(새로 작성): 메모 속 사실만, 지어내지 않음, 명사형 종결(~함/~임), 학생 호칭·이름 없음, 교외 수상·사교육 등 기재 금지 사항 쓰지 않음,
//  쓸 내용이 부족하면 drafts에 INSUFFICIENT_TEXT 하나만. 응답은 JSON {"drafts": ["...", ...]} (count개, 최대 3)
export function parseResponse(rawText): { drafts: string[], insufficient: boolean }
//  코드 울타리(```) 벗기기, JSON 찾기, 실패 시 throw AiError('parse')
export function tidyDraft(text): string    // 호칭(이 학생은, 학생은, 위 학생은, OO은/는) 앞머리 삭제, cleanText, 따옴표 정리

// gemini.js
export class AiError extends Error { kind: 'key'|'quota-minute'|'quota-day'|'busy'|'timeout'|'network'|'blocked'|'parse'|'model'|'unknown'; userMessage: string }
export function buildRequest({ model, apiKey, prompt }): { url, init }   // 키는 headers['x-goog-api-key'], URL에 없음
export async function callGemini({ models, apiKey, prompt, fetchImpl = fetch, timeoutMs = 35000, signal }): { text, model }
//  모델 목록 순서대로 시도. quota-minute/quota-day/busy/model 오류면 다음 모델. 다 실패하면 마지막 AiError throw
export function classifyError(status, bodyText): AiError
export async function generateDrafts({ record, studentName, roster, settings, apiKey, count, fetchImpl, fake }): { drafts, insufficient, model }
//  scrubMemo -> buildPrompt -> (fake ? fakeGenerate : callGemini) -> parseResponse -> tidyDraft. studentName은 scrubMemo 확인용으로만 사용
// fake-ai.js
export async function fakeGenerate(prompt, { delayMs = 300 }): { text, model: 'fake' }   // 메모 문장을 명사형으로 바꾼 JSON 문자열을 돌려줌. '부족'이 메모에 있거나 메모가 10자 미만이면 INSUFFICIENT_TEXT
// batch.js
export function createBatch({ targets: recordId[], run: async (recordId) => void, intervalMs, sleep, onProgress }): Batch
// Batch = { start(), stop(), resume(), state: { total, done, failed: [{id, message}], skipped, running, stoppedAt } }
//  stop 후 resume은 남은 것부터. run이 quota-day AiError를 던지면 자동으로 멈추고 state.stopReason에 기록
export function pickBatchTargets(records, { mode: 'selected'|'unwritten', selectedIds }): recordId[]
//  done은 언제나 뺌. unwritten = draft와 final이 모두 빈 기록 중 memo가 있는 것
```
일괄 생성은 단일 생성과 같은 조건(record.length, record.traits, 과목·성취기준)을 쓰고, 결과 1개를 `draft` 칸에 넣는다 (`candidates`도 그 1개로 바꿈). 최종본은 건드리지 않는다.

## 6. 명단 (`roster-parse.js`)
```js
export function validateStudentId(raw): { ok, value, error }   // 공백 제거, 숫자 5자리, 학년 1~6, 반 01 이상, 번호 01 이상
export function parseRosterRows(rows: string[][]): { students: [{studentId, name, row}], errors: [{row, message}] }
//  머리글 자동 찾기(처음 20행 안에서 '이름|성명'과 '학번' 또는 '학년+반+번호'가 있는 행). 머리글이 없으면 [학번, 이름] 순서로 봄
//  학년·반·번호 열이 따로 있으면 학번으로 합침. 행 번호는 엑셀 기준(1부터)
//  오류 문구 예: '7행: 학번 "3051"이 4자리입니다. 학년 1자리 + 반 2자리 + 번호 2자리로 고쳐 주세요 (예: 30501).'
//  같은 학번이 다른 이름으로 두 번 나오면 오류
export function parsePastedRoster(text): 같은 결과   // 줄마다 탭/쉼표/공백 구분
export const TEMPLATE_ROWS = [['학번', '이름'], ['30101', '(예시) 김가온']]
```

## 7. NEIS 옮기기와 확장 연결 (`neis-export.js`, `ext-bridge.js`)
```js
export async function textHash(text): string           // SHA-256 hex 앞 16자리 (TextEncoder UTF-8)
export async function buildNeisBatch({ records, students, settings, now }): Batch  // done이고 final이 있는 기록만
// Batch = { kind: 'sgb-neis-batch', version: 1, createdAt, schoolYear, semester,
//   items: [{ id, studentId, grade, classNo, no, name, area, subject, text, bytes, hash }] }   (확장 기획초안 3절 그대로)
export async function applyNeisDone(records, doneItems: [{id, hash, savedAt}]): { updated: Record[], ignored: number }
//  record.id === item.id 이고 hash가 현재 final의 hash와 같을 때만 neis = { hash, doneAt: savedAt }
```

### 확장 메시지 (window.postMessage, targetOrigin = location.origin)
웹앱 -> 확장:
```js
{ source: 'sgb-webapp', type: 'sgb-batch', requestId, payload: Batch }
{ source: 'sgb-webapp', type: 'sgb-done-request', requestId }          // 화면 열 때, NEIS 옮기기 화면 들어올 때
```
확장 -> 웹앱:
```js
{ source: 'sgb-extension', type: 'sgb-batch-received', requestId, count }        // '받았습니다 N명'
{ source: 'sgb-extension', type: 'sgb-done-list', requestId, items: [{ id, hash, savedAt }] }
```
- 웹앱은 `event.source === window`, `event.origin === location.origin`, `data.source === 'sgb-extension'`, 알려진 type, 필드 형식이 맞을 때만 받는다. `sgb-done-list`는 요청 없이 와도 받는다.
- 보낸 뒤 3초 안에 `sgb-batch-received`가 없으면 '확장프로그램이 설치된 학교 PC 크롬에서 눌러 주세요' + [NEIS 입력 파일 내려받기] (Batch JSON, 파일명 `NEIS입력_<학년도>-<학기>_<YYYYMMDD-HHmm>.json`).
- 웹앱 주소: `https://176-oss.github.io/class/textgenerator-v2/`. 확장의 받기 스크립트는 이 경로에서만 돈다.

## 8. 백업 (`backup-format.js`)
```js
export function makeBackup({ students, classes, records, settings, now }): Backup   // settings에 키 관련 값 없음
export function validateBackup(obj): { ok, error, backup }       // kind, schemaVersion 검사, 낮은 버전이면 migrate
export function previewImport(current, incoming): { students, classes, records, doneKept, newStudents, overwritten }
export function mergeBackup(current, incoming): { students, classes, records, settings }
//  학생·반은 id로 합침(들어온 것이 우선). 기록은 현재 것이 done이면 그대로 두고, 아니면 들어온 것으로. 설정은 들어온 것(현재 키 보관 방식은 유지)
```
가져오기 순서: 파일 선택 -> 미리보기 통계 -> [가져오기] -> 현재 데이터를 `snapshots['before-import']`에 저장(1개만 유지) -> 병합 -> 저장. 백업 화면에 [가져오기 전 상태로 되돌리기].

## 9. 화면 (`#roster`, `#write`, `#status`, `#neis`, `#backup`, `#settings`)
- 머리: 앱 이름, 탭 6개(명단, 작성, 현황, NEIS 옮기기, 백업, 설정). 휴대폰 폭에서는 탭이 가로 스크롤.
- 작성: 위에 반 고르기(select) + 영역 탭(role=tablist) + 도구(일괄 초안, 상태 거르기). 가운데 학생 표(체크, 학번, 이름, 메모, AI 초안, 최종본, 바이트, 상태, 검사) — 글 칸은 두 줄 미리보기, 행을 누르거나 Enter로 패널에 연다. 오른쪽 패널 4단계 (1 메모: 메모, 드러낼 모습 칩, 목표 분량, 과목·성취기준 / 2 초안: [초안 만들기] -> 후보 3개까지, 각 [초안 칸에 저장] [최종본 끝에 붙이기], 초안 칸 / 3 검사: 최종본 칸, 바이트 막대, 문제 목록, [정리], [완료로 표시] / 4 NEIS: [복사], 입력 상태). 입력은 0.6초 디바운스 자동 저장, '저장됨' 표시.
- 현황: 행=학생, 열=영역(그 학생이 속한 반들의 영역 합), 칸에 바이트 비율만큼 채운 막대 + 상태 글자, 초과·금지 표현 빨간 테두리, 칸 누르면 `#write?class=..&area=..&student=..`.
- NEIS 옮기기: 반·영역 고르기 -> 완료 학생 목록과 진행률 -> 지금 학생 카드 [복사] [옮김, 다음] -> [확장프로그램으로 보내기] (설명 7절).
- 설정: API 키(보관 방식 선택, 지우기, 발급 안내), 학교급, 학년도·학기, 영역별 한도('학교 기준을 확인하세요'), 모델 목록(추가·삭제·순서), 일괄 간격, 금지 표현 편집(표: 말, 분류, 근거, 바꿀 표현, 영역, 삭제/추가, 기본값으로), 모든 데이터 지우기(확인 대화상자), 개발용(가짜 AI 켜기, `?dev=1`일 때만 보임).
- 알림은 `#live`(aria-live=polite) 영역으로. 대화상자는 `<dialog>` + 포커스 가두기 + Esc.

## 10. CSS 클래스 약속 (디자인 담당이 만들고 화면 담당이 씀)
`btn`, `btn-primary`, `btn-secondary`, `btn-ghost`, `btn-danger`, `btn-sm`(높이는 여전히 44px 이상), `icon-btn`, `icon`, `input`, `textarea`, `select`, `field`, `label`, `hint`, `chip`(aria-pressed), `seg`/`seg-item`(role=radio, aria-checked), `tabs`/`tab`(aria-selected), `card`, `panel`, `table-wrap`(가로 스크롤), `table`, `badge` + `badge-empty|badge-memo|badge-draft|badge-done|badge-warn|badge-danger`, `bytebar`(+ `is-near`, `is-over`, 안쪽 `bytebar-fill` style width), `alert` + `alert-info|alert-warn|alert-danger|alert-ok`, `toast`, `dialog`, `progress`(+ `progress-fill`), `muted`, `small`, `num`(tabular-nums), `sr-only`, `skip-link`, `stack`, `row`, `row-between`, `grid-2`, `empty-state`, `issue-list`, `appbar`, `navtabs`/`navtab`(aria-current=page).

## 11. 구현하며 바뀐 점 (각 담당 보고 반영)
- `js/core/ai-error.js` 추가: `AiError`를 여기 두고 `gemini.js`가 다시 내보냄 (prompt.js와 gemini.js의 순환 import 방지). `kind`에 `'aborted'`(사용자 중단), `'privacy'`(보내기 직전 이 학생 이름·학번이 남아 있으면 보내지 않음) 추가.
- `createBatch`: `key` 오류에서도 자동으로 멈춤. 멈춘 그 기록은 실패로 세지 않고 `resume()`이 먼저 다시 시도. `run`이 `'skipped'`를 돌려주면 건너뜀으로 셈. `state`에 `stopMessage`, `current`, `next`, `finished`.
- `parseResponse`: 내용 부족 답이면 `{ drafts: [], insufficient: true }` (정해진 문장은 drafts에 넣지 않음).
- `checkRecord.issueCount`는 `over`만 셈 (`near`는 세지 않음).
- `generateDrafts` 선택 인자: `achievement`, `signal`, `timeoutMs`, `fakeDelayMs`. `fake`가 없으면 `settings.devFakeAI`를 따름.
- `buildPrompt`는 메모를 `<메모>` ... `</메모>`로 감쌈 (가짜 AI가 꺼내 씀).
- `store.js` 공용 함수: `areasOfClass`, `limitOf`, `othersFor`, `checkOf`, `renameSubjectRecords`(교과반 과목명을 바꾸면 그 반 교과세특 기록 키를 옮김).
- 반을 지워도 학생과 기록은 남김. 완료 기록은 최종본이 읽기 전용([완료 풀기] 뒤 수정).
- 키 보관 방식을 '이번에만 사용'으로 바꾸면 브라우저에 저장된 키를 바로 지움.
- IndexedDB를 못 열면 경고와 '저장 안 됨' 배지를 띄우고 메모리로 계속 씀.
