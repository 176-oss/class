// 점검 결과 보고서 (기획서 7절). 표 만들기는 순수 함수, 파일 만들기는 XLSX 주입.
// 모든 셀을 문자열 셀(t: 's')로 쓴다. '=', '+', '-', '@'로 시작해도 수식이 되지 않는다. CSV 내보내기는 만들지 않는다.

const MAX_CELL = 32000; // 엑셀 셀 한도(32,767자) 안쪽

/**
 * items: [{ studentId, name, areaLabel, subject, original, current, bytes, limit, status, issues, excepted: [{ issue, reason }] }]
 * status: 'pass' | 'warn' | 'error' | 'empty'
 */
export function buildReport(items) {
  const byArea = new Map();
  for (const it of items) {
    const k = it.areaLabel + (it.subject ? ` (${it.subject})` : '');
    if (!byArea.has(k)) byArea.set(k, { n: 0, pass: 0, warn: 0, error: 0, empty: 0, labels: new Map() });
    const a = byArea.get(k);
    a.n++; a[it.status]++;
    for (const i of it.issues) a.labels.set(i.label, (a.labels.get(i.label) || 0) + 1);
  }
  const summary = [['항목', '학생 수', '통과', '확인', '오류', '미작성', '많이 나온 지적']];
  for (const [k, a] of byArea) {
    const top = [...a.labels].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([l, n]) => `${l} ${n}건`).join(', ');
    summary.push([k, a.n, a.pass, a.warn, a.error, a.empty, top]);
  }
  const students = [['학번', '이름', '항목(과목)', '바이트/한도', '지적 수', '지적 내용', '근거 쪽수', '제안 문구', '예외 처리와 사유']];
  for (const it of items) {
    students.push([
      it.studentId, it.name, it.areaLabel + (it.subject ? ` (${it.subject})` : ''),
      `${it.bytes}/${it.limit || '-'}`, it.issues.length,
      it.issues.map((i) => `[${i.level === 'error' ? '오류' : '확인'}] ${i.label}${i.text ? `: "${i.text}"` : ''} - ${i.reason}`).join('\n'),
      [...new Set(it.issues.map((i) => i.basis).filter(Boolean))].join(', '),
      it.issues.filter((i) => typeof i.fix === 'string' && i.fix).map((i) => `"${i.text}" -> "${i.fix}"`).join('\n'),
      (it.excepted || []).map((e) => `${e.issue.label}${e.issue.text ? `: "${e.issue.text}"` : ''} (사유: ${e.reason})`).join('\n'),
    ]);
  }
  const revised = [['학번', '이름', '항목(과목)', '원문', '적용한 수정본']];
  for (const it of items) revised.push([it.studentId, it.name, it.areaLabel + (it.subject ? ` (${it.subject})` : ''), it.original, it.current === it.original ? '' : it.current]);
  return [{ name: '요약', rows: summary }, { name: '학생별', rows: students }, { name: '수정본', rows: revised }];
}

/** 문자열 셀만으로 된 시트 */
export function textSheet(XLSX, rows) {
  const ws = {};
  let maxC = 0;
  rows.forEach((row, r) => row.forEach((v, c) => {
    const s = String(v ?? '').slice(0, MAX_CELL);
    ws[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: s };
    maxC = Math.max(maxC, c);
  }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: maxC } });
  return ws;
}

/** @returns Uint8Array (xlsx 파일) */
export function reportFile(XLSX, sheets) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, textSheet(XLSX, s.rows), s.name);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
