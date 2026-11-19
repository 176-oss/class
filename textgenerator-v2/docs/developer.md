# 생기부 작성 도우미 v2: 개발자용
- 빌드 없이 정적 파일로 돌아갑니다. 시험: 저장소 루트에서 `python -m http.server` 후 `http://localhost:8000/textgenerator-v2/?dev=1` (설정에 개발용 칸: 가짜 AI, 가짜 드라이브(새로고침 필요, 구글로 아무것도 보내지 않음), [사본만 지우기], 가상 학생 30명 반).
- 외부에서 불러오는 코드는 구글 로그인 스크립트(`accounts.google.com/gsi/client`) 하나뿐이며, 드라이브에 연결할 때 `js/drive.js`가 넣습니다.
- 테스트: `node textgenerator-v2/tests/run.mjs`
- 구조와 함수 계약: `docs/contract.md`, 검수 결과: `docs/review.md`
- 학교 PC 확장 배포 zip: `node sgb-extension/tools/make-zip.mjs` (버전을 올리면 다시 만들기). 사용 안내 그림은 `guide-img/`, 페이지는 `guide.html`.
