// 항목 목록, 한도, 시트 이름 인식. 순수 모듈 (DOM 없음).
// 한도는 NEIS '글자' 기준. 바이트 한도 = 글자 x 3 (중 162, 고 208: 한글 1자 3Byte).

/** id는 작성 도우미(textgenerator-v2)와 같은 이름을 쓴다: autonomy, club, career, subject, behavior */
export const AREAS = [
  { id: 'autonomy', label: '자율·자치활동', chars: { mid: 500, high: 500 } },
  { id: 'club', label: '동아리활동', chars: { mid: 500, high: 500 } },
  { id: 'career', label: '진로활동', chars: { mid: 500, high: 500 } },
  { id: 'subject', label: '과목별 세부능력 및 특기사항', chars: { mid: 500, high: 500 }, hasSubject: true },
  { id: 'individual', label: '개인별 세부능력 및 특기사항', chars: { mid: 500, high: 500 } },
  { id: 'behavior', label: '행동특성 및 종합의견', chars: { mid: 300, high: 300 } },
  { id: 'free-career', label: '자유학기 진로탐색활동', chars: { mid: 1000 } },
  { id: 'free-topic', label: '자유학기 주제선택활동', chars: { mid: 1000 } },
  { id: 'free-art', label: '자유학기 예술·체육활동', chars: { mid: 1000 } },
  { id: 'free-club', label: '자유학기 동아리활동', chars: { mid: 1000 } },
  { id: 'daily', label: '일상생활 활동상황', chars: { mid: 1000, high: 1000 } },
];

export const LIMIT_BASIS = { mid: '중 162', high: '고 208' };

export function areaById(id) {
  return AREAS.find((a) => a.id === id) || null;
}

/** 학교급에서 쓸 수 있는 항목 */
export function areasFor(school) {
  return AREAS.filter((a) => a.chars[school]);
}

/** 바이트 한도. overrides: { [areaId]: 글자 수 } (설정에서 바꾼 값) */
export function byteLimit(areaId, school, overrides = {}) {
  const o = Number(overrides?.[areaId]);
  if (Number.isFinite(o) && o > 0) return Math.round(o) * 3;
  const a = areaById(areaId);
  return a?.chars[school] ? a.chars[school] * 3 : 0;
}

// 2022 개정 1~2학년 공통과목: 1·2 합산 500자 (고 208)
export const COMMON_SUBJECTS = ['공통국어', '공통수학', '공통영어', '통합사회', '통합과학', '한국사', '과학탐구실험'];

/** '공통국어1', '공통국어 2', '공통국어Ⅰ' -> '공통국어'. 공통과목이 아니면 null */
export function commonSubjectBase(subject) {
  const s = String(subject || '').replace(/\s+/g, '');
  const m = s.match(/^(.+?)(1|2|Ⅰ|Ⅱ|I{1,2})$/);
  if (!m || !COMMON_SUBJECTS.includes(m[1])) return null;
  return m[1];
}

// 고 118: 수업 중 연구보고서(소논문) 작성이 가능한 과목
export const THESIS_SUBJECTS = ['수학과제탐구', '사회문제탐구', '융합과학탐구', '과학과제연구', '사회과제연구', '윤리문제탐구'];

/** 시트 이름 -> { area, subject } 또는 null */
export function areaFromSheetName(name) {
  const raw = String(name || '').trim();
  const s = raw.replace(/[\s·ㆍ･_\-()]/g, '');
  if (!s) return null;
  const sub = raw.match(/^(?:세특|과세특|과목별세특|교과세특)[\s_\-:]*(.+)$/);
  if (sub) return { area: 'subject', subject: sub[1].trim() };
  if (/^자유학기/.test(s) || /^(진로탐색|주제선택|예술체육)/.test(s)) {
    if (/진로/.test(s)) return { area: 'free-career' };
    if (/주제/.test(s)) return { area: 'free-topic' };
    if (/예술|체육/.test(s)) return { area: 'free-art' };
    if (/동아리/.test(s)) return { area: 'free-club' };
    return null;
  }
  if (/^(자율|자치|자율자치)(활동)?$/.test(s)) return { area: 'autonomy' };
  if (/^동아리(활동)?$/.test(s)) return { area: 'club' };
  if (/^진로(활동)?$/.test(s)) return { area: 'career' };
  if (/^(행특|행동특성|종합의견|행동특성및종합의견)$/.test(s)) return { area: 'behavior' };
  if (/^(개세특|개인별|개인별세특|개인별세부능력및특기사항)$/.test(s)) return { area: 'individual' };
  if (/^(세특|과세특|과목별세특)$/.test(s)) return { area: 'subject' };
  if (/^일상생활/.test(s)) return { area: 'daily' };
  return null;
}
