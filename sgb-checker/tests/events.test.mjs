import test from 'node:test';
import assert from 'node:assert/strict';
import { canonDate, parseEventList, checkEvents, eventLabel } from '../rules/events.js';
import { checkText } from '../rules/check.js';

const ctx = (o = {}) => ({ school: 'mid', area: 'autonomy', subject: '', limitBytes: 1500, names: [], schoolWords: [], schoolYear: 2026, ...o });

test('canonDate: 하루·기간을 기재요령 꼴로', () => {
  assert.equal(canonDate('2026-3-4'), '2026.03.04.');
  assert.equal(canonDate('2026년 3월 4일'), '2026.03.04.');
  assert.equal(canonDate('3.4', 2026), '2026.03.04.');
  assert.equal(canonDate('2026.03.04.~2026.03.06.'), '2026.03.04.-2026.03.06.');
  assert.equal(canonDate('2026.03.04.-2026.03.06.'), '2026.03.04.-2026.03.06.');
  assert.equal(canonDate('2026.3.4 ~ 3.6'), '2026.03.04.-2026.03.06.');
  assert.equal(canonDate('2026.02.30.'), null);
  assert.equal(canonDate('2026.03.06.-2026.03.04.'), null);
  assert.equal(canonDate('사흘'), null);
});

test('parseEventList: 붙여넣기 여러 꼴, 표, 머리글, 오류, 중복', () => {
  const r = parseEventList('행사명\t날짜\n학생자치회 임원 선거\t2026-3-15\n체육대회, 2026.05.14.~2026.05.15.\n진로의 날(2026.6.3)\n과학의 날 2026.04.21\n잘못된 줄\n진로의 날(2026.06.03.)\n축제\t다음 달');
  assert.deepEqual(r.events, [
    { name: '학생자치회 임원 선거', date: '2026.03.15.' },
    { name: '체육대회', date: '2026.05.14.-2026.05.15.' },
    { name: '진로의 날', date: '2026.06.03.' },
    { name: '과학의 날', date: '2026.04.21.' },
  ]);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[1], /날짜로 읽을 수 없습니다/);
  assert.deepEqual(parseEventList([['행사', '일자'], ['독서 토론회', '2026.09.10']]).events, [{ name: '독서 토론회', date: '2026.09.10.' }]);
});

const EV = parseEventList('학생자치회 임원 선거\t2026.03.15.\n체육대회\t2026.05.14.-2026.05.15.\n진로의 날\t2026.06.03.').events;
const rules = (text) => checkEvents(text, EV, 2026).map((i) => i.ruleId);

test('checkEvents: 맞으면 지적 없음', () => {
  assert.deepEqual(rules('학생자치회 임원 선거(2026.03.15.)에서 공약을 발표함. 체육대회(2026.05.14.-2026.05.15.)에서 응원단을 이끎.'), []);
});

test('checkEvents: 날짜 다름 -> 목록 날짜로 고칠 값', () => {
  const t = '진로의 날(2026.06.04.)에 직업인 강연을 듣고 소감을 씀.';
  const [i] = checkEvents(t, EV, 2026);
  assert.equal(i.ruleId, 'event-date');
  assert.equal(t.slice(i.start, i.end), '2026.06.04.');
  assert.equal(i.fix, '2026.06.03.');
});

test('checkEvents: 이름 다름, 목록에 없는 날짜, 날짜 빠짐', () => {
  assert.deepEqual(rules('학생회 선거(2026.03.15.)에서 투표함.'), ['event-name']);
  assert.deepEqual(rules('독서 캠프(2026.07.01.)에 참여함.'), ['event-unknown']);
  const t = '체육대회에서 반 대표로 계주에 나감.';
  const [i] = checkEvents(t, EV, 2026);
  assert.equal(i.ruleId, 'event-no-date');
  assert.equal(i.fix, '체육대회(2026.05.14.-2026.05.15.)');
  assert.deepEqual(checkEvents('아무 행사 없음', [], 2026), []);
});

test('checkText: 자율·진로에서만 행사 점검, 고칠 값 [적용]', () => {
  const t = '진로의 날(2026.06.04.)에 강연을 들음.';
  assert.ok(checkText(t, ctx({ area: 'career', events: EV })).issues.some((i) => i.ruleId === 'event-date' && i.label === '행사 날짜가 목록과 다름'));
  assert.ok(!checkText(t, ctx({ area: 'subject', events: EV })).issues.some((i) => i.ruleId.startsWith('event-')));
  assert.ok(!checkText(t, ctx({ area: 'career' })).issues.some((i) => i.ruleId.startsWith('event-')), '목록이 없으면 안 함');
  assert.equal(eventLabel(EV[0]), '학생자치회 임원 선거(2026.03.15.)');
});
