// 화면 상태와 계산. 학생 글은 메모리에만 둔다 (페이지를 닫으면 사라짐). 설정만 localStorage에.
import { checkText, checkClass } from '../rules/check.js';
import { byteLimit, areaById } from '../rules/areas.js';
import { DEFAULT_MODELS, validModel } from './ai.js';
import { createKeyStore } from '../shared/key-store.js';

const SETTINGS_KEY = 'sgb-checker:settings';
const ls = (() => { try { return window.localStorage; } catch { return null; } })();

export const keys = createKeyStore(ls);

function defaults() {
  return { school: 'mid', limits: {}, schoolWords: [], aiOn: false, models: [...DEFAULT_MODELS], fakeAi: false };
}
function loadSettings() {
  const d = defaults();
  try {
    const v = JSON.parse(ls?.getItem(SETTINGS_KEY) || 'null');
    if (!v || typeof v !== 'object') return d;
    if (v.school === 'mid' || v.school === 'high') d.school = v.school;
    if (v.limits && typeof v.limits === 'object') {
      for (const [k, n] of Object.entries(v.limits)) if (areaById(k) && Number.isInteger(n) && n > 0 && n <= 5000) d.limits[k] = n;
    }
    if (Array.isArray(v.schoolWords)) d.schoolWords = v.schoolWords.filter((w) => typeof w === 'string' && w.trim().length >= 2).map((w) => w.trim().slice(0, 40)).slice(0, 30);
    d.aiOn = v.aiOn === true;
    d.fakeAi = v.fakeAi === true;
    if (Array.isArray(v.models)) { const m = v.models.filter(validModel).slice(0, 8); if (m.length) d.models = m; }
  } catch { /* 깨진 설정은 기본값 */ }
  return d;
}
export const settings = loadSettings();
export function saveSettings() {
  try { ls?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 저장 못 하면 이번에만 */ }
}

export const S = {
  view: 'start',
  school: settings.school,
  grade: 1,
  items: [], // { key, studentId, name, area, subject, original, current, history, excepted: Map(key->reason), dismissed: Set, ai: [], aiNote, tooLong }
  classIssues: new Map(),
  results: new Map(), // key -> { issues, bytes, limit }
  filter: 'all',
  areaKey: 'all', // 결과 표에서 보는 항목(과목): 'all' 또는 '영역|과목'
  panel: false, // 결과 표 오른쪽 상세 패널
  current: 0,
  aiConfirmed: false,
  notice: null, // { kind, text }
};

export function schoolYear(now = new Date()) {
  return now.getMonth() + 1 <= 2 ? now.getFullYear() - 1 : now.getFullYear();
}
export const allNames = () => [...new Set(S.items.map((i) => i.name).filter(Boolean))];

export function itemCtx(it) {
  return {
    school: S.school, grade: S.grade, area: it.area, subject: it.subject,
    limitBytes: byteLimit(it.area, S.school, settings.limits),
    names: allNames(), schoolWords: settings.schoolWords, schoolYear: schoolYear(),
  };
}

/** 글이 바뀐 학생(없으면 모두)을 다시 점검. 반 전체 점검은 늘 다시 */
export function recheck(it) {
  const list = it ? [it] : S.items;
  for (const x of list) S.results.set(x.key, x.current.trim() ? checkText(x.current, itemCtx(x)) : { issues: [], bytes: 0, limit: itemCtx(x).limitBytes });
  S.classIssues = checkClass(S.items.map((x) => ({ key: x.key, studentId: x.studentId, name: x.name, area: x.area, subject: x.subject, text: x.current })), { school: S.school, grade: S.grade });
}

/** 지적 전부 (규칙 + 반 전체 + AI). off: 예외 처리·그대로 둠 */
export function issuesOf(it) {
  const r = S.results.get(it.key);
  const all = [...(r?.issues || []), ...(S.classIssues.get(it.key) || []), ...it.ai];
  if (it.tooLong) all.unshift({ ruleId: 'too-long', label: '너무 김', level: 'error', start: 0, end: 0, text: '', key: 'too-long|', basis: '', reason: '엑셀 셀이 5,000자를 넘어 앞부분만 읽었습니다. 원본 파일을 확인하세요.' });
  return all.map((i) => ({ ...i, off: it.excepted.has(i.key) ? 'except' : it.dismissed.has(i.key) ? 'keep' : null }));
}
export const activeIssues = (it) => issuesOf(it).filter((i) => !i.off);

export function statusOf(it) {
  if (!it.current.trim()) return 'empty';
  const a = activeIssues(it);
  if (a.some((i) => i.level === 'error')) return 'error';
  if (a.length) return 'warn';
  return 'pass';
}
export const STATUS_LABEL = { pass: '통과', warn: '확인', error: '오류', empty: '미작성' };
export const LEVEL_LABEL = { error: '오류', warn: '확인' };

export function areaLabel(it) { return areaById(it.area)?.label || it.area; }

/** 글 바꾸기 (되돌리기용 기록을 남김). AI 결과는 위치가 틀어지므로 지움 */
export function setText(it, next) {
  if (next === it.current) return false;
  it.history.push(it.current);
  if (it.history.length > 50) it.history.shift();
  it.current = next;
  if (it.ai.length) { it.ai = []; it.aiNote = '글이 바뀌어 AI 결과를 지웠습니다. 필요하면 다시 AI로 점검하세요.'; }
  recheck(it);
  return true;
}
export function undo(it) {
  if (!it.history.length) return false;
  it.current = it.history.pop();
  it.ai = [];
  recheck(it);
  return true;
}

/** 읽은 묶음을 학생 목록으로. groups: [{ area, subject, rows }] */
export function loadGroups(groups) {
  S.items = [];
  let n = 0;
  for (const g of groups) for (const r of g.rows) {
    S.items.push({
      key: `k${n++}`, studentId: r.studentId, name: r.name, area: g.area, subject: g.area === 'subject' ? r.subject || g.subject : '',
      original: r.text, current: r.text, history: [], excepted: new Map(), dismissed: new Set(), ai: [], aiNote: '', tooLong: r.tooLong,
    });
  }
  S.current = 0;
  S.filter = 'all';
  S.areaKey = 'all';
  S.panel = false;
  recheck();
}
