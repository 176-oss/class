import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { textHash, buildNeisBatch, applyNeisDone } from '../js/core/neis-export.js';
import { byteLength } from '../js/core/bytes.js';

test('textHash: SHA-256 앞 16자리, 결정적', async () => {
  const h = await textHash('학급 회의를 진행함.');
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(h, await textHash('학급 회의를 진행함.'));
  assert.equal(h, createHash('sha256').update('학급 회의를 진행함.', 'utf8').digest('hex').slice(0, 16));
  assert.notEqual(h, await textHash('학급 회의를 진행함'));
  assert.equal(await textHash(''), 'e3b0c44298fc1c14');
});

const students = [
  { studentId: '30503', name: '박하늘' },
  { studentId: '30501', name: '김가온' },
  { studentId: '11215', name: '이도윤' },
];
const records = [
  { id: '30503|autonomy', studentId: '30503', area: 'autonomy', subject: null, status: 'done', final: '학급 회의를 진행함.' },
  { id: '30503|club', studentId: '30503', area: 'club', subject: null, status: 'draft', final: '아직 초안임.' },
  { id: '30501|subject|통합과학', studentId: '30501', area: 'subject', subject: '통합과학', status: 'done', final: '실험을 설계함.' },
  { id: '30501|career', studentId: '30501', area: 'career', subject: null, status: 'done', final: '   ' },
  { id: '11215|behavior', studentId: '11215', area: 'behavior', subject: null, status: 'done', final: '성실함.' },
];

test('buildNeisBatch: done 이고 final 이 있는 것만, 학번 나누기, 과목', async () => {
  const now = new Date('2026-11-20T01:00:00Z');
  const batch = await buildNeisBatch({ records, students, settings: { schoolYear: 2026, semester: 2 }, now });
  assert.equal(batch.kind, 'sgb-neis-batch');
  assert.equal(batch.version, 1);
  assert.equal(batch.createdAt, '2026-11-20T01:00:00.000Z');
  assert.equal(batch.schoolYear, 2026);
  assert.equal(batch.semester, 2);
  assert.deepEqual(batch.items.map((i) => i.id), ['11215|behavior', '30501|subject|통합과학', '30503|autonomy']);
  const [beh, subj, auto] = batch.items;
  assert.deepEqual({ grade: beh.grade, classNo: beh.classNo, no: beh.no }, { grade: 1, classNo: 12, no: 15 });
  assert.deepEqual({ grade: auto.grade, classNo: auto.classNo, no: auto.no }, { grade: 3, classNo: 5, no: 3 });
  assert.equal(subj.subject, '통합과학');
  assert.equal(subj.area, 'subject');
  assert.equal(auto.subject, null);
  assert.equal(auto.name, '박하늘');
  assert.equal(auto.text, '학급 회의를 진행함.');
  assert.equal(auto.bytes, byteLength('학급 회의를 진행함.'));
  assert.equal(auto.hash, await textHash('학급 회의를 진행함.'));
  assert.deepEqual(Object.keys(auto).sort(), ['area', 'bytes', 'classNo', 'grade', 'hash', 'id', 'name', 'no', 'studentId', 'subject', 'text'].sort());
});

test('applyNeisDone: hash 가 지금 final 과 같을 때만', async () => {
  const h = await textHash('학급 회의를 진행함.');
  const { updated, ignored } = await applyNeisDone(records, [
    { id: '30503|autonomy', hash: h, savedAt: '2026-11-21T10:00:00+09:00' },
    { id: '30501|subject|통합과학', hash: await textHash('옛 글'), savedAt: '2026-11-21T10:00:00+09:00' },
    { id: 'none|x', hash: h, savedAt: '2026-11-21T10:00:00+09:00' },
    { id: '11215|behavior', hash: 'not-a-hash', savedAt: '2026-11-21T10:00:00+09:00' },
  ]);
  assert.equal(updated.length, 1);
  assert.equal(ignored, 3);
  assert.deepEqual(updated[0].neis, { hash: h, doneAt: '2026-11-21T10:00:00+09:00' });
  assert.equal(updated[0].final, '학급 회의를 진행함.');
  assert.equal(records[0].neis, undefined, '원래 배열은 바꾸지 않음');
});
