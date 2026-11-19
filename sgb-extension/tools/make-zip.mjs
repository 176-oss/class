// 학교 배포용 zip 만들기: node sgb-extension/tools/make-zip.mjs
// - tests/, mock-neis/, tools/ 는 빼고, 가상 나이스용 localhost 주소를 manifest·패널에서 지운다 (README '배포 전 정리')
// - 결과: textgenerator-v2/sgb-extension.zip (작성 도우미 화면에서 내려받음) + sgb-extension-version.json
// 외부 패키지 없이 node 기본 기능(zlib)으로 zip 을 쓴다. 압축을 풀면 sgb-extension/ 폴더 하나가 나온다.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..');
const OUT_DIR = path.resolve(SRC, '../textgenerator-v2');
const SKIP = new Set(['tests', 'mock-neis', 'tools', '.gitattributes']);
const LOCAL = ['http://localhost/*', 'http://127.0.0.1/*'];

function walk(dir, rel = '') {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!rel && SKIP.has(name)) continue;
    const abs = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (fs.statSync(abs).isDirectory()) out.push(...walk(abs, r));
    else out.push({ rel: r, abs });
  }
  return out;
}

/** 배포용으로 고친 내용 (manifest, 패널의 localhost 주소 지우기) */
function contentOf(f) {
  const buf = fs.readFileSync(f.abs);
  if (f.rel === 'manifest.json') {
    const m = JSON.parse(buf.toString('utf8'));
    m.host_permissions = m.host_permissions.filter((u) => !LOCAL.includes(u));
    for (const cs of m.content_scripts) cs.matches = cs.matches.filter((u) => !LOCAL.includes(u));
    return Buffer.from(`${JSON.stringify(m, null, 2)}\n`, 'utf8');
  }
  if (f.rel === 'sidepanel/sgb-panel.js') {
    const s = buf.toString('utf8');
    const next = s.replace(/const NEIS_URLS = \[[^\]]*\];/, "const NEIS_URLS = ['https://*.neis.go.kr/*'];");
    if (next === s) throw new Error('sgb-panel.js 의 NEIS_URLS 를 찾지 못했습니다');
    return Buffer.from(next, 'utf8');
  }
  return buf;
}

// ---------- zip (deflate, CRC-32) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
export function makeZip(entries, now = new Date()) {
  const { time, date } = dosTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // UTF-8 이름
    local.writeUInt16LE(8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const files = walk(SRC);
  const zip = makeZip(files.map((f) => ({ name: `sgb-extension/${f.rel}`, data: contentOf(f) })));
  fs.writeFileSync(path.join(OUT_DIR, 'sgb-extension.zip'), zip);
  const info = { version: manifest.version, date: new Date().toISOString().slice(0, 10), zip: 'sgb-extension.zip' };
  fs.writeFileSync(path.join(OUT_DIR, 'sgb-extension-version.json'), `${JSON.stringify(info, null, 2)}\n`);
  console.log(`sgb-extension.zip ${manifest.version}: 파일 ${files.length}개, ${zip.length} 바이트`);
}
