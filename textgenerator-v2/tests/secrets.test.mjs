// 비밀 정보 테스트: 백업, 엑셀, 자동 백업 결과에 API 키가 없음. 끄면 secrets가 비워짐.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, validateBackup, excelRows } from '../js/core/backup-format.js';
import { toDriveFile, withoutSecrets, mergeData, emptyData } from '../js/core/sync-merge.js';
import { createSync } from '../js/sync.js';
import { createFakeDrive } from '../js/core/fake-drive.js';
import { DATA_FILE_NAME, BACKUP_PREFIX, DriveError } from '../js/core/drive-common.js';
import { defaultSettings, newRecord } from '../js/core/model.js';

const KEY = 'AIzaSyTESTKEY-0123456789abcdef';
const T1 = '2026-11-01T00:00:00.000Z';
const T2 = '2026-11-02T00:00:00.000Z';

function sample() {
  return {
    students: [{ studentId: '30501', name: '김가온', updatedAt: T1 }],
    classes: [{ id: 'c_1', name: '3-5', kind: 'homeroom', studentIds: ['30501'], createdAt: T1, updatedAt: T1 }],
    records: [{ ...newRecord('30501', 'autonomy'), final: '최종', updatedAt: T1 }],
    settings: { ...defaultSettings(), apiKey: KEY, geminiKey: KEY },
    styles: { updatedAt: null, areas: {} },
    secrets: { geminiKey: KEY, updatedAt: T1 },
    deleted: [],
  };
}

test('secrets: 백업 파일에 키 없음 (settings에 섞여 들어와도, secrets가 있어도)', () => {
  const b = makeBackup({ ...sample(), now: new Date(T2) });
  assert.ok(!JSON.stringify(b).includes(KEY));
  assert.ok(!('secrets' in b));
  const v = validateBackup({ ...b, secrets: { geminiKey: KEY, updatedAt: T1 }, settings: { ...b.settings, geminiKey: KEY } });
  assert.equal(v.ok, true);
  assert.ok(!JSON.stringify(v.backup).includes(KEY));
});

test('secrets: 엑셀 행에 키 없음', () => {
  const d = sample();
  for (const area of ['autonomy', 'career', 'behavior', 'club', 'subject']) {
    assert.ok(!JSON.stringify(excelRows({ ...d, area })).includes(KEY));
  }
});

test('secrets: 자동 백업(withoutSecrets)에 키 없음', () => {
  const f = toDriveFile(sample(), new Date(T2));
  assert.ok(JSON.stringify(f).includes(KEY), '데이터 파일에는 켰을 때만 secrets에');
  assert.ok(!JSON.stringify(f.settings).includes(KEY), '설정에 섞인 키 칸은 뺌');
  assert.ok(!JSON.stringify(withoutSecrets(f)).includes(KEY));
  assert.equal(withoutSecrets(f).secrets, null);
});

test('secrets: 드라이브 오류 문구에 키·토큰 없음', () => {
  for (const kind of ['auth', 'forbidden', 'blocked', 'popup', 'network', 'busy', 'newer', 'parse', 'conflict', 'unknown']) {
    const e = new DriveError(kind, { status: 401 });
    assert.ok(e.userMessage && !e.userMessage.includes(KEY) && !/Bearer|ya29/.test(e.message));
  }
});

test('secrets: 체크를 끄면(빈 키) 드라이브의 secrets가 비워지고, 자동 백업 파일에는 언제나 없음', async () => {
  const drive = createFakeDrive();
  let data = { ...emptyData(), secrets: { geminiKey: KEY, updatedAt: T1 } };
  let pending = true;
  let state = {};
  const local = {
    async read() { return JSON.parse(JSON.stringify(data)); },
    async apply(d) { data = JSON.parse(JSON.stringify(d)); },
    async readState() { return { ...state, pending }; },
    async writeState(p) { state = { ...state, ...p }; },
    async setPending(b) { pending = b; },
    async snapshot() {},
    async wipe() {},
  };
  const sync = createSync({ drive, local, setTimer: () => 0, clearTimer: () => {} });
  await sync.connect();
  assert.equal(drive.readRaw(DATA_FILE_NAME).secrets.geminiKey, KEY);

  data = { ...data, secrets: { geminiKey: '', updatedAt: T2 } };
  pending = true;
  sync.notifyChange();
  await sync.syncNow({ reason: 'button' });
  assert.deepEqual(drive.readRaw(DATA_FILE_NAME).secrets, { geminiKey: '', updatedAt: T2 });
  assert.ok(!JSON.stringify(drive.readRaw(DATA_FILE_NAME)).includes(KEY));
  for (const f of drive.files().filter((x) => x.name.startsWith(BACKUP_PREFIX))) {
    assert.ok(!JSON.stringify(drive.readRaw(f.name)).includes(KEY), f.name);
  }
  // 다른 기기의 옛 키가 합치기에서 되살아나지 않음
  const other = { ...emptyData(), secrets: { geminiKey: KEY, updatedAt: T1 } };
  assert.equal(mergeData(other, drive.readRaw(DATA_FILE_NAME)).data.secrets.geminiKey, '');
});
