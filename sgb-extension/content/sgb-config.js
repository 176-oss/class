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

  // 확장이 누를 수 있는 버튼 (이 목록 밖은 모두 거부)
  clickableIds: ['btnSave', 'btnConfirm'],
  // 혹시 위 목록에 잘못 들어가도 절대 누르지 않을 버튼 (마감, 확정, 일괄 삭제, 가져오기, 반영, 출력)
  forbiddenIds: ['btnMagam', 'btnMagamCncl', 'btnCfm', 'btnCfmCncl', 'btnBatchDel', 'btnImport', 'btnApply', 'btnPrint'],

  // 공통 확인창·알림창
  dialogs: { appIdPart: 'app/cmn/', confirmAppId: 'app/cmn/confirm', msgControl: 'optMsg', saveConfirm: '저장하시겠습니까?', saveDone: '저장했습니다.' },
};
