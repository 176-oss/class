# 가상 나이스(mock-neis/sgb.html)에 확장을 실제로 로드해 입력 -> 확인 -> 저장 흐름을 시험한다.
# 실행: python tests/e2e_mock.py   (Playwright 크로미움 필요)
import functools, http.server, json, os, sys, tempfile, threading
from playwright.sync_api import sync_playwright, expect

EXT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PORT = 8091
LONG = '가' * 501  # 1503바이트: 자율 한도 1500 초과


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=EXT)
    h.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def item(i, no, name, text, area='autonomy', cls=5):
    return {'id': f'i{i}', 'grade': 3, 'classNo': cls, 'no': no, 'name': name, 'area': area, 'text': text}


BATCH = {'kind': 'sgb-neis-batch', 'version': 1, 'schoolYear': 2026, 'semester': 2, 'items': [
    item(1, 3, '박다온', '학급 회의를 세 차례 진행함.\r\n토론을 이끎.'),
    item(2, 4, '최라온', LONG),                       # 바이트 초과
    item(3, 5, '정마루', '환경 캠페인을 기획함.'),
    item(4, 7, '조사랑', '새 글'),                      # 나이스에 다른 글 있음
    item(5, 9, '장자람', '이름 다름'),                   # 가상 화면에서 이름을 바꿈
    item(6, 11, '한카라', '글 하나'), item(7, 11, '한카라', '글 둘'),  # 같은 학생 2개
    item(8, 30, '없는학생', '표에 없음'),
    item(9, 1, '김가람', '동아리 활동', area='club'),
    item(10, 2, '이나래', '다른 반', cls=6),
]}
NAMES = {i['name'] for i in BATCH['items']}


def main():
    srv = serve()
    tmp = tempfile.mkdtemp()
    batch_path = os.path.join(tmp, 'batch.json')
    with open(batch_path, 'w', encoding='utf-8') as f:
        json.dump(BATCH, f, ensure_ascii=False)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(os.path.join(tmp, 'profile'), headless=True, channel='chromium',
                                                   args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        ext_id = sw.url.split('/')[2]
        assert ext_id == 'fjgpgoehdihombkkjepcpppnokoiklkl', ext_id  # manifest key 로 고정한 ID

        neis = ctx.new_page()
        neis.goto(f'http://localhost:{PORT}/mock-neis/sgb.html?existing=7&rename=9:장가명')
        panel = ctx.new_page()
        panel.goto(f'chrome-extension://{ext_id}/sidepanel/index.html')
        expect(panel.get_by_text('나이스 생기부 화면 감지됨: 창의적 체험활동 특기사항')).to_be_visible(timeout=10000)

        panel.set_input_files('#sgbFile', batch_path)
        expect(panel.get_by_text('3학년 5반 자율·자치 8명')).to_be_visible()
        expect(panel.get_by_text('3학년 6반 자율·자치 1명')).to_be_visible()

        # 금지 버튼 차단 확인 (아무것도 누르지 않음)
        guard = panel.evaluate("""async () => { const [t] = await chrome.tabs.query({url: 'http://localhost/*'});
            return (await chrome.tabs.sendMessage(t.id, {sgb: 'neis-cmd', cmd: 'guardCheck'})).result; }""")
        assert guard and all(guard.values()), guard

        panel.get_by_role('button', name='입력 시작').click()
        expect(panel.get_by_role('button', name='확인 완료 · 저장 (2명)')).to_be_visible(timeout=10000)
        rows = neis.evaluate("""() => { const ds = cpr.core.Platform.INSTANCE.getAllRunningAppInstances()[0].lookup('grdMain').dataSet;
            return [3,5,7,9,11].map(n => [n, ds.getValue(n-1,'spcfCn'), ds.getRowState(n-1)]); }""")
        assert rows[0][1] == '학급 회의를 세 차례 진행함.\n토론을 이끎.' and rows[0][2] != 1, rows
        assert rows[1][1] == '환경 캠페인을 기획함.' and rows[1][2] != 1, rows
        assert rows[2][1] == '이미 저장된 다른 글입니다 (7번).' and rows[2][2] == 1, rows  # 덮어쓰지 않음
        assert rows[3][1] == '' and rows[4][1] == '', rows
        body = panel.inner_text('#sgb-root')
        for why in ['한도(1500바이트)를 넘습니다', '나이스에 다른 글이 이미 있어', '나이스 이름과 다릅니다', '같은 학생 글이 2개 이상', '나이스 표에 없는 번호']:
            assert why in body, why

        panel.get_by_role('button', name='확인 완료 · 저장 (2명)').click()
        expect(panel.get_by_text('저장 목록 2명')).to_be_visible()
        panel.get_by_role('button', name='이대로 저장').click()
        expect(panel.get_by_text('2명 저장했습니다')).to_be_visible(timeout=15000)
        assert neis.evaluate('window.__mockSaves') == 1
        assert neis.evaluate('window.__mockViolations') == []
        assert panel.locator('.badge', has_text='저장됨').count() == 2
        expect(panel.get_by_role('button', name='입력 시작')).to_be_disabled()  # 남은 대기 글 없음

        # 영역을 동아리로 바꾸면 다시 감지 -> 입력 뒤 선생님이 다른 행을 고치면 저장 거부
        neis.select_option('select[data-dm="actvAreaCd"]', '2')
        neis.click('[data-btn="btnSearch"]')
        expect(panel.get_by_text('2학기 3학년 5반 동아리 · 학생 25명')).to_be_visible(timeout=5000)
        panel.get_by_role('button', name='입력 시작').click()
        expect(panel.get_by_role('button', name='확인 완료 · 저장 (1명)')).to_be_visible(timeout=10000)
        neis.evaluate("cpr.core.Platform.INSTANCE.getAllRunningAppInstances()[0].lookup('grdMain').dataSet.setValue(9, 'spcfCn', '선생님이 직접 쓴 글')")
        panel.get_by_role('button', name='확인 완료 · 저장 (1명)').click()
        panel.get_by_role('button', name='이대로 저장').click()
        expect(panel.locator('.alert-title', has_text='저장하지 않았습니다')).to_be_visible(timeout=5000)
        expect(panel.locator('.alert').get_by_text('확장프로그램이 입력하지 않은 행이 바뀌어 있습니다 (10번)')).to_be_visible()
        assert neis.evaluate('window.__mockSaves') == 1

        # 멈추기 -> 대기 상태
        panel.get_by_role('button', name='멈추기').click()
        expect(panel.locator('.alert-title', has_text='멈췄습니다')).to_be_visible()

        # 다른 반 화면: 맞는 글 없음 안내
        neis.goto(f'http://localhost:{PORT}/mock-neis/sgb.html?cls=7')
        expect(panel.get_by_text('이 화면 조건(3학년 7반 자율·자치)에 맞는 글이 없습니다')).to_be_visible(timeout=10000)

        # 화면 구조 기록: 구조만, 학생 이름 없음
        panel.get_by_text('도구와 작업 기록').click()
        panel.get_by_role('button', name='화면 구조 기록 (읽기 전용)').click()
        survey = panel.locator('textarea.sgb-survey').input_value()
        data = json.loads(survey)
        assert data['apps'][0]['id'] == 'MOCK_SGB_CREATIVE' and any(c['id'] == 'btnMagam' for c in data['apps'][0]['controls'])
        assert not any(n in survey for n in NAMES | {'김가람'}), 'survey leaked names'
        logs = panel.inner_text('.log-lines')
        assert not any(n in logs for n in NAMES), 'log leaked names'
        assert neis.evaluate('window.__mockViolations') == []

        # 교과세특 화면: 과목 감지
        neis.goto(f'http://localhost:{PORT}/mock-neis/sgb.html?screen=subject&subject=통합과학')
        expect(panel.get_by_text('나이스 생기부 화면 감지됨: 교과 세부능력 및 특기사항')).to_be_visible(timeout=10000)
        expect(panel.get_by_text('3학년 5반 교과세특 (통합과학) · 학생 25명')).to_be_visible()

        ctx.close()
    srv.shutdown()
    print('e2e ok')


if __name__ == '__main__':
    sys.exit(main())
