// 배포용 zip: node tests/zip.test.mjs
// zip 을 만드는 코드가 맞는 zip 을 쓰는지, 작성 도우미에 올린 zip 이 지금 manifest 버전과 같은지 본다 (버전을 올리고 zip 을 다시 안 만든 경우를 잡는다)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { makeZip } from '../tools/make-zip.mjs';

const zip = makeZip([{ name: 'a/가.txt', data: Buffer.from('안녕') }, { name: 'a/b.json', data: Buffer.from('{"x":1}') }]);
assert.equal(zip.readUInt32LE(0), 0x04034b50);
const nameLen = zip.readUInt16LE(26);
assert.equal(zip.slice(30, 30 + nameLen).toString('utf8'), 'a/가.txt');
const compLen = zip.readUInt32LE(18);
assert.equal(zlib.inflateRawSync(zip.slice(30 + nameLen, 30 + nameLen + compLen)).toString('utf8'), '안녕');
assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 2);

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const info = JSON.parse(fs.readFileSync(new URL('../../textgenerator-v2/sgb-extension-version.json', import.meta.url), 'utf8'));
assert.equal(info.version, manifest.version, '버전을 올렸으면 node sgb-extension/tools/make-zip.mjs 로 zip 을 다시 만드세요');
assert.ok(fs.statSync(new URL('../../textgenerator-v2/sgb-extension.zip', import.meta.url)).size > 1000);
console.log('zip tests ok');
