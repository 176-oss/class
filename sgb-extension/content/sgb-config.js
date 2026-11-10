/* 생기부 도우미 - 나이스 화면 설정 (MAIN world, sgb-page.js 보다 먼저 실행)
   나이스 생기부 화면 구조 분석 전이라 아래 id·이름은 모두 '가정'이다 (가상 화면 mock-neis/sgb.html 과만 맞음).
   실제 화면을 분석한 뒤에는 이 파일만 고치고 verified 를 true 로 바꾼다.
   verified 가 false 이면 진짜 나이스 주소에서는 읽기(화면 감지, 화면 구조 기록)만 하고 아무것도 입력·클릭하지 않는다. */
window.__sgbNeisConfig = {
  verified: false,

  // 화면 감지: 실행 중인 eXbuilder6 앱 인스턴스의 app.id 에 이 글자가 들어 있으면 그 화면
  screens: [
    { key: 'creative', label: '창의적 체험활동 특기사항', appId: 'MOCK_SGB_CREATIVE' },
    { key: 'behavior', label: '행동특성 및 종합의견', appId: 'MOCK_SGB_BEHAVIOR', area: 'behavior' },
    { key: 'subject', label: '교과 세부능력 및 특기사항', appId: 'MOCK_SGB_SUBJECT', area: 'subject' },
  ],

  // 조회 조건 데이터맵과 컬럼
  search: {
    dm: 'dmSearch',
    cols: { schoolYear: 'schYr', semester: 'shtm', grade: 'grd', classNo: 'clsCd', area: 'actvAreaCd', subject: 'sbjtNm' },
    areaCodes: { autonomy: '1', club: '2', career: '3' }, // 창체 화면의 영역 코드 -> 확장 영역 이름
  },

  // 학생 표
  grid: { id: 'grdMain', cols: { no: 'clsNo', name: 'stuFlnm', text: 'spcfCn' } },

  // 본문 넣는 방법: 'dataset' = 데이터셋 setValue, 'control' = 행 선택 뒤 입력칸 컨트롤 value 대입
  input: { mode: 'dataset', textControl: 'txaSpcfCn' },

  // [값 읽기] 전용 (읽기만 함). 실제 화면 분석(docs/textgenerator-v2/나이스-생기부화면-구조-분석.md)에서 확인한 화면별 이름.
  // 학생 이름·번호·본문은 읽어 내보내지 않고, 본문은 길이만 잰다. name 컬럼은 결과에 이름이 섞였을 때 지우는 용도로만 읽는다.
  probes: [
    { key: 'autonomy', label: '자율활동', appId: 'mis_sdlce00_m00', ds: 'dsScrgRec', name: 'stuFlnm', text: 'speclActSpablMteCn', len: 'length', textareas: ['txaSpeclActSpablMteCn'] },
    { key: 'career', label: '진로활동', appId: 'mis_sdlce04_m00', ds: 'dsScrgRec', name: 'stuFlnm', text: 'speclActSpablMteCn', len: 'length', textareas: ['txaSpeclActSpablMteCn', 'txaHopRealm'] },
    { key: 'club', label: '동아리활동', appId: 'mis_sdlce01_m06', ds: 'dsScrgRec', name: 'stuFlnm', text: 'speclActSpablMteCn', len: 'length', extra: ['sportsLength'], textareas: ['txaSpeclActSpablMteCn'] },
    { key: 'behavior', label: '행동특성 및 종합의견', appId: 'mis_sdlbg00_m00', ds: 'dsScrgRec', name: 'stuFlnm', text: 'gnrlzOpiCn', len: 'length', textareas: ['txaGnrlz'] },
    { key: 'subject', label: '교과 세부능력 및 특기사항', appId: 'mis_scrmc50_m00', ds: 'dsGridMain', name: 'stuFlnm', text: 'genDetaAbtSpablMteCn', len: 'genDetaAbtSpablMteCnLength',
      extra: ['inputCanLeng', 'inputLen', 'totalLength', 'othSemInputLen', 'genGfcrRecMteCnLength'], textareas: ['txa1', 'txa2'] },
    // 가상 나이스 화면(시험용). 실제 나이스에는 이 id가 없어 아무 일도 하지 않는다.
    { key: 'mock', label: '가상 화면', appId: 'MOCK_SGB_', ds: 'dsList', name: 'stuFlnm', text: 'spcfCn', len: 'length', textareas: ['txaSpcfCn'],
      searchKeys: ['schYr', 'shtm', 'grd', 'clsCd', 'actvAreaCd', 'sbjtNm'] },
  ],

  // 확장이 누를 수 있는 버튼 (이 목록 밖은 모두 거부)
  clickableIds: ['btnSave', 'btnConfirm'],
  // 혹시 위 목록에 잘못 들어가도 절대 누르지 않을 버튼 (마감, 확정, 일괄 삭제, 가져오기, 반영, 출력)
  forbiddenIds: ['btnMagam', 'btnMagamCncl', 'btnCfm', 'btnCfmCncl', 'btnBatchDel', 'btnImport', 'btnApply', 'btnPrint'],

  // 공통 확인창·알림창
  dialogs: { appIdPart: 'app/cmn/', confirmAppId: 'app/cmn/confirm', msgControl: 'optMsg', saveConfirm: '저장하시겠습니까?', saveDone: '저장했습니다.' },
};
