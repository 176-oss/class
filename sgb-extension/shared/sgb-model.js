// 생기부 데이터 모델: 사이드 패널과 tests/ 가 함께 쓴다 (화면과 무관한 순수 함수만).
export const DATA_FILE_NAME = 'sgb-data.json';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export const AREAS = {
  autonomy: '자율·자치',
  club: '동아리',
  career: '진로',
  behavior: '행동특성 및 종합의견',
  subject: '교과세특',
};
// shortcut: 나이스 바이트 한도는 가정값(한글 500자 = 1500바이트, 진로 700자), 화면 분석 뒤 실제 값으로 고친다.
export const BYTE_LIMITS = { autonomy: 1500, club: 1500, career: 2100, behavior: 1500, subject: 1500 };

// 비교·해시 전에 항상 같은 규칙으로 정리: 유니코드 NFC, 줄바꿈 \n, 줄 끝 공백과 앞뒤 공백 제거
export const normText = (s) => String(s ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
export const normName = (s) => String(s ?? '').replace(/\s+/g, '');
export const normSubject = (s) => String(s ?? '').replace(/\s+/g, '');

// shortcut: 나이스 바이트 계산 가정 (UTF-8 기준, 한글 3바이트, 줄바꿈 2바이트). 나이스 화면의 바이트 표시와 다르면 고친다.
export function neisBytes(s) {
  let n = 0;
  for (const ch of normText(s)) {
    if (ch === '\n') { n += 2; continue; }
    const cp = ch.codePointAt(0);
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

// sha256(정리한 글) 앞 16자리
export async function textHash(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normText(s)));
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

const posInt = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

// 기록 하나 검사 + 바이트·해시는 직접 다시 계산 (받은 값은 믿지 않음)
async function toItem(r, i) {
  const where = `${i + 1}번째 글`;
  if (!r || typeof r !== 'object') throw new Error(`${where}: 형식이 올바르지 않습니다.`);
  if (!AREAS[r.area]) throw new Error(`${where}: 영역(area) '${r.area}'를 알 수 없습니다.`);
  if (!posInt(r.grade) || !posInt(r.classNo) || !posInt(r.no)) throw new Error(`${where}: 학년·반·번호가 올바르지 않습니다.`);
  if (typeof r.name !== 'string' || !r.name.trim()) throw new Error(`${where}: 이름이 없습니다.`);
  if (r.area === 'subject' && !String(r.subject || '').trim()) throw new Error(`${where}: 교과세특인데 과목명이 없습니다.`);
  const text = normText(r.text);
  if (!text) throw new Error(`${where}: 본문이 비어 있습니다.`);
  const grade = Number(r.grade), classNo = Number(r.classNo), no = Number(r.no);
  const subject = r.area === 'subject' ? String(r.subject).trim() : null;
  return {
    id: String(r.id || `${grade}${String(classNo).padStart(2, '0')}${String(no).padStart(2, '0')}|${r.area}${subject ? `|${subject}` : ''}`),
    grade, classNo, no, name: r.name.trim(), area: r.area, subject, text,
    bytes: neisBytes(text), hash: await textHash(text),
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
  for (let i = 0; i < obj.items.length; i++) items.push(await toItem(obj.items[i], i));
  return { schoolYear: Number(obj.schoolYear) || null, semester: Number(obj.semester) || null, source: 'file', receivedAt: Date.now(), items };
}

// 드라이브의 sgb-data.json -> 입력 대상 (상태가 '완료'인 기록만)
// shortcut: sgb-data.json 형식은 웹앱 v2가 아직 없어 가정({records:[{...item, status, schoolYear, semester}]}). 웹앱이 정해지면 이 함수만 고친다.
export async function fromDriveData(obj) {
  if (!obj || !Array.isArray(obj.records)) throw new Error('드라이브 파일에 records 항목이 없습니다.');
  const done = obj.records.filter((r) => r && (r.status === 'done' || r.status === '완료'));
  const items = [];
  for (let i = 0; i < done.length; i++) items.push(await toItem(done[i], i));
  return { schoolYear: Number(obj.schoolYear) || null, semester: Number(obj.semester) || null, source: 'drive', receivedAt: Date.now(), items };
}

// 저장 결과를 드라이브 데이터에 반영: 해당 기록의 neis 필드만 고친다. 그 사이 웹앱에서 글이 바뀐 기록(해시 다름)은 건드리지 않는다.
export async function applyNeisDone(obj, saved) {
  const byId = new Map(saved.map((s) => [s.id, s]));
  let changed = 0;
  for (const r of obj.records || []) {
    const s = r && byId.get(String(r.id));
    if (!s || (await textHash(r.text)) !== s.hash) continue;
    r.neis = { done: true, doneAt: s.at, hash: s.hash };
    changed++;
  }
  return changed;
}

// 나이스 화면 조건에 맞는 글 + 같은 학생 글이 2개 이상이면 dup 표시
export function itemsFor(items, cond) {
  if (!cond) return [];
  const list = items.filter((it) => it.grade === Number(cond.grade) && it.classNo === Number(cond.classNo) && it.area === cond.area &&
    (it.area !== 'subject' || normSubject(it.subject) === normSubject(cond.subject)));
  const count = new Map();
  for (const it of list) count.set(it.no, (count.get(it.no) || 0) + 1);
  return list.map((it) => ({ ...it, dup: count.get(it.no) > 1 })).sort((a, b) => a.no - b.no);
}

export const condLabel = (c) => (c ? `${c.grade}학년 ${c.classNo}반 ${AREAS[c.area] || c.area}${c.area === 'subject' && c.subject ? ` (${c.subject})` : ''}` : '');

// 불러온 글을 조건별로 묶어 요약 ('3학년 5반 자율·자치 12명')
export function groupSummary(items) {
  const m = new Map();
  for (const it of items) {
    const k = condLabel(it);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m, ([label, n]) => `${label} ${n}명`);
}
