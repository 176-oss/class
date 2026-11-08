import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeStorage } from './helpers.mjs';
import { createKeyStore, SHARED_KEY, isValidKey, maskKey } from '../shared/key-store.js';

const K1 = 'AIzaSyA-test-key-0000000000000000001234';
const K2 = 'AIzaSyB-test-key-0000000000000000005678';
const shared = (key, savedBy = 'sgb-checker') => JSON.stringify({ key, savedBy, savedAt: 1 });

test('공용 자리에 있으면 그걸 씀', () => {
  const s = fakeStorage({ [SHARED_KEY]: shared(K1, 'textgenerator-v2'), 'sgb-v2-api-key': K2 });
  assert.deepEqual(createKeyStore(s).read(), { key: K1, source: 'shared', savedBy: 'textgenerator-v2' });
});

test('공용 자리에 없고 작성 도우미 자리에 있으면 그걸 쓰고 공용 자리에 복사', () => {
  const s = fakeStorage({ 'sgb-v2-api-key': K2 });
  const r = createKeyStore(s, () => 42).read();
  assert.deepEqual(r, { key: K2, source: 'legacy', savedBy: 'textgenerator-v2' });
  assert.deepEqual(JSON.parse(s.getItem(SHARED_KEY)), { key: K2, savedBy: 'textgenerator-v2', savedAt: 42 });
  assert.equal(s.getItem('sgb-v2-api-key'), K2); // 원래 자리는 그대로
});

test('둘 다 없으면 null, 모양이 틀린 값은 무시', () => {
  assert.equal(createKeyStore(fakeStorage()).read(), null);
  assert.equal(createKeyStore(fakeStorage({ [SHARED_KEY]: '{"key":"short","savedBy":"sgb-checker","savedAt":1}' })).read(), null);
  assert.equal(createKeyStore(fakeStorage({ [SHARED_KEY]: 'not json' })).read(), null);
  assert.equal(createKeyStore(fakeStorage({ [SHARED_KEY]: shared(K1, 'evil-page') })).read(), null);
  assert.equal(createKeyStore(fakeStorage({ 'sgb-v2-api-key': 'has space in it 000000000000000000000' })).read(), null);
});

test('저장은 공용 자리에, savedBy sgb-checker', () => {
  const s = fakeStorage();
  const ks = createKeyStore(s, () => 7);
  assert.equal(ks.save('  ' + K1 + ' '), true);
  assert.deepEqual(JSON.parse(s.getItem(SHARED_KEY)), { key: K1, savedBy: 'sgb-checker', savedAt: 7 });
  assert.equal(ks.save('bad key'), false);
});

test('지우기는 공용 자리만, 작성 도우미 자리에 남았는지 알려 줌, 같은 키를 다시 가져오지 않음', () => {
  const s = fakeStorage({ 'sgb-v2-api-key': K2 });
  const ks = createKeyStore(s);
  ks.read();
  assert.deepEqual(ks.clear(), { legacyRemains: true });
  assert.equal(s.getItem(SHARED_KEY), null);
  assert.equal(s.getItem('sgb-v2-api-key'), K2);
  assert.equal(createKeyStore(s).read(), null);
  s.setItem('sgb-v2-api-key', K1); // 작성 도우미에서 새 키를 넣으면 다시 씀
  assert.equal(createKeyStore(s).read().key, K1);
  assert.deepEqual(createKeyStore(fakeStorage({ [SHARED_KEY]: shared(K1) })).clear(), { legacyRemains: false });
});

test('이번에만 사용은 저장하지 않음', () => {
  const s = fakeStorage();
  const ks = createKeyStore(s);
  assert.equal(ks.useForSession(K1), true);
  assert.deepEqual(ks.read(), { key: K1, source: 'session', savedBy: 'sgb-checker' });
  assert.deepEqual(s.dump(), {});
  assert.equal(createKeyStore(s).read(), null);
});

test('화면에는 끝 4자리만', () => {
  assert.equal(maskKey(K1), '****1234');
  assert.equal(maskKey('x'), '');
  assert.equal(isValidKey(K1), true);
});
