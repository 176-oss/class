// node tests/model.test.mjs
import assert from 'node:assert/strict';
import { normText, neisBytes, textHash, parseBatch, fromDriveData, applyNeisDone, itemsFor, groupSummary } from '../shared/sgb-model.js';

// 정리 규칙: 줄바꿈·끝 공백·NFC
assert.equal(normText('가나 \r\n다라\t\n'), '가나\n다라');
assert.equal(normText('가'), '가'); // 조합형 -> 완성형
assert.equal(await textHash('가나\r\n'), await textHash('가나\n'));
assert.equal((await textHash('a')).length, 16);

// 바이트: 한글 3, ASCII 1, 줄바꿈 2
assert.equal(neisBytes('가a'), 4);
assert.equal(neisBytes('가\n나'), 8);

const batch = {
  kind: 'sgb-neis-batch', version: 1, schoolYear: 2026, semester: 2,
  items: [
    { id: 'a', grade: 3, classNo: 5, no: 3, name: '박 다온', area: 'autonomy', text: '학급 회의를 진행함.' },
    { id: 'b', grade: 3, classNo: 5, no: 4, name: '최라온', area: 'autonomy', text: '봉사', bytes: 1, hash: 'fake' },
    { id: 'c', grade: 3, classNo: 5, no: 4, name: '최라온', area: 'autonomy', text: '두 번째 글' },
    { id: 'd', grade: 3, classNo: 5, no: 5, name: '정마루', area: 'subject', subject: '통합 과학', text: '실험' },
  ],
};
const d = await parseBatch(JSON.stringify(batch));
assert.equal(d.items.length, 4);
assert.equal(d.items[1].bytes, 6); // 받은 bytes 는 무시하고 다시 계산
assert.notEqual(d.items[1].hash, 'fake');

// 형식 오류는 거부
await assert.rejects(parseBatch('{'), /JSON/);
await assert.rejects(parseBatch({ ...batch, kind: 'x' }), /kind/);
await assert.rejects(parseBatch({ ...batch, items: [{ ...batch.items[0], area: 'zzz' }] }), /영역/);
await assert.rejects(parseBatch({ ...batch, items: [{ ...batch.items[0], text: '  ' }] }), /본문/);
await assert.rejects(parseBatch({ ...batch, items: [{ ...batch.items[3], subject: '' }] }), /과목/);

// 조건 맞추기 + 같은 학생 글 2개 표시 + 과목명 공백 무시
const auto = itemsFor(d.items, { grade: 3, classNo: 5, area: 'autonomy' });
assert.deepEqual(auto.map((x) => [x.id, x.dup]), [['a', false], ['b', true], ['c', true]]);
assert.equal(itemsFor(d.items, { grade: 3, classNo: 5, area: 'subject', subject: '통합과학' }).length, 1);
assert.equal(itemsFor(d.items, { grade: 3, classNo: 6, area: 'autonomy' }).length, 0);
assert.deepEqual(groupSummary(d.items), ['3학년 5반 자율·자치 3명', '3학년 5반 교과세특 (통합 과학) 1명']);

// 드라이브: '완료'만, 결과는 neis 필드만, 글이 바뀐 기록은 그대로
const drive = { records: [
  { id: 'a', status: '완료', grade: 3, classNo: 5, no: 3, name: '박다온', area: 'autonomy', text: '글 A' },
  { id: 'b', status: 'draft', grade: 3, classNo: 5, no: 4, name: '최라온', area: 'autonomy', text: '글 B' },
  { id: 'c', status: 'done', grade: 3, classNo: 5, no: 6, name: '강바다', area: 'club', text: '글 C' },
] };
const dd = await fromDriveData(drive);
assert.deepEqual(dd.items.map((x) => x.id), ['a', 'c']);
const n = await applyNeisDone(drive, [{ id: 'a', hash: await textHash('글 A'), at: 1 }, { id: 'c', hash: await textHash('옛 글'), at: 1 }]);
assert.equal(n, 1);
assert.deepEqual(drive.records[0].neis, { done: true, doneAt: 1, hash: await textHash('글 A') });
assert.equal(drive.records[2].neis, undefined);

console.log('model tests ok');
