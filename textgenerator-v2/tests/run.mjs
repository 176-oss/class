// 모든 테스트 실행: node textgenerator-v2/tests/run.mjs
// tests 폴더의 *.test.mjs 를 차례로 불러온다. node:test 가 불러온 테스트를 실행하고,
// 하나라도 실패하면 종료 코드가 1 이 된다.

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();

for (const f of files) {
  await import(pathToFileURL(join(here, f)).href);
}
