import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byteLength, byteLevel, charsForBytes } from '../js/core/bytes.js';

test('bytes: 한글 완성형은 3바이트', () => {
  assert.equal(byteLength('가'), 3);
  assert.equal(byteLength('학교생활'), 12);
});

test('bytes: 영문, 숫자, 공백, 기호는 1바이트', () => {
  assert.equal(byteLength('abc'), 3);
  assert.equal(byteLength('2026'), 4);
  assert.equal(byteLength(' '), 1);
  assert.equal(byteLength('.,!?()-'), 7);
  assert.equal(byteLength('A 1.'), 4);
});

test('bytes: 호환 자모(ㄱ-ㅎ, ㅏ-ㅣ)도 3바이트', () => {
  assert.equal(byteLength('ㄱ'), 3);
  assert.equal(byteLength('ㅎ'), 3);
  assert.equal(byteLength('ㅏ'), 3);
  assert.equal(byteLength('ㅣ'), 3);
  assert.equal(byteLength('ㅋㅋ'), 6);
});

test('bytes: 줄바꿈은 1바이트', () => {
  assert.equal(byteLength('\n'), 1);
  assert.equal(byteLength('가\n나'), 7);
});

test('bytes: 서로게이트 쌍은 1글자(1바이트)로 셈', () => {
  const smile = String.fromCodePoint(0x1f600);
  assert.equal(smile.length, 2);
  assert.equal(byteLength(smile), 1);
  assert.equal(byteLength(`가${smile}`), 4);
});

test('bytes: 빈 값', () => {
  assert.equal(byteLength(''), 0);
  assert.equal(byteLength(null), 0);
  assert.equal(byteLength(undefined), 0);
});

test('bytes: byteLevel 경계값 (95% near, 초과 over)', () => {
  assert.equal(byteLevel(0, 1000), 'ok');
  assert.equal(byteLevel(949, 1000), 'ok');
  assert.equal(byteLevel(950, 1000), 'near');
  assert.equal(byteLevel(1000, 1000), 'near');
  assert.equal(byteLevel(1001, 1000), 'over');
  assert.equal(byteLevel(854, 900), 'ok');
  assert.equal(byteLevel(855, 900), 'near');
  assert.equal(byteLevel(901, 900), 'over');
  assert.equal(byteLevel(10, 0), 'ok');
});

test('bytes: charsForBytes 는 2.6 으로 나눠 내림', () => {
  assert.equal(charsForBytes(1500), 576);
  assert.equal(charsForBytes(900), 346);
  assert.equal(charsForBytes(0), 0);
});
