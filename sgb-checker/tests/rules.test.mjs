import test from 'node:test';
import assert from 'node:assert/strict';
import { byteLength } from '../rules/bytes.js';
import { checkText, checkClass, similarity } from '../rules/check.js';
import { toNounEnding } from '../rules/text.js';
import { applyFix, tidy, diff } from '../rules/fix.js';
import { byteLimit, commonSubjectBase, areaFromSheetName } from '../rules/areas.js';

const ctx = (o = {}) => ({ school: 'mid', grade: 1, area: 'autonomy', subject: '', limitBytes: 1500, names: [], schoolWords: [], schoolYear: 2026, ...o });
const ids = (text, o) => checkText(text, ctx(o)).issues.map((i) => i.ruleId);
const find = (text, rule, o) => checkText(text, ctx(o)).issues.filter((i) => i.ruleId === rule);

test('바이트: 한글 3, 그 밖 1, 엔터 1, \\r은 세지 않음', () => {
  assert.equal(byteLength('가나다'), 9);
  assert.equal(byteLength('ab 1.'), 5);
  assert.equal(byteLength('가\n나'), 7);
  assert.equal(byteLength('가\r\n나'), 7);
  assert.equal(byteLength(''), 0);
});

test('바이트 한도: 초과는 오류, 95% 이상은 확인', () => {
  assert.ok(ids('가'.repeat(501) + '.', { limitBytes: 1500 }).includes('bytes-over'));
  assert.ok(ids('가'.repeat(480) + '함.', { limitBytes: 1500 }).includes('bytes-near'));
  assert.equal(byteLimit('behavior', 'mid'), 900);
  assert.equal(byteLimit('free-career', 'high'), 0);
  assert.equal(byteLimit('autonomy', 'mid', { autonomy: 400 }), 1200);
});

test('명사형 어미: ~다/~요/~습니다는 오류, ~함/~음/~임은 통과', () => {
  assert.ok(ids('토론에 참여했다.').includes('ending'));
  assert.ok(ids('열심히 해요.').includes('ending'));
  assert.ok(ids('성실하게 참여했습니다.').includes('ending'));
  for (const ok of ['토론에 참여함.', '꾸준히 노력하는 모습을 보임.', '배려심이 깊은 학생임.', '자료를 분석함(2026.03.04.).', '발표를 마침.']) {
    assert.ok(!ids(ok).includes('ending'), ok);
  }
  assert.ok(ids('성실한 학생.').includes('ending-noun'));
});

test('명사형 바꾸기 제안', () => {
  assert.equal(toNounEnding('참여했다'), '참여함');
  assert.equal(toNounEnding('참여하였습니다'), '참여함');
  assert.equal(toNounEnding('학생이다'), '학생임');
  assert.equal(toNounEnding('보인다'), '보임');
  assert.equal(toNounEnding('있다'), '있음');
  assert.equal(toNounEnding('먹는다'), '먹음');
  assert.equal(toNounEnding('보입니다'), '보임');
  assert.equal(toNounEnding('개선되었다'), '개선됨');
  assert.equal(find('토론에 참여했다.', 'ending')[0].fix, '참여함');
});

test('관찰자 시점: 1인칭, 대명사, 이름, 교사 주어', () => {
  assert.ok(ids('나는 토론에 참여함.').includes('viewpoint-first'));
  assert.ok(ids('그녀는 성실함.').includes('viewpoint-pronoun'));
  assert.ok(ids('김민준 학생은 성실함.', { names: ['김민준'] }).includes('viewpoint-name'));
  assert.ok(ids('민준이는 성실함.', { names: ['김민준'] }).includes('viewpoint-name'));
  assert.ok(ids('발표 태도를 칭찬함.').includes('viewpoint-teacher'));
  assert.ok(!ids('자라나는 모습을 보임.').includes('viewpoint-first'));
  assert.ok(!ids('그는 것을 좋아함.').includes('viewpoint-first'));
});

test('마침표: 문장(줄) 끝에 없으면 오류, 괄호 머리말 줄은 건너뜀', () => {
  const p = find('토론에 참여함\n발표함.', 'period');
  assert.equal(p.length, 1);
  assert.equal(applyFix('토론에 참여함\n발표함.', p[0]), '토론에 참여함.\n발표함.');
  assert.ok(!ids('(영어회화반)(34시간)\n영어에 관심이 많음.', { area: 'club' }).includes('period'));
  assert.ok(ids('학급회의에 참여함(월 1회)').includes('period'));
});

test('공백: 두 칸 이상, 줄 앞뒤 공백', () => {
  const s = find('토론에  참여함.', 'space-double');
  assert.equal(s.length, 1);
  assert.equal(applyFix('토론에  참여함.', s[0]), '토론에 참여함.');
  assert.ok(ids('토론에 참여함. ').includes('space-edge'));
});

test('문단 구분 기호와 번호', () => {
  for (const t of ['1. 토론에 참여함.', '\u2460 토론에 참여함.', '- 토론에 참여함.', '· 토론에 참여함.', '가. 토론에 참여함.', '(1) 토론에 참여함.', '\u25A0 토론에 참여함.']) {
    assert.ok(ids(t).includes('bullet'), t);
  }
  assert.ok(!ids('2026.03.04. 토론에 참여함.').includes('bullet'));
  assert.ok(!ids('(1학기) 토론에 참여함.').includes('bullet'));
  assert.ok(ids('토론\u2605에 참여함.').includes('special-char'));
});

test('NEIS 깨짐 문자와 [정리]', () => {
  const t = '\u201C토론\u201D에\u00A0참여함\u2026 발표함.';
  const r = checkText(t, ctx());
  assert.ok(r.issues.some((i) => i.ruleId === 'neis-char'));
  assert.equal(tidy(t, r.issues), '"토론"에 참여함... 발표함.');
});

test('날짜 형식: 하루', () => {
  const cases = [
    ['민주시민교육(2026. 3. 4.)에 참여함.', '2026.03.04.'],
    ['민주시민교육(2026-03-04)에 참여함.', '2026.03.04.'],
    ['민주시민교육(2026/3/4)에 참여함.', '2026.03.04.'],
    ['민주시민교육(2026.3.4)에 참여함.', '2026.03.04.'],
    ['민주시민교육(2026.03.04)에 참여함.', '2026.03.04.'],
    ['2026년 3월 4일 민주시민교육에 참여함.', '2026.03.04.'],
  ];
  for (const [t, want] of cases) {
    const d = find(t, 'date-format');
    assert.equal(d.length, 1, t);
    assert.equal(d[0].fix, want, t);
  }
  assert.equal(find('민주시민교육(2026.09.10.)에 참여함.', 'date-format').length, 0);
});

test('날짜 형식: 기간, 연도 없음, 마침표 중복', () => {
  assert.equal(find('학교폭력예방활동(2026.03.04.-2026.07.08./5회)에 참여함.', 'date-format').length, 0);
  const r = find('활동 기간 2026.3.4 ~ 2026.7.8 동안 참여함.', 'date-format');
  assert.equal(r[0].fix, '2026.03.04.-2026.07.08.');
  const sp = find('활동 기간 2026.03.04. - 2026.07.08. 동안 참여함.', 'date-format');
  assert.equal(sp[0].fix, '2026.03.04.-2026.07.08.');
  const ny = find('3월 4일에 참여함.', 'date-format');
  assert.equal(ny[0].fix, '2026.03.04.');
  assert.equal(ny[0].needsConfirm, true);
  assert.equal(find('1월 5일에 참여함.', 'date-format')[0].fix, '2027.01.05.');
  const dd = find('토론회를 2026.03.04..', 'date-format');
  assert.equal(dd[0].text, '2026.03.04..');
  assert.equal(dd[0].fix, '2026.03.04.');
  assert.equal(find('전화 010-1234-5678로 연락함.', 'date-format').length, 0);
});

test('금지 내용: 잡을 것', () => {
  const has = (t, rule, o) => ids(t, o).includes(rule);
  assert.ok(has('토익 900점을 받음.', 'forbidden-lang-test'));
  assert.ok(has('TOEIC 시험에 응시함.', 'forbidden-lang-test'));
  assert.ok(has('교내 토론대회에 참가함.', 'forbidden-contest'));
  assert.ok(has('과학 경진대회에서 금상을 받음.', 'forbidden-contest'));
  assert.ok(has('봉사 표창장을 받음.', 'forbidden-outside-award'));
  assert.ok(has('서울대학교 캠프에 참여함.', 'forbidden-university'));
  assert.ok(has('카이스트 강연을 들음.', 'forbidden-university'));
  assert.ok(has('장학금을 받음.', 'forbidden-scholarship'));
  assert.ok(has('컴퓨터활용능력 자격증을 취득함.', 'forbidden-license'));
  assert.ok(has('수학 학원에서 공부함.', 'forbidden-private-edu'));
  assert.ok(has('아버지가 운영하는 병원에서 체험함.', 'forbidden-parent-job'));
  assert.ok(has('어학연수를 다녀옴.', 'forbidden-abroad'));
  assert.ok(has('발명품으로 특허를 출원함.', 'forbidden-ip-filing'));
  assert.ok(has('K-MOOC 강좌를 수강함.', 'forbidden-mooc', { area: 'subject' }));
  assert.ok(has('방과후학교 수업에 참여함.', 'forbidden-after-school', { area: 'behavior' }));
  assert.ok(has('영재교육원에서 수학을 배움.', 'forbidden-gifted', { area: 'behavior' }));
  assert.ok(has('(주)한빛전자 견학에 참여함.', 'forbidden-company'));
});

test('금지 내용: 정상 문맥 오탐 없음', () => {
  const none = (t, o) => assert.ok(!ids(t, o).some((r) => r.startsWith('forbidden-')), `${t} -> ${ids(t, o).filter((r) => r.startsWith('forbidden-'))}`);
  none('친구와 대화를 나누며 의견을 조율함.');
  none('대회의실에서 열린 학급 회의에 참여함.');
  none('발표를 듣고 깊은 인상을 받음.');
  none('대학 진학을 목표로 학과 정보를 탐색함.');
  none('희망 학과의 교육과정을 조사함.');
  none('학교 축제 준비에 참여함.', { school: 'high' });
  none('대학원 진학 과정을 조사함.');
  none('방과후학교스포츠클럽 활동을 함.', { area: 'club' });
  none('방과후학교 활동에 참여함.', { area: 'club' }); // 세특·행특 전용 규칙
  // 검수에서 찾은 오탐
  none('생명을 경시하는 태도의 문제점을 토론함.');
  none('백분위수의 뜻을 설명함.', { school: 'high', area: 'subject' });
  none('의과대학 진학을 목표로 생명과학 학습에 힘씀.');
  const errOnly = (t, o) => checkText(t, ctx(o)).issues.filter((i) => i.level === 'error').map((i) => i.ruleId);
  assert.deepEqual(errOnly('저자의 저서를 읽고 출간 배경을 조사함.'), []);
  assert.deepEqual(errOnly('아인슈타인의 생애를 조사하고 그의 업적을 발표함.'), []);
  assert.deepEqual(errOnly("'나의 꿈 발표하기' 활동에서 꿈을 소개함."), []);
  assert.deepEqual(errOnly('체육대회에서 학급 응원을 이끎.'), []);
  assert.deepEqual(errOnly('(위드유: 자율동아리) 소외 계층을 위한 봉사동아리', { area: 'club' }), []);
  assert.deepEqual(errOnly('작품을 만듦.'), []);
  assert.ok(!ids('작품을 만듦.').includes('ending-noun'));
  // 그래도 잡을 것
  assert.ok(errOnly('직접 쓴 소설책을 출간함.').includes('forbidden-book'));
  assert.ok(errOnly('수학 경시대회에 나감.').includes('forbidden-contest'));
  assert.ok(errOnly('서울대학교 의과대학 캠프에 참여함.').includes('forbidden-university'));
});

test('성 없이 쓴 이름과 호칭', () => {
  for (const t of ['민준은 성실함.', '민준이 발표함.', '민준과 함께 정리함.', '민준이도 참여함.', '민준 학생이 발표함.']) {
    assert.ok(ids(t, { names: ['김민준'] }).includes('viewpoint-name'), t);
  }
});

test('학교급 차이: 모의고사·학교명은 고등학교만', () => {
  assert.ok(ids('모의고사 성적이 오름.', { school: 'high' }).includes('forbidden-mock-exam'));
  assert.ok(!ids('모의고사 성적이 오름.', { school: 'mid' }).includes('forbidden-mock-exam'));
  assert.ok(ids('한빛고등학교 축제에 참여함.', { school: 'high' }).includes('forbidden-school-name'));
  assert.ok(!ids('한빛고등학교 축제에 참여함.', { school: 'mid' }).includes('forbidden-school-name'));
  assert.ok(ids('빛나래제 무대에 섬.', { school: 'high', schoolWords: ['빛나래제'] }).includes('forbidden-school-word'));
  assert.ok(!ids('빛나래제 무대에 섬.', { school: 'mid', schoolWords: ['빛나래제'] }).includes('forbidden-school-word'));
  assert.equal(find('스카우트 활동을 함.', 'forbidden-youth-group-high', { school: 'high', area: 'club' })[0].level, 'error');
  assert.equal(find('스카우트 활동을 함.', 'forbidden-youth-group-mid', { school: 'mid', area: 'club' })[0].level, 'warn');
});

test('소논문: 고등학교 탐구 과목은 확인, 그 밖 과목은 오류', () => {
  assert.equal(find('소논문을 작성함.', 'forbidden-thesis-subject', { school: 'high', area: 'subject', subject: '수학과제 탐구' })[0].level, 'warn');
  assert.equal(find('소논문을 작성함.', 'forbidden-thesis-subject', { school: 'high', area: 'subject', subject: '물리학' })[0].level, 'error');
  assert.equal(find('소논문을 작성함.', 'forbidden-thesis-subject', { school: 'mid', area: 'subject', subject: '수학과제탐구' })[0].level, 'error');
});

test('항목별: 3학년 자율·자치, 동아리명 반복, 자율동아리 소개, 행특 성장 관점', () => {
  assert.ok(ids('자율·자치활동 시간에 참여함.', { grade: 3 }).includes('grade3-autonomy'));
  assert.ok(!ids('자율·자치활동 시간에 참여함.', { grade: 2 }).includes('grade3-autonomy'));
  assert.ok(ids('(로봇반) 로봇반에서 코딩을 익힘.', { area: 'club' }).includes('club-name-repeat'));
  assert.ok(ids('(위드유: 자율동아리) 소외 계층을 위한 봉사를 꾸준히 실천하는 학생들이 모인 동아리', { area: 'club', school: 'high' }).includes('club-intro-length'));
  assert.ok(!ids('(위드유: 자율동아리) 소외 계층을 위한 봉사동아리', { area: 'club', school: 'high' }).includes('club-intro-length'));
  assert.equal(find('(위드유: 자율동아리) 소외 계층을 위한 봉사를 꾸준히 실천하는 학생들이 모인 동아리', 'club-intro-length', { area: 'club', school: 'mid' })[0].basis, '중 79');
  assert.ok(ids('수업 중 산만하고 지각이 잦음.', { area: 'behavior', limitBytes: 900 }).includes('behavior-negative'));
  assert.ok(!ids('수업 중 산만했으나 2학기에 스스로 노력하여 나아짐.', { area: 'behavior', limitBytes: 900 }).includes('behavior-negative'));
});

test('과장 표현은 확인', () => {
  const e = find('분석 능력이 탁월함.', 'exaggeration');
  assert.equal(e[0].level, 'warn');
});

test('지적 형식: 규칙 id, 등급, 위치, 원문 조각, 이유, 근거', () => {
  const i = find('토익 점수가 높음.', 'forbidden-lang-test', { school: 'high' })[0];
  assert.deepEqual([i.level, i.start, i.end, i.text, i.basis], ['error', 0, 2, '토익', '고 18']);
  assert.ok(i.reason.length > 5);
});

test('반 전체: 반복 문장(3명 이상), 유사도 90%', () => {
  const same = '학급 회의에서 친구들의 의견을 경청하고 정리하여 발표함.';
  const rows = [
    { key: 'a', name: '가', area: 'autonomy', text: `${same} 체육대회 준비에 앞장섬.` },
    { key: 'b', name: '나', area: 'autonomy', text: `${same} 환경 캠페인을 기획함.` },
    { key: 'c', name: '다', area: 'autonomy', text: `${same} 도서 정리를 도움.` },
    { key: 'd', name: '라', area: 'autonomy', text: '학급 문고를 관리함.' },
  ];
  const m = checkClass(rows, { school: 'mid' });
  assert.equal(m.get('a').filter((i) => i.ruleId === 'repeat-sentence').length, 1);
  assert.equal(m.get('d').length, 0);
  assert.ok(similarity('학급 회의에서 의견을 정리하여 발표함.', '학급 회의에서 의견을 정리하여 발표함!') > 0.99);
  const sim = checkClass([
    { key: 'x', name: '가', area: 'career', text: '진로 탐색 활동에서 관심 분야인 생명과학 관련 직업을 조사하고 발표 자료를 만들어 친구들에게 설명함.' },
    { key: 'y', name: '나', area: 'career', text: '진로 탐색 활동에서 관심 분야인 생명과학 관련 직업을 조사하고 발표 자료를 만들어 친구들에게 소개함.' },
  ], { school: 'mid' });
  assert.ok(sim.get('x').some((i) => i.ruleId === 'similar'));
});

test('고등학교 공통과목 1·2 합산 500자', () => {
  assert.equal(commonSubjectBase('공통국어1'), '공통국어');
  assert.equal(commonSubjectBase('공통 국어 2'), '공통국어');
  assert.equal(commonSubjectBase('국어'), null);
  const t = '가'.repeat(260) + '.';
  const rows = [
    { key: 'a', studentId: '10101', area: 'subject', subject: '공통국어1', text: t },
    { key: 'b', studentId: '10101', area: 'subject', subject: '공통국어2', text: t },
    { key: 'c', studentId: '10102', area: 'subject', subject: '공통국어1', text: t },
  ];
  const m = checkClass(rows, { school: 'high', grade: 1 });
  assert.ok(m.get('a').some((i) => i.ruleId === 'common-sum'));
  assert.ok(m.get('b').some((i) => i.ruleId === 'common-sum'));
  assert.ok(!m.get('c').some((i) => i.ruleId === 'common-sum'));
  assert.ok(!checkClass(rows, { school: 'high', grade: 3 }).get('a').some((i) => i.ruleId === 'common-sum'));
  assert.ok(!checkClass(rows, { school: 'mid', grade: 1 }).get('a').some((i) => i.ruleId === 'common-sum'));
});

test('시트 이름으로 항목 알아보기', () => {
  assert.deepEqual(areaFromSheetName('세특_국어'), { area: 'subject', subject: '국어' });
  assert.deepEqual(areaFromSheetName('자율'), { area: 'autonomy' });
  assert.deepEqual(areaFromSheetName('행특'), { area: 'behavior' });
  assert.equal(areaFromSheetName('자유학기 진로탐색'), null, '자유학기는 뺌');
  assert.equal(areaFromSheetName('자유학기 동아리'), null);
  assert.equal(areaFromSheetName('일상생활'), null);
  assert.equal(areaFromSheetName('Sheet1'), null);
});

test('전후 비교', () => {
  const d = diff('토론에 참여했다.', '토론에 참여함.');
  assert.equal(d.filter((p) => p.type !== 'ins').map((p) => p.text).join(''), '토론에 참여했다.');
  assert.equal(d.filter((p) => p.type !== 'del').map((p) => p.text).join(''), '토론에 참여함.');
});

test('자유학기·일상생활 항목은 없음', async () => {
  const { AREAS, areasFor } = await import('../rules/areas.js');
  assert.deepEqual(AREAS.map((a) => a.id), ['autonomy', 'club', 'career', 'subject', 'individual', 'behavior']);
  assert.equal(areasFor('mid').length, 6);
  assert.equal(areasFor('high').length, 6);
});
