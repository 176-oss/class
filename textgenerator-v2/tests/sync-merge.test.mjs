import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA_KIND, emptyData, checkDataFile, toDriveFile, withoutSecrets, mergeData, sameData, prepareReplace, summarize, hasData,
} from '../js/core/sync-merge.js';
import { defaultSettings, newRecord, SCHEMA_VERSION } from '../js/core/model.js';

const T1 = '2026-11-01T00:00:00.000Z';
const T2 = '2026-11-02T00:00:00.000Z';
const T3 = '2026-11-03T00:00:00.000Z';
const NOW = new Date('2026-11-07T00:00:00Z');

const rec = (sid, area, patch = {}) => ({ ...newRecord(sid, area), updatedAt: T1, ...patch });
const data = (patch = {}) => ({ ...emptyData(), ...patch });

test('mergeData: 늦은 쪽 우선, 같은 시각이면 원격, 한쪽만 있으면 그것', () => {
  const local = data({
    students: [{ studentId: '30501', name: '로컬', updatedAt: T2 }, { studentId: '30502', name: '로컬만', updatedAt: T1 }],
    records: [rec('30501', 'autonomy', { memo: '로컬', updatedAt: T1 }), rec('30501', 'career', { memo: '로컬', updatedAt: T2 })],
  });
  const remote = data({
    students: [{ studentId: '30501', name: '원격', updatedAt: T1 }, { studentId: '30503', name: '원격만', updatedAt: T1 }],
    records: [rec('30501', 'autonomy', { memo: '원격', updatedAt: T1 }), rec('30501', 'career', { memo: '원격', updatedAt: T1 })],
  });
  const { data: m } = mergeData(local, remote, { now: NOW });
  const st = Object.fromEntries(m.students.map((s) => [s.studentId, s.name]));
  assert.deepEqual(st, { 30501: '로컬', 30502: '로컬만', 30503: '원격만' });
  const r = Object.fromEntries(m.records.map((x) => [x.id, x.memo]));
  assert.equal(r['30501|autonomy'], '원격', '같은 시각이면 원격');
  assert.equal(r['30501|career'], '로컬');
});

test('mergeData: remote가 null이면 local 그대로, 바뀐 수 0', () => {
  const local = data({ students: [{ studentId: '30501', name: 'a', updatedAt: T1 }] });
  const { data: m, changes } = mergeData(local, null);
  assert.deepEqual(m.students, local.students);
  assert.equal(changes.added + changes.updated + changes.removed, 0);
});

test('mergeData: 삭제 vs 수정, 지운 항목이 되살아나지 않음', () => {
  const local = data({
    classes: [{ id: 'c_1', name: '옛 반', updatedAt: T1 }, { id: 'c_2', name: '지운 뒤 고침', updatedAt: T3 }],
    deleted: [],
  });
  const remote = data({
    classes: [],
    deleted: [{ store: 'classes', id: 'c_1', deletedAt: T2 }, { store: 'classes', id: 'c_2', deletedAt: T2 }],
  });
  const { data: m, changes } = mergeData(local, remote, { now: NOW });
  assert.deepEqual(m.classes.map((c) => c.id), ['c_2'], '삭제보다 늦게 고친 것은 살고, 이른 것은 지워짐');
  assert.deepEqual(m.deleted.map((d) => d.id), ['c_1']);
  assert.equal(changes.removed, 1);
  assert.equal(changes.byStore.classes.removed, 1);
  // 다시 합쳐도 되살아나지 않음 (다른 기기가 옛 것을 들고 있어도)
  const again = mergeData(m, data({ classes: [{ id: 'c_1', name: '옛 반', updatedAt: T1 }] }), { now: NOW }).data;
  assert.ok(!again.classes.some((c) => c.id === 'c_1'));
});

test('mergeData: 같은 삭제 기록은 늦은 것 하나, 90일 지난 것은 정리', () => {
  const local = data({ deleted: [{ store: 'records', id: 'a', deletedAt: T1 }, { store: 'records', id: 'old', deletedAt: '2026-07-01T00:00:00Z' }] });
  const remote = data({ deleted: [{ store: 'records', id: 'a', deletedAt: T2 }] });
  const { data: m } = mergeData(local, remote, { now: NOW });
  assert.deepEqual(m.deleted, [{ store: 'records', id: 'a', deletedAt: T2 }]);
});

test('mergeData: neis는 본문과 따로 doneAt이 늦은 쪽', () => {
  const neisOld = { hash: 'aaaaaaaaaaaaaaaa', doneAt: T1 };
  const neisNew = { hash: 'bbbbbbbbbbbbbbbb', doneAt: T2 };
  // 본문은 로컬이 이기지만 neis는 원격(확장이 씀)이 늦음
  const local = data({ records: [rec('30501', 'autonomy', { final: '새 글', updatedAt: T3, neis: null })] });
  const remote = data({ records: [rec('30501', 'autonomy', { final: '옛 글', updatedAt: T1, neis: neisNew })] });
  const m = mergeData(local, remote, { now: NOW }).data.records[0];
  assert.equal(m.final, '새 글');
  assert.deepEqual(m.neis, neisNew);
  // 본문은 원격이 이기지만 neis는 로컬이 늦음
  const m2 = mergeData(
    data({ records: [rec('30501', 'autonomy', { updatedAt: T1, neis: neisNew })] }),
    data({ records: [rec('30501', 'autonomy', { memo: '원격', updatedAt: T2, neis: neisOld })] }),
    { now: NOW },
  ).data.records[0];
  assert.equal(m2.memo, '원격');
  assert.deepEqual(m2.neis, neisNew);
});

test('mergeData: 설정은 updatedAt이 늦은 쪽, 기기별 값은 언제나 로컬', () => {
  const ls = { ...defaultSettings(NOW), batchIntervalSec: 5, keyStorage: 'session', devFakeAI: true, publicPC: true, updatedAt: T1 };
  const rs = { ...defaultSettings(NOW), batchIntervalSec: 9, keyStorage: 'local', devFakeAI: false, publicPC: false, updatedAt: T2 };
  const m = mergeData(data({ settings: ls }), data({ settings: rs }), { now: NOW }).data.settings;
  assert.equal(m.batchIntervalSec, 9);
  assert.equal(m.keyStorage, 'session');
  assert.equal(m.devFakeAI, true);
  assert.equal(m.publicPC, true);
  const m2 = mergeData(data({ settings: { ...ls, updatedAt: T3 } }), data({ settings: rs }), { now: NOW }).data.settings;
  assert.equal(m2.batchIntervalSec, 5);
  const m3 = mergeData(data({ settings: { ...ls, updatedAt: null } }), data({ settings: { ...rs, updatedAt: null } }), { now: NOW }).data.settings;
  assert.equal(m3.batchIntervalSec, 5, '둘 다 null이면 로컬');
  const m4 = mergeData(data({ settings: { ...ls, updatedAt: null } }), data({ settings: rs }), { now: NOW }).data.settings;
  assert.equal(m4.batchIntervalSec, 9);
  assert.equal(m4.keyStorage, 'session');
});

test('mergeData: styles 영역별, secrets 늦은 쪽', () => {
  const local = data({
    styles: { updatedAt: T3, areas: { common: { examples: [], rules: '로컬 공통', aiRules: '', updatedAt: T3 }, career: { examples: [], rules: '로컬 진로', aiRules: '', updatedAt: T1 } } },
    secrets: { geminiKey: 'LOCALKEY', updatedAt: T1 },
  });
  const remote = data({
    styles: { updatedAt: T2, areas: { common: { examples: [], rules: '원격 공통', aiRules: '', updatedAt: T1 }, career: { examples: [], rules: '원격 진로', aiRules: '', updatedAt: T2 }, club: { examples: [], rules: '원격 동아리', aiRules: '', updatedAt: T1 } } },
    secrets: { geminiKey: '', updatedAt: T2 },
  });
  const m = mergeData(local, remote, { now: NOW }).data;
  assert.equal(m.styles.areas.common.rules, '로컬 공통');
  assert.equal(m.styles.areas.career.rules, '원격 진로');
  assert.equal(m.styles.areas.club.rules, '원격 동아리');
  assert.equal(m.styles.updatedAt, T3);
  assert.deepEqual(m.secrets, { geminiKey: '', updatedAt: T2 }, '끈 기록이 이김');
  assert.deepEqual(mergeData(data({ secrets: null }), data({ secrets: { geminiKey: 'K', updatedAt: T1 } })).data.secrets, { geminiKey: 'K', updatedAt: T1 });
  assert.deepEqual(mergeData(data({ secrets: { geminiKey: 'K', updatedAt: T1 } }), data({ secrets: null })).data.secrets, { geminiKey: 'K', updatedAt: T1 });
  assert.equal(mergeData(data(), data()).data.secrets, null);
});

test('mergeData: 바뀐 수 (새로 들어옴, 고쳐짐, 지워짐)', () => {
  const local = data({
    students: [{ studentId: '30501', name: 'a', updatedAt: T1 }],
    records: [rec('30501', 'autonomy', { memo: 'a', updatedAt: T1 }), rec('30501', 'career', { updatedAt: T1 }), rec('30501', 'club', { updatedAt: T1 })],
  });
  const remote = data({
    students: [{ studentId: '30501', name: 'a', updatedAt: T1 }, { studentId: '30502', name: 'b', updatedAt: T1 }],
    records: [rec('30501', 'autonomy', { memo: 'b', updatedAt: T2 }), rec('30501', 'career', { updatedAt: T1, neis: { hash: 'x', doneAt: T2 } }), rec('30501', 'club', { updatedAt: T1 })],
    deleted: [{ store: 'records', id: '30501|club', deletedAt: T2 }],
  });
  const { changes } = mergeData(local, remote, { now: NOW });
  assert.equal(changes.added, 1);
  assert.equal(changes.updated, 2, 'neis만 바뀐 것도 셈');
  assert.equal(changes.removed, 1);
  assert.deepEqual(changes.byStore.students, { added: 1, updated: 0, removed: 0 });
  assert.deepEqual(changes.byStore.records, { added: 0, updated: 2, removed: 1 });
});

test('checkDataFile: 형식, 더 새 버전, 낮은 버전 migrate', () => {
  assert.equal(checkDataFile({ kind: 'other' }).ok, false);
  assert.equal(checkDataFile('{깨짐').ok, false);
  const newer = checkDataFile({ kind: DATA_KIND, schemaVersion: SCHEMA_VERSION + 1 });
  assert.equal(newer.ok, false);
  assert.equal(newer.newer, true);
  const v1 = checkDataFile({ kind: DATA_KIND, schemaVersion: 1, records: [rec('30501', 'autonomy', { candidates: ['가'] })] });
  assert.equal(v1.ok, true);
  assert.equal(v1.data.records[0].candidates[0].original, '가');
  assert.deepEqual(v1.data.students, []);
  assert.deepEqual(v1.data.deleted, []);
  assert.equal(v1.data.secrets, null);
});

test('toDriveFile, withoutSecrets: 머리 필드, 기기별 설정 뺌, 자동 백업에 키 없음', () => {
  const d = data({ settings: { ...defaultSettings(NOW), publicPC: true }, secrets: { geminiKey: 'AIzaSECRET', updatedAt: T1 } });
  const f = toDriveFile(d, NOW);
  assert.equal(f.kind, DATA_KIND);
  assert.equal(f.schemaVersion, SCHEMA_VERSION);
  assert.equal(f.updatedAt, NOW.toISOString());
  for (const k of ['keyStorage', 'devFakeAI', 'publicPC']) assert.ok(!(k in f.settings), k);
  assert.equal(f.secrets.geminiKey, 'AIzaSECRET');
  const b = withoutSecrets(f);
  assert.equal(b.secrets, null);
  assert.ok(!JSON.stringify(b).includes('AIzaSECRET'));
});

test('sameData: 머리 필드와 키 순서, 기기별 설정은 비교하지 않음', () => {
  const a = data({ students: [{ studentId: '30501', name: 'a', updatedAt: T1 }] });
  const b = toDriveFile({ ...a, students: [{ updatedAt: T1, name: 'a', studentId: '30501' }], settings: { ...a.settings, keyStorage: 'session' } }, NOW);
  assert.equal(sameData(a, b), true);
  assert.equal(sameData(a, { ...b, students: [] }), false);
});

test('prepareReplace: 바뀐 것만 updatedAt 올림, 없어진 것은 삭제 기록', () => {
  const current = data({
    students: [{ studentId: '30501', name: 'a', updatedAt: T1 }, { studentId: '30502', name: 'b', updatedAt: T1 }],
    records: [rec('30501', 'autonomy', { memo: '같음', updatedAt: T2 })],
    settings: { ...defaultSettings(NOW), batchIntervalSec: 5, keyStorage: 'session', updatedAt: T1 },
    styles: { updatedAt: T1, areas: { common: { examples: [], rules: 'r', aiRules: '', updatedAt: T1 } } },
    secrets: { geminiKey: 'K', updatedAt: T1 },
  });
  const next = {
    students: [{ studentId: '30501', name: 'a 바뀜', updatedAt: T1 }],
    classes: [],
    records: [rec('30501', 'autonomy', { memo: '같음', updatedAt: T1 })],
    settings: { ...defaultSettings(NOW), batchIntervalSec: 9, updatedAt: T1 },
    styles: { updatedAt: T1, areas: {} },
  };
  delete next.settings.keyStorage;
  const out = prepareReplace(current, next, NOW);
  const at = NOW.toISOString();
  assert.equal(out.students[0].updatedAt, at);
  assert.equal(out.records[0].updatedAt, T2, '내용이 같으면 그대로');
  assert.deepEqual(out.deleted, [{ store: 'students', id: '30502', deletedAt: at }]);
  assert.equal(out.settings.updatedAt, at);
  assert.equal(out.settings.keyStorage, 'session', '없는 기기별 값은 current 것');
  assert.equal(out.styles.areas.common.updatedAt, at, '없어진 영역은 빈 영역으로');
  assert.equal(out.styles.areas.common.rules, '');
  assert.deepEqual(out.secrets, current.secrets, 'next에 secrets가 없으면 current 것');
  // 결과를 드라이브(current)와 합치면 next 내용이 이김
  const m = mergeData(out, current, { now: NOW }).data;
  assert.deepEqual(m.students.map((s) => s.name), ['a 바뀜']);
  assert.equal(m.settings.batchIntervalSec, 9);
  assert.equal(m.styles.areas.common.rules, '');
});

test('summarize, hasData', () => {
  assert.equal(hasData(emptyData()), false);
  assert.equal(hasData(data({ records: [rec('30501', 'autonomy')] })), false, '빈 기록은 데이터가 아님');
  const d = data({
    students: [{ studentId: '30501', name: 'a', updatedAt: T1 }],
    records: [rec('30501', 'autonomy', { memo: 'm', updatedAt: T3 }), rec('30501', 'career')],
  });
  assert.equal(hasData(d), true);
  assert.deepEqual(summarize(d), { students: 1, records: 1, updatedAt: T3 });
});
