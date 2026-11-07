# 생기부 작성 도우미 v2 계약 문서 (contract)

작성: 기획 담당 / 기준 문서: `docs/textgenerator-v2/생기부-작성도우미-업그레이드-기획서.md`(이하 기획서), `생기부-작성도우미-분석과-적용안.md`, `생기부-NEIS-확장프로그램-기획초안.md` 3절.
2026-11-07 개정: `textgenerator-v2/docs/수정지시서.md`(이하 지시서)의 드라이브 동기화, 내 스타일, 초안 바로 고치기, 드라이브 저장 버튼, API 키 드라이브 저장. 바뀐 자리는 그 절에서 직접 고치고, 새 내용은 12절부터.
모든 담당은 이 문서의 이름, 모양, 함수 서명을 그대로 따른다. 바꿔야 하면 이 문서를 먼저 고친다.

## 0. 공통 규칙
- 정적 파일만. 빌드 도구 없음. ES 모듈(`<script type="module">`).
- 외부에서 코드를 불러오지 않는다 (지시서 0-2의 8번). `src="http`, `href="http`, `import ... from 'http` 금지.
  - 엑셀: 저장소 공용 SheetJS 0.18.5 `../lib/xlsx.full.min.js` (전역 `XLSX`, `index.html`의 `<script defer src="../lib/xlsx.full.min.js">`). 선생님 결정(2026-11-07)으로 0-2의 1번·8번 규칙의 예외. `textgenerator-v2/lib/`로 복사하지 않는다.
  - 글꼴: IBM Plex Sans KR 400/500/600을 `lib/fonts/`에 내장 (`css/tokens.css`의 `@font-face`, OFL 1.1). 외부 글꼴 주소 금지. 출처와 라이선스는 `lib/README.md`.
  - 유일한 외부 주소: 구글 로그인 스크립트 `https://accounts.google.com/gsi/client`. `index.html`에 적지 않고 `js/drive.js`가 연결할 때 `<script>` 요소를 만들어 넣는다 (출결 앱 방식).
- 데이터를 보내는 곳은 Google 로그인(`accounts.google.com`), Google Drive API(`www.googleapis.com/drive/v3`, `www.googleapis.com/upload/drive/v3`), Gemini API뿐.
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
  js/views/settings.js       설정 (+ 구글 드라이브 카드, API 키 드라이브 저장, 개발용 가짜 드라이브) [A]
  js/views/style.js          내 스타일 (#style) [B, 새 파일]
  config.js                  GOOGLE_CLIENT_ID (attendance/config.js 값 복사) [A, 새 파일, textgenerator-v2/ 바로 아래]
  js/drive.js                GIS 토큰 + Drive REST v3 appDataFolder. DriveApi 구현 (13절) [A, 새 파일]
  js/sync.js                 동기화 흐름 createSync() (14절). DOM·indexedDB·localStorage 없음, 모두 주입 [A, 새 파일]
  js/core/drive-common.js    DriveError, metaStamp, 파일 이름 상수, dayStamp (13절) [A, 새 파일]
  js/core/fake-drive.js      가짜 드라이브 createFakeDrive() (브라우저 개발용과 node 테스트 공용, 13-3) [A, 새 파일]
  js/core/sync-merge.js      드라이브 파일 형식, mergeData, prepareReplace 등 (12절) [A, 새 파일]
  js/core/style.js           maskExample, pickExamples, styleOverlap, 스타일 데이터 고치기 (16절) [B, 새 파일]
  js/core/candidates.js      후보 고치기·판 관리 (17절) [B, 새 파일]
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
[A]/[B]는 이번 개정의 담당 (20절 분담표). `config.js`는 `js/drive.js`가 `../config.js`로 import한다.

## 2. 데이터 구조 (기획서 3절)
IndexedDB 이름 `sgb-v2`, DB 버전 1 그대로. 새 저장소를 만들지 않고 기존 `meta`·`settings`·`snapshots`에 키를 더한다 (`onupgradeneeded`가 바뀌지 않으므로 DB 버전을 올릴 필요가 없다). 데이터 스키마 버전(`meta.schemaVersion`)은 2 (3절 migrate).
IndexedDB는 **임시 사본**이다. 원본은 구글 드라이브의 `sgb-data.json` (12절). 드라이브에 연결하지 않았으면 지금처럼 사본이 유일한 저장소다.

| 저장소 | keyPath | 내용 |
|---|---|---|
| `meta` | `key` | `{ key: 'schemaVersion', value: 2 }`, `{ key: 'deleted', value: Tombstone[] }`, `{ key: 'sync', value: SyncState }`(14절), `{ key: 'syncPending', value: boolean }`, `{ key: 'secrets', value: Secrets or null }`(18절, 공용 PC면 쓰지 않음) |
| `students` | `studentId` | 학생 |
| `classes` | `id` | 반 |
| `records` | `id` | 기록 |
| `settings` | `key` | `{ key: 'app', value: Settings }`, `{ key: 'styles', value: Styles }`(16절) |
| `snapshots` | `id` | 되돌리기용 사본, id마다 1개 `{ id, createdAt, data }`: `'before-import'`(가져오기 직전, Backup), `'before-first-sync'`(처음 연결 고르기 직전, DriveFile), `'before-restore'`(드라이브 백업으로 되돌리기 직전, DriveFile). `putSnapshot`은 같은 id만 바꾼다 (지금처럼 저장소 전체를 지우지 않음) |

`Tombstone = { store: 'students'|'classes'|'records', id, deletedAt: ISO }` (12절).

API 키는 지금처럼 `localStorage['sgb-v2-api-key']`('이 브라우저에 저장') 또는 메모리('이번에만 사용'). 드라이브 저장(18절)을 켠 경우에만 같은 키가 `meta.secrets`(공용 PC가 아닐 때)와 드라이브 파일 `secrets`에 들어간다. 백업 파일, 엑셀, 자동 백업, 콘솔, 오류 문구에는 절대 넣지 않는다.

기기별 브라우저 저장소 키 (백업·드라이브에 넣지 않음): `localStorage['sgb-v2-api-key']`, `sgb-v2-token`(드라이브 토큰 `{accessToken, expiresAt}`, 기본 localStorage, 공용 PC면 sessionStorage에만), `localStorage['sgb-v2-drive-intro']`(처음 연결 안내를 본 표시), `localStorage['sgb-v2-dev-fake-drive']`('1'이면 가짜 드라이브, `?dev=1`일 때만 따름), `localStorage['sgb-v2-fake-drive']`(가짜 드라이브의 파일들).

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
  candidates: Candidate[],    // 마지막 생성 결과 최대 3개 (아래 Candidate, 17절). v1의 문자열 배열은 migrate가 바꿈
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
- `neis`는 확장프로그램이 드라이브 파일에 직접 쓸 수 있는 유일한 필드다 (19절). `neis`만 바꿀 때는 `updatedAt`을 바꾸지 않는다 (웹앱의 `putRecords`도 지금처럼 그대로 둠). 동기화 합치기에서 `neis`는 본문과 따로 `doneAt`이 늦은 쪽 (12절).

### Candidate (초안 후보, 17절)
```js
{ original: 'AI가 처음 준 글', text: '지금 글(고친 것)', versions: ['이전 판', ...], edited: false }
// versions: 다듬기·[처음 상태로] 직전의 글. 오래된 것부터, 최대 3개 (MAX_CANDIDATE_VERSIONS)
// edited === (text !== original). 화면의 '고침' 표시
```

### Settings
```js
{
  schoolLevel: 'high' | 'middle',
  schoolYear: 2026, semester: 1 | 2,
  limits: { autonomy: 1500, career: 1500, behavior: 900, club: 1500, subject: 1500 },
  forbidden: ForbiddenEntry[],   // 4절. 처음에는 DEFAULT_FORBIDDEN 복사
  models: ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  batchIntervalSec: 5,
  keyStorage: 'local' | 'session',   // 기기별
  devFakeAI: false,                  // 기기별
  publicPC: false,                   // 기기별. 공용 PC: 토큰은 sessionStorage, secrets 사본 안 남김, 키 드라이브 저장 막음
  updatedAt: ISO | null              // 기기별이 아닌 값을 바꿀 때 갱신. v1 데이터는 migrate가 null로
}
```
- `DEVICE_SETTING_KEYS = ['keyStorage', 'devFakeAI', 'publicPC']` (model.js). 이 값들은 드라이브 파일·백업에 넣지 않고, 동기화 합치기와 백업 가져오기에서 언제나 이 브라우저 값을 쓴다.
- `store.updateSettings(patch)`는 patch에 기기별이 아닌 키가 하나라도 있으면 `updatedAt = now`로 하고 드라이브에 올릴 변경으로 친다. 기기별 값만 바꾸면 `updatedAt`을 그대로 두고 IndexedDB에만 쓴다.

### Backup (백업 파일)
```js
{ kind: 'sgb-v2-backup', schemaVersion: 2, exportedAt: ISO, app: 'textgenerator-v2',
  students: [], classes: [], records: [], settings: Settings, styles: Styles }
// API 키·secrets·기기별 설정·deleted 없음. schemaVersion 1 백업도 읽는다 (migrate: candidates 바꿈, styles 없으면 빈 Styles)
```
Styles는 16절, 드라이브 데이터 파일(DriveFile)은 12절.

## 3. `js/core/model.js`
```js
export const SCHEMA_VERSION = 2;
export const DEVICE_SETTING_KEYS = ['keyStorage', 'devFakeAI', 'publicPC'];
export const STYLE_AREAS = ['common', 'autonomy', 'career', 'behavior', 'club'];   // 교과는 'subject:<과목명>' (16절)
export const MAX_CANDIDATE_VERSIONS = 3;
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
export function migrate(data, fromVersion): data                 // 버전별 함수 표 MIGRATIONS[n]
export function defaultStyles(): Styles                          // { updatedAt: null, areas: {} }
export function newCandidate(text): Candidate                    // { original: text, text, versions: [], edited: false }
export function normalizeCandidates(list): Candidate[]           // 문자열이면 newCandidate, 객체면 빈 칸 채움, 최대 3개
```
`MIGRATIONS[2]` (v1 -> v2). 받는 `data`는 IndexedDB 묶음 `{ students, classes, records, settings }`, 백업, 드라이브 파일 중 하나다. 없는 필드는 건너뛴다.
- `records[].candidates`: `normalizeCandidates` (문자열 -> `newCandidate`).
- `settings`: `updatedAt`이 없으면 `null`, `publicPC`가 없으면 `false`.
- `styles`가 없으면 `defaultStyles()`, 드라이브 파일이면 `deleted`가 없을 때 `[]`. `secrets`는 건드리지 않는다.
- `defaultSettings()`에 `publicPC: false`, `updatedAt: null` 추가.
- `db.loadAll`은 지금처럼 `meta.schemaVersion < 2`면 migrate 후 `replaceAllData`로 다시 쓰고 버전을 2로 (`loadAll`이 `styles`, `deleted`, `secrets`, `syncState`, `syncPending`도 읽어 돌려줌, 15절).

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
일괄 생성은 단일 생성과 같은 조건(record.length, record.traits, 과목·성취기준, 내 스타일)을 쓰고, 결과 1개를 `draft` 칸에 넣는다 (`candidates`도 `[newCandidate(그 글)]`로 바꿈). 최종본은 건드리지 않는다.
2026-11-07 추가: `buildPrompt`·`generateDrafts`의 `style` 인자, 스타일 정리(`buildStyleSummaryPrompt`, `summarizeStyle`)는 16절, 다듬기(`buildRefinePrompt`, `refineDraft`)는 17절.

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

### 드라이브 경로 (2026-11-07 추가, 연결됐을 때 기본)
- 드라이브에 연결되어 있으면 확장은 드라이브의 `sgb-data.json`에서 직접 읽고 `records[].neis`만 써 넣는다 (쓸 수 있는 범위는 19절). 웹앱은 동기화로 받은 기록의 `neis`로 입력 완료 표시를 갱신한다. 유효 규칙은 위와 같다 (hash가 현재 최종본과 같을 때만).
- 위의 postMessage 보내기와 [NEIS 입력 파일 내려받기]는 '드라이브 없이 보내기' 아래의 예비 경로로 남긴다. `sgb-done-list`로 받은 완료도 지금처럼 `applyNeisDone` -> `putRecords`로 반영하고, 그 변경은 드라이브에도 올린다.

## 8. 백업 (`backup-format.js`)
```js
export function makeBackup({ students, classes, records, settings, styles, now }): Backup   // settings에 키 관련 값·기기별 값 없음
export function excelRows({ classes, students, records, area }): (string|number)[][]   // views/backup.js의 exportRows를 옮긴 순수 함수 (비밀 정보 테스트용) [A]
export function validateBackup(obj): { ok, error, backup }       // kind, schemaVersion 검사, 낮은 버전이면 migrate
export function previewImport(current, incoming): { students, classes, records, doneKept, newStudents, overwritten }
export function mergeBackup(current, incoming): { students, classes, records, settings }
//  학생·반은 id로 합침(들어온 것이 우선). 기록은 현재 것이 done이면 그대로 두고, 아니면 들어온 것으로. 설정은 들어온 것(현재 키 보관 방식은 유지)
//  2026-11-07: 반환에 styles 추가 (styles.areas 키별로 들어온 것이 우선, 들어온 백업에 styles가 없으면 현재 것). 기기별 설정(DEVICE_SETTING_KEYS)은 모두 현재 값 유지
```
- `stripKeys`가 빼는 필드에 `publicPC`, `geminiKey`, `secrets` 추가. 백업 최상위에도 `secrets`·`deleted`를 넣지 않는다.
- 이 병합(`mergeBackup`, 들어온 것 우선 + done 보존)은 백업 파일 가져오기 전용으로 그대로 둔다. 드라이브 동기화 합치기(`sync-merge.mergeData`, `updatedAt` 기준)와는 별개다.
- 가져오기 순서: 파일 선택 -> 미리보기 통계 -> [가져오기] -> 현재 데이터를 `snapshots['before-import']`에 저장(1개만 유지) -> 병합 -> `store.replaceAll(병합 결과)`. 백업 화면에 [가져오기 전 상태로 되돌리기].
- `store.replaceAll`은 이제 `prepareReplace`(12절)를 거친다: 바뀐 항목의 `updatedAt`을 지금으로 올리고, 없어진 항목은 삭제 기록을 남기고, 드라이브에 올릴 변경으로 친다. 그래야 가져온 것과 되돌린 것이 다음 동기화에서 드라이브의 옛것에 지지 않는다.

## 9. 화면 (`#roster`, `#write`, `#style`, `#status`, `#neis`, `#backup`, `#settings`)
- 머리: 앱 이름, 탭 7개(명단, 작성, 내 스타일, 현황, NEIS 옮기기, 백업, 설정). 휴대폰 폭에서는 탭이 가로 스크롤. 머리 줄 오른쪽에 드라이브 저장 상태 글과 [구글 드라이브에 저장] 버튼 (14-4, 모든 화면).
- 배너(`#banner-root`): 드라이브 연결 안 됨(경고, [구글 드라이브 연결], 닫을 수 없음), 구글 연결 확인 필요([다시 연결]), 동기화 오류(이유 + [다시 시도]). 기존 저장 공간 배너와 함께 쌓는다.
- 작성: 위에 반 고르기(select) + 영역 탭(role=tablist) + 도구(일괄 초안, 상태 거르기). 가운데 학생 표(체크, 학번, 이름, 메모, AI 초안, 최종본, 바이트, 상태, 검사) — 글 칸은 두 줄 미리보기, 행을 누르거나 Enter로 패널에 연다. 오른쪽 패널 4단계 (1 메모: 메모, 드러낼 모습 칩, 목표 분량, 과목·성취기준 / 2 초안: [초안 만들기] -> 후보 3개까지, 각 [초안 칸에 저장] [최종본 끝에 붙이기], 초안 칸 / 3 검사: 최종본 칸, 바이트 막대, 문제 목록, [정리], [완료로 표시] / 4 NEIS: [복사], 입력 상태). 입력은 0.6초 디바운스 자동 저장, '저장됨' 표시.
- 현황: 행=학생, 열=영역(그 학생이 속한 반들의 영역 합), 칸에 바이트 비율만큼 채운 막대 + 상태 글자, 초과·금지 표현 빨간 테두리, 칸 누르면 `#write?class=..&area=..&student=..`.
- 작성 패널 2단계(초안)는 17절대로 바뀐다: 후보 카드 textarea, [처음 상태로], [AI에게 다듬기 요청], [이전 판], '내 스타일 적용' 스위치(16-5).
- 내 스타일(`#style`): 16-4.
- NEIS 옮기기: 반·영역 고르기 -> 완료 학생 목록과 진행률 -> 지금 학생 카드 [복사] [옮김, 다음]. 드라이브에 연결되어 있으면 안내 '학교 PC 확장프로그램이 드라이브에서 완료 기록을 바로 가져갑니다'를 기본으로 보이고, [확장프로그램으로 보내기]와 [NEIS 입력 파일 내려받기]는 '드라이브 없이 보내기' 접이식(`<details>`) 안으로 옮긴다. 연결 안 됐을 때는 접이식을 처음부터 펼쳐 둔다 (설명 7절).
- 백업: 지금 카드들 + '드라이브 자동 백업' 카드(연결됐을 때만): 날짜별 목록(최근 7개)과 각 [이 백업으로 되돌리기](확인 대화상자, 되돌리기 전 현재 상태를 `snapshots['before-restore']`에 저장). `snapshots['before-first-sync']`가 있으면 [드라이브 연결 전 이 브라우저 상태로 되돌리기]도 보인다.
- 설정: API 키(보관 방식 선택, 지우기, 발급 안내, 18절의 '구글 드라이브에도 저장' 체크), 학교급, 학년도·학기, 영역별 한도('학교 기준을 확인하세요'), 모델 목록(추가·삭제·순서), 일괄 간격, 금지 표현 편집(표: 말, 분류, 근거, 바꿀 표현, 영역, 삭제/추가, 기본값으로), '구글 드라이브' 카드(14-5), 모든 데이터 지우기(확인 대화상자), 개발용(`?dev=1`일 때만: 가짜 AI 켜기, 가짜 드라이브 켜기(새로고침 필요), [사본만 지우기]), 맨 아래 [설정을 구글 드라이브에 저장](4장, 머리 줄 버튼과 같은 동작. 위에 '저장 안 된 설정이 있습니다': 연결됐고 `settings.updatedAt > sync.status.lastSyncAt`일 때).
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

---

# 2026-11-07 개정: 드라이브 동기화와 내 스타일 (지시서 1~7장)

## 12. 드라이브 데이터 파일과 합치기 (`js/core/sync-merge.js`) [A]
### 12-1. 파일 (appDataFolder)
- 데이터 `sgb-data.json` 하나. 자동 백업 `sgb-backup-YYYYMMDD.json` (날짜는 이 PC의 지역 날짜). 출결 앱 파일(`attendance-data.json`)과 같은 appDataFolder를 쓰므로(같은 OAuth 클라이언트) **이름이 `sgb-`로 시작하는 파일만** 읽고 쓰고 지운다.
- 범위(scope)는 `https://www.googleapis.com/auth/drive.appdata` 하나.

### 12-2. DriveFile (드라이브 데이터 파일 = 동기화 데이터 SyncData)
```js
{
  kind: 'sgb-v2-data', schemaVersion: 2, app: 'textgenerator-v2', updatedAt: ISO,   // updatedAt: 올린 시각
  students: Student[], classes: Class[], records: Record[],
  settings: Settings,          // DEVICE_SETTING_KEYS 뺀 것 + updatedAt
  styles: Styles,              // 16절
  secrets: null | { geminiKey: string, updatedAt: ISO },   // 18절. geminiKey '' = 끈 기록(지운 것이 다른 기기에서 되살아나지 않게)
  deleted: Tombstone[]         // [{ store: 'students'|'classes'|'records', id, deletedAt }]
}
```
- 자동 백업 파일도 같은 모양이고 `secrets`는 언제나 `null`.
- `SyncData`는 store가 만드는 이 브라우저 쪽 같은 모양(kind 등 머리 필드는 없어도 됨). 기기별 설정이 들어 있어도 되고, `toDriveFile`이 뺀다.
- 삭제 기록: 학생·반·기록을 지울 때(store의 `markDeleted`) `deleted`에 남긴다. 같은 id를 다시 만들면(`markDirty`) 이 브라우저의 그 삭제 기록을 지운다. `deletedAt`이 90일 지난 것은 `mergeData`가 정리한다. (지금 화면에 학생 삭제는 없다. 반 삭제와 과목명 변경 때 옛 기록 키가 해당)

### 12-3. 함수
```js
export const DATA_KIND = 'sgb-v2-data';
export const TOMBSTONE_DAYS = 90;
export function emptyData(): SyncData                       // 빈 목록, defaultSettings(), defaultStyles(), secrets null, deleted []
export function checkDataFile(obj): { ok, error, data, newer }
//  kind가 다르면 ok false. schemaVersion > SCHEMA_VERSION 이면 { ok: false, newer: true } (이때 동기화는 올리지 않고 멈춤: 'newer' 오류)
//  낮으면 migrate. 빠진 목록은 빈 배열로 채움
export function toDriveFile(data, now = new Date()): DriveFile      // 머리 필드 붙이고 settings에서 DEVICE_SETTING_KEYS 뺌
export function withoutSecrets(file): DriveFile                       // secrets: null (자동 백업용)
export function mergeData(local, remote, { now = new Date() } = {}): { data: SyncData, changes: Changes }
export function sameData(a, b): boolean                    // 머리 필드(updatedAt 등) 빼고 내용 비교 (올릴 필요 판단)
export function prepareReplace(current, next, now = new Date()): SyncData
//  '통째로 바꾸기'용: next에서 current와 내용이 다르거나 새로 생긴 항목의 updatedAt = now, current에만 있는 id는 deleted에 추가,
//  settings·styles(영역별)가 다르면 updatedAt = now. 쓰는 곳: 백업 가져오기·되돌리기(store.replaceAll), 드라이브 백업으로 되돌리기,
//  처음 연결 [이 브라우저 것으로 드라이브 바꾸기](current = 드라이브 것, next = 이 브라우저 것)
export function summarize(data): { students: number, records: number, updatedAt: ISO|null }   // 처음 연결 고르기 화면, 내용 있는 기록만 셈
export function hasData(data): boolean                     // 학생 또는 반 또는 내용 있는 기록이 있음
// Changes = { added, updated, removed, byStore: { students: {added, updated, removed}, classes: {...}, records: {...} } }
//  local 기준: added = 결과에 새로 생긴 id, updated = 양쪽에 있고 결과가 local과 다른 것(neis만 바뀐 것 포함), removed = 삭제 기록으로 local에서 빠진 것
```
`mergeData` 규칙 (순수 함수, `remote`가 null이면 local 그대로 + changes 0):
1. 학생(`studentId`)·반(`id`)·기록(`id`): id별로 `updatedAt`이 늦은 쪽. 같으면 원격. 한쪽에만 있으면 그것.
2. 삭제 기록: 같은 (store, id)는 `deletedAt`이 늦은 것 하나. 항목의 `updatedAt` > `deletedAt`이면 항목이 살고 그 삭제 기록은 버림, 아니면 항목을 뺌 (지운 것이 되살아나지 않음).
3. 기록의 `neis`: 본문이 어느 쪽이 이기든, 양쪽 `neis` 중 `doneAt`이 늦은 것을 결과 기록에 넣는다 (한쪽만 있으면 그것). 유효성(hash)은 화면에서 판단.
4. `settings`: `updatedAt`이 늦은 쪽 (한쪽만 있으면 그쪽, 둘 다 null이면 로컬). 결과의 DEVICE_SETTING_KEYS는 언제나 로컬 값.
5. `secrets`: `updatedAt`이 늦은 쪽 (null은 가장 이른 것으로 봄). 둘 다 null이면 null.
6. `styles`: `areas`의 키별로 `updatedAt`이 늦은 쪽 (같으면 원격). `styles.updatedAt`은 결과 영역들의 가장 늦은 값.
7. `deletedAt`이 `now`보다 90일 넘게 지난 삭제 기록은 결과에서 뺀다.

## 13. 드라이브 모듈 (`js/drive.js`, `js/core/drive-common.js`, `js/core/fake-drive.js`) [A]
### 13-1. `js/core/drive-common.js` (순수)
```js
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const DATA_FILE_NAME = 'sgb-data.json';
export const BACKUP_PREFIX = 'sgb-backup-';                // + 'YYYYMMDD.json'
export function dayStamp(date = new Date()): 'YYYYMMDD'    // 지역 날짜
export function backupName(day): string                    // 'sgb-backup-20261107.json'
export function metaStamp(meta): string | null             // `${version}|${modifiedTime}`
export class DriveError extends Error { kind, status, userMessage }
// kind: 'auth' | 'forbidden' | 'blocked' | 'popup' | 'network' | 'busy' | 'notfound' | 'parse' | 'newer' | 'conflict' | 'unknown'
export const DRIVE_MESSAGES = {
  auth: '구글 연결이 만료되었습니다',                                   // 화면에 [다시 연결]
  forbidden: '드라이브 접근 권한이 없습니다. 연결할 때 권한 상자를 체크했는지 확인하세요',
  blocked: '이 구글 계정으로는 연결할 수 없습니다. 학교 계정은 외부 앱이 막혀 있을 수 있으니 개인 구글 계정으로 연결해 주세요',
  popup: '구글 연결 창을 열지 못했습니다. 팝업 차단을 확인하세요',
  network: '인터넷 연결이 없어 올리지 못했습니다. 연결되면 올립니다',
  busy: '구글 드라이브가 잠시 바쁩니다. 조금 뒤 다시 올립니다',
  newer: '더 새 버전의 앱이 드라이브에 저장했습니다. 새로고침해 주세요',
  parse: '드라이브의 생기부 데이터 파일을 읽을 수 없습니다',
  conflict: '다른 기기에서 동시에 고치고 있어 올리지 못했습니다. 잠시 뒤 다시 올립니다',
  unknown: '구글 드라이브에 저장하지 못했습니다',
};
```
오류 분류: HTTP 401 -> `auth`(토큰 지움), 403 + 사유 `rateLimitExceeded|userRateLimitExceeded` -> `busy`, 그 밖 403 -> `forbidden`, 404 -> `notfound`, 429·5xx -> `busy`, `fetch` 실패 -> `network`. GIS 응답 `error === 'access_denied'` 또는 관리자 정책 거부 -> `blocked`, 받은 권한에 drive.appdata가 없으면(`google.accounts.oauth2.hasGrantedAllScopes`) -> `forbidden`, 팝업 실패 -> `popup`, 조용한 재요청 실패·시간 초과 -> `auth`. 토큰과 응답 본문은 오류 문구와 콘솔에 넣지 않는다.

### 13-2. DriveApi (드라이브 구현이 지켜야 할 모양. `js/drive.js`의 내보내기 이름이 곧 이 모양이고, `import * as drive`를 그대로 주입한다)
```js
isConfigured(): boolean                       // GOOGLE_CLIENT_ID가 있음
hasToken(): boolean                           // 만료 1분 전까지 유효한 토큰이 있음
setTokenMode(mode: 'local'|'session'): void   // 공용 PC면 'session'. 있던 토큰을 옮기고 다른 쪽은 지움
requestToken({ consent = false, silent = false } = {}): Promise<void>   // consent: 동의 화면, silent: prompt 'none'(8초 제한). 실패는 DriveError
revoke(): Promise<void>                       // 토큰 지우고 GIS revoke
findDataFile(): Promise<Meta|null>            // name = 'sgb-data.json', spaces=appDataFolder, 가장 최근 것
getMeta(id): Promise<Meta>                    // fields=id,name,version,modifiedTime (본문 없음)
download(id): Promise<object>                 // alt=media, JSON 파싱 실패 -> DriveError('parse')
upload(id | null, data): Promise<Meta>        // multipart. null이면 sgb-data.json 새로 만듦(parents ['appDataFolder'])
listBackups(): Promise<Meta[]>                // name contains 'sgb-backup-', 이름 내림차순(최근 먼저)
writeBackup(day, data): Promise<Meta>         // backupName(day) 파일이 있으면 덮어쓰고, 없으면 만듦
deleteFile(id): Promise<void>
deleteAppFiles(): Promise<number>             // sgb-data.json과 sgb-backup-*.json만 지움. 지운 수
// Meta = { id, name, version: string, modifiedTime: ISO }
```
`js/drive.js`: `attendance/drive.js`를 복사해 고친다 (폴더 사이 import 금지). GIS는 연결이 필요할 때 처음 한 번 `<script src="https://accounts.google.com/gsi/client">`를 만들어 넣음(15초 제한). 토큰 저장 키 `sgb-v2-token`, 값 `{ accessToken, expiresAt }`. 모듈 맨 위에서 `window`·`document`를 건드리지 않는다(함수 안에서만).

### 13-3. 가짜 드라이브 `js/core/fake-drive.js` (순수, 개발용·테스트 공용)
```js
export function createFakeDrive({ storage = null, now = () => new Date(), tokenOk = true } = {}): FakeDrive
// FakeDrive = DriveApi 전부 + 시험 도구:
//   setOffline(bool)                 켜면 모든 호출이 DriveError('network')
//   failNext(kind, count = 1)        다음 count번 호출을 그 kind로 실패
//   setTokenOk(bool)                 false면 requestToken({silent})가 DriveError('auth')
//   afterDownload(fn)                다음 download가 끝난 직후 한 번 fn(fake) 실행 (확장이 그 사이 쓰는 상황 재현)
//   writeRaw(name, data) / readRaw(name)   바깥(확장·다른 기기)에서 파일을 바로 쓰고 읽기. 쓰면 version이 1 오름
//   files(): Meta[]                  지금 파일 목록
//   calls: string[]                  불린 함수 이름 기록
```
- `storage`가 있으면(`{ getItem, setItem, removeItem }`) 파일 전체를 `storage`의 `sgb-v2-fake-drive` 키에 JSON으로 저장한다(브라우저 개발용: app.js가 `localStorage`를 넘김). 없으면 메모리(node 테스트).
- 모든 쓰기는 `version`을 1 올리고 `modifiedTime = now()`. 지연 없음(테스트 결정성).
- 브라우저에서는 `?dev=1` + `localStorage['sgb-v2-dev-fake-drive'] === '1'`일 때만 app.js가 진짜 대신 이것을 주입하고, 머리에 '가짜 드라이브 모드' 배지를 띄운다. 가짜 드라이브는 구글로 아무것도 보내지 않는다.
- 주의: 크롬의 '사이트 데이터 지우기'는 같은 출처의 localStorage도 지우므로 가짜 드라이브도 사라진다. 그래서 8장 3번 검수는 개발용 [사본만 지우기](IndexedDB와 동기화 상태만 지우고 `sgb-v2-fake-drive`, `sgb-v2-dev-fake-drive`, API 키는 남김, 그 뒤 새로고침)로 '사이트 데이터 지우기'를 흉내 낸다.

## 14. 동기화 흐름 (`js/sync.js`) [A]
`js/sync.js`는 DOM, `window`, `document`, `indexedDB`, `localStorage`를 쓰지 않는다. 드라이브·저장소·시계·타이머를 주입받아 node에서 `import`하고 시험할 수 있어야 한다. 브라우저 이벤트(`visibilitychange`, `pagehide`, `online`, 5분 간격)는 app.js가 묶는다.

### 14-1. 주입
```js
export function createSync({
  drive,                 // DriveApi (13-2). 진짜 js/drive.js 또는 createFakeDrive()
  local,                 // LocalPort (아래). 브라우저는 store.syncLocal, 테스트는 메모리 구현
  now = () => new Date(),
  setTimer = setTimeout, clearTimer = clearTimeout,
  isOnline = () => true,
  uploadDelayMs = 3000,                              // 마지막 변경 3초 뒤 올림
  retryMs = [5000, 15000, 60000, 300000],            // 실패 뒤 다시 시도 간격 (마지막 값 반복)
  keepBackups = 7,
  choose = async (summary) => 'merge',               // 처음 연결 고르기: 'merge' | 'remote' | 'local' | null(취소 = 연결 안 함)
}): Sync

// LocalPort: 이 브라우저 사본. store.js가 store.syncLocal로 구현 [A]
// read(): Promise<SyncData>              화면 디바운스와 store.flush를 끝낸 뒤 지금 메모리 상태 (기기별 설정 포함 가능)
// apply(data: SyncData): Promise<void>   합친 결과 반영. **첫 await 전에 메모리를 동기적으로 바꾼다**(그 사이 사용자 입력이 끼지 않게).
//                                        그 다음 IndexedDB에 씀. syncPending은 건드리지 않음. 'all' 알림, 드라이브 올릴 변경으로 치지 않음
// readState(): Promise<SyncState & { pending: boolean }>
// writeState(patch): Promise<void>       meta.sync에 patch를 합쳐 씀
// setPending(bool): Promise<void>        meta.syncPending
// snapshot(id, data): Promise<void>      snapshots 저장소 (before-first-sync, before-restore)
// wipe(): Promise<void>                  IndexedDB 사본과 동기화 상태 지움 (연결 끊기의 '사본도 지우기')

// SyncState (meta.sync)
// { connected: false, fileId: null, stamp: null, lastSyncAt: null, lastBackupDay: null, secretsSeen: null }
//  stamp: 마지막으로 맞춘 드라이브 파일의 metaStamp. secretsSeen: 이 기기가 답한 secrets.updatedAt (18절)
```

### 14-2. Sync 객체
```js
start(): Promise<void>            // state 읽기. connected면 토큰(없으면 silent) -> pull. pending이면 이어서 올림. 토큰 실패면 status 'auth'
connect(): Promise<Result>        // requestToken({consent:true}) -> 처음 연결 처리(14-3) -> syncNow
disconnect({ wipeLocal = false }): Promise<void>   // revoke, connected false. wipeLocal이면 local.wipe() (+ 화면이 API 키도 지움)
notifyChange(): void              // store의 'local-change'마다 app.js가 부름: 세대 수 +1, uploadDelayMs 뒤 syncNow({reason:'auto'})
syncNow({ reason = 'auto' }): Promise<Result>   // reason: 'auto'|'button'|'hidden'|'start'|'poll'|'online'|'retry'. 이미 도는 중이면 그 promise
check(): Promise<boolean>         // 메타데이터만 보고 바뀌었으면 받아 합침 (탭이 다시 보일 때, 보이는 동안 5분마다)
flushNow(): Promise<Result|null>  // 기다리는 변경이 있으면 바로 syncNow({reason:'hidden'}) (visibilitychange hidden, pagehide)
listBackups(): Promise<Meta[]>
restoreBackup(id): Promise<Result>   // 현재 상태를 local.snapshot('before-restore') -> 백업 받기 -> prepareReplace(현재, 백업. secrets는 현재 것 유지) -> apply -> 올리기
deleteDriveData(): Promise<number>   // drive.deleteAppFiles() 후 자동으로 연결 끊기(사본은 남김). 그렇지 않으면 다음 저장 때 다시 생긴다
status                               // { state, lastSyncAt, message, errorKind, connected }
on(fn): () => void                   // fn(event). event.type: 'status' | 'merged' { changes, fromRemote } | 'restored' { students, records } | 'secrets-offer' { updatedAt } | 'saved' { at }
// Result = { ok: boolean, uploaded: boolean, unchanged: boolean, changes: Changes|null, error: DriveError|null }
// status.state: 'off'(연결 안 됨) | 'idle'(저장됨) | 'pending'(올릴 것 있음) | 'saving' | 'offline' | 'auth' | 'error'
```

### 14-3. 흐름
- **시작** (app.js): `store.init()`으로 IndexedDB 사본을 먼저 그림 -> `sync.start()`. connected면 조용히 토큰 -> 파일 받기 -> `mergeData(local, remote)` -> `local.apply` -> 화면 갱신. 사본이 비어 있었고(`!hasData(local)`) 드라이브에 데이터가 있으면 'restored' 이벤트 -> 토스트 '드라이브에서 학생 N명, 기록 N건을 불러왔습니다'.
- **syncNow 한 번**:
  1. 연결 안 됨 -> `{ ok:false }`, status 'off'. `isOnline()`이 false -> status 'offline', 다시 시도 예약.
  2. 토큰 없으면 `requestToken({silent:true})` (button이면 대화형 `requestToken()`). 실패 -> status 'auth'.
  3. `fileId`가 없으면 `findDataFile()`. `getMeta` -> stamp가 state.stamp와 다르면(또는 처음) `download` -> `checkDataFile`(newer면 멈춤) -> `mergeData(await local.read(), remote)` -> 결과가 local과 다르면 `local.apply`.
  4. 올릴 필요: pending이거나 합친 결과가 드라이브 것과 다를 때(`sameData`). 필요 없으면 `{ unchanged: true }` ('이미 저장되어 있습니다').
  5. **올리기 직전 `getMeta`를 다시 본다.** 3에서 본 것과 다르면 3으로 돌아간다(최대 3번, 넘으면 'conflict' 오류 후 다시 시도 예약). 다른 기기·확장이 그 사이 쓴 것(특히 `neis`)을 덮어쓰지 않기 위해서다.
  6. `upload(fileId, toDriveFile(merged))` -> state에 `fileId`, `stamp`, `lastSyncAt` 저장. 그동안 세대 수가 그대로면 `setPending(false)`, 바뀌었으면 uploadDelayMs 뒤 다시.
  7. 오늘(`dayStamp(now())`)이 `lastBackupDay`와 다르면 `writeBackup(오늘, withoutSecrets(file))` -> `listBackups()`에서 7개 넘는 오래된 것 `deleteFile` -> `lastBackupDay = 오늘`. 백업 실패는 저장 실패로 치지 않는다.
- **실패**: `network`·`busy`·`conflict` -> status 'offline'(network) 또는 'error', `retryMs` 간격을 늘려 가며 다시 시도. pending은 IndexedDB(`syncPending`)에 남아 새로고침 뒤 `start()`가 이어 올린다. `auth` -> status 'auth'(배너 [다시 연결]이 대화형 토큰). `forbidden`·`blocked`·`newer` -> status 'error', 자동 재시도 안 함.
- **처음 연결** (`connect()`, `state.lastSyncAt`이 null일 때): 드라이브 파일이 있고 `hasData(remote)`이고 `hasData(local)`이면 고르기 전에 양쪽 자동 백업(`local.snapshot('before-first-sync', toDriveFile(local))`, 오늘 드라이브 백업이 없으면 `writeBackup(오늘, withoutSecrets(remote))`) -> `choose({ local: summarize(local), remote: summarize(remote) })`:
  - 'merge' -> `mergeData`. 'remote' -> 드라이브 것으로 local을 바꿈(`apply(remote)`, 기기별 설정은 유지). 'local' -> `prepareReplace(remote, local)`을 올림. null -> 연결 취소(disconnect, 사본 그대로).
  - 한쪽만 데이터가 있으면 묻지 않고 합친다.
- **확인(check)**: `getMeta`만 보고 stamp가 같으면 끝. 다르면 받아 합치고 'merged' 이벤트(fromRemote: true). 받은 변경이 있으면 화면이 토스트 '드라이브에서 바뀐 내용 N건을 반영했습니다'.

### 14-4. 머리 줄 (app.js, index.html) [A]
- 상태 글 (`#sync-status`, `aria-live="polite"`): 'idle' '구글 드라이브에 저장됨 14:05' / 'pending'·'saving' '저장 중' / 'offline' '연결되면 올립니다' / 'off' '드라이브 연결 안 됨: 이 브라우저에만 저장'(경고색, 누르면 `#settings`의 드라이브 카드) / 'auth' '구글 연결 확인 필요' / 'error' '드라이브 저장 실패'.
- 버튼 (`#sync-save`, `btn btn-primary`, 44px 이상, 모든 화면): 연결됨이면 [구글 드라이브에 저장] -> `sync.syncNow({reason:'button'})`: 성공 토스트 '구글 드라이브에 저장했습니다 14:05', unchanged면 '이미 저장되어 있습니다', 실패면 이유 + 토스트 [다시 시도]. 올리는 중에는 `disabled` + '저장 중'. 연결 안 됨이면 [구글 드라이브 연결] -> `connect()` 뒤 바로 저장.
- 휴대폰 폭(기존 미디어 쿼리 기준)에서는 버튼을 단색 SVG 아이콘(`icon('drive')`, `index.html`에 symbol 추가) + `aria-label`만, 크기 44px 유지.
- 처음 실행 안내: 지금 앱에는 학교급 설정 단계가 따로 없다. 그래서 `store.init()`이 설정을 새로 만든 첫 실행이고 `localStorage['sgb-v2-drive-intro']`가 없으면 시작할 때 대화상자 '구글 드라이브에 연결 (추천)': 설명(사이트 데이터가 지워져도 드라이브에서 되살림, 다른 PC에서도 이어 씀) + [구글 드라이브에 연결] [나중에]. 어느 쪽이든 그 표시를 남긴다. [나중에]여도 연결 안 됨 배너는 계속 보인다.

### 14-5. 설정의 '구글 드라이브' 카드 (views/settings.js) [A]
연결 상태(계정 이메일은 받지 않으므로 '연결됨, 마지막 저장 14:05'), [연결] / [지금 동기화] / [연결 끊기], '공용 PC' 체크(설명: 토큰을 이 창에만 두고 키 드라이브 저장을 막음. 바꾸면 `drive.setTokenMode`), [드라이브의 생기부 데이터 지우기](확인 2번, `sync.deleteDriveData()`, 출결 앱 파일은 지우지 않는다고 안내). [연결 끊기]는 고르기 대화상자: '이 브라우저 사본도 지우기 (공용 PC 추천)'(사본과 API 키를 지움) / '사본은 남기기' / 취소. 오류 상태면 13-1의 문구.

## 15. store.js·db.js 바뀌는 점 [A]
- `db.js`: `DB_VERSION` 1 그대로. `loadAll()`이 `{ students, classes, records, settings, styles, deleted, secrets, syncState, syncPending, snapshots: {id: snap}, snapshot(=before-import), newer }`를 돌려줌. `writeChanges({ put, del, settings, styles, meta })` — `meta`는 `{ key: value }`를 meta 저장소에 같은 트랜잭션으로 씀(삭제 기록, syncPending). `replaceAllData({ students, classes, records, settings, styles, deleted, secrets })`. `putSnapshot(snap)`은 같은 id만 바꿈, `deleteSnapshot(id)`.
- `store.state`에 `styles`, `deleted`(Tombstone[]), `secrets` 추가. `state.sync`는 두지 않는다(상태는 sync 객체가 가짐).
- 사용자 변경(`markDirty`, `markDeleted`, `updateSettings`(기기별 아님), `setStyles`, `setSecrets`, `putRecords`, `replaceAll`) 뒤에는 `emit('local-change')`. app.js가 이것을 `sync.notifyChange()`로 잇는다. `flush`는 사용자 변경을 쓸 때 같은 트랜잭션에 `meta.syncPending = true`. `syncLocal.apply`는 `'local-change'`를 내지 않는다.
- 새 공용 함수:
```js
export function getStyles(): Styles
export function setStyles(next: Styles): void              // 통째로 바꿈(B가 core/style.js의 순수 함수로 만든 결과를 넣음). emit('styles'), 'local-change'
export function getSecrets(): Secrets | null
export function setSecrets(next: Secrets | null): void     // 공용 PC면 IndexedDB에 쓰지 않고 메모리에만
export function getSyncData(): SyncData                    // snapshotData + styles, deleted, secrets
export const syncLocal: LocalPort                          // 14-1
export async function replaceAll(data): Promise<void>      // 이제 prepareReplace(getSyncData(), data)를 거친 뒤 저장, 'local-change'
export async function wipeLocalCopy(): Promise<void>       // IndexedDB 사본만 지움 (개발용 [사본만 지우기], 연결 끊기의 사본 지우기)
export function styleExamplesFor(record): string[]         // 그 기록 영역 키(16-1)와 'common'의 예시 글. checkOf가 씀
```
- `checkOf(record, text)`는 `checkRecord`에 `styleExamples: styleExamplesFor(record)`를 함께 넘긴다 (B가 check.js에서 씀).
- `snapshotData()`는 지금처럼 백업용(styles 포함으로 바뀜, deleted·secrets 없음).
- 알림 kind 추가: `'styles'`, `'local-change'`, `'secrets'`. 기존 화면의 `update(kind)`는 모르는 kind를 무시해야 한다.

## 16. 내 스타일 (`js/core/style.js`, `js/views/style.js`) [B]
### 16-1. 데이터 (드라이브 파일과 백업에 포함)
```js
Styles = {
  updatedAt: ISO | null,
  areas: {
    // 키: 'common' | 'autonomy' | 'career' | 'behavior' | 'club' | 'subject:<과목명>'
    autonomy: { examples: [{ id: 'e_<랜덤>', text, addedAt: ISO }], rules: '', aiRules: '', updatedAt: ISO }
  }
}
```
- `rules`, `aiRules`는 줄바꿈으로 나눈 규칙 글. 영역마다 예시 최대 5개(`MAX_EXAMPLES = 5`), 예시 하나는 그 영역 바이트 한도 이하(`common`은 영역 한도 중 가장 큰 값, 교과는 `subject` 한도).
- 영역을 고칠 때마다 그 영역 `updatedAt`과 `styles.updatedAt`을 지금으로 (합치기가 영역별로 하므로 반드시).

### 16-2. `js/core/style.js` (순수, 테스트 대상)
```js
export const MAX_EXAMPLES = 5;
export const OVERLAP_MIN_WORDS = 6;
export function styleKey(area, subject = null): string         // area==='subject' ? `subject:${subject || ''}` : area
export function maskExample(text, names: string[]): { text, replaced: [{ from, index }] }
//  names: 명단의 이름들(전체 이름). 안에서 prompt.js의 nameVariants로 성 뺀 이름도 가림. 5자리 학번, 'n학년 n반 n번'(학년 없이 'n반 n번' 포함)을 'OO'으로.
//  index는 원래 글에서의 위치. 긴 것부터 바꿈
export function addExample(styles, key, text, now = new Date()): { styles, error: null | string }   // 5개 넘으면 error
export function removeExample(styles, key, exampleId, now = new Date()): Styles
export function setAreaRules(styles, key, { rules, aiRules }, now = new Date()): Styles   // 준 것만 바꿈
export function buildStyleSummaryPrompt(examples: string[]): { system, user }
//  예시는 '<문체 예시>' ... '</문체 예시>' 안에. 응답 JSON {"rules": ["...", ...]} (5~8개, 짧게): 문장 길이, 종결 어미, 구성 순서, 자주 쓰는 표현 유형.
//  예시 속 활동·사실·고유 표현은 규칙에 넣지 말 것을 적는다. 사용자 글에 STYLE_SUMMARY_MARK = '[문체 정리 요청]'
export function parseStyleRules(rawText): string[]              // 실패 시 AiError('parse')
export function pickExamples(styles, area, subject = null): null | { rules: string[], examples: string[], summary: string }
//  rules: common.rules, common.aiRules, 영역.rules, 영역.aiRules 순서로 줄을 모아 빈 줄·중복 뺌 (최대 12줄)
//  examples: 영역 예시(없으면 common) 중 짧은 것 1~2개. 자료가 하나도 없으면 null
//  summary: 화면 한 줄 요약 (예: '규칙 4개, 예시 2개: 한 문장은 짧게 ...' 60자 안)
export function styleOverlap(draft, examples: string[]): [{ text, exampleIndex, index }]
//  어절(공백 단위) 6개 이상 연속으로 같은 부분. index는 draft에서의 위치. 겹치는 구간은 가장 긴 것 하나로
```

### 16-3. AI에 적용 (prompt.js, gemini.js, fake-ai.js, check.js) [B]
```js
// prompt.js
buildPrompt({ ...지금 인자, style = null })     // style = pickExamples 결과(가린 뒤). null이면 지금과 똑같은 글(기존 테스트 유지)
//  system: 지금 원칙 1~8 뒤에 '9. 아래 [문체 규칙]과 <문체 예시>는 문장 모양에만 적용함. 원칙 1~8과 부딪치면 원칙을 따름.' (style이 있을 때만)
//  user: [분량] 앞에 '[문체 규칙]' 줄들, '<문체 예시>...</문체 예시>'와 '문체만 참고하고 예시의 활동·사실·고유 표현은 쓰지 말 것.'
//  문체 블록은 언제나 [교사 메모] 앞. 예시·규칙 안의 '<메모>' '</메모>' 표시는 지움(extractMemo가 깨지지 않게)
//  테스트: system+user에서 '메모에 적힌 사실만'의 위치가 문체 관련 글보다 앞
// gemini.js
generateDrafts({ ...지금 인자, style = null })  // 보내기 직전 style.examples·rules를 maskExample(명단 이름)로 한 번 더 가림. 마지막 containsIdentity 검사는 그대로
summarizeStyle({ examples, roster, settings, apiKey, fake, signal, fetchImpl }): Promise<{ rules: string[], model }>   // maskExample -> buildStyleSummaryPrompt -> 호출 -> parseStyleRules
// fake-ai.js
fakeGenerate가 user에 STYLE_SUMMARY_MARK가 있으면 정해진 규칙 JSON, REFINE_MARK(17절)가 있으면 다듬은 글 JSON을 돌려줌. 둘 다 아니면 지금 그대로
// check.js
checkRecord(text, { ...지금, styleExamples = [] })  // 결과에 styleOverlap: [...] 추가. 하나라도 있으면 issueCount + 1. 문구 '스타일 예시와 같은 문장이 있습니다'. 저장은 막지 않음
```
- 일괄 초안도 그 기록 영역의 `pickExamples`를 쓴다 (일괄 대화상자에 같은 '내 스타일 적용' 체크, 기본 켬).
- AI로 보내는 것: 가린 예시, 규칙. 이름·학번·키는 보내지 않는다.

### 16-4. 화면 `#style` (views/style.js, 주 메뉴 '내 스타일', 작성 다음) [B]
- 영역 탭(role=tablist): 공통, 자율·자치, 진로, 행동특성, 동아리, 교과세특(과목별: 교과반들의 과목명으로 탭. 과목이 없으면 안내).
- 예시 목록: 글, 바이트, [삭제]. 추가: 붙여넣기 칸, `.txt` 파일(`ui.readFileText`), `.xlsx`/`.csv`(`xlsx-io.readSheetFile` -> 열 고르기 -> 칸마다 예시 후보). 5개·바이트 한도 넘으면 막고 이유 표시.
- 넣기 전 `maskExample(text, 명단 이름)` 결과를 보여 줌: 바꾼 개수와 위치(바뀐 말 목록) -> 선생님이 [이대로 저장] / [취소]. 화면 안내 '다른 학생 이름이나 알아볼 수 있는 내용은 지우고 넣으세요'.
- '스타일 규칙' textarea (0.6초 디바운스 저장).
- [AI로 스타일 정리]: 예시가 있어야 켜짐 -> `summarizeStyle` -> 결과를 고칠 수 있는 textarea -> [이 규칙 쓰기]면 `aiRules`에 저장. 가짜 AI 모드 따름.
- 저장은 `store.setStyles(core 함수 결과)`.

### 16-5. 작성 패널 (views/write.js) [B]
- '내 스타일 적용' 스위치: 그 영역(+common)에 `pickExamples`가 null이 아닐 때만 보임, 기본 켬. 상태는 화면 메모리(영역별), 저장 안 함.
- 적용 중인 규칙 한 줄 요약(`summary`) + [내 스타일 고치기] 링크 `#style?area=<styleKey>`.

## 17. 초안 그 자리에서 고치기 (`js/core/candidates.js`, views/write.js) [B]
```js
// candidates.js (순수)
export function editCandidate(c, text): Candidate          // text 바꾸고 edited 다시 계산 (versions는 그대로)
export function pushVersion(c, nextText): Candidate        // 지금 text를 versions 끝에 넣고(최대 3, 오래된 것 버림) text = nextText
export function undoVersion(c): Candidate                  // versions 마지막을 text로 꺼냄. 없으면 그대로
export function resetCandidate(c): Candidate               // pushVersion(c, c.original)
// prompt.js
export const REFINE_MARK = '[다듬기 요청]';
export function buildRefinePrompt({ area, subject, text, request, memo, style = null, limit }): { system, user }
//  원칙 1(메모에 없는 사실 더하지 않음)과 기존 원칙 유지. user: [작성할 영역], 문체 블록(있으면), '[지금 글]' + 글, REFINE_MARK + 요청, [교사 메모] <메모>..</메모>.
//  응답은 지금과 같은 JSON {"drafts": ["..."]} 1개
// gemini.js
export async function refineDraft({ record, text, request, studentName, roster, settings, apiKey, style = null, fake, signal, fetchImpl, timeoutMs, fakeDelayMs }): Promise<{ text, model }>
//  text·request·memo 모두 scrubMemo, style은 maskExample. containsIdentity 검사. 결과는 tidyDraft
```
- 후보 카드: `<textarea>`(라벨 '후보 n'), 입력하면 바이트 즉시 다시 계산(한도 넘으면 경고색, 바이트 표시 `aria-live="polite"`), 0.6초 디바운스로 `updateRecord(id, { candidates })`. `edited`면 '고침' 배지.
- 카드 버튼: [초안 칸에 저장] [최종본 끝에 붙이기](done이면 막음, 지금처럼) [처음 상태로] [이전 판](versions 없으면 disabled).
- 다듬기: 카드 아래 한 줄 입력칸 + 칩 [더 짧게] [더 자세히] [문장 나누기] [평가어 줄이기](칩을 누르면 그 말로 바로 요청) + [AI에게 다듬기 요청]. 결과는 `pushVersion`으로 같은 카드 새 판.
- 새로 [초안 만들기]를 하면 후보 전체를 `drafts.map(newCandidate)`로 바꾼다 (지금처럼).

## 18. API 키 드라이브 저장 (선택 기능, 지시서 5장) [A]
- `Secrets = { geminiKey: string, updatedAt: ISO }`. 드라이브 파일 `secrets`에만 (settings와 분리). 이 브라우저의 사본은 `meta.secrets`(공용 PC면 메모리에만).
- 설정의 API 키 칸 아래 체크 '구글 드라이브에도 저장 (다른 PC에서 다시 입력하지 않아도 됨)'. 기본 끔. 켜짐 표시 = `secrets?.geminiKey`가 비어 있지 않음. 드라이브 연결 안 됨 또는 공용 PC면 비활성 + 이유 표시.
- 켤 때 확인 대화상자(무료 키만, 키 제한: API 제한 'Generative Language API'만 + 웹사이트 제한 `https://176-oss.github.io/*`, 공용 PC에서는 권하지 않음, 의심되면 AI Studio에서 삭제 후 재발급) [켜기] [취소] -> `store.setSecrets({ geminiKey: 지금 키, updatedAt: now })` (local-change로 동기화가 올림).
- 켜진 채로 키를 바꾸면 같은 방식으로 갱신. 끄면 `store.setSecrets({ geminiKey: '', updatedAt: now })` (빈 키 = 끈 기록, 합치기에서 이김). [키 지우기]는 이 브라우저 키를 지우고, 켜져 있었으면 같은 방법으로 드라이브 것도 비운다.
- 다른 PC: 합친 뒤 `secrets.geminiKey`가 있고 이 브라우저 키와 다르고 `state.secretsSeen !== secrets.updatedAt`이면 'secrets-offer' -> 대화상자 '드라이브에 저장된 API 키를 쓸까요?' [쓰기](`store.setApiKey(키, settings.keyStorage)`) [이 PC에서는 쓰지 않기]. 어느 쪽이든 `secretsSeen = secrets.updatedAt`. 쓰지 않아도 드라이브의 secrets는 그대로 둔다.
- 키는 `x-goog-api-key` 헤더로만 (지금 그대로). 백업(`makeBackup`), 엑셀(`excelRows`), 자동 백업(`withoutSecrets`), 콘솔, 오류 문구에 넣지 않는다.
- README에 키 제한 설정 방법을 단계로 (그림 없이).

## 19. 확장프로그램이 드라이브 파일에 쓸 수 있는 범위 (지시서 1-7, 6장. 이번 작업 범위 아님, 확장 개발 때 따름)
- 확장은 같은 Google Cloud 프로젝트의 OAuth 클라이언트로 `drive.appdata` 권한을 받아야 같은 appDataFolder의 `sgb-data.json`을 본다.
- 읽기: `status === 'done'`이고 `final`이 있는 기록만 입력 대상으로 쓴다. `schemaVersion`이 확장이 아는 것(2)보다 크면 아무것도 쓰지 않는다.
- 쓰기: 입력과 NEIS 저장이 끝난 기록의 `neis = { hash: textHash(final), doneAt: ISO }`만 쓴다. 다른 필드는 쓰지 않는다 (기록의 `updatedAt`, 파일의 `updatedAt` 포함. 다른 필드는 받은 그대로 둔다).
- 순서: 받기 -> 해당 기록의 `neis`만 바꾸기 -> 올리기 직전 `getMeta`로 version 확인 -> 받은 뒤 바뀌었으면 다시 받아 처음부터(최대 3번) -> 올리기.
- 입력 직전에 파일을 다시 받아 `final`의 hash가 바뀐 학생은 입력하지 않는다.
- `secrets`는 읽거나 쓰거나 저장·기록하지 않는다 (파일을 다시 올릴 때 받은 값 그대로 둘 뿐). `sgb-backup-*`와 출결 앱 파일(`attendance-data.json`)은 읽지도 쓰지도 않는다.

## 20. 담당 분담 (A: 1·4·5장, B: 2·3장)
작업 순서: A(12~15절, 18절) -> B(16~17절). B는 A가 만든 `model.js`(newCandidate, migrate)와 `store.setStyles`·`styleExamplesFor`를 쓴다.

| 파일 | 담당 | 경계 |
|---|---|---|
| `config.js`, `js/drive.js`, `js/sync.js`, `js/core/drive-common.js`, `js/core/fake-drive.js`, `js/core/sync-merge.js` | A | 새 파일 |
| `js/db.js`, `js/store.js` | A | B는 고치지 않는다. 스타일은 `setStyles`/`getStyles`, 후보는 `updateRecord`로만 |
| `js/core/model.js`, `js/core/backup-format.js` | A | 스키마 2, migrate, newCandidate/normalizeCandidates, defaultStyles, DEVICE_SETTING_KEYS, excelRows |
| `js/app.js` | A | B는 `ROUTES`에 `{ name: 'style', label: '내 스타일', icon: 'brush', view: styleView }` 한 줄(작성 다음)과 import 한 줄만 |
| `index.html` | A | 머리 줄 `#sync-status`·`#sync-save`, `i-drive` symbol. B는 `i-brush` symbol 한 줄만 |
| `js/views/settings.js`, `js/views/backup.js`, `js/views/neis.js` | A | |
| `js/ext-bridge.js` | A | 바꿀 것 없음 (예비 경로 유지) |
| `js/core/style.js`, `js/core/candidates.js`, `js/views/style.js` | B | 새 파일 |
| `js/core/prompt.js`, `js/core/gemini.js`, `js/core/fake-ai.js`, `js/core/check.js` | B | 기존 서명은 유지하고 인자만 더함 |
| `js/views/write.js` | B | A는 고치지 않는다 |
| `js/xlsx-io.js` | B | 필요하면 함수 추가만 |
| `js/ui.js` | A 먼저 | 둘 다 새 함수를 파일 끝에 더하기만 (기존 함수 서명 변경 금지) |
| `css/app.css` | 둘 다 | A는 `/* 동기화 */`, B는 `/* 내 스타일, 후보 */` 주석 아래 블록을 파일 끝에. `components.css`·`tokens.css`는 고치지 않는다 |
| `README.md` | A | B는 '내 스타일' 절 하나만 추가 |
| 테스트 | A: `sync-merge.test.mjs`, `sync.test.mjs`, `secrets.test.mjs`(백업·엑셀·자동 백업에 키 없음, 끄면 secrets 비움), `model.test.mjs`·`backup-format.test.mjs` 고침 / B: `style.test.mjs`, `candidates.test.mjs`, `privacy.test.mjs`(초안·일괄·다듬기·스타일 정리 요청 본문에 이름·학번·키 없음: `fetchImpl`로 본문을 잡아 검사), `prompt.test.mjs` 추가 | |

## 21. 테스트 (지시서 7장, node, 실제 구글·Gemini 호출 없음)
- `sync.test.mjs`는 `createFakeDrive()`(메모리)와 테스트 안의 메모리 LocalPort로 `createSync`를 돌린다. 타이머는 `setTimer`/`clearTimer`를 주입하거나 `syncNow`를 직접 부른다. '새로고침 뒤'는 같은 LocalPort·같은 가짜 드라이브로 `createSync`를 새로 만들어 `start()`. '확장이 그 사이 씀'은 `afterDownload`로 `writeRaw`. 자동 백업 7개는 `now`를 하루씩 늘려 9번 저장 뒤 `listBackups().length === 7`. [구글 드라이브에 저장]은 `notifyChange()` 직후 `syncNow({reason:'button'})`이 타이머를 기다리지 않고 올림.
- 기존 테스트는 모두 통과해야 한다. `SCHEMA_VERSION`이 2가 되므로 그에 맞춰 바뀌는 단언만 고친다.

## 22. 이번 개정에서 정한 것 (지시서와 기존 계약·코드가 다르거나 빈 곳)
1. IndexedDB DB 버전은 1 그대로. 새 저장소 없이 `meta`(deleted, sync, syncPending, secrets)·`settings`(styles)·`snapshots`(id 여러 개)에 키를 더한다.
2. 기존 계약 '키는 IndexedDB에 넣지 않는다'의 예외: 드라이브 저장을 켰을 때만 `meta.secrets`에 둔다(드라이브 파일과 같은 값, 공용 PC면 안 둠). 오프라인 중 끈 기록이 새로고침에 사라지지 않게 하기 위해서다.
3. 끈 secrets는 `null`이 아니라 `{ geminiKey: '', updatedAt }` (다른 기기의 옛 키가 합치기에서 되살아나지 않게). `null`은 한 번도 안 씀.
4. 가짜 드라이브 켜기 표시는 settings가 아니라 `localStorage['sgb-v2-dev-fake-drive']` (사본을 지워도 남아야 하므로). 8장 3번 검수는 [사본만 지우기]로 한다.
5. 처음 실행 '학교급 설정 다음 단계'는 지금 앱에 그런 단계가 없어 첫 실행 대화상자로 대신한다 (14-4).
6. 처음 연결 '양쪽 자동 백업': 이 브라우저 것은 `snapshots['before-first-sync']`, 드라이브 것은 그날 드라이브 자동 백업 파일.
7. 백업 가져오기·되돌리기와 드라이브 백업 되돌리기는 `prepareReplace`로 `updatedAt`을 올려 드라이브에서도 이기게 한다. `mergeBackup` 자체 규칙은 그대로.
8. [드라이브의 생기부 데이터 지우기] 뒤에는 자동으로 연결을 끊는다 (그대로 두면 다음 저장 때 파일이 다시 생김). `sgb-` 파일만 지움.
9. [연결 끊기]의 '사본도 지우기'는 API 키도 지운다.
10. `styleOverlap`은 `checkRecord.issueCount`에 1로 센다 (경고일 뿐 저장은 막지 않음).
11. 다듬기 결과·[처음 상태로]는 모두 판(versions)을 남겨 [이전 판]으로 되돌릴 수 있다.
12. 확장은 파일을 다시 올리므로 `secrets`를 내려받기는 한다. '읽지 않는다'는 값을 쓰거나 저장·기록하지 않는다는 뜻으로 적었다 (19절).
13. 계정 이메일은 받지 않는다 (범위가 drive.appdata 하나라서). 연결 상태는 '연결됨'과 마지막 저장 시각만 보인다.

## 23. A 구현하며 바뀐 점 (12~15절, 18절 보충)
- `sync.answerSecrets(updatedAt)` 추가: 'secrets-offer'에 답한 뒤 `secretsSeen`을 저장 (화면은 LocalPort를 직접 만지지 않음). 'secrets-offer' 이벤트에 `geminiKey`도 담는다 (화면이 이 브라우저 키와 같은지 보고, 같으면 묻지 않고 답함). 공용 PC면 화면이 묻지 않는다.
- 'merged' 이벤트에 `reason`(syncNow의 reason). 화면은 'start'·'button'일 때는 토스트를 띄우지 않는다. `connect()`가 고르기에서 취소되면 Result에 `cancelled: true`.
- `sync.listBackups()`는 조용한 토큰만 쓴다 (백업 화면을 열 때 팝업이 뜨지 않게). 되돌리기·지우기는 대화형.
- `store.getRecord`가 메모리에 새로 만드는 빈 기록은 `updatedAt: null`. `getSyncData()`는 `updatedAt`이 null인 기록을 빼고, 합치기에서는 언제나 진다 (화면을 열기만 한 기기가 빈 기록으로 다른 기기의 글을 덮지 않게).
- `store.firstRun`(설정을 새로 만든 첫 실행), `store.setBeforeSyncRead(fn)`(app.js가 지금 화면의 `flush`를 넣음, `syncLocal.read`가 먼저 부름) 추가.
- `db.replaceAllData`에 `meta` 인자(같은 트랜잭션에 meta 저장소 키), `db.deleteSnapshot`, `db.clearAllStores()`(사본 비우기, 스키마 버전은 다시 씀) 추가.
- `drive-common.js`에 `kindFromStatus(status, body)`와 `DRIVE_MESSAGES.notfound` 추가.
- `prepareReplace`: current의 삭제 기록을 잃지 않는다. next에 없는 스타일 영역은 빈 영역(`updatedAt = now`)으로 둔다 (지운 영역이 합치기로 되살아나지 않게).
- `toDriveFile`·`sameData`의 settings에서는 기기별 값과 함께, 혹시 섞여 들어온 키 칸(`apiKey`, `geminiKey`, `geminiApiKey`, `secrets`)도 뺀다. 키는 `secrets`에만.
- 백업(`makeBackup`·`validateBackup`·`mergeBackup`)은 2절대로 DEVICE_SETTING_KEYS를 모두 빼고, 가져올 때는 현재 값을 쓴다.
- 머리 줄 [구글 드라이브에 저장]은 머리 줄 배경이 주 색이라 `btn btn-primary`에 `.appbar .sync-save`(밝은 바탕) 덧칠을 둔다.
- 화면 ctx(app.js가 views에 넘김)에 `sync()`, `syncConnected()`, `saveToDrive()`, `connectDrive()`, `drive`, `fakeDrive`, `hhmm(iso)` 추가. 화면의 `update(kind, detail)`에 `'sync'`(detail = sync.status)가 온다.
- 주의(B): 동기화가 다른 기기 변경을 반영하면 `'all'`이 온다. 지금 write.js는 `'all'`에 `renderAll()`을 하므로, 입력 중이면 패널을 다시 그리지 않게 하는 것을 B가 검토.

## 24. B 구현하며 바뀐 점 (16~17절 보충)
- `scrubMemo`가 'n학년 n반 n번'(학년 없이 'n반 n번' 포함)도 '학생'으로 바꾼다 (5절 보충). 메모·다듬기 글·요청에 반 번호가 있으면 학생을 알아볼 수 있어서다. privacy 테스트가 이것을 잡았다.
- `style.js` 추가 내보내기: `exampleLimit(key, limits)`(16-1의 예시 바이트 한도), `stripMarks`, `STYLE_SUMMARY_MARK`, `EXAMPLE_OPEN`('<문체 예시>'), `EXAMPLE_CLOSE`, `MASK`('OO'). `addExample(styles, key, text, now, limit = Infinity)`: 다섯째 인자로 바이트 한도(넘으면 error).
- `pickExamples(styles, 'common')`은 공통 규칙과 공통 예시만 쓴다. 규칙 줄 앞의 '- ', '1. ' 같은 글머리는 지운다.
- `styleOverlap`은 어절 비교 때 끝의 문장부호(. , ! ? 따옴표 괄호 가운뎃점)를 빼고 비교한다.
- `prompt.js` 추가 내보내기: `REFINE_MARK`, `CURRENT_HEAD`('[지금 글]'), `STYLE_RULES_HEAD`('[문체 규칙]'), `STYLE_ONLY_TEXT`(문체만 참고 문구), `extractRefine(user)`(가짜 AI용, 다듬기 프롬프트가 아니면 null). `buildRefinePrompt` user에 '[초안 개수] 1개'를 함께 넣는다.
- `check.js` 추가 내보내기: `STYLE_OVERLAP_TEXT` (화면 문구).
- `candidates.js`: `pushVersion`은 새 글이 지금 글과 같으면 받은 객체를 그대로 돌려주고(판을 만들지 않음), `resetCandidate`도 이미 원문이면 그대로. 화면은 이것으로 '바뀐 것이 없음'을 안내한다.
- 가짜 AI: 스타일 정리는 예시의 평균 문장 길이로 규칙 5개, 다듬기는 요청 말('짧게', '자세히', '나누', '평가어', 그 밖)에 따라 정해진 방식으로 바꾼다. 결과가 같으면 정해진 마무리 문장 하나를 붙인다.
- 작성 화면: 동기화 반영('all')과 classes·students·settings·styles 알림이 입력 중(포커스가 textarea 또는 글 input)이거나 저장 대기 입력이 있을 때 오면 다시 그리기를 미루고, 칸을 벗어날 때(focusout) 그린다. 내 스타일 화면도 같은 방식.
- 내 스타일 화면의 [지우기]·[AI 규칙 지우기] 되돌리기는 이전 상태로 되돌리되 그 영역 `updatedAt`을 지금으로 한다 (동기화에서 지운 쪽에 지지 않게).
- 일괄 초안 대화상자의 '내 스타일 적용' 체크는 작성 패널 스위치 상태를 기본값으로 가져온다 (영역별 화면 메모리).
