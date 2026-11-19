import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, shouldNotify } from '../js/core/ext-version.js';

test('확장 버전 비교: 자리마다 숫자로 (0.4.10 > 0.4.9)', () => {
  assert.equal(compareVersions('0.4.10', '0.4.9'), 1);
  assert.equal(compareVersions('0.4.8', '0.4.8'), 0);
  assert.equal(compareVersions('0.4', '0.4.1'), -1);
});

test('업데이트 알림: 설치됨 < 최신일 때만, 건너뛴 버전과 오늘 나중에는 빼고', () => {
  const latest = { version: '0.4.9' };
  const base = { installed: '0.4.8', latest, skip: null, later: null, todayStr: '2026-11-19' };
  assert.equal(shouldNotify(base), true);
  assert.equal(shouldNotify({ ...base, installed: '0.4.9' }), false);
  assert.equal(shouldNotify({ ...base, installed: null }), false, '확장이 없는 PC에서는 알리지 않음');
  assert.equal(shouldNotify({ ...base, skip: '0.4.9' }), false);
  assert.equal(shouldNotify({ ...base, skip: '0.4.8' }), true);
  assert.equal(shouldNotify({ ...base, later: '2026-11-19' }), false);
  assert.equal(shouldNotify({ ...base, later: '2026-11-18' }), true);
});
