// node tests/model.test.mjs
import assert from 'node:assert/strict';
import { condLabel, normText, neisBytes, textHash, splitStudentId, parseBatch, fromDriveData, applyNeisDone, itemsFor, limitFor, groupSummary } from '../shared/sgb-model.js';
import { textHash as webHash, buildNeisBatch } from '../../textgenerator-v2/js/core/neis-export.js';
import { byteLength as webBytes } from '../../textgenerator-v2/js/core/bytes.js';

// 나이스 비교용 정리 규칙: 줄바꿈·끝 공백·NFC
assert.equal(normText('가나 \r\n다라\t\n'), '가나\n다라');
assert.equal(normText('가'), '가');

// 해시·바이트는 웹앱과 똑같아야 한다 (원문 그대로)
for (const t of ['가나\r\n다 ', 'abc', '이모지😀 포함\n줄바꿈', '가']) {
  assert.equal(await textHash(t), await webHash(t), `hash: ${t}`);
  assert.equal(neisBytes(t), webBytes(t), `bytes: ${t}`);
}
assert.notEqual(await textHash('가나\r\n'), await textHash('가나\n'));
assert.equal(neisBytes('가a\n'), 5);
assert.deepEqual(splitStudentId('30503'), { grade: 3, classNo: 5, no: 3 });

const batch = {
  kind: 'sgb-neis-batch', version: 1, schoolYear: 2026, semester: 2,
  items: [
    { id: '30503|autonomy', grade: 3, classNo: 5, no: 3, name: '박 다온', area: 'autonomy', text: '학급 회의를 진행함. ' },
    { id: 'b', grade: 3, classNo: 5, no: 4, name: '최라온', area: 'autonomy', text: '봉사', bytes: 1, hash: 'fake' },
    { id: 'c', grade: 3, classNo: 5, no: 4, name: '최라온', area: 'autonomy', text: '두 번째 글' },
    { id: 'd', grade: 3, classNo: 5, no: 5, name: '정마루', area: 'subject', subject: '통합 과학', text: '실험' },
  ],
};
const d = await parseBatch(JSON.stringify(batch));
assert.equal(d.items.length, 4);
assert.equal(d.items[0].text, '학급 회의를 진행함. '); // 본문은 원문 그대로
assert.equal(d.items[1].bytes, 6); // 받은 bytes·hash 는 무시하고 다시 계산
assert.equal(d.items[1].hash, await webHash('봉사'));

// 형식 오류는 거부
await assert.rejects(parseBatch('{'), /JSON/);
await assert.rejects(parseBatch({ ...batch, kind: 'x' }), /kind/);
await assert.rejects(parseBatch({ ...batch, items: [{ ...batch.items[0], area: 'zzz' }] }), /영역/);
await assert.rejects(parseBatch({ ...batch, items: [{ ...batch.items[0], text: '  ' }] }), /본문/);
await assert.rejects(parseBatch({ ...batch, items: [{ ...batch.items[3], subject: '' }] }), /과목/);

// 조건 맞추기 + 같은 학생 글 2개 표시 + 과목명 공백 무시
const auto = itemsFor(d.items, { grade: 3, classNo: 5, area: 'autonomy' });
assert.deepEqual(auto.map((x) => [x.id, x.dup]), [['30503|autonomy', false], ['b', true], ['c', true]]);
assert.equal(itemsFor(d.items, { grade: 3, classNo: 5, area: 'subject', subject: '통합과학' }).length, 1);
assert.equal(itemsFor(d.items, { grade: 3, classNo: 6, area: 'autonomy' }).length, 0);

// 동아리·교과세특 화면은 학년·반이 섞여 있어 조건에 반이 없다 (null 이면 거르지 않음)
const mixed = [
  { id: 'm1', grade: 3, classNo: 1, no: 3, name: 'ㄱ', area: 'club', text: 'a' },
  { id: 'm2', grade: 3, classNo: 5, no: 3, name: 'ㄴ', area: 'club', text: 'b' },   // 번호는 같지만 반이 다름: 중복이 아님
  { id: 'm3', grade: 2, classNo: 5, no: 1, name: 'ㄷ', area: 'club', text: 'c' },
  { id: 'm4', grade: 3, classNo: 8, no: 1, name: 'ㄹ', area: 'subject', subject: '과학', text: 'd' },
];
const club = itemsFor(mixed, { grade: null, classNo: null, area: 'club' });
assert.equal(club.length, 3);
assert.ok(club.every((it) => !it.dup), '반이 다르면 같은 번호여도 중복 아님');
assert.deepEqual(club.map((it) => it.id), ['m3', 'm1', 'm2'], '학년, 반, 번호 순');
assert.equal(itemsFor(mixed, { grade: 3, classNo: null, area: 'club' }).length, 2);
assert.equal(itemsFor(mixed, { grade: 3, classNo: null, area: 'subject', subject: '과학' }).length, 1);
assert.equal(condLabel({ grade: null, classNo: null, area: 'club' }), '동아리');
assert.equal(condLabel({ grade: 3, classNo: null, area: 'subject', subject: '과학' }), '3학년 교과세특 (과학)');

assert.deepEqual(groupSummary(d.items), ['3학년 5반 자율·자치 3명', '3학년 5반 교과세특 (통합 과학) 1명']);

// 웹앱이 만든 batch 를 그대로 읽으면 hash 가 같다
const students = [{ studentId: '30503', name: '박다온' }, { studentId: '30506', name: '강바다' }, { studentId: '30507', name: '조사랑' }];
const records = [
  { id: '30503|autonomy', studentId: '30503', area: 'autonomy', subject: null, status: 'done', final: '글 A\r\n둘째 줄 ', neis: null, updatedAt: 'T1' },
  { id: '30503|career', studentId: '30503', area: 'career', subject: null, status: 'draft', final: '글 B', neis: null, updatedAt: 'T1' },
  { id: '30506|club', studentId: '30506', area: 'club', subject: null, status: 'done', final: '글 C', neis: null, updatedAt: 'T1' },
  { id: '30599|club', studentId: '30599', area: 'club', subject: null, status: 'done', final: '이름 없는 학생', neis: null, updatedAt: 'T1' },
  { id: '30507|behavior', studentId: '30507', area: 'behavior', subject: null, status: 'done', final: '글 D', updatedAt: 'T1' },
];
const settings = { schoolYear: 2026, semester: 2, limits: { autonomy: 1500, career: 1500, behavior: 900, club: 1500, subject: 1500 } };
const webBatch = await buildNeisBatch({ records, students: students.slice(0, 2), settings });
const fromWeb = await parseBatch(webBatch);
assert.deepEqual(fromWeb.items.map((x) => x.hash), webBatch.items.filter((x) => x.name).map((x) => x.hash));
assert.equal(fromWeb.skipped, 2); // 30599, 30507: 명단에 이름 없음

// 드라이브 파일: kind·schemaVersion 확인, done + final 만, 이름 없는 학생은 건너뜀, 이미 입력된 표시 읽기
const file = { kind: 'sgb-v2-data', schemaVersion: 2, updatedAt: 'U', students, classes: [], records, settings, deleted: [], secrets: { geminiKey: 'k' } };
records[4].neis = { hash: await webHash('글 D'), doneAt: '2026-11-01T00:00:00.000Z' };
const dd = await fromDriveData(file);
assert.deepEqual(dd.items.map((x) => x.id), ['30503|autonomy', '30506|club', '30507|behavior']);
assert.equal(dd.skipped, 1);
assert.equal(dd.items[0].no, 3);
assert.equal(dd.items[2].neisHash, dd.items[2].hash);
assert.equal(limitFor(dd, 'behavior'), 900);
assert.equal(limitFor(null, 'behavior'), 900);
await assert.rejects(fromDriveData({ ...file, kind: 'sgb-backup' }), /형식/);
await assert.rejects(fromDriveData({ ...file, schemaVersion: 3 }), /더 새 버전/);

// 입력 완료 반영: neis 만 { hash, doneAt }, 다른 필드와 updatedAt 은 그대로, 글이 바뀐 기록·이미 같은 표시는 건드리지 않음
const before = JSON.parse(JSON.stringify(file));
const at = '2026-11-07T10:00:00.000Z';
const n = await applyNeisDone(file, [
  { id: '30503|autonomy', hash: await webHash('글 A\r\n둘째 줄 '), doneAt: at },
  { id: '30506|club', hash: await webHash('옛 글'), doneAt: at },
  { id: '30507|behavior', hash: await webHash('글 D'), doneAt: at },
]);
assert.equal(n, 1);
assert.deepEqual(file.records[0].neis, { hash: await webHash('글 A\r\n둘째 줄 '), doneAt: at });
before.records[0].neis = file.records[0].neis;
assert.deepEqual(file, before); // 그 밖에는 아무것도 바뀌지 않음 (secrets, updatedAt 포함)
await assert.rejects(applyNeisDone({ ...file, schemaVersion: 3 }, []), /더 새 버전/);

console.log('model tests ok');
