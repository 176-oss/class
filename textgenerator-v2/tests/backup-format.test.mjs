import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, validateBackup, previewImport, mergeBackup, excelRows } from '../js/core/backup-format.js';
import { defaultSettings, defaultStyles, newRecord, newCandidate, SCHEMA_VERSION } from '../js/core/model.js';

const now = new Date('2026-11-06T00:00:00Z');

function rec(studentId, area, patch = {}) {
  return { ...newRecord(studentId, area), ...patch };
}

test('makeBackup: 형식, API 키 없음', () => {
  const settings = { ...defaultSettings(now), apiKey: 'SECRET', geminiApiKey: 'SECRET2' };
  const b = makeBackup({
    students: [{ studentId: '30501', name: '김가온' }],
    classes: [{ id: 'c_1', name: '3학년 5반', kind: 'homeroom', studentIds: ['30501'] }],
    records: [rec('30501', 'autonomy', { memo: '메모' })],
    settings,
    now,
  });
  assert.equal(b.kind, 'sgb-v2-backup');
  assert.equal(b.schemaVersion, SCHEMA_VERSION);
  assert.equal(b.app, 'textgenerator-v2');
  assert.equal(b.exportedAt, '2026-11-06T00:00:00.000Z');
  assert.ok(!('apiKey' in b.settings) && !('geminiApiKey' in b.settings));
  assert.ok(!JSON.stringify(b).includes('SECRET'));
  assert.equal(settings.apiKey, 'SECRET', '원래 설정은 바꾸지 않음');
  assert.equal(b.records.length, 1);
});

test('validateBackup: 맞는 파일과 문자열', () => {
  const b = makeBackup({ students: [], classes: [], records: [], settings: defaultSettings(now), now });
  const r1 = validateBackup(b);
  assert.equal(r1.ok, true);
  assert.equal(r1.error, null);
  assert.equal(r1.backup.kind, 'sgb-v2-backup');
  const r2 = validateBackup(JSON.stringify({ ...b, settings: { ...b.settings, apiKey: 'X' } }));
  assert.equal(r2.ok, true);
  assert.ok(!('apiKey' in r2.backup.settings), '들어오는 키도 버림');
});

test('validateBackup: 형식 오류', () => {
  const good = makeBackup({ students: [], classes: [], records: [], settings: {}, now });
  const cases = [
    ['{깨짐', /JSON/],
    [null, /형식/],
    [[], /형식/],
    [{ ...good, kind: 'other' }, /백업 파일이 아닙니다/],
    [{ ...good, schemaVersion: undefined }, /버전/],
    [{ ...good, schemaVersion: SCHEMA_VERSION + 1 }, /새 버전/],
    [{ ...good, records: 'x' }, /records/],
    [{ ...good, students: [{ studentId: '3051', name: 'x' }] }, /학번/],
    [{ ...good, records: [{ id: 'a', studentId: '30501', area: 'unknown' }] }, /영역/],
    [{ ...good, classes: [{ name: 'x' }] }, /id/],
  ];
  for (const [input, re] of cases) {
    const r = validateBackup(input);
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.match(r.error, re);
    assert.equal(r.backup, null);
  }
});

function sample() {
  const current = {
    students: [{ studentId: '30501', name: '김가온' }, { studentId: '30502', name: '이도윤' }],
    classes: [{ id: 'c_1', name: '3학년 5반', kind: 'homeroom', studentIds: ['30501', '30502'] }],
    records: [
      rec('30501', 'autonomy', { memo: '지금 메모', final: '지금 최종', status: 'done' }),
      rec('30502', 'autonomy', { memo: '지금 메모', status: 'memo' }),
      rec('30502', 'career', { memo: '같음', status: 'memo' }),
      rec('30501', 'club', { memo: '현재에만 있음', status: 'memo' }),
    ],
    settings: { ...defaultSettings(now), keyStorage: 'session', batchIntervalSec: 5 },
  };
  const incoming = {
    students: [{ studentId: '30502', name: '이도윤(수정)' }, { studentId: '30503', name: '박하늘' }],
    classes: [{ id: 'c_1', name: '3-5 담임', kind: 'homeroom', studentIds: ['30501', '30502', '30503'] }, { id: 'c_2', name: '동아리', kind: 'club', studentIds: ['30503'] }],
    records: [
      rec('30501', 'autonomy', { memo: '들어온 메모', final: '들어온 최종', status: 'draft' }),
      rec('30502', 'autonomy', { memo: '들어온 메모', status: 'memo' }),
      rec('30502', 'career', { memo: '같음', status: 'memo' }),
      rec('30503', 'autonomy', { memo: '새 학생', status: 'memo' }),
    ],
    settings: { ...defaultSettings(now), keyStorage: 'local', batchIntervalSec: 9 },
  };
  incoming.records[2].updatedAt = current.records[2].updatedAt;
  return { current, incoming };
}

test('previewImport: 통계', () => {
  const { current, incoming } = sample();
  assert.deepEqual(previewImport(current, incoming), {
    students: 2,
    classes: 2,
    records: 4,
    doneKept: 1,
    newStudents: 1,
    overwritten: 1,
  });
});

test('mergeBackup: done 기록 보존, 들어온 것 우선, 키 보관 방식 유지', () => {
  const { current, incoming } = sample();
  const m = mergeBackup(current, incoming);
  const byId = Object.fromEntries(m.records.map((r) => [r.id, r]));
  assert.equal(byId['30501|autonomy'].final, '지금 최종', 'done 은 그대로');
  assert.equal(byId['30501|autonomy'].status, 'done');
  assert.equal(byId['30502|autonomy'].memo, '들어온 메모');
  assert.equal(byId['30501|club'].memo, '현재에만 있음', '현재에만 있는 기록은 남김');
  assert.equal(byId['30503|autonomy'].memo, '새 학생');
  assert.equal(m.records.length, 5);
  assert.deepEqual(m.students.map((s) => s.studentId).sort(), ['30501', '30502', '30503']);
  assert.equal(m.students.find((s) => s.studentId === '30502').name, '이도윤(수정)');
  assert.equal(m.classes.length, 2);
  assert.equal(m.classes.find((c) => c.id === 'c_1').name, '3-5 담임');
  assert.equal(m.settings.batchIntervalSec, 9);
  assert.equal(m.settings.keyStorage, 'session');
  assert.ok(!('apiKey' in m.settings));
});

test('devFakeAI: 백업에 넣지 않고, 가져올 때 무시하고 현재 값 유지', () => {
  const dev = { ...defaultSettings(now), devFakeAI: true };
  const b = makeBackup({ students: [], classes: [], records: [], settings: dev, now });
  assert.ok(!('devFakeAI' in b.settings), 'makeBackup 에서 뺌');

  const v = validateBackup({ ...b, settings: { ...b.settings, devFakeAI: true } });
  assert.equal(v.ok, true);
  assert.ok(!('devFakeAI' in v.backup.settings), 'validateBackup 이 들어온 값을 버림');

  const incoming = { students: [], classes: [], records: [], settings: { ...dev, batchIntervalSec: 7 } };
  const school = { students: [], classes: [], records: [], settings: { ...defaultSettings(now), devFakeAI: false } };
  const m1 = mergeBackup(school, incoming);
  assert.equal(m1.settings.devFakeAI, false, '학교 PC 는 꺼진 채');
  assert.equal(m1.settings.batchIntervalSec, 7);

  const devPc = { students: [], classes: [], records: [], settings: { ...defaultSettings(now), devFakeAI: true } };
  assert.equal(mergeBackup(devPc, { ...incoming, settings: { ...incoming.settings, devFakeAI: false } }).settings.devFakeAI, true, '현재 값 유지');
  assert.equal(mergeBackup(devPc, { ...incoming, settings: undefined }).settings.devFakeAI, true);
  assert.equal(mergeBackup({}, incoming).settings.devFakeAI, false, '현재 설정이 없으면 꺼짐');
});

test('makeBackup: styles 포함, 기기별 설정·secrets·deleted 없음', () => {
  const styles = { updatedAt: 't1', areas: { common: { examples: [], rules: '짧게', aiRules: '', updatedAt: 't1' } } };
  const b = makeBackup({ students: [], classes: [], records: [], settings: { ...defaultSettings(now), publicPC: true, keyStorage: 'session' }, styles, now });
  assert.deepEqual(b.styles, styles);
  assert.notEqual(b.styles, styles, '복사본');
  for (const k of ['publicPC', 'keyStorage', 'devFakeAI']) assert.ok(!(k in b.settings), k);
  assert.ok(!('secrets' in b) && !('deleted' in b));
  assert.deepEqual(makeBackup({ now }).styles, defaultStyles());
});

test('validateBackup: v1 백업을 v2로, secrets와 deleted는 버림', () => {
  const v1 = {
    kind: 'sgb-v2-backup', schemaVersion: 1, exportedAt: now.toISOString(), app: 'textgenerator-v2',
    students: [], classes: [], records: [rec('30501', 'autonomy', { candidates: ['초안'] })], settings: {},
    secrets: { geminiKey: 'AIzaSECRET', updatedAt: 'x' }, deleted: [{ store: 'records', id: 'a', deletedAt: 'x' }],
  };
  const r = validateBackup(v1);
  assert.equal(r.ok, true);
  assert.equal(r.backup.schemaVersion, 2);
  assert.deepEqual(r.backup.records[0].candidates, [newCandidate('초안')]);
  assert.deepEqual(r.backup.styles, defaultStyles());
  assert.ok(!('secrets' in r.backup) && !('deleted' in r.backup));
  assert.ok(!JSON.stringify(r.backup).includes('AIzaSECRET'));
});

test('mergeBackup: styles 영역별 들어온 것 우선, 기기별 설정은 현재 값', () => {
  const cur = { students: [], classes: [], records: [], settings: { ...defaultSettings(now), publicPC: true, keyStorage: 'session' },
    styles: { updatedAt: 't2', areas: { common: { examples: [], rules: '현재 공통', aiRules: '', updatedAt: 't2' }, career: { examples: [], rules: '현재 진로', aiRules: '', updatedAt: 't1' } } } };
  const inc = { students: [], classes: [], records: [], settings: { ...defaultSettings(now), publicPC: false },
    styles: { updatedAt: 't0', areas: { career: { examples: [], rules: '들어온 진로', aiRules: '', updatedAt: 't0' } } } };
  const m = mergeBackup(cur, inc);
  assert.equal(m.styles.areas.common.rules, '현재 공통');
  assert.equal(m.styles.areas.career.rules, '들어온 진로');
  assert.equal(m.styles.updatedAt, 't2');
  assert.equal(m.settings.publicPC, true);
  assert.equal(m.settings.keyStorage, 'session');
  assert.equal(mergeBackup(cur, { ...inc, styles: undefined }).styles.areas.career.rules, '현재 진로');
});

test('excelRows: 머리글, 반 이름 합침, 학번 순', () => {
  const classes = [
    { id: 'c_1', name: '3-5 담임', kind: 'homeroom', studentIds: ['30502', '30501'], createdAt: '1' },
    { id: 'c_2', name: '로봇반', kind: 'club', studentIds: ['30501'], createdAt: '2' },
    { id: 'c_3', name: '과학', kind: 'subject', subject: '통합과학', studentIds: ['30501'], createdAt: '3' },
  ];
  const students = [{ studentId: '30501', name: '김가온' }, { studentId: '30502', name: '이도윤' }];
  const records = [rec('30501', 'club', { final: '가나', status: 'done' })];
  const rows = excelRows({ classes, students, records, area: 'club' });
  assert.deepEqual(rows[0], ['학번', '이름', '반', '과목', '최종본', '바이트', '상태']);
  assert.deepEqual(rows[1], ['30501', '김가온', '3-5 담임, 로봇반', '', '가나', 6, '완료']);
  assert.deepEqual(rows[2], ['30502', '이도윤', '3-5 담임', '', '', 0, '미작성']);
  const sub = excelRows({ classes, students, records: [{ ...newRecord('30501', 'subject', '통합과학'), final: 'A' }], area: 'subject' });
  assert.deepEqual(sub[1], ['30501', '김가온', '과학', '통합과학', 'A', 1, '미작성']);
});
