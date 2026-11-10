/* 생기부 도우미 - 나이스 화면 설정 (MAIN world, sgb-page.js 보다 먼저 실행)
   실제 나이스 화면 분석(docs/textgenerator-v2/나이스-생기부화면-구조-분석.md, 2026-11-10 읽기 전용 기록)에서 확인한 이름이다.
   입력 방식(데이터셋 setValue 가 화면 칸에 반영되는지)과 저장 확인창 문구는 쓰기 시험 전이라 아직 가정이다.
   verified 가 false 이면 진짜 나이스 주소에서는 읽기(화면 감지, 구조 기록, 값 읽기)만 하고 아무것도 입력·클릭하지 않는다.

   활성 조건: 입력하려는 화면의 표(gridId)가 지금 눈에 보일 때만 그 화면으로 감지한다 (표의 getActualRect 가 0이 아닐 때).
   나이스 탭을 다른 것으로 바꾸거나 같은 화면의 출결·누가기록 탭으로 옮기면 비활성이 된다. */
(function () {
  // 창체(자율·진로) 공통 틀: 한 학급, 표에 번호(clsNo)와 이름(stuFlnm)
  const classScreen = (key, area, label, appId, areaCode, text) => ({
    key, area, label, appId, areaCode,
    gridId: 'grdMain', ds: 'dsScrgRec',
    cols: { no: 'clsNo', name: 'stuFlnm', text },
    search: { dm: 'dmSearch', schoolYear: 'ayr', semester: 'sem', grade: 'grd', classNo: 'clsCd', subject: null },
    semesterFallback: { ds: 'dsSwcSem', col: 'cd' },     // 자율·진로·행특은 dmSearch.sem 이 비어 있음
    closedFlags: { dm: 'dmScrgDdln', cols: ['scrgClsDdlnYn', 'scrgDdlnCfmtnYn', 'ddlnYn'] },
    input: { mode: 'dataset' },
    lengthCol: 'length',      // 실제 입력은 이 열과 화면의 'N / 한도 Byte' 표시도 갱신한다 (행동특성에서 확인). 데이터셋 setValue 만으로는 갱신되지 않음
  });

  window.__sgbNeisConfig = {
    version: '0.4.0',          // manifest.json 의 version 과 같아야 한다 (tests/detect.test.mjs 가 확인). 사이드 패널이 옛 페이지 코드를 알아보는 데 쓴다
    verified: false,

    screens: [
      classScreen('autonomy', 'autonomy', '자율·자치활동(자율활동)관리', 'edu/sw/mis/sdl/ce/mis_sdlce00_m00', '11', 'speclActSpablMteCn'),
      classScreen('career', 'career', '진로활동관리', 'edu/sw/mis/sdl/ce/mis_sdlce04_m00', '14', 'speclActSpablMteCn'),
      classScreen('behavior', 'behavior', '행동특성및종합의견', 'edu/sw/mis/sdl/bg/mis_sdlbg00_m00', '99', 'gnrlzOpiCn'),
      // 동아리: 동아리담임 역할의 동아리활동관리(4단계) 안 '학생부자료기록' 탭. 한 동아리의 학생들이라 학년·반이 섞여 있다(표에 grd, clsCd 열).
      {
        key: 'club', area: 'club', label: '동아리활동관리', appId: 'edu/sw/mis/sdl/ce/mis_sdlce01_m06', areaCode: '12',
        gridId: 'grdMain', ds: 'dsScrgRec',
        cols: { no: 'clsNo', name: 'stuFlnm', text: 'speclActSpablMteCn', grade: 'grd', classNo: 'clsCd' },
        search: { dm: 'dmSearch', schoolYear: 'ayr', semester: 'sem', grade: null, classNo: null, subject: null },
        rowLock: { col: 'scrgRfltYn', value: 'Y' },       // 이미 학생부에 반영된 학생은 건드리지 않음
        lengthCol: 'length',
        closedFlags: { dm: 'dmScrgDdln', cols: ['scrgClsDdlnYn', 'scrgDdlnCfmtnYn', 'ddlnYn'] },
        input: { mode: 'dataset' },
      },
      // 교과세특: 한 과목(강좌)의 학생들. 학생마다 입력 가능 바이트가 다르다(1·2학기 합산 한도에서 다른 학기 입력분을 뺌).
      {
        key: 'subject', area: 'subject', label: '과목별세부능력및특기사항', appId: 'edu/sw/mis/scr/mc/mis_scrmc50_m00', areaCode: null,
        gridId: 'grdMain', ds: 'dsGridMain',
        cols: { no: 'clsNo', name: 'stuFlnm', text: 'genDetaAbtSpablMteCn', grade: 'grd', classNo: 'clsCd' },
        search: { dm: 'dmSearch', schoolYear: 'ayr', semester: 'sem', grade: 'grd', classNo: null, subject: 'sbjtNm' },
        capacityCol: 'othSemInputLen01',                   // 이 학생의 일반 세특 입력 가능 Byte
        rowLock: { col: 'enableYn', value: 'false' },     // 입력할 수 없는 행
        closedFlags: { dm: 'dmCheckTeukDesc', cols: ['ddlnYn'] },
        input: { mode: 'dataset' },
      },
      // 가상 나이스 화면(시험용, 실제 나이스에는 이 id가 없음). 이전에 가정했던 이름을 그대로 둔다.
      ...[['creative', 'MOCK_SGB_CREATIVE', null], ['behavior', 'MOCK_SGB_BEHAVIOR', 'behavior'], ['subject', 'MOCK_SGB_SUBJECT', 'subject']].map(([k, id, area]) => ({
        key: `mock-${k}`, mock: true, area, label: { creative: '창의적 체험활동 특기사항', behavior: '행동특성 및 종합의견', subject: '교과 세부능력 및 특기사항' }[k],
        appId: id, areaCodeCol: k === 'creative' ? 'actvAreaCd' : null, areaCodes: { 1: 'autonomy', 2: 'club', 3: 'career' },
        gridId: 'grdMain', ds: 'dsList',
        cols: { no: 'clsNo', name: 'stuFlnm', text: 'spcfCn' },
        search: { dm: 'dmSearch', schoolYear: 'schYr', semester: 'shtm', grade: 'grd', classNo: 'clsCd', subject: 'sbjtNm' },
        input: { mode: 'dataset', textControl: 'txaSpcfCn' },
      })),
    ],

    // [값 읽기] 전용 (읽기만 함). 학생 이름·번호·본문은 읽어 내보내지 않고, 본문은 길이만 잰다. name 컬럼은 결과에 이름이 섞였을 때 지우는 용도로만 읽는다.
    probes: [
      { key: 'autonomy', label: '자율활동', appId: 'mis_sdlce00_m00', ds: 'dsScrgRec', name: 'stuFlnm', text: 'speclActSpablMteCn', len: 'length', textareas: ['txaSpeclActSpablMteCn'] },
      { key: 'career', label: '진로활동', appId: 'mis_sdlce04_m00', ds: 'dsScrgRec', name: 'stuFlnm', text: 'speclActSpablMteCn', len: 'length', textareas: ['txaSpeclActSpablMteCn', 'txaHopRealm'] },
      { key: 'club', label: '동아리활동', appId: 'mis_sdlce01_m06', ds: 'dsScrgRec', name: 'stuFlnm', text: 'speclActSpablMteCn', len: 'length', extra: ['sportsLength'], textareas: ['txaSpeclActSpablMteCn'] },
      { key: 'behavior', label: '행동특성 및 종합의견', appId: 'mis_sdlbg00_m00', ds: 'dsScrgRec', name: 'stuFlnm', text: 'gnrlzOpiCn', len: 'length', textareas: ['txaGnrlz'] },
      { key: 'subject', label: '교과 세부능력 및 특기사항', appId: 'mis_scrmc50_m00', ds: 'dsGridMain', name: 'stuFlnm', text: 'genDetaAbtSpablMteCn', len: 'genDetaAbtSpablMteCnLength',
        extra: ['inputCanLeng', 'inputLen', 'totalLength', 'othSemInputLen', 'othSemInputLen01', 'othSemInputLen02', 'genGfcrRecMteCnLength'], textareas: ['txa1', 'txa2'] },
      { key: 'mock', label: '가상 화면', appId: 'MOCK_SGB_', ds: 'dsList', name: 'stuFlnm', text: 'spcfCn', len: 'length', textareas: ['txaSpcfCn'],
        searchKeys: ['schYr', 'shtm', 'grd', 'clsCd', 'actvAreaCd', 'sbjtNm'] },
    ],

    // 나이스에 이미 글이 있을 때 [뒤에 이어쓰기]를 고르면 기존 글 끝(공백 정리 뒤)과 새 글 사이에 넣는 글자
    appendSeparator: ' ',

    // 확장이 누를 수 있는 버튼 (이 목록 밖은 모두 거부). 조회는 선생님이 누른다.
    clickableIds: ['btnSave', 'btnConfirm'],
    // 혹시 위 목록에 잘못 들어가도 절대 누르지 않을 버튼. 실제 화면에서 확인한 위험 버튼 (삭제, 한꺼번에 바꾸기, 가져오기·내려받기·출력, 학생부 반영, 이수시간, 마감, 조회성 팝업, 용도 모르는 버튼).
    forbiddenIds: [
      'btnDelete', 'btnBndeSave', 'btnChrsChg', 'btnExcelUpload', 'btnFileUpld', 'btnExcelDwld', 'btnFileDwld', 'btnOtpt', 'btnPrint',
      'btnScrgRflt', 'btnScrgRfltAll', 'btnScrgRfltAllCen', 'btnIsuHr', 'btnCoseInfo', 'btnObsvList',
      'btnDdln', 'btnDdlnCancel', 'btnEntrJnt', 'btnExpa', 'btnAntiExpa', 'btnDcr', 'btnNeis',
      // 가상 화면용
      'btnMagam', 'btnMagamCncl', 'btnCfm', 'btnCfmCncl', 'btnBatchDel', 'btnImport', 'btnApply',
    ],

    // 공통 확인창·알림창 (출결 확장이 실제 나이스에서 확인한 것과 같은 공통 부품)
    dialogs: { appIdPart: 'app/cmn/', confirmAppId: 'app/cmn/confirm', msgControl: 'optMsg', saveConfirm: '저장하시겠습니까?', saveDone: '저장했습니다.' },
  };
})();
