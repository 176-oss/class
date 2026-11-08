// 테스트 도우미: lib의 SheetJS 불러오기, 가짜 localStorage
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
export const XLSX = require('../lib/xlsx.full.min.js');

export function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

/** 2차원 배열들 -> xlsx 바이트 */
export function makeXlsx(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
