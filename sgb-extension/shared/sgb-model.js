// 생기부 데이터 모델: 사이드 패널과 tests/ 가 함께 쓴다 (화면과 무관한 순수 함수만).
// 웹앱 v2 계약(textgenerator-v2/docs/contract.md 7절, 12절, 19절)에 맞춘다.
export const DATA_FILE_NAME = 'sgb-data.json';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const DATA_KIND = 'sgb-v2-data';
export const KNOWN_SCHEMA = 2; // 이보다 새 드라이브 파일은 읽지도 쓰지도 않는다

export const AREAS = {
  autonomy: '자율·자치',
  club: '동아리',
  career: '진로',
  behavior: '행동특성 및 종합의견',
  subject: '교과세특',
};
// 웹앱 기본 한도 (settings.limits 가 있으면 그것을 쓴다). 실제 나이스 한도는 화면 분석 때 확인.
export const DEFAULT_LIMITS = { autonomy: 1500, club: 1500, career: 1500, behavior: 900, subject: 1500 };

// 나이스 값과 비교할 때만 쓰는 정리 규칙: 유니코드 NFC, 줄바꿈 \n, 줄 끝 공백과 앞뒤 공백 제거 (해시에는 쓰지 않음)
export const normText = (s) => String(s ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
export const normName = (s) => String(s ?? '').replace(/\s+/g, '');
export const normSubject = (s) => String(s ?? '').replace(/\s+/g, '');

// 웹앱 bytes.js 와 같은 규칙: 한글(가-힣, 호환 자모) 3, 그 밖 문자 1 (줄바꿈 포함).
// shortcut: 나이스 실제 계산과 같은지는 화면 분석 때 확인한다. 다르면 웹앱과 함께 고친다.
export function neisBytes(s) {
  let n = 0;
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    n += (c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3131 && c <= 0x3163) ? 3 : 1;
  }
  return n;
}

// 웹앱 neis-export.js 와 같다: 원문 그대로 SHA-256 hex 앞 16자리
export async function textHash(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s ?? '')));
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

// '30503' -> {3, 5, 3} (웹앱 splitStudentId)
export function splitStudentId(id) {
  const s = String(id ?? '').trim();
  return { grade: Number(s.slice(0, 1)), classNo: Number(s.slice(1, 3)), no: Number(s.slice(3, 5)) };
}

const posInt = (v) => Number.isInteger(Number(v)) && Number(v) > 0;
const hasText = (s) => typeof s === 'string' && s.trim() !== '';

// 기록 하나 검사 + 바이트·해시는 직접 다시 계산 (받은 값은 믿지 않음). 본문은 원문 그대로 둔다.
export async function toItem(r, where) {
  if (!r || typeof r !== 'object') throw new Error(`${where}: 형식이 올바르지 않습니다.`);
  if (!AREAS[r.area]) throw new Error(`${where}: 영역(area) '${r.area}'를 알 수 없습니다.`);
  if (!posInt(r.grade) || !posInt(r.classNo) || !posInt(r.no)) throw new Error(`${where}: 학년·반·번호가 올바르지 않습니다.`);
  if (!hasText(r.name)) throw new Error(`${where}: 이름이 없습니다.`);
  if (r.area === 'subject' && !hasText(r.subject)) throw new Error(`${where}: 교과세특인데 과목명이 없습니다.`);
  if (!hasText(r.text)) throw new Error(`${where}: 본문이 비어 있습니다.`);
  const grade = Number(r.grade), classNo = Number(r.classNo), no = Number(r.no);
  const subject = r.area === 'subject' ? String(r.subject).trim() : null;
  const studentId = `${grade}${String(classNo).padStart(2, '0')}${String(no).padStart(2, '0')}`;
  return {
    id: String(r.id || `${studentId}|${r.area}${subject ? `|${subject}` : ''}`),
    grade, classNo, no, name: r.name.trim(), area: r.area, subject, text: r.text,
    bytes: neisBytes(r.text), hash: await textHash(r.text),
    neisHash: r.neisHash || null, // 드라이브에 이미 남은 입력 완료 표시의 hash
  };
}

// 웹앱에서 내려받은 'NEIS 입력 파일' (kind: sgb-neis-batch)
export async function parseBatch(raw) {
  let obj;
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { throw new Error('JSON 파일이 아닙니다.'); }
  if (!obj || obj.kind !== 'sgb-neis-batch') throw new Error('생기부 NEIS 입력 파일이 아닙니다 (kind 확인).');
  if (obj.version !== 1) throw new Error(`지원하지 않는 파일 버전입니다 (version ${obj.version}).`);
  if (!Array.isArray(obj.items)) throw new Error('items 항목이 없습니다.');
  const items = [];
  let skipped = 0;
  for (let i = 0; i < obj.items.length; i++) {
    const it = obj.items[i];
    if (it && typeof it === 'object' && !hasText(it.name)) { skipped++; continue; } // 웹앱 명단에 없는 학생: 번호·이름 대조가 안 되므로 뺀다
    items.push(await toItem(it, `${i + 1}번째 글`));
  }
  return { schoolYear: Number(obj.schoolYear) || null, semester: Number(obj.semester) || null, limits: null, source: 'file', receivedAt: Date.now(), skipped, items };
}

// 드라이브 파일 확인: 다른 종류이거나 더 새 버전이면 거부
export function checkDriveFile(obj) {
  if (!obj || obj.kind !== DATA_KIND) throw new Error('드라이브의 생기부 데이터 파일 형식이 아닙니다.');
  if (Number(obj.schemaVersion) > KNOWN_SCHEMA) throw new Error('더 새 버전의 웹앱이 드라이브에 저장했습니다. 확장프로그램을 업데이트하세요.');
}

// 드라이브의 sgb-data.json -> 입력 대상 (status 'done' 이고 final 이 있는 기록만). 이름이 없는 학생 등은 건너뛰고 개수만 센다.
export async function fromDriveData(obj) {
  checkDriveFile(obj);
  const names = new Map((obj.students || []).filter((s) => s && s.studentId).map((s) => [String(s.studentId), s.name]));
  const items = [];
  let skipped = 0;
  for (const r of obj.records || []) {
    if (!r || r.status !== 'done' || !hasText(r.final)) continue;
    const { grade, classNo, no } = splitStudentId(r.studentId);
    try {
      items.push(await toItem({ id: r.id, grade, classNo, no, name: names.get(String(r.studentId)), area: r.area, subject: r.subject, text: r.final,
        neisHash: r.neis && r.neis.hash }, '기록'));
    } catch (e) { skipped++; }
  }
  const s = obj.settings || {};
  return { schoolYear: Number(s.schoolYear) || null, semester: Number(s.semester) || null, limits: s.limits || null, source: 'drive', receivedAt: Date.now(), skipped, items };
}

// 저장 결과를 드라이브 파일에 반영: 해당 기록의 neis 만 { hash, doneAt } 로 바꾼다 (updatedAt 등 다른 필드는 그대로).
// 그 사이 웹앱에서 최종본이 바뀐 기록(해시 다름)은 건드리지 않는다. saved: [{ id, hash, doneAt(ISO) }]
export async function applyNeisDone(obj, saved) {
  checkDriveFile(obj);
  const byId = new Map(saved.map((s) => [s.id, s]));
  let changed = 0;
  for (const r of obj.records || []) {
    const s = r && byId.get(String(r.id));
    if (!s || !hasText(r.final) || (await textHash(r.final)) !== s.hash) continue;
    if (r.neis && r.neis.hash === s.hash) continue; // 이미 표시됨 (doneAt 도 그대로 둔다)
    r.neis = { hash: s.hash, doneAt: s.doneAt };
    changed++;
  }
  return changed;
}

// 나이스 화면 조건에 맞는 글 + 같은 학생 글이 2개 이상이면 dup 표시.
// 조건에 학년·반이 없으면(동아리, 교과세특은 반이 섞여 있음) 그 항목은 거르지 않는다.
const idOf = (it) => `${it.grade}|${it.classNo}|${it.no}`;
export function itemsFor(items, cond) {
  if (!cond) return [];
  const list = items.filter((it) => it.area === cond.area &&
    (cond.grade == null || it.grade === Number(cond.grade)) &&
    (cond.classNo == null || it.classNo === Number(cond.classNo)) &&
    (it.area !== 'subject' || normSubject(it.subject) === normSubject(cond.subject)));
  const count = new Map();
  for (const it of list) count.set(idOf(it), (count.get(idOf(it)) || 0) + 1);
  return list.map((it) => ({ ...it, dup: count.get(idOf(it)) > 1 })).sort((a, b) => a.grade - b.grade || a.classNo - b.classNo || a.no - b.no);
}

export const limitFor = (data, area) => Number((data && data.limits && data.limits[area]) || DEFAULT_LIMITS[area]);

export const condLabel = (c) => (c ? `${c.grade ? `${c.grade}학년 ` : ''}${c.classNo ? `${c.classNo}반 ` : ''}${AREAS[c.area] || c.area}${c.area === 'subject' && c.subject ? ` (${c.subject})` : ''}` : '');

// 불러온 글을 조건별로 묶어 요약 ('3학년 5반 자율·자치 12명')
export function groupSummary(items) {
  const m = new Map();
  for (const it of items) {
    const k = condLabel(it);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m, ([label, n]) => `${label} ${n}명`);
}

// ---------- 불러온 파일(출처) 여러 개 ----------
// data.sources: [{ id, kind: 'drive'|'excel'|'json'|'legacy', name, detail, receivedAt, count, on }]. 각 글의 it.src 가 출처 id.
// 선생님이 일부 파일만 적용할 수 있도록 on 이 꺼진 출처의 글은 activeItems 에서 빠진다.
export function ensureSources(data) {
  if (!data || Array.isArray(data.sources)) return data;
  const kind = data.source === 'drive' ? 'drive' : 'legacy';
  const src = { id: kind === 'drive' ? 'drive' : 'legacy', kind, name: kind === 'drive' ? DATA_FILE_NAME : '이전에 불러온 파일', detail: kind === 'drive' ? '구글 드라이브' : '', receivedAt: data.receivedAt || null, count: (data.items || []).length, on: true };
  return { ...data, sources: [src], items: (data.items || []).map((it) => ({ ...it, src: src.id })) };
}
export const activeItems = (data) => {
  const d = ensureSources(data);
  if (!d) return [];
  const on = new Set(d.sources.filter((s) => s.on).map((s) => s.id));
  return d.items.filter((it) => on.has(it.src));
};
// 새로 읽은 파일을 목록에 넣는다. 같은 출처 id 면 바꿔 넣는다. 학년도·학기가 이미 불러온 것과 다르면 이전 파일은 모두 뺀다 (replacedOthers).
export function addSource(data, incoming, src) {
  let base = ensureSources(data);
  let replacedOthers = false;
  const differs = (a, b) => a != null && b != null && Number(a) !== Number(b);
  if (base && base.sources.some((s) => s.id !== src.id) && (differs(base.schoolYear, incoming.schoolYear) || differs(base.semester, incoming.semester))) {
    base = { ...base, sources: base.sources.filter((s) => s.id === src.id), items: base.items.filter((it) => it.src === src.id) };
    replacedOthers = true;
  }
  const sources = (base ? base.sources.filter((s) => s.id !== src.id) : []).concat([{ ...src, receivedAt: incoming.receivedAt || Date.now(), count: incoming.items.length, on: true }]);
  const items = (base ? base.items.filter((it) => it.src !== src.id) : []).concat(incoming.items.map((it) => ({ ...it, src: src.id })));
  const out = {
    schoolYear: incoming.schoolYear ?? (base && base.schoolYear) ?? null,
    semester: incoming.semester ?? (base && base.semester) ?? null,
    limits: incoming.limits || (base && base.limits) || null,
    receivedAt: incoming.receivedAt || Date.now(), skipped: incoming.skipped || 0, sources, items,
  };
  // 켜고 끈 상태는 같은 출처를 다시 받아도 유지한다
  const prev = base && base.sources.find((s) => s.id === src.id);
  if (prev) out.sources.find((s) => s.id === src.id).on = prev.on;
  return { data: out, replacedOthers };
}
