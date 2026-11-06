// 상수, 영역, 기본 설정, 레코드 키, 상태 계산, 스키마 버전, 마이그레이션.
// 순수 모듈.

import { DEFAULT_FORBIDDEN } from './forbidden.js';

export const SCHEMA_VERSION = 1;

export const AREAS = ['autonomy', 'career', 'behavior', 'club', 'subject'];

export const AREA_LABELS = {
  autonomy: '자율·자치',
  career: '진로',
  behavior: '행동특성',
  club: '동아리',
  subject: '교과세특',
};

export const AREAS_BY_KIND = {
  homeroom: ['autonomy', 'career', 'behavior', 'club'],
  subject: ['subject'],
  club: ['club'],
};

export const KIND_LABELS = { homeroom: '담임', subject: '교과', club: '동아리' };

export const STATUS_LABELS = { empty: '미작성', memo: '메모', draft: '초안', done: '완료' };

export const LENGTHS = { concise: 0.5, standard: 0.7, full: 0.95 };

export const LENGTH_LABELS = { concise: '간결', standard: '표준', full: '충실' };

// 드러낼 모습 칩. 이 도구를 위해 새로 지은 목록.
export const TRAITS_BY_AREA = {
  autonomy: ['책임감', '협력', '배려', '공동체 의식', '리더십', '적극적 참여', '문제 해결', '소통', '규칙 준수', '성실함'],
  career: ['자기 이해', '진로 탐색', '호기심', '계획 세우기', '정보 활용', '실천력', '성찰', '주도성', '꾸준함'],
  behavior: ['성실함', '배려', '책임감', '정직', '자기 관리', '원만한 교우 관계', '긍정적 태도', '성장', '나눔', '예의 바름'],
  club: ['협력', '전문성 탐구', '창의성', '맡은 역할 수행', '꾸준함', '공동체 기여', '소통', '문제 해결'],
  subject: ['개념 이해', '탐구력', '비판적 사고', '표현력', '협업', '자기주도 학습', '적용력', '질문하는 태도', '성찰', '끈기'],
};

const LIMITS = { autonomy: 1500, career: 1500, behavior: 900, club: 1500, subject: 1500 };

// 학교급별 기본 한도 (2026 기재요령 원문으로 다시 확인 필요)
export const DEFAULT_LIMITS = {
  high: { ...LIMITS },
  middle: { ...LIMITS },
};

export const DEFAULT_MODELS = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

function currentSchoolTerm(now) {
  const month = now.getMonth() + 1; // 1~12
  const year = now.getFullYear();
  // 1~2월은 앞 학년도 2학기, 3~7월은 1학기, 8~12월은 2학기
  if (month <= 2) return { schoolYear: year - 1, semester: 2 };
  if (month <= 7) return { schoolYear: year, semester: 1 };
  return { schoolYear: year, semester: 2 };
}

export function copyForbidden(entries = DEFAULT_FORBIDDEN) {
  return entries.map((x) => ({ ...x, areas: Array.isArray(x.areas) ? [...x.areas] : [] }));
}

export function defaultSettings(now = new Date()) {
  const { schoolYear, semester } = currentSchoolTerm(now);
  return {
    schoolLevel: 'high',
    schoolYear,
    semester,
    limits: { ...DEFAULT_LIMITS.high },
    forbidden: copyForbidden(),
    models: [...DEFAULT_MODELS],
    batchIntervalSec: 5,
    keyStorage: 'local',
    devFakeAI: false,
  };
}

export function recordKey(studentId, area, subject = null) {
  if (area === 'subject' && subject) return `${studentId}|subject|${subject}`;
  return `${studentId}|${area}`;
}

export function newRecord(studentId, area, subject = null) {
  const subj = area === 'subject' ? (subject || null) : null;
  return {
    id: recordKey(studentId, area, subj),
    studentId: String(studentId),
    area,
    subject: subj,
    memo: '',
    traits: [],
    length: 'standard',
    achievement: '',
    candidates: [],
    draft: '',
    final: '',
    status: 'empty',
    neis: null,
    updatedAt: new Date().toISOString(),
  };
}

function filled(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** done은 선생님만 정한다. 그 밖에는 내용으로 계산 */
export function deriveStatus(record) {
  if (!record) return 'empty';
  if (record.status === 'done') return 'done';
  if (filled(record.final) || filled(record.draft)) return 'draft';
  if (filled(record.memo)) return 'memo';
  return 'empty';
}

/** '30503' 은 { grade: 3, classNo: 5, no: 3 } */
export function splitStudentId(id) {
  const s = String(id ?? '').trim();
  return {
    grade: Number(s.slice(0, 1)),
    classNo: Number(s.slice(1, 3)),
    no: Number(s.slice(3, 5)),
  };
}

// MIGRATIONS[n]: 버전 n-1 데이터를 버전 n 으로 바꾸는 함수. 지금은 1뿐이라 비어 있다.
export const MIGRATIONS = {
  // 2: (data) => ({ ...data, schemaVersion: 2 }),
};

export function migrate(data, fromVersion) {
  let out = data;
  let v = Number(fromVersion) || 1;
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v + 1];
    if (typeof step === 'function') out = step(out);
    v += 1;
  }
  if (out && typeof out === 'object' && 'schemaVersion' in out) out = { ...out, schemaVersion: SCHEMA_VERSION };
  return out;
}
