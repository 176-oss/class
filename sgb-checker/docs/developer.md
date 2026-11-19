# 생기부 점검기: 개발자용

- 빌드 없음. 저장소 최상위에서 `python -m http.server`로 열고 `http://localhost:8000/sgb-checker/`.
- 테스트: `node --test sgb-checker/tests/` (패키지 설치 없음).
- 샘플 엑셀 다시 만들기: `node sgb-checker/tests/make-samples.mjs` (가상 학생 30명, `tests/samples/`).
- 구조와 형식: `docs/contract.md`. 검수: `docs/review.md`. 같은 주소 보안 점검: `docs/security-origin-audit.md`.
- 외부 코드는 불러오지 않습니다. SheetJS와 글꼴은 `lib/`에 있고 버전·해시는 `lib/README.md`에 있습니다.
