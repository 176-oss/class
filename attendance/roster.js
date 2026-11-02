// 학생 명단 보조 (화면 공통). 이름 표시는 모두 nameFor 를 거친다.
import { nameOf, hasRoster } from './shared/model.js';
import { store } from './store.js';

export const getRoster = () => (store.data && store.data.roster) || null;
export const rosterOn = () => hasRoster(getRoster());
// 번호로 이름 (명단이 없거나 번호가 없으면 '')
export const nameFor = (no) => nameOf(getRoster(), no);
// '7번 홍길동' 또는 '7번'
export const stuLabel = (no) => {
  const n = nameFor(no);
  return n ? `${no}번 ${n}` : `${no}번`;
};

// 설정 줄 요약: '29명 등록됨 · 마지막 갱신 11월 3일 14:05' / '등록 안 됨'
export function rosterSummary(roster) {
  if (!hasRoster(roster)) return '등록 안 됨';
  let s = `${roster.students.length}명 등록됨`;
  const t = roster.updatedAt ? new Date(roster.updatedAt) : null;
  if (t && !Number.isNaN(t.getTime())) {
    s += ` · 마지막 갱신 ${t.getMonth() + 1}월 ${t.getDate()}일 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  }
  return s;
}
