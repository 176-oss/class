import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AREAS, AREAS_BY_KIND, TRAITS_BY_AREA, DEFAULT_LIMITS, SCHEMA_VERSION,
  defaultSettings, recordKey, newRecord, deriveStatus, splitStudentId, migrate,
  DEVICE_SETTING_KEYS, defaultStyles, newCandidate, normalizeCandidates,
} from '../js/core/model.js';
import { DEFAULT_FORBIDDEN } from '../js/core/forbidden.js';

test('model: 영역, 칩, 한도', () => {
  assert.deepEqual(AREAS_BY_KIND.homeroom, ['autonomy', 'career', 'behavior', 'club']);
  for (const a of AREAS) {
    assert.ok(TRAITS_BY_AREA[a].length >= 8 && TRAITS_BY_AREA[a].length <= 10, a);
    assert.equal(DEFAULT_LIMITS.high[a], a === 'behavior' ? 900 : 1500);
    assert.equal(DEFAULT_LIMITS.middle[a], a === 'behavior' ? 900 : 1500);
  }
});

test('model: defaultSettings 는 금지 표현을 복사하고 키를 담지 않음', () => {
  const s = defaultSettings(new Date('2026-11-06T09:00:00+09:00'));
  assert.equal(s.schoolYear, 2026);
  assert.equal(s.semester, 2);
  assert.equal(defaultSettings(new Date('2027-02-10T09:00:00+09:00')).schoolYear, 2026);
  assert.equal(defaultSettings(new Date('2027-04-01T09:00:00+09:00')).semester, 1);
  assert.equal(s.limits.behavior, 900);
  assert.equal(s.forbidden.length, DEFAULT_FORBIDDEN.length);
  assert.notEqual(s.forbidden[0], DEFAULT_FORBIDDEN[0]);
  s.forbidden[0].areas.push('subject');
  assert.deepEqual(DEFAULT_FORBIDDEN[0].areas, []);
  assert.ok(!('apiKey' in s));
  assert.equal(s.batchIntervalSec, 5);
  assert.equal(s.devFakeAI, false);
});

test('model: recordKey, newRecord, splitStudentId', () => {
  assert.equal(recordKey('30503', 'autonomy'), '30503|autonomy');
  assert.equal(recordKey('30503', 'subject', '통합과학'), '30503|subject|통합과학');
  const r = newRecord('30503', 'subject', '통합과학');
  assert.equal(r.id, '30503|subject|통합과학');
  assert.equal(r.status, 'empty');
  assert.equal(r.length, 'standard');
  assert.equal(newRecord('30503', 'club', '무시').subject, null);
  assert.deepEqual(splitStudentId('30503'), { grade: 3, classNo: 5, no: 3 });
  assert.deepEqual(splitStudentId('11215'), { grade: 1, classNo: 12, no: 15 });
});

test('model: deriveStatus', () => {
  assert.equal(deriveStatus({ memo: '', draft: '', final: '' }), 'empty');
  assert.equal(deriveStatus({ memo: '메모', draft: '', final: '' }), 'memo');
  assert.equal(deriveStatus({ memo: '', draft: '초안', final: '' }), 'draft');
  assert.equal(deriveStatus({ memo: '', draft: '', final: '최종' }), 'draft');
  assert.equal(deriveStatus({ memo: '', draft: '', final: '', status: 'done' }), 'done');
  assert.equal(deriveStatus({ memo: '  ', draft: '\n', final: '' }), 'empty');
});

test('model: migrate 는 현재 버전이면 그대로', () => {
  const d = { kind: 'x', schemaVersion: SCHEMA_VERSION, a: 1 };
  assert.deepEqual(migrate(d, SCHEMA_VERSION), d);
});

test('model: 스키마 2, 기기별 설정, defaultSettings 새 칸', () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.deepEqual(DEVICE_SETTING_KEYS, ['keyStorage', 'devFakeAI', 'publicPC']);
  const s = defaultSettings();
  assert.equal(s.publicPC, false);
  assert.equal(s.updatedAt, null);
  assert.deepEqual(defaultStyles(), { updatedAt: null, areas: {} });
});

test('model: newCandidate, normalizeCandidates', () => {
  assert.deepEqual(newCandidate('가'), { original: '가', text: '가', versions: [], edited: false });
  const list = normalizeCandidates(['하나', { original: '둘', text: '둘 고침', versions: ['a', 'b', 'c', 'd'] }, null, { text: '셋' }, '넷']);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], newCandidate('하나'));
  assert.equal(list[1].edited, true);
  assert.deepEqual(list[1].versions, ['b', 'c', 'd']);
  assert.deepEqual(list[2], { original: '셋', text: '셋', versions: [], edited: false });
  assert.deepEqual(normalizeCandidates(undefined), []);
});

test('model: migrate v1 -> v2 (후보, 설정, 스타일, 삭제 기록)', () => {
  const v1 = {
    kind: 'sgb-v2-backup', schemaVersion: 1,
    records: [{ ...newRecord('30501', 'autonomy'), candidates: ['가', '나'] }],
    settings: { schoolLevel: 'high' },
  };
  const m = migrate(v1, 1);
  assert.equal(m.schemaVersion, 2);
  assert.deepEqual(m.records[0].candidates, [newCandidate('가'), newCandidate('나')]);
  assert.equal(m.settings.updatedAt, null);
  assert.equal(m.settings.publicPC, false);
  assert.deepEqual(m.styles, defaultStyles());
  assert.ok(!('deleted' in m), '백업에는 deleted를 만들지 않음');
  assert.deepEqual(v1.records[0].candidates, ['가', '나'], '원본은 그대로');
  const drive = migrate({ kind: 'sgb-v2-data', schemaVersion: 1, records: [], secrets: { geminiKey: 'k', updatedAt: 'x' } }, 1);
  assert.deepEqual(drive.deleted, []);
  assert.deepEqual(drive.secrets, { geminiKey: 'k', updatedAt: 'x' }, 'secrets는 건드리지 않음');
  const idb = migrate({ students: [], classes: [], records: [], settings: null }, 1);
  assert.equal(idb.settings, null);
  assert.ok(!('schemaVersion' in idb));
});
