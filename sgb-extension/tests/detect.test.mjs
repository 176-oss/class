// 화면 감지(보이는 탭에서만 활성)와 입력 규칙을 브라우저 없이 시험한다.
// sgb-config.js 와 sgb-page.js 를 가짜 window 안에서 돌리고, 가짜 나이스 앱 인스턴스(표 크기를 바꿀 수 있음)를 넣는다.
// 실행: node tests/detect.test.mjs
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function table(rowsIn) {
  const rows = rowsIn.map((v) => ({ v: { ...v }, st: 1 }));
  return {
    rows, getRowCount: () => rows.length, getColumnNames: () => Object.keys(rowsIn[0] || {}),
    getValue: (r, c) => rows[r].v[c],
    setValue(r, c, x) { rows[r].v[c] = String(x); rows[r].st = 4; },
    getRowState: (r) => rows[r].st,
  };
}
const datamap = (o) => ({ getValue: (k) => o[k] });

// 가짜 나이스 한 벌. screens: [{ appId, dm, ddln, ddlnId, rows, shown }]
function makeEnv({ verified, screens }) {
  const insts = screens.map((sc) => {
    const ds = table(sc.rows);
    const grid = { dataSet: ds, getActualRect: () => (sc.shown ? { width: 800, height: 600 } : { width: 0, height: 0 }) };
    const lookups = {
      dmSearch: datamap(sc.dm), [sc.ds]: ds, grdMain: grid,
      dsSwcSem: table([{ cd: '2', nm: '2학기' }]),
      [sc.ddlnId || 'dmScrgDdln']: datamap(sc.ddln || {}),
      btnSave: { enabled: true, click() { sc.clicked = (sc.clicked || 0) + 1; } },
    };
    const inst = { app: { id: sc.appId }, lookup: (id) => (id in lookups ? lookups[id] : null) };
    sc.inst = inst; sc.table = ds;
    return inst;
  });
  const listeners = []; const outbox = [];
  const win = { addEventListener: (t, f) => listeners.push(f), postMessage: (m) => outbox.push(m) };
  win.window = win;
  win.cpr = { core: { Platform: { INSTANCE: { getAllRunningAppInstances: () => insts } } } };
  const ctx = vm.createContext({ window: win, location: { hostname: 'goe.neis.go.kr', origin: 'https://goe.neis.go.kr', pathname: '/jsp/main.jsp' }, TextEncoder, setTimeout, JSON, Set, Map, Promise, Number, Math, String, Date, Object, Array, Error, RegExp });
  const cfg = verified ? read('content/sgb-config.js').replace('verified: false', 'verified: true') : read('content/sgb-config.js');
  vm.runInContext(cfg, ctx);
  vm.runInContext(read('content/sgb-page.js'), ctx);
  const nonce = 'n'.repeat(20);
  const send0 = (m) => listeners.forEach((f) => f({ source: win, data: Object.assign({ channel: 'sgb-neis-bridge-v1', from: 'bridge', nonce }, m) }));
  send0({ type: 'init' });
  let id = 0;
  async function cmd(name, args) {
    const reqId = ++id;
    send0({ type: 'request', reqId, cmd: name, args: args || {} });
    for (let i = 0; i < 100; i++) {
      const res = outbox.find((m) => m.type === 'response' && m.reqId === reqId);
      if (res) return res;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('응답 없음');
  }
  return { cmd, screens };
}

const AUTONOMY = 'edu/sw/mis/sdl/ce/mis_sdlce00_m00';
const autonomy = (over = {}) => Object.assign({
  appId: AUTONOMY, ds: 'dsScrgRec', shown: true,
  dm: { ayr: '2026', sem: '', grd: '3', clsCd: '10', actScCd: '11' },
  ddln: { scrgClsDdlnYn: 'N', scrgDdlnCfmtnYn: 'N', ddlnYn: 'N' },
  rows: [{ clsNo: '1', stuFlnm: '가나', speclActSpablMteCn: '' }, { clsNo: '2', stuFlnm: '다라', speclActSpablMteCn: '' }, { clsNo: '3', stuFlnm: '마바', speclActSpablMteCn: '이미 있는 글' }],
}, over);
const COND = { screen: 'autonomy', schoolYear: 2026, semester: 2, grade: 3, classNo: 10, area: 'autonomy', subject: null };
const it = (id, no, name, text, grade = 3, classNo = 10) => ({ id, grade, classNo, no, name, text });

// ---------- 1. 보일 때만 활성 ----------
{
  const sc = autonomy({ shown: false });
  const env = makeEnv({ verified: false, screens: [sc] });
  let r = (await env.cmd('detect')).result;
  assert.equal(r.state, 'hidden');
  assert.equal(r.hiddenLabel, '자율·자치활동(자율활동)관리');
  assert.equal(r.cond, null);

  sc.shown = true;
  r = (await env.cmd('detect')).result;
  assert.equal(r.state, 'active');
  assert.deepEqual({ ...r.cond }, { ...COND, screenLabel: '자율·자치활동(자율활동)관리' });   // 학기는 dsSwcSem 에서
  assert.equal(r.rowCount, 3);
  assert.equal(r.closed, null);

  sc.shown = false;     // 다른 탭으로 옮김
  assert.equal((await env.cmd('detect')).result.state, 'hidden');
}
// 열린 화면이 없으면 none
assert.equal((await makeEnv({ verified: false, screens: [] }).cmd('detect')).result.state, 'none');
// 같은 화면의 인스턴스가 둘이면 보이는 쪽을 쓴다 (앞의 것은 숨김)
{
  const a = autonomy({ shown: false, dm: { ayr: '2026', sem: '', grd: '3', clsCd: '99', actScCd: '11' } });
  const b = autonomy({ shown: true });
  const env = makeEnv({ verified: false, screens: [a, b] });
  assert.equal((await env.cmd('detect')).result.cond.classNo, 10);
}
// 영역 코드가 다르면 그 화면으로 보지 않는다 (조건 읽기 실패)
{
  const env = makeEnv({ verified: false, screens: [autonomy({ dm: { ayr: '2026', sem: '', grd: '3', clsCd: '10', actScCd: '14' } })] });
  assert.equal((await env.cmd('detect')).result.cond, null);
}

// ---------- 2. 마감이면 입력 안 함 ----------
{
  const env = makeEnv({ verified: true, screens: [autonomy({ ddln: { ddlnYn: 'Y' } })] });
  assert.ok((await env.cmd('detect')).result.closed);
  const r = await env.cmd('fill', { cond: COND, items: [it('a', 1, '가나', '새 글')] });
  assert.equal(r.ok, false); assert.equal(r.error.code, 'closed');
}

// ---------- 3. 확인 전(verified false)에는 쓰지 않음 ----------
{
  const env = makeEnv({ verified: false, screens: [autonomy()] });
  const r = await env.cmd('fill', { cond: COND, items: [it('a', 1, '가나', '새 글')] });
  assert.equal(r.error.code, 'not_verified');
  assert.equal(env.screens[0].table.rows[0].v.speclActSpablMteCn, '');
}

// ---------- 4. 안 보이면 입력·저장 거부 ----------
{
  const sc = autonomy({ shown: false });
  const env = makeEnv({ verified: true, screens: [sc] });
  let r = await env.cmd('fill', { cond: COND, items: [it('a', 1, '가나', '새 글')] });
  assert.equal(r.error.code, 'not_visible');
  r = await env.cmd('save', { cond: COND, expect: [] });
  assert.equal(r.error.code, 'not_visible');
  assert.equal(sc.clicked, undefined, '저장 버튼을 누르면 안 됨');
  assert.equal(sc.table.rows[0].v.speclActSpablMteCn, '');
}

// ---------- 5. 입력 규칙 ----------
{
  const sc = autonomy();
  const env = makeEnv({ verified: true, screens: [sc] });
  const r = await env.cmd('fill', { cond: COND, items: [
    it('ok', 1, '가나', '활동함'), it('nm', 2, '다른이름', '글'), it('ex', 3, '마바', '새 글'), it('nf', 9, '없음', '글'), it('g2', 1, '가나', '다른 학년', 2, 10),
  ] });
  assert.ok(r.ok, JSON.stringify(r));
  const st = Object.fromEntries(r.result.results.map((x) => [x.id, x.status]));
  assert.deepEqual(st, { ok: 'entered', nm: 'name_mismatch', ex: 'existing', nf: 'not_found', g2: 'not_found' });
  assert.equal(sc.table.rows[0].v.speclActSpablMteCn, '활동함');
  assert.equal(sc.table.rows[1].v.speclActSpablMteCn, '');           // 이름이 달라 안 넣음
  assert.equal(sc.table.rows[2].v.speclActSpablMteCn, '이미 있는 글'); // 덮어쓰지 않음
  // 저장 직전 검사: 확장이 안 넣은 행이 바뀌어 있으면 거부, 버튼은 안 누름
  sc.table.rows[1].st = 4;
  const sv = await env.cmd('save', { cond: COND, expect: [{ grade: 3, classNo: 10, no: 1, text: '활동함' }] });
  assert.equal(sv.error.code, 'stray_change');
  assert.equal(sc.clicked, undefined);
}

// ---------- 5-2. 이미 글이 있을 때: 선택 전에는 넣지 않고, 덮어쓰기/이어쓰기는 선택한 학생만 ----------
{
  const sc = autonomy({ rows: [
    { clsNo: '1', stuFlnm: '가나', speclActSpablMteCn: '원래 글입니다.  \n' },
    { clsNo: '2', stuFlnm: '다라', speclActSpablMteCn: '다른 원래 글' },
    { clsNo: '3', stuFlnm: '마바', speclActSpablMteCn: '새 글 포함된 원래 글 새 글' },
    { clsNo: '4', stuFlnm: '사아', speclActSpablMteCn: '' },
  ] });
  const env = makeEnv({ verified: true, screens: [sc] });
  const T = sc.table.rows;
  const col = 'speclActSpablMteCn';
  // (1) 선택 없이: 덮어쓰지 않음
  let r = await env.cmd('fill', { cond: COND, items: [it('a', 1, '가나', '새 글'), it('b', 2, '다라', '새 글'), it('c', 3, '마바', '새 글')] });
  assert.deepEqual(Array.from(r.result.results.map((x) => x.status)), ['existing', 'existing', 'contained']);
  assert.equal(T[0].v[col], '원래 글입니다.  \n'); assert.equal(T[1].v[col], '다른 원래 글');
  assert.equal(T[0].st, 1);
  // (2) 이어쓰기: 기존 글 끝 공백 정리 + 구분 글자 + 새 글
  r = await env.cmd('fill', { cond: COND, items: [{ ...it('a', 1, '가나', '새 글'), mode: 'append' }] });
  assert.equal(r.result.results[0].status, 'entered'); assert.equal(r.result.results[0].mode, 'append');
  assert.equal(T[0].v[col], '원래 글입니다. 새 글');
  assert.equal(T[0].v.length, '28', '글과 함께 length 열도 맞춘다 (한글 8자 x 3 + 나머지 4)');
  assert.equal(r.result.results[0].entered, '원래 글입니다. 새 글');
  assert.equal(r.result.results[0].neisText, '원래 글입니다.');   // 바꾸기 전 글도 알려 줌
  // 이미 들어 있는 글은 이어쓰기를 해도 또 붙이지 않음
  r = await env.cmd('fill', { cond: COND, items: [{ ...it('c', 3, '마바', '새 글'), mode: 'append' }] });
  assert.equal(r.result.results[0].status, 'contained'); assert.equal(T[2].v[col], '새 글 포함된 원래 글 새 글');
  // (3) 덮어쓰기
  r = await env.cmd('fill', { cond: COND, items: [{ ...it('b', 2, '다라', '새 글'), mode: 'overwrite' }] });
  assert.equal(r.result.results[0].mode, 'overwrite'); assert.equal(T[1].v[col], '새 글'); assert.equal(T[1].st, 4);
  assert.equal(r.result.results[0].neisText, '다른 원래 글');
  // (4) 글이 없는 학생은 mode 와 상관없이 그냥 입력
  r = await env.cmd('fill', { cond: COND, items: [{ ...it('d', 4, '사아', '처음 글'), mode: 'append' }] });
  assert.equal(r.result.results[0].mode, null); assert.equal(T[3].v[col], '처음 글');
  // (5) 이어쓴 결과가 바이트 한도를 넘으면 넣지 않음 (한도는 웹앱 한도 limit 로 전달)
  T[1].v[col] = '가'.repeat(5); T[1].st = 1;                                   // 15바이트
  r = await env.cmd('fill', { cond: COND, items: [{ ...it('e', 2, '다라', '나'.repeat(4)), mode: 'append', limit: 20 }] });   // 15 + 1 + 12 = 28 > 20
  assert.equal(r.result.results[0].status, 'too_long'); assert.equal(r.result.results[0].capacity, 20);
  assert.equal(T[1].v[col], '가'.repeat(5));
  // 저장 직전 검사는 확장이 넣은 행(이어쓴 최종 글 포함)만 허용
  const sv = await env.cmd('save', { cond: COND, expect: [{ grade: 3, classNo: 10, no: 1, text: '원래 글입니다. 새 글' }] });
  assert.equal(sv.error.code, 'stray_change');   // 2번·4번 행도 바뀌어 있는데 expect 에 없음
}

// ---------- 6. 동아리: 학년·반은 표의 열에서 (번호만 같은 다른 반 학생을 구분) ----------
{
  const sc = {
    appId: 'edu/sw/mis/sdl/ce/mis_sdlce01_m06', ds: 'dsScrgRec', shown: true,
    dm: { ayr: '2026', sem: '2', grd: '', clsCd: '', actScCd: '12' },
    ddln: { scrgClsDdlnYn: 'N', ddlnYn: 'N' },
    rows: [
      { grd: '3', clsCd: '01', clsNo: '3', stuFlnm: '가나', speclActSpablMteCn: '', scrgRfltYn: 'N' },
      { grd: '3', clsCd: '05', clsNo: '3', stuFlnm: '다라', speclActSpablMteCn: '', scrgRfltYn: 'N' },
      { grd: '3', clsCd: '06', clsNo: '7', stuFlnm: '마바', speclActSpablMteCn: '', scrgRfltYn: 'Y' },   // 학생부에 이미 반영
    ],
  };
  const env = makeEnv({ verified: true, screens: [sc] });
  const det = (await env.cmd('detect')).result;
  assert.equal(det.cond.area, 'club'); assert.equal(det.cond.semester, 2); assert.equal(det.cond.grade, null); assert.equal(det.cond.classNo, null);
  const cond = { screen: 'club', schoolYear: 2026, semester: 2, grade: null, classNo: null, area: 'club', subject: null };
  const r = await env.cmd('fill', { cond, items: [it('b5', 3, '다라', '5반 글', 3, 5), it('b1', 3, '가나', '1반 글', 3, 1), it('lk', 7, '마바', '잠긴 글', 3, 6)] });
  const st = Object.fromEntries(r.result.results.map((x) => [x.id, x.status]));
  assert.deepEqual(st, { b5: 'entered', b1: 'entered', lk: 'locked' });
  assert.equal(sc.table.rows[0].v.speclActSpablMteCn, '1반 글');
  assert.equal(sc.table.rows[1].v.speclActSpablMteCn, '5반 글');
  assert.equal(sc.table.rows[2].v.speclActSpablMteCn, '');
}

// ---------- 7. 교과세특: 학생별 입력 가능 바이트 ----------
{
  const sc = {
    appId: 'edu/sw/mis/scr/mc/mis_scrmc50_m00', ds: 'dsGridMain', ddlnId: 'dmCheckTeukDesc', shown: true,
    dm: { ayr: '2026', sem: '2', grd: '3', sbjtNm: '과학' },
    ddln: { ddlnYn: 'N' },
    rows: [
      { grd: '3', clsCd: '08', clsNo: '1', stuFlnm: '가나', genDetaAbtSpablMteCn: '', othSemInputLen01: '1500', enableYn: 'true' },
      { grd: '3', clsCd: '08', clsNo: '2', stuFlnm: '다라', genDetaAbtSpablMteCn: '', othSemInputLen01: '20', enableYn: 'true' },     // 가능 20바이트
      { grd: '3', clsCd: '08', clsNo: '3', stuFlnm: '마바', genDetaAbtSpablMteCn: '', othSemInputLen01: '1500', enableYn: 'false' },
    ],
  };
  const env = makeEnv({ verified: true, screens: [sc] });
  const det = (await env.cmd('detect')).result;
  assert.equal(det.cond.area, 'subject'); assert.equal(det.cond.subject, '과학'); assert.equal(det.cond.grade, 3); assert.equal(det.cond.classNo, null);
  const cond = { screen: 'subject', schoolYear: 2026, semester: 2, grade: 3, classNo: null, area: 'subject', subject: '과학' };
  const long = '가'.repeat(10);   // 30바이트
  const r = await env.cmd('fill', { cond, items: [it('a', 1, '가나', long, 3, 8), it('b', 2, '다라', long, 3, 8), it('c', 3, '마바', '글', 3, 8)] });
  const st = Object.fromEntries(r.result.results.map((x) => [x.id, x.status]));
  assert.deepEqual(st, { a: 'entered', b: 'too_long', c: 'locked' });
  assert.equal(r.result.results.find((x) => x.id === 'b').capacity, 20);
  assert.equal(sc.table.rows[1].v.genDetaAbtSpablMteCn, '');
}

console.log('detect tests ok');
