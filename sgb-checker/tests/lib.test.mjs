// lib 파일이 README에 적은 것과 같은지 (누가 바꾸면 실패)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, XLSX } from './helpers.mjs';

const readme = readFileSync(join(ROOT, 'lib/README.md'), 'utf8');
const sha = (f) => createHash('sha256').update(readFileSync(join(ROOT, 'lib', f))).digest('hex');
const listed = (f) => readme.split('\n').find((l) => l.startsWith(`| \`${f}\``))?.match(/`([0-9a-f]{64})`/)?.[1];

test('SheetJS 파일 SHA-256이 README 값과 같음', () => {
  for (const f of ['xlsx.full.min.js', 'LICENSE']) {
    assert.ok(listed(f), `${f}가 README에 없음`);
    assert.equal(sha(f), listed(f), f);
  }
});

test('SheetJS 버전이 0.20.2 이상 (CVE-2023-30533, CVE-2024-22363 고친 버전)', () => {
  const [a, b, c] = XLSX.version.split('.').map(Number);
  assert.ok(a > 0 || b > 20 || (b === 20 && c >= 2), XLSX.version);
  assert.match(readme, new RegExp(`\\| ${XLSX.version.replace(/\./g, '\\.')} \\|`));
});
