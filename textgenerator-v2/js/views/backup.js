// 백업: 백업 파일 내보내기·가져오기(미리보기, 되돌리기 지점), 영역별 엑셀 내보내기
import { h, clear, icon } from '../dom.js';
import { toast, confirmDialog, alertBox, viewHeader, downloadJSON, readFileText, stamp, formatDateTime, field } from '../ui.js';
import * as store from '../store.js';
import { AREAS, AREA_LABELS } from '../core/model.js';
import { makeBackup, validateBackup, previewImport, mergeBackup, excelRows } from '../core/backup-format.js';
import { downloadSheet, hasXlsx, XLSX_MISSING_TEXT } from '../xlsx-io.js';

let root = null;
let incoming = null; // { backup, preview, fileName }
let importMsg = null;
let exportArea = 'autonomy';

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
    onchange: async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
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
    },
  });
  return h('section', { class: 'card stack', 'aria-labelledby': 'bk-import-title' },
    h('h2', { class: 'card-title', id: 'bk-import-title', tabindex: '-1' }, '백업 파일 가져오기'),
    h('p', { class: 'small' }, '파일을 고르면 먼저 무엇이 바뀌는지 보여 줍니다. 학생과 반은 합치고, 기록은 파일 것으로 바꾸되 완료 기록은 그대로 둡니다.'),
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
          await store.replaceAll({ students: d.students, classes: d.classes, records: d.records, settings: { ...d.settings, keyStorage: store.state.settings.keyStorage, devFakeAI: store.state.settings.devFakeAI } });
          toast('가져오기 전 상태로 되돌렸습니다');
        } catch (e) {
          console.error(e);
          toast('되돌리지 못했습니다', { danger: true });
        }
      },
    }, icon('undo'), '가져오기 전 상태로 되돌리기')));
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

function render() {
  if (!root) return;
  clear(root,
    viewHeader('백업', '이 앱의 데이터는 이 브라우저에만 저장됩니다. 브라우저 기록을 지우거나 PC를 바꾸기 전에 백업 파일을 내보내 두세요.'),
    alertBox('warn', '백업 파일에는 학생 이름이 있으니 메신저·메일로 다른 사람에게 보내지 마세요. USB나 학교 PC의 개인 폴더에 보관하세요.'),
    h('div', { class: 'grid-2' }, exportCard(), importCard()),
    restoreCard(),
    excelCard());
}

export const backupView = {
  mount(el) {
    root = h('div', { class: 'view view-backup stack' });
    el.appendChild(root);
    render();
  },
  update(kind) {
    if (kind === 'all') render();
  },
  unmount() { root = null; },
};
