import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findForbidden, findNeisIssues, cleanText, similarity, findSimilar, checkRecord, NEIS_CHAR_RULES,
} from '../js/core/check.js';
import { DEFAULT_FORBIDDEN } from '../js/core/forbidden.js';

const C = (...codes) => String.fromCodePoint(...codes);
const ids = (hits) => hits.map((h) => h.entry.id);

test('forbidden: 기본 목록 형식 (30~60개, 필드, 분류, 근거 표시)', () => {
  const cats = ['교외 수상', '어학시험', '사교육', '부모 정보', '기관·상표명', '논문·출판', '지식재산권', '교외 활동', '기타'];
  assert.ok(DEFAULT_FORBIDDEN.length >= 30 && DEFAULT_FORBIDDEN.length <= 60, `개수 ${DEFAULT_FORBIDDEN.length}`);
  const seen = new Set();
  for (const e of DEFAULT_FORBIDDEN) {
    assert.ok(e.id && !seen.has(e.id), `id 중복 또는 없음: ${e.id}`);
    seen.add(e.id);
    assert.ok(['word', 'prefix', 'regex'].includes(e.match), e.id);
    assert.ok(cats.includes(e.category), `${e.id} 분류 ${e.category}`);
    assert.ok(e.basis.includes('원문 쪽수 확인 필요'), `${e.id} basis`);
    assert.ok(e.replace, `${e.id} replace`);
    assert.ok(Array.isArray(e.areas), `${e.id} areas`);
    if (e.match === 'regex') assert.doesNotThrow(() => new RegExp(e.term, 'gi'), e.id);
  }
});

test('forbidden: 기본 목록이 찾아야 하는 표현', () => {
  const cases = [
    ['교외 대회에서 좋은 결과를 얻음', 'award-outside'],
    ['교육감 표창을 받음', 'award-official'],
    ['수학 올림피아드에 나감', 'olympiad'],
    ['KMO 준비', 'olympiad-abbr'],
    ['과학 탐구 대회에서 금상을 수상함', 'award-in-text'],
    ['토론 대회에 입상하여', 'award-verb'],
    ['TOEIC 900점', 'lang-toeic-en'],
    ['토익 점수를 올림', 'lang-toeic-ko'],
    ['토플 공부', 'lang-toefl-ko'],
    ['HSK 5급', 'lang-etc'],
    ['JLPT N2', 'lang-etc'],
    ['DELF B1', 'lang-etc'],
    ['공인 어학 성적', 'lang-score'],
    ['수학 학원에서 배운 내용', 'private-academy'],
    ['과외를 받으며', 'private-tutor'],
    ['인강으로 복습', 'private-online'],
    ['아버지가 의사여서', 'parent-job'],
    ['어머니의 직업을 소개', 'parent-status'],
    ['한국대학교 탐방', 'univ-full'],
    ['서울대에 가고 싶어', 'univ-short'],
    ['KAIST 견학', 'univ-science'],
    ['홍길동 교수의 특강을 듣고', 'lecturer-name'],
    ['ChatGPT를 활용하여', 'brand-ai'],
    ['유튜브 영상을 만듦', 'brand-sns'],
    ['소논문을 작성함', 'paper'],
    ['논문을 투고함', 'paper-submit'],
    ['학회지에 실림', 'paper'],
    ['책을 출간함', 'book-publish'],
    ['특허를 출원함', 'ip-patent'],
    ['상표 등록', 'ip-design'],
    ['해외 봉사 활동', 'overseas'],
    ['방학 중 어학연수', 'language-study'],
    ['영재교육원 수료', 'gifted'],
    ['발명교실 참여', 'invention'],
    ['장학생으로 선발됨', 'scholarship'],
    ['정보처리 기능사 자격 취득', 'certificate'],
    ['모의고사 성적이 오름', 'mock-exam'],
    ['전교 3등', 'rank'],
    ['수학 1등급', 'grade-level'],
    ['방과후학교 강좌', 'afterschool'],
  ];
  for (const [text, id] of cases) {
    const hits = findForbidden(text, 'subject', DEFAULT_FORBIDDEN);
    assert.ok(ids(hits).includes(id), `"${text}" 에서 ${id} 못 찾음 (찾은 것: ${ids(hits).join(',')})`);
  }
});

test('forbidden: 기본 목록이 오탐하지 않아야 하는 표현', () => {
  const clean = [
    '대학원 진학 과정을 알아봄',
    '과외 활동이 많은 학기였음',
    '학교 대표로 수학 탐구 발표를 맡음',
    '수상한 점을 발견하고 질문함',
    '시장 상황을 분석하는 활동을 함',
    '고려대장경의 가치를 조사함',
    '교과 외 시간에도 꾸준히 연습함',
    '특허 제도의 의미를 조사하여 발표함',
    '현대 사회의 문제를 탐구함',
    '부모님께 감사 편지를 씀',
    '희망하는 대학 학과의 교육과정을 찾아봄',
    '모둠 활동에서 자료를 정리함',
    '조선 후기 신분 제도의 변화를 탐구함',
    'delete 명령의 원리를 설명함',
  ];
  for (const text of clean) {
    const hits = findForbidden(text, 'subject', DEFAULT_FORBIDDEN);
    assert.deepEqual(ids(hits), [], `"${text}" 오탐: ${ids(hits).join(',')}`);
  }
});

test('findForbidden: word 경계 (앞 경계, 영문은 뒤 경계도)', () => {
  const entries = [
    { id: 'a', term: '학원', match: 'word', category: '사교육', basis: '', replace: '삭제', areas: [] },
    { id: 'b', term: 'TEPS', match: 'word', category: '어학시험', basis: '', replace: '삭제', areas: [] },
  ];
  assert.equal(findForbidden('학원에서', 'career', entries).length, 1, '뒤에 조사는 허용');
  assert.equal(findForbidden('(학원)', 'career', entries).length, 1);
  assert.equal(findForbidden('대학원에서', 'career', entries).length, 0, '앞에 한글이 붙으면 아님');
  assert.equal(findForbidden('TEPS 점수', 'career', entries).length, 1);
  assert.equal(findForbidden('teps', 'career', entries).length, 1, '대소문자 무시');
  assert.equal(findForbidden('STEPS', 'career', entries).length, 0, '영문 앞 경계');
  assert.equal(findForbidden('TEPSA', 'career', entries).length, 0, '영문 뒤 경계');
  const hit = findForbidden('어제 학원에서', 'career', entries)[0];
  assert.equal(hit.index, 3);
  assert.equal(hit.length, 2);
  assert.equal(hit.match, '학원');
});

test('findForbidden: 영역 제한', () => {
  const entries = [
    { id: 'only-subject', term: '노트필기', match: 'word', category: '기타', basis: '', replace: '', areas: ['subject'] },
    { id: 'all', term: '학원', match: 'word', category: '사교육', basis: '', replace: '', areas: [] },
  ];
  const text = '노트필기와 학원';
  assert.deepEqual(ids(findForbidden(text, 'subject', entries)).sort(), ['all', 'only-subject']);
  assert.deepEqual(ids(findForbidden(text, 'behavior', entries)), ['all']);
});

test('findForbidden: 잘못된 정규식은 건너뜀, 위치 순서로 정렬', () => {
  const entries = [
    { id: 'bad', term: '(', match: 'regex', category: '기타', basis: '', replace: '', areas: [] },
    { id: 'x', term: '토플', match: 'word', category: '어학시험', basis: '', replace: '', areas: [] },
    { id: 'y', term: '학원', match: 'word', category: '사교육', basis: '', replace: '', areas: [] },
  ];
  const hits = findForbidden('학원 다니며 토플 공부, 다시 학원', 'subject', entries);
  assert.deepEqual(hits.map((h) => h.index), [0, 7, 17]);
});

test('NEIS 문자: 찾기', () => {
  const text = `${C(0x201c)}좋음${C(0x201d)} ${C(0x2018)}a${C(0x2019)} 끝${C(0x2026)} A${C(0x2014)}B\n탭\t공백${C(0xa0)}끝${C(0x200b)} ${C(0x1f600)} ${C(0x2605)}`;
  const issues = findNeisIssues(text);
  const got = Object.fromEntries(issues.map((i) => [i.id, i.count]));
  assert.equal(got['double-quote'], 2);
  assert.equal(got['single-quote'], 2);
  assert.equal(got.ellipsis, 1);
  assert.equal(got.dash, 1);
  assert.equal(got.newline, 1);
  assert.equal(got.tab, 1);
  assert.equal(got['special-space'], 1);
  assert.equal(got['zero-width'], 1);
  assert.equal(got.emoji >= 1, true);
  assert.ok(issues.every((i) => i.label && i.count > 0));
  assert.deepEqual(findNeisIssues('문제 없는 글임.'), []);
});

test('NEIS 문자: 연속 공백', () => {
  const issues = findNeisIssues('두  칸   공백');
  assert.deepEqual(issues, [{ id: 'double-space', label: '연속 공백', count: 2 }]);
});

test('NEIS 문자 규칙: 모든 규칙에 id, label, g 플래그 정규식, replace', () => {
  for (const r of NEIS_CHAR_RULES) {
    assert.ok(r.id && r.label);
    assert.ok(r.pattern instanceof RegExp && r.pattern.global, r.id);
    assert.equal(typeof r.replace, 'string');
  }
});

test('cleanText: NEIS 문자 바꿈 + 연속 공백 + 앞뒤 공백', () => {
  const text = `  ${C(0x201c)}탐구${C(0x201d)}함${C(0x2026)}\n\n다음  문장${C(0x2014)}끝${C(0x200b)}임. ${C(0x1f600)}  `;
  assert.equal(cleanText(text), '"탐구"함... 다음 문장-끝임.');
  assert.equal(cleanText('가\t\t나'), '가 나');
  assert.equal(cleanText(`가${C(0x3000)}나`), '가 나');
  assert.equal(cleanText('이미 깨끗한 글임.'), '이미 깨끗한 글임.');
  const once = cleanText(text);
  assert.equal(cleanText(once), once, '두 번 해도 같음');
  assert.deepEqual(findNeisIssues(once), []);
});

const LONG_A = '모둠 활동에서 실험 계획을 세우고 역할을 나누어 결과를 정리하는 과정을 성실하게 이끎. 자료를 꼼꼼히 비교함.';
const LONG_B = '독서 토론에서 근거를 들어 자기 생각을 밝히고 다른 의견을 존중하며 대화를 이어가는 태도가 돋보임.';

test('similarity: 같은 글 1, 다른 글은 낮음, 공백 무시', () => {
  assert.equal(similarity(LONG_A, LONG_A), 1);
  assert.equal(similarity(LONG_A, LONG_A.replace(/ /g, '')), 1);
  assert.ok(similarity(LONG_A, LONG_B) < 0.3, String(similarity(LONG_A, LONG_B)));
  assert.equal(similarity('', ''), 1);
  assert.equal(similarity('가', '나'), 0);
});

test('similarity: 90% 경계', () => {
  const base = '가나다라마바사아자차카타파하'.repeat(3); // 42자
  const near = `${base.slice(0, -1)}X`; // 끝 한 글자만 다름
  const s1 = similarity(base, near);
  assert.ok(s1 >= 0.9, `거의 같은 글 ${s1}`);
  const half = base.slice(0, 21) + 'ABCDEFGHIJKLMNOPQRSTU';
  const s2 = similarity(base, half);
  assert.ok(s2 < 0.9, `반만 같은 글 ${s2}`);
  assert.deepEqual(findSimilar(base, [{ id: 'n', text: near }, { id: 'h', text: half }]).map((x) => x.id), ['n']);
  assert.deepEqual(findSimilar(base, [{ id: 'h', text: half }], 0.4).map((x) => x.id), ['h']);
});

test('findSimilar: 30자 미만은 검사하지 않음', () => {
  const short = '짧은 글은 비교하지 않음';
  assert.deepEqual(findSimilar(short, [{ id: 'x', text: short }]), []);
  assert.deepEqual(findSimilar(LONG_A, [{ id: 'x', text: '짧음' }]), []);
  assert.deepEqual(findSimilar(LONG_A, [{ id: 'x', text: LONG_A }]), [{ id: 'x', score: 1 }]);
});

test('checkRecord: 종합 결과', () => {
  const text = `${LONG_A} 학원에서 배운 내용을 소개함.  끝`;
  const r = checkRecord(text, {
    area: 'subject',
    limit: 100,
    entries: DEFAULT_FORBIDDEN,
    others: [{ id: 'other', text }],
  });
  assert.equal(r.limit, 100);
  assert.equal(r.level, 'over');
  assert.ok(r.bytes > 100);
  assert.ok(r.forbidden.some((h) => h.entry.id === 'private-academy'));
  assert.ok(r.neis.some((i) => i.id === 'double-space'));
  assert.deepEqual(r.similar.map((x) => x.id), ['other']);
  assert.equal(r.issueCount, 1 + r.forbidden.length + r.neis.length + r.similar.length);

  const ok = checkRecord('짧고 문제 없는 글임.', { area: 'behavior', limit: 900, entries: DEFAULT_FORBIDDEN, others: [] });
  assert.equal(ok.level, 'ok');
  assert.equal(ok.issueCount, 0);
});
