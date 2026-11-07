import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../js/sync.js';
import { createFakeDrive } from '../js/core/fake-drive.js';
import { DATA_FILE_NAME } from '../js/core/drive-common.js';
import { emptyData } from '../js/core/sync-merge.js';
import { newRecord } from '../js/core/model.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

/** 메모리 LocalPort (store.syncLocal 대신). mutate는 사용자 변경 + syncPending */
function memLocal(initial = emptyData()) {
  let data = clone(initial);
  let state = {};
  let pending = false;
  const snapshots = {};
  return {
    async read() { return clone(data); },
    async apply(d) { data = clone(d); },
    async readState() { return { ...state, pending }; },
    async writeState(p) { state = { ...state, ...p }; },
    async setPending(b) { pending = b; },
    async snapshot(id, d) { snapshots[id] = clone(d); },
    async wipe() { data = emptyData(); state = {}; pending = false; },
    get data() { return data; },
    get pending() { return pending; },
    snapshots,
    mutate(fn) { fn(data); pending = true; },
  };
}

function clock(start = '2026-11-07T09:00:00Z') {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), tick(ms = 1000) { t += ms; } };
}

// 타이머는 직접 부르는 목록으로 (결정성)
function timers() {
  const list = [];
  return {
    list,
    setTimer: (fn, ms) => { const h = { fn, ms }; list.push(h); return h; },
    clearTimer: (h) => { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); },
    async runAll() { while (list.length) { const h = list.shift(); h.fn(); await new Promise((r) => setTimeout(r, 0)); } },
  };
}

const student = (id, name, at) => ({ studentId: id, name, updatedAt: at });
const rec = (sid, area, patch) => ({ ...newRecord(sid, area), ...patch });

function make({ drive, local, c = clock(), extra = {} } = {}) {
  const tm = timers();
  const sync = createSync({ drive, local, now: c.now, setTimer: tm.setTimer, clearTimer: tm.clearTimer, ...extra });
  return { sync, tm, c };
}

test('sync: 사본을 지운 뒤 다시 연결하면 전부 돌아옴', async () => {
  const drive = createFakeDrive();
  const c = clock();
  const local = memLocal();
  local.mutate((d) => {
    d.students.push(student('30501', '김가온', c.now().toISOString()));
    d.classes.push({ id: 'c_1', name: '3-5', kind: 'homeroom', studentIds: ['30501'], updatedAt: c.now().toISOString() });
    d.records.push(rec('30501', 'autonomy', { memo: '메모', updatedAt: c.now().toISOString() }));
    d.settings.batchIntervalSec = 9;
    d.settings.updatedAt = c.now().toISOString();
    d.styles = { updatedAt: c.now().toISOString(), areas: { common: { examples: [], rules: '짧게', aiRules: '', updatedAt: c.now().toISOString() } } };
  });
  const { sync } = make({ drive, local, c });
  const r = await sync.connect();
  assert.equal(r.ok, true);
  assert.equal(r.uploaded, true);
  assert.equal(local.pending, false);

  await local.wipe(); // 사이트 데이터 지움
  const events = [];
  const s2 = make({ drive, local, c }).sync;
  s2.on((e) => events.push(e));
  await s2.start();
  assert.equal(s2.status.state, 'off', '연결 상태도 지워짐');
  const r2 = await s2.connect();
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.restored, { students: 1, records: 1, updatedAt: r2.restored.updatedAt }, 'connect 결과로 불러온 수를 돌려줌');
  assert.deepEqual(local.data.students.map((s) => s.name), ['김가온']);
  assert.equal(local.data.classes.length, 1);
  assert.equal(local.data.records[0].memo, '메모');
  assert.equal(local.data.settings.batchIntervalSec, 9);
  assert.equal(local.data.styles.areas.common.rules, '짧게');
  const restored = events.find((e) => e.type === 'restored');
  assert.ok(restored);
  assert.equal(restored.students, 1);
  assert.equal(restored.records, 1);
});

test('sync: 두 기기가 다른 기록을 고쳐도 둘 다 남음', async () => {
  const drive = createFakeDrive();
  const c = clock();
  const a = memLocal();
  const b = memLocal();
  const A = make({ drive, local: a, c }).sync;
  const B = make({ drive, local: b, c }).sync;
  await A.connect();
  await B.connect();
  c.tick();
  a.mutate((d) => d.records.push(rec('30501', 'autonomy', { memo: 'A가 씀', updatedAt: c.now().toISOString() })));
  A.notifyChange();
  b.mutate((d) => d.records.push(rec('30502', 'career', { memo: 'B가 씀', updatedAt: c.now().toISOString() })));
  B.notifyChange();
  await A.syncNow({ reason: 'auto' });
  await B.syncNow({ reason: 'auto' });
  await A.check();
  const ids = (x) => x.data.records.map((r) => r.id).sort();
  assert.deepEqual(ids(a), ['30501|autonomy', '30502|career']);
  assert.deepEqual(ids(b), ['30501|autonomy', '30502|career']);
  assert.deepEqual(drive.readRaw(DATA_FILE_NAME).records.map((r) => r.id).sort(), ['30501|autonomy', '30502|career']);
});

test('sync: 올리는 사이 확장이 neis를 써도 사라지지 않음', async () => {
  const drive = createFakeDrive();
  const c = clock();
  const local = memLocal();
  local.mutate((d) => d.records.push(rec('30501', 'autonomy', { final: '최종', status: 'done', updatedAt: c.now().toISOString() })));
  const { sync } = make({ drive, local, c });
  await sync.connect();
  c.tick();
  local.mutate((d) => { d.records[0].memo = '메모 고침'; d.records[0].updatedAt = c.now().toISOString(); });
  sync.notifyChange();
  // 다른 기기가 바꿔 두어 받기가 일어나게 하고, 그 받기 직후 확장이 neis만 써 넣음
  const f = drive.readRaw(DATA_FILE_NAME);
  drive.writeRaw(DATA_FILE_NAME, { ...f, students: [student('30509', '다른 기기', c.now().toISOString())] });
  const neis = { hash: 'abcdabcdabcdabcd', doneAt: c.now().toISOString() };
  drive.afterDownload((fake) => {
    const cur = fake.readRaw(DATA_FILE_NAME);
    cur.records = cur.records.map((r) => (r.id === '30501|autonomy' ? { ...r, neis } : r));
    fake.writeRaw(DATA_FILE_NAME, cur);
  });
  const r = await sync.syncNow({ reason: 'auto' });
  assert.equal(r.ok, true);
  assert.equal(r.uploaded, true);
  const out = drive.readRaw(DATA_FILE_NAME).records[0];
  assert.deepEqual(out.neis, neis, '확장이 쓴 neis가 남음');
  assert.equal(out.memo, '메모 고침', '내 변경도 올라감');
  assert.deepEqual(local.data.records[0].neis, neis);
  assert.ok(drive.readRaw(DATA_FILE_NAME).students.some((s) => s.studentId === '30509'));
});

test('sync: 오프라인 중 변경은 다시 연결되면 올라감, 새로고침 뒤에도', async () => {
  const drive = createFakeDrive();
  const c = clock();
  const local = memLocal();
  let online = true;
  const { sync, tm } = make({ drive, local, c, extra: { isOnline: () => online } });
  await sync.connect();
  online = false;
  local.mutate((d) => d.records.push(rec('30501', 'autonomy', { memo: '오프라인에서 씀', updatedAt: c.now().toISOString() })));
  sync.notifyChange();
  const r = await sync.syncNow({ reason: 'auto' });
  assert.equal(r.ok, false);
  assert.equal(sync.status.state, 'offline');
  assert.ok(tm.list.some((h) => h.ms === 5000), '다시 시도 예약');
  assert.equal(local.pending, true, '기다리는 변경 표시가 남음');

  // 새로고침: 같은 사본, 같은 드라이브로 새 sync
  online = true;
  const s2 = make({ drive, local, c, extra: { isOnline: () => online } }).sync;
  await s2.start();
  assert.equal(drive.readRaw(DATA_FILE_NAME).records[0].memo, '오프라인에서 씀');
  assert.equal(local.pending, false);
  assert.equal(s2.status.state, 'idle');
});

test('sync: 네트워크 실패 뒤 다시 시도 간격이 늘어남', async () => {
  const drive = createFakeDrive();
  const local = memLocal();
  const { sync, tm } = make({ drive, local });
  await sync.connect();
  drive.setOffline(true);
  local.mutate((d) => d.students.push(student('30501', 'a', new Date().toISOString())));
  sync.notifyChange();
  await sync.syncNow();
  assert.equal(tm.list.at(-1).ms, 5000);
  await sync.syncNow();
  assert.equal(tm.list.at(-1).ms, 15000);
  drive.setOffline(false);
  await tm.runAll();
  assert.equal(sync.status.state, 'idle');
  assert.equal(drive.readRaw(DATA_FILE_NAME).students.length, 1);
});

test('sync: 자동 백업은 하루 첫 저장 때, 최근 7개만, secrets 없음', async () => {
  const drive = createFakeDrive();
  const c = clock();
  const local = memLocal();
  const { sync } = make({ drive, local, c });
  await sync.connect();
  for (let i = 0; i < 9; i += 1) {
    c.tick(24 * 60 * 60 * 1000);
    local.mutate((d) => {
      d.students.push(student(`305${String(i + 10)}`, 'a', c.now().toISOString()));
      d.secrets = { geminiKey: 'AIzaSECRETKEY', updatedAt: c.now().toISOString() };
    });
    sync.notifyChange();
    await sync.syncNow();
  }
  const list = await drive.listBackups();
  assert.equal(list.length, 7);
  assert.ok(list[0].name > list[6].name, '최근 것 먼저');
  for (const b of list) assert.ok(!JSON.stringify(drive.readRaw(b.name)).includes('AIzaSECRETKEY'));
  assert.equal(drive.readRaw(DATA_FILE_NAME).secrets.geminiKey, 'AIzaSECRETKEY', '데이터 파일에는 켰을 때 들어감');
});

test('sync: [구글 드라이브에 저장]은 기다리는 변경을 타이머 없이 바로 올림, 바뀐 것 없으면 unchanged', async () => {
  const drive = createFakeDrive();
  const local = memLocal();
  const { sync, tm } = make({ drive, local });
  await sync.connect();
  local.mutate((d) => d.students.push(student('30501', 'a', new Date().toISOString())));
  sync.notifyChange();
  assert.equal(sync.status.state, 'pending');
  assert.equal(tm.list.length, 1);
  const r = await sync.syncNow({ reason: 'button' });
  assert.equal(r.uploaded, true);
  assert.equal(tm.list.length, 0, '기다리던 타이머는 취소');
  assert.equal(drive.readRaw(DATA_FILE_NAME).students.length, 1);
  const r2 = await sync.syncNow({ reason: 'button' });
  assert.equal(r2.ok, true);
  assert.equal(r2.unchanged, true);
});

test('sync: 처음 연결에 양쪽 데이터가 있으면 고르기 전에 양쪽 백업, 고른 대로', async () => {
  const c = clock();
  const remoteData = { ...emptyData(), students: [student('30501', '드라이브', c.now().toISOString())] };
  for (const choice of ['merge', 'remote', 'local', null]) {
    const drive = createFakeDrive();
    drive.writeRaw(DATA_FILE_NAME, { kind: 'sgb-v2-data', schemaVersion: 2, ...clone(remoteData) });
    const local = memLocal({ ...emptyData(), students: [student('30502', '브라우저', c.now().toISOString())] });
    local.data.settings.keyStorage = 'session';
    let asked = null;
    const { sync } = make({ drive, local, c, extra: { choose: async (s) => { asked = s; return choice; } } });
    const r = await sync.connect();
    assert.deepEqual(asked.local.students, 1);
    assert.deepEqual(asked.remote.students, 1);
    assert.ok(local.snapshots['before-first-sync'], '브라우저 것 백업');
    assert.equal(drive.files().filter((f) => f.name.startsWith('sgb-backup-')).length, 1, '드라이브 것 백업');
    const names = local.data.students.map((s) => s.name).sort();
    const driveNames = (drive.readRaw(DATA_FILE_NAME).students || []).map((s) => s.name).sort();
    if (choice === 'merge') { assert.deepEqual(names, ['드라이브', '브라우저']); assert.deepEqual(driveNames, names); }
    if (choice === 'remote') { assert.deepEqual(names, ['드라이브']); assert.deepEqual(driveNames, ['드라이브']); assert.equal(local.data.settings.keyStorage, 'session'); }
    if (choice === 'local') { assert.deepEqual(names, ['브라우저']); assert.deepEqual(driveNames, ['브라우저']); }
    if (choice === null) { assert.equal(r.ok, false); assert.equal(sync.status.state, 'off'); assert.deepEqual(names, ['브라우저']); }
  }
});

test('sync: 토큰 조용한 재요청 실패면 auth, 더 새 버전 파일이면 올리지 않음', async () => {
  const drive = createFakeDrive();
  const local = memLocal();
  const s1 = make({ drive, local }).sync;
  await s1.connect();
  await drive.revoke();
  drive.setTokenOk(false);
  const s2 = make({ drive, local }).sync;
  await s2.start();
  assert.equal(s2.status.state, 'auth');

  drive.setTokenOk(true);
  drive.writeRaw(DATA_FILE_NAME, { kind: 'sgb-v2-data', schemaVersion: 99, students: [] });
  const s3 = make({ drive, local }).sync;
  await s3.start();
  assert.equal(s3.status.state, 'error');
  assert.equal(s3.status.errorKind, 'newer');
  assert.equal(drive.readRaw(DATA_FILE_NAME).schemaVersion, 99, '덮어쓰지 않음');
});

test('sync: 드라이브 백업으로 되돌리기, 드라이브 데이터 지우기', async () => {
  const drive = createFakeDrive();
  const c = clock();
  const local = memLocal();
  const { sync } = make({ drive, local, c });
  local.mutate((d) => d.students.push(student('30501', '처음', c.now().toISOString())));
  await sync.connect();
  const [backup] = await sync.listBackups();
  c.tick(60000);
  local.mutate((d) => { d.students[0] = student('30501', '나중', c.now().toISOString()); d.secrets = { geminiKey: 'K', updatedAt: c.now().toISOString() }; });
  sync.notifyChange();
  await sync.syncNow();
  c.tick(60000);
  const r = await sync.restoreBackup(backup.id);
  assert.equal(r.ok, true);
  assert.equal(local.data.students[0].name, '처음');
  assert.equal(drive.readRaw(DATA_FILE_NAME).students[0].name, '처음', '되돌린 것이 드라이브에서도 이김');
  assert.equal(local.data.secrets.geminiKey, 'K', 'secrets는 지금 것 유지');
  assert.equal(local.snapshots['before-restore'].students[0].name, '나중');

  drive.writeRaw('attendance-data.json', { x: 1 });
  const n = await sync.deleteDriveData();
  assert.equal(n, 2);
  assert.deepEqual(drive.files().map((f) => f.name), ['attendance-data.json'], '출결 앱 파일은 그대로');
  assert.equal(sync.status.state, 'off');
});

test('sync: 다른 PC에서 secrets가 있으면 한 번 묻고, 답하면 다시 묻지 않음', async () => {
  const drive = createFakeDrive();
  const c = clock();
  const a = memLocal();
  const A = make({ drive, local: a, c }).sync;
  await A.connect();
  a.mutate((d) => { d.secrets = { geminiKey: 'AIzaKEY', updatedAt: c.now().toISOString() }; });
  A.notifyChange();
  await A.syncNow();

  const b = memLocal();
  const B = make({ drive, local: b, c }).sync;
  const offers = [];
  B.on((e) => { if (e.type === 'secrets-offer') offers.push(e); });
  await B.connect();
  assert.equal(offers.length, 1);
  await B.answerSecrets(offers[0].updatedAt);
  const B2 = make({ drive, local: b, c }).sync;
  const offers2 = [];
  B2.on((e) => { if (e.type === 'secrets-offer') offers2.push(e); });
  await B2.start();
  c.tick();
  drive.writeRaw(DATA_FILE_NAME, { ...drive.readRaw(DATA_FILE_NAME), students: [student('30501', 'x', c.now().toISOString())] });
  await B2.check();
  assert.equal(offers2.length, 0);
});

test('sync: 끈 secrets(빈 키)는 다른 기기의 옛 키를 이김', async () => {
  const drive = createFakeDrive();
  const c = clock();
  const a = memLocal({ ...emptyData(), secrets: { geminiKey: 'OLD', updatedAt: c.now().toISOString() } });
  const A = make({ drive, local: a, c }).sync;
  await A.connect();
  const b = memLocal();
  const B = make({ drive, local: b, c }).sync;
  await B.connect();
  c.tick();
  b.mutate((d) => { d.secrets = { geminiKey: '', updatedAt: c.now().toISOString() }; });
  B.notifyChange();
  await B.syncNow();
  await A.syncNow({ reason: 'poll' });
  assert.equal(a.data.secrets.geminiKey, '');
  assert.equal(drive.readRaw(DATA_FILE_NAME).secrets.geminiKey, '');
});
