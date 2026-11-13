// 백업: 백업 파일 내보내기·가져오기(미리보기, 되돌리기 지점), 드라이브 자동 백업 되돌리기, 영역별 엑셀 내보내기
import { h, clear, icon } from '../dom.js';
import { toast, confirmDialog, alertBox, viewHeader, downloadJSON, readFileText, stamp, formatDateTime, field, enableDrop } from '../ui.js';
import * as store from '../store.js';
import { AREAS, AREA_LABELS } from '../core/model.js';
import { makeBackup, validateBackup, previewImport, mergeBackup, excelRows } from '../core/backup-format.js';
import { checkDataFile } from '../core/sync-merge.js';
import { downloadSheet, hasXlsx, XLSX_MISSING_TEXT, fillWorkbookFile } from '../xlsx-io.js';
import { planNeisFill, FILL_MODES } from '../core/neis-excel.js';

let root = null;
let ctx = null;
let driveList = null; // null: 아직 안 읽음 | { items } | { error }
let driveHost = null;
let incoming = null; // { backup, preview, fileName }
let importMsg = null;
let exportArea = 'autonomy';
let fillMode = 'empty';
let fillNotDone = false;
let fillResult = null; // { fileName, outName, total, sheets, sums, issues } | { error }

function currentBackup() {
  const d = store.snapshotData();
  return makeBackup({ ...d, settings: settingsForBackup(d.settings), now: new Date().toISOString() });
}
function settingsForBackup(s) {
  // API 키는 설정에 없지만, 혹시 모를 키 관련 칸은 빼고 넣는다
  const { apiKey, key, ...rest } = s || {};
  void apiKey; void key;
  return rest;
}

function exportCard() {
  return h('section', { class: 'card stack', 'aria-labelledby': 'bk-export-title' },
    h('h2', { class: 'card-title', id: 'bk-export-title' }, '백업 파일 내보내기'),
    h('p', { class: 'small' }, '명단, 반, 메모, 초안, 최종본, 설정을 파일 하나로 저장합니다. 다른 PC에서 [가져오기]로 이어서 쓸 수 있습니다. API 키는 들어가지 않습니다.'),
    h('div', { class: 'row' }, h('button', {
      type: 'button', class: 'btn btn-primary',
      onclick: () => {
        store.flush();
        downloadJSON(currentBackup(), `생기부도우미_백업_${stamp()}.json`);
        toast('백업 파일을 내려받았습니다');
      },
    }, icon('download'), '백업 파일 내보내기')));
}

const PREVIEW_ROWS = [
  ['students', '파일의 학생'],
  ['classes', '파일의 반'],
  ['records', '파일의 기록'],
  ['newStudents', '새로 들어올 학생'],
  ['overwritten', '파일 내용으로 바뀔 기록'],
  ['doneKept', '완료라서 그대로 둘 기록'],
];

function previewTable(p) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table preview-table' },
    h('caption', { class: 'sr-only' }, '가져오기 미리보기'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '항목'), h('th', { scope: 'col', class: 'num' }, '수'))),
    h('tbody', {}, PREVIEW_ROWS.map(([k, label]) => h('tr', {},
      h('th', { scope: 'row' }, label),
      h('td', { class: 'num' }, String(Array.isArray(p?.[k]) ? p[k].length : (p?.[k] ?? 0))))))));
}

async function doImport() {
  if (!incoming) return;
  const ok = await confirmDialog({
    title: '백업 파일을 가져올까요?',
    body: '지금 데이터는 [가져오기 전 상태로 되돌리기]용으로 먼저 저장해 둡니다. 완료로 표시한 기록은 바꾸지 않습니다.',
    ok: '가져오기',
  });
  if (!ok) return;
  try {
    await store.flush();
    const current = store.snapshotData();
    await store.saveSnapshot(makeBackup({ ...current, settings: settingsForBackup(current.settings), now: new Date().toISOString() }));
    const merged = mergeBackup(current, incoming.backup);
    merged.settings = { ...merged.settings, keyStorage: store.state.settings.keyStorage };
    await store.replaceAll(merged);
    importMsg = alertBox('ok', `'${incoming.fileName}'을 가져왔습니다.`);
    incoming = null;
    toast('백업 파일을 가져왔습니다');
  } catch (e) {
    console.error(e);
    importMsg = alertBox('danger', `가져오지 못했습니다. ${e.message || ''}`, { role: 'alert' });
  }
  render();
}

function importCard() {
  const fileInput = h('input', {
    type: 'file', accept: '.json,application/json', hidden: true,
    onchange: () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) loadBackupFile(file);
    },
  });
  async function loadBackupFile(file) {
    {
      incoming = null;
      try {
        const text = await readFileText(file);
        let obj;
        try { obj = JSON.parse(text); } catch { throw new Error('백업 파일 형식이 아닙니다 (JSON을 읽지 못함).'); }
        const v = validateBackup(obj);
        if (!v.ok) throw new Error(v.error || '생기부 작성 도우미 백업 파일이 아닙니다.');
        incoming = { backup: v.backup, preview: previewImport(store.snapshotData(), v.backup), fileName: file.name };
        importMsg = null;
      } catch (e) {
        importMsg = alertBox('danger', e.message || '파일을 읽지 못했습니다.', { role: 'alert' });
      }
      render();
      root?.querySelector('#bk-import-title')?.focus();
    }
  }
  const importSection = h('section', { class: 'card stack', 'aria-labelledby': 'bk-import-title' },
    h('h2', { class: 'card-title', id: 'bk-import-title', tabindex: '-1' }, '백업 파일 가져오기'),
    h('p', { class: 'small' }, '파일을 고르거나 이 칸에 끌어다 놓으면 먼저 무엇이 바뀌는지 보여 줍니다. 학생과 반은 합치고, 기록은 파일 것으로 바꾸되 완료 기록은 그대로 둡니다.'),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => fileInput.click() }, icon('upload'), '백업 파일 고르기'),
      fileInput),
    importMsg,
    incoming ? h('div', { class: 'stack' },
      h('p', { class: 'small' }, `'${incoming.fileName}' (${formatDateTime(incoming.backup.exportedAt) || '날짜 모름'} 저장)`),
      previewTable(incoming.preview),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: doImport }, '가져오기'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { incoming = null; render(); } }, '취소'))) : null);
  enableDrop(importSection, loadBackupFile, { accept: ['.json'] });
  return importSection;
}

function restoreCard() {
  const snap = store.state.snapshot;
  if (!snap) return null;
  return h('section', { class: 'card stack', 'aria-labelledby': 'bk-restore-title' },
    h('h2', { class: 'card-title', id: 'bk-restore-title' }, '가져오기 전 상태로 되돌리기'),
    h('p', { class: 'small' }, `마지막 가져오기 직전(${formatDateTime(snap.createdAt)})에 자동으로 저장한 상태가 있습니다.`),
    h('div', { class: 'row' }, h('button', {
      type: 'button', class: 'btn btn-secondary',
      onclick: async () => {
        const ok = await confirmDialog({
          title: '가져오기 전 상태로 되돌릴까요?',
          body: '그 뒤에 고친 내용은 모두 사라집니다. 필요하면 먼저 백업 파일을 내보내 두세요.',
          ok: '되돌리기', danger: true,
        });
        if (!ok) return;
        try {
          const v = validateBackup(snap.data);
          if (!v.ok) throw new Error(v.error);
          const d = v.backup;
          await store.replaceAll({ students: d.students, classes: d.classes, records: d.records, styles: d.styles, settings: { ...d.settings, keyStorage: store.state.settings.keyStorage, devFakeAI: store.state.settings.devFakeAI } });
          toast('가져오기 전 상태로 되돌렸습니다');
        } catch (e) {
          console.error(e);
          toast('되돌리지 못했습니다', { danger: true });
        }
      },
    }, icon('undo'), '가져오기 전 상태로 되돌리기')));
}

// ---------- 드라이브 자동 백업 (contract 9절) ----------
const dayLabel = (name) => {
  const m = /(\d{4})(\d{2})(\d{2})/.exec(name || '');
  return m ? `${m[1]}.${m[2]}.${m[3]}` : name;
};

async function loadDriveList() {
  const sync = ctx?.sync();
  if (!sync?.status.connected) { driveList = null; return; }
  driveList = { loading: true };
  try {
    driveList = { items: (await sync.listBackups()).slice(0, 7) };
  } catch (e) {
    driveList = { error: e?.userMessage || '드라이브 백업 목록을 읽지 못했습니다' };
  }
  renderDrive();
}

async function restoreDrive(item) {
  const ok = await confirmDialog({
    title: `${dayLabel(item.name)} 백업으로 되돌릴까요?`,
    body: '지금 상태를 이 브라우저에 먼저 저장해 둔 뒤, 그 날의 드라이브 자동 백업으로 바꿉니다. 그 뒤에 고친 내용은 사라집니다. API 키 설정은 그대로 둡니다.',
    ok: '이 백업으로 되돌리기', danger: true,
  });
  if (!ok) return;
  const res = await ctx.sync().restoreBackup(item.id);
  if (res.ok) toast(`${dayLabel(item.name)} 백업으로 되돌렸습니다`);
  else toast(res.error?.userMessage || '되돌리지 못했습니다', { danger: true });
}

async function restoreBeforeFirstSync() {
  const snap = store.state.snapshots['before-first-sync'];
  if (!snap) return;
  const ok = await confirmDialog({
    title: '드라이브 연결 전 상태로 되돌릴까요?',
    body: '처음 드라이브에 연결하기 직전의 이 브라우저 상태로 바꿉니다. 그 뒤에 고친 내용은 사라지고, 연결되어 있으면 드라이브에도 올립니다.',
    ok: '되돌리기', danger: true,
  });
  if (!ok) return;
  try {
    const chk = checkDataFile(snap.data);
    if (!chk.ok) throw new Error('parse');
    const { secrets, ...data } = chk.data; // 키 설정은 지금 것 유지
    void secrets;
    await store.replaceAll(data);
    toast('드라이브 연결 전 상태로 되돌렸습니다');
  } catch (e) {
    console.error(e);
    toast('되돌리지 못했습니다', { danger: true });
  }
}

function driveCard() {
  const connected = !!ctx?.syncConnected();
  const snap = store.state.snapshots?.['before-first-sync'];
  if (!connected && !snap) return null;
  let body = null;
  if (connected) {
    if (!driveList || driveList.loading) body = h('p', { class: 'small muted' }, '목록을 읽는 중입니다.');
    else if (driveList.error) body = alertBox('warn', driveList.error);
    else if (!driveList.items.length) body = h('p', { class: 'small muted' }, '아직 자동 백업이 없습니다. 하루 첫 저장 때 만들어집니다.');
    else {
      body = h('ul', { class: 'stack drive-backup-list' }, driveList.items.map((it) => h('li', { class: 'row-between' },
        h('span', { class: 'num' }, `${dayLabel(it.name)} (${formatDateTime(it.modifiedTime)} 저장)`),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': `${dayLabel(it.name)} 백업으로 되돌리기`, onclick: () => restoreDrive(it) }, icon('undo'), '이 백업으로 되돌리기'))));
    }
  }
  return h('section', { class: 'card stack', 'aria-labelledby': 'bk-drive-title' },
    h('h2', { class: 'card-title', id: 'bk-drive-title' }, '드라이브 자동 백업'),
    connected ? h('p', { class: 'small' }, '구글 드라이브에 날마다 첫 저장 때 자동 백업을 만들고 최근 7개를 남깁니다. API 키는 자동 백업에 들어가지 않습니다.') : null,
    body,
    snap ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: restoreBeforeFirstSync }, icon('undo'), '드라이브 연결 전 이 브라우저 상태로 되돌리기')) : null);
}

function renderDrive() {
  if (driveHost) clear(driveHost, driveCard());
}

function exportRows(area) {
  const d = store.snapshotData();
  return excelRows({ classes: d.classes, students: d.students, records: d.records, area });
}

function excelCard() {
  const select = h('select', {
    class: 'select', id: 'bk-area', value: exportArea,
    onchange: (e) => { exportArea = e.target.value; },
  }, AREAS.map((a) => h('option', { value: a }, AREA_LABELS[a])));
  return h('section', { class: 'card stack', 'aria-labelledby': 'bk-excel-title' },
    h('h2', { class: 'card-title', id: 'bk-excel-title' }, '영역별 엑셀 내보내기'),
    h('p', { class: 'small' }, '학번, 이름, 반, 과목, 최종본, 바이트, 상태를 엑셀 파일로 받습니다.'),
    hasXlsx() ? null : alertBox('warn', XLSX_MISSING_TEXT),
    h('div', { class: 'row align-end' },
      field('영역', select),
      h('button', {
        type: 'button', class: 'btn btn-secondary',
        onclick: () => {
          const rows = exportRows(exportArea);
          if (rows.length < 2) { toast('이 영역을 쓰는 반이 없습니다'); return; }
          try {
            downloadSheet(rows, `생기부_${AREA_LABELS[exportArea].replace(/[^\p{L}\p{N}]/gu, '')}_${stamp()}.xlsx`, AREA_LABELS[exportArea].replace(/[^\p{L}\p{N}]/gu, ''), { widths: [8, 10, 14, 12, 80, 8, 8] });
            toast('엑셀 파일을 내려받았습니다');
          } catch (e) { toast(e.message || XLSX_MISSING_TEXT, { danger: true }); }
        },
      }, icon('download'), '엑셀로 내보내기')));
}

const SUM_LABELS = [['filled', '새로 채움'], ['appended', '이어씀'], ['overwritten', '덮어씀'], ['same', '이미 같은 글'], ['kept', '나이스 글을 그대로 둠'], ['noRecord', '작성기에 글 없음'], ['notDone', '완료 아님'], ['nameMismatch', '이름 다름'], ['notInRoster', '명단에 없음'], ['tooLong', '한도 초과'], ['noArea', '영역 모름'], ['bad', '읽지 못한 행']];

function fillCard() {
  const fileInput = h('input', {
    type: 'file', accept: '.xlsx,.xls', hidden: true,
    onchange: () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) fillFile(file);
    },
  });
  async function fillFile(file) {
    {
      const d = store.snapshotData();
      const limits = d.settings?.limits || {};
      try {
        const sums = {}; const issues = [];
        const res = await fillWorkbookFile(file, ({ name, rows, rowOffset }) => {
          const plan = planNeisFill({ sheetName: name, rows, rowOffset, students: d.students, records: d.records, limits, mode: fillMode, includeNotDone: fillNotDone });
          if (plan.found) {
            for (const [k, v] of Object.entries(plan.summary)) sums[k] = (sums[k] || 0) + v;
            for (const it of plan.issues) issues.push({ sheet: name, ...it });
          }
          return plan;
        });
        fillResult = { fileName: file.name, outName: res.outName, total: res.total, sheets: res.perSheet.filter((x) => x.plan?.found).length, sums, issues };
      } catch (e) {
        fillResult = { error: e.message || '엑셀을 처리하지 못했습니다.' };
      }
      render();
      root?.querySelector('#bk-fill-title')?.focus();
    }
  }
  const modeSel = h('select', { class: 'select', id: 'bk-fill-mode', value: fillMode, onchange: (e) => { fillMode = e.target.value; } },
    Object.entries(FILL_MODES).map(([k, v]) => h('option', { value: k }, v)));
  const notDone = h('input', { type: 'checkbox', id: 'bk-fill-notdone', checked: fillNotDone, onchange: (e) => { fillNotDone = e.target.checked; } });
  let result = null;
  if (fillResult?.error) result = alertBox('danger', fillResult.error, { role: 'alert' });
  else if (fillResult) {
    const lines = SUM_LABELS.filter(([k]) => fillResult.sums[k]).map(([k, t]) => `${t} ${fillResult.sums[k]}`);
    result = h('div', { class: 'stack', role: 'status' },
      fillResult.outName
        ? alertBox('ok', `'${fillResult.fileName}'의 ${fillResult.total}칸을 채워 '${fillResult.outName}'로 내려받았습니다.`)
        : alertBox('warn', fillResult.sheets ? '채울 칸이 없습니다. 아래 내용을 확인하세요.' : '나이스 특기사항 표를 찾지 못했습니다. 나이스에서 내려받은 엑셀 파일인지 확인하세요.'),
      lines.length ? h('p', { class: 'small' }, lines.join(' · ')) : null,
      fillResult.issues.length ? h('ul', { class: 'small' },
        fillResult.issues.slice(0, 10).map((i) => h('li', {}, `${i.sheet} ${i.row}행: ${i.message}`)),
        fillResult.issues.length > 10 ? h('li', {}, `그 밖에 ${fillResult.issues.length - 10}건`) : null) : null);
  }
  const fillSection = h('section', { class: 'card stack', 'aria-labelledby': 'bk-fill-title' },
    h('h2', { class: 'card-title', id: 'bk-fill-title', tabindex: '-1' }, '나이스 엑셀 양식에 채우기'),
    h('p', { class: 'small' }, '나이스에서 내려받은 특기사항 엑셀(자율, 진로, 동아리, 행동특성, 교과세특)을 고르면, 학년·반·번호와 이름이 맞는 학생의 최종본을 본문 칸에 넣어 새 파일로 받습니다. 원본 파일은 바뀌지 않고 다른 칸은 그대로입니다. 글꼴·색 같은 꾸밈은 새 파일에 남지 않을 수 있습니다.'),
    hasXlsx() ? null : alertBox('warn', XLSX_MISSING_TEXT),
    h('div', { class: 'row align-end' },
      field('이미 글이 있는 칸', modeSel),
      h('label', { class: 'row', for: 'bk-fill-notdone' }, notDone, '완료로 표시하지 않은 글도 넣기')),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => fileInput.click() }, icon('upload'), '나이스 엑셀 고르기'),
      h('span', { class: 'hint' }, '이 칸에 파일을 끌어다 놓아도 됩니다'),
      fileInput),
    result);
  enableDrop(fillSection, fillFile, { accept: ['.xlsx', '.xls'] });
  return fillSection;
}

function render() {
  if (!root) return;
  driveHost = h('div', {});
  clear(root,
    viewHeader('백업', ctx?.syncConnected()
      ? '데이터는 구글 드라이브에 저장되고 이 브라우저에는 사본이 있습니다. 따로 보관하고 싶으면 백업 파일을 내보내세요.'
      : '드라이브에 연결하지 않아 데이터가 이 브라우저에만 있습니다. 브라우저 기록을 지우거나 PC를 바꾸기 전에 백업 파일을 내보내 두세요.'),
    alertBox('warn', '백업 파일에는 학생 이름이 있으니 메신저·메일로 다른 사람에게 보내지 마세요. USB나 학교 PC의 개인 폴더에 보관하세요.'),
    h('div', { class: 'grid-2' }, exportCard(), importCard()),
    restoreCard(),
    driveHost,
    fillCard(),
    excelCard());
  renderDrive();
}

export const backupView = {
  mount(el, params, c) {
    ctx = c;
    root = h('div', { class: 'view view-backup stack' });
    el.appendChild(root);
    driveList = null;
    render();
    loadDriveList();
  },
  update(kind, detail) {
    if (kind === 'all') render();
    if (kind === 'sync' && detail?.state === 'idle' && !driveList) loadDriveList();
    if (kind === 'sync' && !detail?.connected && driveList) { driveList = null; render(); }
  },
  unmount() { root = null; driveHost = null; },
};
