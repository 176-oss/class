// 가상 학생 30명 샘플 엑셀 만들기: node sgb-checker/tests/make-samples.mjs
// 이름은 모두 가상. 정상 글과 일부러 틀린 글을 섞는다.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, XLSX } from './helpers.mjs';
import { textSheet } from '../js/report.js';

const FAMILY = ['가', '나', '다', '라', '마', '바'];
const GIVEN = ['하람', '누리', '솔빛', '다온', '한결'];
const students = Array.from({ length: 30 }, (_, i) => ({ id: `1${String(Math.floor(i / 10) + 1).padStart(2, '0')}${String((i % 10) + 1).padStart(2, '0')}`, name: `${FAMILY[i % 6]}${GIVEN[Math.floor(i / 6) % 5]}${'일이삼사오'[i % 5]}`.slice(0, 3) }));

const GOOD = {
  autonomy: [
    '학급 회의(월 1회)에서 서기를 맡아 친구들의 의견을 꼼꼼하게 기록하고 정리하여 공유함. 의견이 엇갈릴 때 각 입장을 차분히 요약해 합의에 이르도록 도움.',
    '학교폭력예방활동(2026.03.04.-2026.07.08./5회)에서 또래 상담 역할극을 기획하고, 갈등 상황에서 상대의 감정을 묻는 말하기를 연습하며 공감하는 태도가 깊어짐.',
    '환경 캠페인에서 분리배출 안내문을 직접 만들어 교실에 붙이고, 일주일 동안 배출 상태를 기록하여 개선 정도를 학급에 발표함.',
  ],
  club: [
    '(과학탐구반) 물의 표면장력을 주제로 실험을 설계하고, 변인을 하나씩 바꾸어 측정한 결과를 그래프로 정리함. 실패한 실험의 원인을 스스로 찾아 다시 시도하는 끈기를 보임.',
    '(독서토론반) 청소년 소설을 읽고 인물의 선택을 두고 토론함. 상대의 근거를 메모한 뒤 반박하는 방식으로 말하기가 점차 논리적으로 바뀜.',
  ],
  career: [
    '진로 탐색 활동에서 관심 분야인 생명과학 관련 직업을 조사하고, 직업마다 필요한 역량을 표로 정리하여 자신에게 부족한 점을 찾아 학습 계획을 세움.',
    '진로성향 검사 결과를 바탕으로 자신의 강점을 분석하고, 사람을 돕는 일에 보람을 느낀다는 점을 발견하여 상담 분야 직업을 탐색함.',
  ],
  behavior: [
    '맡은 일을 끝까지 책임지는 성실한 태도가 돋보임. 2학기에는 모둠 활동에서 의견이 다른 친구의 말을 끝까지 듣고 정리하는 모습으로 성장함.',
    '조용하지만 관찰력이 뛰어나 교실 화분의 변화를 꾸준히 기록함. 친구가 어려워할 때 먼저 다가가 돕는 배려심이 있음.',
  ],
  subject: [
    '시 감상 수업에서 화자의 정서를 비유 표현과 연결하여 분석하고, 같은 주제의 다른 시와 비교하는 글을 써서 발표함. 근거를 들어 해석하는 능력이 향상됨.',
    '설명문 쓰기에서 독자의 배경지식을 고려하여 용어를 풀어 쓰고, 친구의 피드백을 반영해 글의 구조를 두 번 고쳐 씀.',
  ],
};
const BAD = {
  autonomy: [
    '나는 학급 회의에 열심히 참여했다.  친구들과 사이좋게 지냄',
    '교내 토론대회에 나가 금상을 받음. 2026. 3. 4. 체육대회에도 참여함.',
    '1. 학급 반장으로 활동함.\n2. 학교폭력예방교육에 참여함.',
    '서울대학교 캠퍼스 투어에 참여하여 대학 생활을 체험함.',
  ],
  club: [
    '(로봇반) 로봇반에서 코딩을 배우고 로봇반 대표로 경진대회에 나감.',
    '스카우트 활동으로 야영에 참여함.',
    '아버지가 운영하는 회사를 견학하고 엔지니어의 꿈을 키움.',
  ],
  career: [
    'MBTI 검사 결과 ENFP로 나와 상담가를 희망하게 됨.',
    '(주)한빛전자 연구소에서 직업 체험을 함. 3월 4일~7월 8일 동안 활동함.',
    '토익 900점을 받아 통역사의 꿈에 한 걸음 다가감.',
  ],
  behavior: [
    '수업 중 산만하고 지각이 잦음.',
    '그는 항상 완벽하게 과제를 해결하는 천재적인 학생이다.',
    '방과후학교 수학반에서 열심히 공부함.',
  ],
  subject: [
    'K-MOOC 강좌를 듣고 미적분을 공부했습니다.',
    '소논문 "표면장력과 세제의 관계"를 작성함(참여인원 3명, 20시간).',
    '수학 학원에서 배운 풀이법을 친구들에게 설명함.',
  ],
};

// 학생마다 다른 문장을 덧붙여 정상 글끼리 90% 넘게 비슷하지 않게 함
const EXTRA = ['모둠 발표에서 자료를 시각적으로 정리하는 데 강점을 보임.', '질문을 받으면 근거를 차분히 되짚어 답하는 습관이 있음.', '수업 뒤 남아 실험 도구를 정리하는 책임감을 보임.', '친구의 글을 읽고 구체적인 칭찬과 제안을 함께 적어 줌.', '처음에는 발표를 망설였으나 연습을 거듭하며 목소리가 커짐.', '자신이 세운 계획표를 매주 점검하며 실천 정도를 기록함.', '어려운 개념을 그림으로 바꾸어 이해하는 방법을 스스로 찾음.', '모둠 안에서 역할이 겹치지 않도록 일을 나누는 데 앞장섬.', '실수를 인정하고 바로 고치는 모습이 여러 번 관찰됨.', '새로운 방법을 제안하고 그 결과를 친구들과 비교함.', '관련 도서를 찾아 읽고 핵심 내용을 한 문단으로 요약함.'];
const COMMON = '시 감상 수업에서 화자의 정서를 파악하고 친구들과 의견을 나눔.'; // 3명 이상 반복 문장
function rows(area, subject = '') {
  return [['학번', '이름', '과목', '내용'], ...students.map((s, i) => {
    let text;
    if (i === 29) text = ''; // 미작성
    else if (i % 3 === 2) text = BAD[area][Math.floor(i / 3) % BAD[area].length];
    else text = `${GOOD[area][i % GOOD[area].length]} ${EXTRA[i % 11]} ${EXTRA[(i * 7 + 3) % 11]}`;
    if (area === 'subject' && i < 4) text = `${COMMON} ${text}`;
    return [s.id, s.name, subject, text];
  })];
}

function save(name, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [n, r] of sheets) XLSX.utils.book_append_sheet(wb, textSheet(XLSX, r), n);
  const dir = join(ROOT, 'tests/samples');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

save('중학교-샘플-30명.xlsx', [['자율', rows('autonomy')], ['동아리', rows('club')], ['진로', rows('career')], ['행특', rows('behavior')], ['세특_국어', rows('subject', '국어')]]);

const longText = '가'.repeat(300) + '함.';
const common1 = rows('subject', '공통국어1');
const common2 = rows('subject', '공통국어2');
common1[1][3] = longText; common2[1][3] = longText; // 1번 학생: 1·2 합산 초과
const thesis = rows('subject', '수학과제탐구');
save('고등학교-샘플-30명.xlsx', [['자율', rows('autonomy')], ['동아리', rows('club')], ['진로', rows('career')], ['행특', rows('behavior')], ['세특_공통국어1', common1], ['세특_공통국어2', common2], ['세특_수학과제탐구', thesis]]);

// 엑셀 열기 보안 시험용: __proto__ 머리글, 수식처럼 보이는 글, NEIS에서 받은 듯한 제목 줄
save('보안-시험.xlsx', [['__proto__', [['학번', '이름', '내용'], ['1', '가하람', '이 시트는 건너뜀.']]], ['자율', [
  ['2026학년도 1학년 1반 자율활동 특기사항'], [],
  ['__proto__', 'constructor', '번호', '성명', '특기사항', 'prototype'],
  ['x', 'y', '1', '가하람', '=1+1', 'z'],
  ['x', 'y', '2', '나하람', '+SUM(A1:A2) 학급 회의에 참여함.', 'z'],
  ['x', 'y', '3', '다하람', '@cmd 토론에 참여함.', 'z'],
]]]);
console.log('tests/samples/ 에 샘플 3개를 만들었습니다.');
