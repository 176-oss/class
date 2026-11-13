// [값 읽기] 명령(surveyValues)을 브라우저 없이 시험한다: sgb-config.js 와 sgb-page.js 를 가짜 window 안에서 실행하고
// 가짜 나이스 앱 인스턴스를 넣어, 결과에 학생 이름·본문이 없는지와 읽어야 할 값이 있는지 확인한다.
// 실행: node tests/survey-values.test.mjs
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const NAMES = ['김가람', '이나래', '박다온'];
const TEXTS = ['학급 회의를 세 차례 진행함.', '', '한글과 English 와 줄바꿈\r\n포함'];
const hangul3 = (s, nl) => { let n = 0; for (const ch of s.replace(/\r\n?/g, '\n')) { const c = ch.codePointAt(0); n += ch === '\n' ? nl : (c >= 0xAC00 && c <= 0xD7A3) ? 3 : 1; } return n; };

function table(cols, rows) {
  return {
    getRowCount: () => rows.length, getColumnNames: () => cols,
    getValue: (r, c) => rows[r][c], getRowState: () => 1,
    setValue() { throw new Error('읽기 전용 명령이 값을 바꾸려 했습니다'); },
  };
}
function inst(id, lookups) { return { app: { id }, lookup: (k) => (k in lookups ? lookups[k] : null) }; }

const grid = table(['clsNo', 'stuFlnm', 'speclActSpablMteCn', 'length'],
  NAMES.map((n, i) => ({ clsNo: String(i + 1), stuFlnm: n, speclActSpablMteCn: TEXTS[i], length: TEXTS[i] ? hangul3(TEXTS[i], 2) : 0 })));
grid.dataSet = grid; // 표 컨트롤처럼 dataSet 도 갖게 함
const dmSearch = { getValue: (k) => ({ ayr: '2026', sem: '2', grd: '3', clsCd: '5', actScCd: '01', stuInvlNo: '비밀번호', userNm: NAMES[0] })[k] };
const dmScrgDdln = { getValue: (k) => ({ scrgClsDdlnYn: 'N', ddlnYn: 'N', ddlnInfoCn: `${NAMES[1]} 선생님 마감 안내` })[k] };
const screen = inst('edu/sw/mis/sdl/ce/mis_sdlce00_m00', {
  dmSearch, dmScrgDdln, dsScrgRec: grid, grdMain: grid,
  optDdln: { value: '마감 전' },
  txaSpeclActSpablMteCn: { type: 'textarea', enabled: true, readOnly: false, maxLength: 1500, value: 'READ-ME-NOT', bind() {} },
});
const header = inst('udc/com/appHeader', { optTit: { value: `${NAMES[2]} 학생 창체` } }); // 제목에 이름이 섞인 경우
const combo = inst('udc/sw/swc/udcSwcAuth', { dsAuth: table(['cd', 'nm'], [{ cd: '3', nm: '3학년' }]) });
const msgs = inst('edu/sw/mis/sdl/ce/mis_sdlce00_m03', { dsExMessage: table(['messageId', 'messageDiv'], [{ messageId: 'M1', messageDiv: '저장하시겠습니까?' }, { messageId: 'M2', messageDiv: '바이트 수를 초과했습니다.' }]) });

const listeners = [];
const outbox = [];
const win = { addEventListener: (t, f) => listeners.push(f), postMessage: (m) => outbox.push(m) };
win.window = win;
win.cpr = { core: { Platform: { INSTANCE: { getAllRunningAppInstances: () => [screen, header, combo, msgs] } } } };
const ctx = vm.createContext({ window: win, location: { hostname: 'goe.neis.go.kr', origin: 'https://goe.neis.go.kr', pathname: '/jsp/main.jsp' }, TextEncoder, setTimeout, JSON, Set, Map, Promise, Number, Math, String, Date, Object, Array, Error });
vm.runInContext(read('content/sgb-config.js'), ctx);
vm.runInContext(read('content/sgb-page.js'), ctx);

const NONCE = 'n'.repeat(20);
const send = (m) => listeners.forEach((f) => f({ source: win, data: Object.assign({ channel: 'sgb-neis-bridge-v1', from: 'bridge', nonce: NONCE }, m) }));
send({ type: 'init' });
send({ type: 'request', reqId: 7, cmd: 'surveyValues', args: {} });
await new Promise((r) => setTimeout(r, 50));

const res = outbox.find((m) => m.type === 'response' && m.reqId === 7);
assert.ok(res && res.ok, `응답 실패: ${JSON.stringify(res)}`);
const text = JSON.stringify(res.result);

// 학생 이름, 학번, 본문, 입력칸 값이 없음
for (const n of NAMES) assert.ok(!text.includes(n), `이름이 새어 나옴: ${n}`);
for (const t of TEXTS.filter(Boolean)) assert.ok(!text.includes(t.slice(0, 6)), '본문이 새어 나옴');
assert.ok(!text.includes('비밀번호') && !text.includes('READ-ME-NOT'), '허용 목록 밖 값이 나옴');

// 읽어야 할 값이 있음
const sc = res.result.screens.find((s) => s.key === 'autonomy');
assert.ok(sc, '자율 화면을 찾지 못함');
assert.deepEqual({ ayr: sc.search.ayr, sem: sc.search.sem, grd: sc.search.grd, clsCd: sc.search.clsCd, actScCd: sc.search.actScCd }, { ayr: '2026', sem: '2', grd: '3', clsCd: '5', actScCd: '01' });
assert.equal(sc.search.stuInvlNo, undefined);
assert.equal(sc.ddln.ddlnYn, 'N');
assert.equal(sc.outputs.optDdln, '마감 전');
assert.equal(sc.grid.rowCount, 3);
assert.equal(sc.grid.rowsWithText, 2);
const smp = sc.grid.samples[0];
assert.equal(smp.neisLength, hangul3(TEXTS[0], 2));
assert.equal(smp.hangul3_other1_nl1, hangul3(TEXTS[0], 1));
assert.equal(smp.hangul3_other1_nl2, hangul3(TEXTS[0], 2));
assert.equal(smp.hasCR, false);
assert.equal(sc.grid.samples[1].hasCR, true);
assert.equal(sc.textareas[0].found, true);
assert.equal(sc.textareas[0].maxLength, 1500);
assert.ok(sc.textareas[0].bindApi.includes('bind'));
assert.ok(res.result.messages.some((m) => m[1] === '저장하시겠습니까?'));
assert.deepEqual(res.result.combos[0][0], { cd: '3', nm: '3학년' });
assert.ok(res.result.headers[0].includes('[이름]'), '제목 속 이름을 지우지 못함');

console.log('survey-values tests ok');
