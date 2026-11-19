// 학교 행사 목록 점검 (자율·진로): 글의 '행사명(날짜)'가 학교 행사 목록과 이름·날짜 모두 같은지.
// 날짜 형식은 기재요령(중 77, 고 82): 하루 2026.03.04. / 기간 2026.03.04.-2026.07.08.
// 순수 모듈 (DOM 없음).

export const EVENT_AREAS = ['autonomy', 'career'];
export const MAX_EVENTS = 300;

const p2 = (n) => String(n).padStart(2, '0');

/** 날짜 하나 -> 'YYYY.MM.DD.'. '2026-5-14', '2026.05.14', '20260514', '2026년 5월 14일', '5.14'(year 필요). 못 읽으면 null */
function oneDate(raw, year) {
  const s = String(raw ?? '').trim().replace(/\s+/g, '');
  let r = s.match(/^(\d{4})[.\-/년](\d{1,2})[.\-/월](\d{1,2})[.일]?$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
  let y; let m; let d;
  if (r) [, y, m, d] = r;
  else if ((r = s.match(/^(\d{1,2})[.\-/월](\d{1,2})[.일]?$/)) && year) { [, m, d] = r; y = String(year); } else return null;
  const dt = new Date(+y, +m - 1, +d);
  if (dt.getFullYear() !== +y || dt.getMonth() !== +m - 1 || dt.getDate() !== +d) return null;
  return `${+y}.${p2(+m)}.${p2(+d)}.`;
}

/** 날짜 또는 기간을 기재요령 꼴로. 못 읽으면 null */
export function canonDate(raw, year) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const parts = s.split(/\s*[~〜∼–]\s*|\s+-\s+|(?<=[.일])\s*-\s*(?=\d)/);
  if (parts.length > 2) return null;
  const a = oneDate(parts[0], year);
  if (!a) return null;
  if (parts.length === 1) return a;
  const b = oneDate(parts[1], +a.slice(0, 4));
  if (!b || b < a) return null;
  return b === a ? a : `${a}-${b}`;
}

/**
 * 행사 목록 읽기. 줄마다 '행사명<탭|쉼표|공백>날짜' 또는 '행사명(날짜)'. 표(2차원 배열)도 받는다 (앞 칸 이름, 뒤 칸 날짜).
 * 머리글 줄(행사명, 날짜)은 건너뛴다. 반환 { events: [{ name, date }], errors: [줄 안내] }
 */
export function parseEventList(input, year) {
  const rows = Array.isArray(input) ? input : String(input ?? '').split(/\r\n|\r|\n/).map((l) => [l]);
  const events = [];
  const errors = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    const cells = (Array.isArray(row) ? row : [row]).map((c) => String(c ?? '').trim()).filter(Boolean);
    if (!cells.length) return;
    let name; let rawDate;
    if (cells.length >= 2) { [name, rawDate] = [cells[0], cells.slice(1).join(' ')]; } else {
      const line = cells[0];
      const m = line.match(/^(.+?)\s*\(([^()]+)\)\s*$/) || line.match(/^(.+?)[\t,]\s*(.+)$/) || line.match(/^(.+?)\s+(\d{4}[.\-/년][\s\S]*|\d{8}[\s\S]*)$/);
      if (!m) { errors.push(`${i + 1}째 줄: 행사명과 날짜를 나눌 수 없습니다 ('${line.slice(0, 30)}')`); return; }
      [, name, rawDate] = m;
    }
    if (/^(행사|행사명|이름)$/.test(name) && /날짜|일자|기간/.test(rawDate)) return; // 머리글
    const date = canonDate(rawDate, year);
    if (!date) { errors.push(`${i + 1}째 줄: '${rawDate.slice(0, 30)}'을(를) 날짜로 읽을 수 없습니다 (예: 2026.03.04. 또는 2026.03.04.-2026.03.06.)`); return; }
    name = name.replace(/\s+/g, ' ').slice(0, 60);
    const k = `${name}|${date}`;
    if (seen.has(k)) return;
    seen.add(k);
    events.push({ name, date });
  });
  if (events.length > MAX_EVENTS) { errors.push(`행사는 ${MAX_EVENTS}개까지만 씁니다.`); events.length = MAX_EVENTS; }
  return { events, errors };
}

export const eventLabel = (e) => `${e.name}(${e.date})`;

/**
 * 글의 행사 표기 점검. events: [{ name, date }] (canonDate 를 거친 것)
 * - event-date: 이름은 목록과 같은데 날짜가 다름 (고칠 값 있음)
 * - event-name: 날짜는 목록에 있는데 앞의 이름이 목록과 다름
 * - event-unknown: 괄호 속 날짜가 목록에 없음
 * - event-no-date: 목록의 행사 이름 뒤에 날짜가 없음 (고칠 값 있음)
 */
export function checkEvents(text, events, year) {
  const t = String(text ?? '');
  const list = (Array.isArray(events) ? events : []).filter((e) => e?.name && e?.date).sort((a, b) => b.name.length - a.name.length);
  if (!list.length || !t) return [];
  const out = [];
  const covered = []; // 이미 날짜가 붙어 있는 이름 위치
  for (const m of t.matchAll(/\(([^()]{4,40})\)/g)) {
    const canon = canonDate(m[1], year);
    if (!canon) continue;
    const before = t.slice(0, m.index).replace(/\s+$/, '');
    const byName = list.find((e) => before.endsWith(e.name));
    if (byName) {
      covered.push(before.length - byName.name.length);
      if (canon !== byName.date) {
        out.push({ ruleId: 'event-date', level: 'warn', start: m.index + 1, end: m.index + 1 + m[1].length, fix: byName.date, reason: `학교 행사 목록의 '${byName.name}' 날짜는 ${byName.date}` });
      }
      continue;
    }
    const byDate = list.filter((e) => e.date === canon);
    if (byDate.length) {
      out.push({ ruleId: 'event-name', level: 'warn', start: m.index, end: m.index + m[0].length, reason: `이 날짜의 학교 행사는 ${byDate.map((e) => `'${e.name}'`).join(', ')}. 앞의 행사 이름을 목록과 똑같이 씀` });
    } else {
      out.push({ ruleId: 'event-unknown', level: 'warn', start: m.index, end: m.index + m[0].length, reason: '학교 행사 목록에 없는 날짜. 행사 이름과 날짜를 확인' });
    }
  }
  for (const e of list) {
    let i = t.indexOf(e.name);
    while (i >= 0) {
      const after = t.slice(i + e.name.length);
      const inside = list.some((o) => o !== e && o.name.length > e.name.length && o.name.includes(e.name) && t.slice(Math.max(0, i - o.name.length), i + o.name.length).includes(o.name));
      if (!/^\s*\(/.test(after) && !inside && !covered.includes(i)) {
        out.push({ ruleId: 'event-no-date', level: 'warn', start: i, end: i + e.name.length, fix: eventLabel(e), reason: `행사 이름 뒤에 날짜를 붙임: ${eventLabel(e)}` });
      }
      i = t.indexOf(e.name, i + e.name.length);
    }
  }
  return out;
}
