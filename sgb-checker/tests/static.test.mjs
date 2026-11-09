// 소스 검사: innerHTML 0곳, eval·new Function·인라인 이벤트 0곳, 외부 주소 0개, 이모지·장식 기호 0개, CSP, 서비스 워커 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './helpers.mjs';

function files(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const rel = relative(ROOT, p).replace(/\\/g, '/');
    if (rel === 'lib' || rel === 'tests/samples' || rel === 'docs') continue;
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(js|mjs|html|css|json)$/.test(n)) out.push({ rel, src: readFileSync(p, 'utf8') });
  }
  return out;
}
const SRC = files(ROOT);
const APP = SRC.filter((f) => !f.rel.startsWith('tests/'));

test('innerHTML, outerHTML, insertAdjacentHTML, document.write 0곳', () => {
  for (const f of APP) assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(f.src), f.rel);
});

test('eval, new Function, 문자열 setTimeout, 인라인 이벤트, 인라인 스크립트 0곳', () => {
  for (const f of APP) {
    assert.ok(!/\beval\s*\(|new Function\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/.test(f.src), f.rel);
    if (f.rel.endsWith('.html')) {
      assert.ok(!/\son[a-z]+\s*=/.test(f.src), `${f.rel} 인라인 이벤트`);
      assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(f.src), `${f.rel} 인라인 스크립트`);
      assert.ok(!/\sstyle\s*=/.test(f.src), `${f.rel} 인라인 스타일`);
    }
  }
});

test('외부에서 불러오는 코드·글꼴 0개 (Gemini 주소 상수와 CSP만 예외)', () => {
  for (const f of APP) {
    for (const m of f.src.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
      const u = m[0];
      const ok = u.startsWith('https://generativelanguage.googleapis.com') || u.startsWith('https://176-oss.github.io') || u === 'http://www.w3.org/2000/svg';
      assert.ok(ok, `${f.rel}: ${u}`);
    }
    assert.ok(!/@import|import\s*\(\s*['"]http|from\s+['"]http/.test(f.src), f.rel);
  }
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(!/^(https?:)?\/\//.test(m[1]) || m[1].startsWith('https://176-oss'), m[1]);
});

test('이모지와 장식 기호 0개', () => {
  const bad = /[\p{Extended_Pictographic}\u2190-\u21FF\u2460-\u24FF\u25A0-\u25FF\u2600-\u27BF\u2B00-\u2BFF]/u;
  for (const f of SRC) {
    const lines = f.src.split('\n');
    lines.forEach((l, i) => assert.ok(!bad.test(l), `${f.rel}:${i + 1}`));
  }
});

test('CSP meta가 있고 정해진 정책', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m);
  assert.equal(m[1], "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://generativelanguage.googleapis.com; object-src 'none'; base-uri 'none'; form-action 'none'");
});

test('서비스 워커, Cache API 없음', () => {
  for (const f of APP) assert.ok(!/serviceWorker|caches\./.test(f.src), f.rel);
});

test('Gemini 주소는 코드 상수 하나', () => {
  const hits = APP.filter((f) => f.src.includes('generativelanguage.googleapis.com') && !f.rel.endsWith('.html'));
  assert.deepEqual(hits.map((f) => f.rel), ['js/ai.js']);
});
