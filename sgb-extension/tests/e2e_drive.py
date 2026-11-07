# 가짜 구글 드라이브(Playwright 가로채기)로 드라이브 경로를 시험한다: 받기, 입력 직전 다시 받기, version 확인 뒤 neis 만 올리기.
# 실행: python tests/e2e_drive.py
import copy, hashlib, json, os, sys, tempfile, time
from playwright.sync_api import sync_playwright, expect
from e2e_mock import EXT, PORT, serve

def h(t):
    return hashlib.sha256(t.encode('utf-8')).hexdigest()[:16]

FILE = {
    'kind': 'sgb-v2-data', 'schemaVersion': 2, 'app': 'textgenerator-v2', 'updatedAt': '2026-11-07T00:00:00.000Z',
    'students': [{'studentId': '30503', 'name': '박다온'}, {'studentId': '30505', 'name': '정마루'}, {'studentId': '30506', 'name': '강바다'}],
    'classes': [],
    'records': [
        {'id': '30503|autonomy', 'studentId': '30503', 'area': 'autonomy', 'subject': None, 'status': 'done', 'final': '드라이브 글 A', 'neis': None, 'updatedAt': 'T1', 'memo': '메모'},
        {'id': '30505|autonomy', 'studentId': '30505', 'area': 'autonomy', 'subject': None, 'status': 'done', 'final': '드라이브 글 B', 'neis': None, 'updatedAt': 'T1'},
        {'id': '30506|autonomy', 'studentId': '30506', 'area': 'autonomy', 'subject': None, 'status': 'draft', 'final': '초안', 'neis': None, 'updatedAt': 'T1'},
    ],
    'settings': {'schoolYear': 2026, 'semester': 2, 'limits': {'autonomy': 1500, 'career': 1500, 'behavior': 900, 'club': 1500, 'subject': 1500}, 'updatedAt': 'S'},
    'styles': {}, 'secrets': {'geminiKey': 'secret', 'updatedAt': 'K'}, 'deleted': [],
}


class FakeDrive:
    def __init__(self):
        self.data = copy.deepcopy(FILE)
        self.version = 1
        self.uploads = []
        self.bump_meta_once = False  # 다음 getMeta 한 번은 다른 기기가 올린 것처럼 version 을 올림

    def meta(self):
        return {'id': 'f1', 'version': str(self.version), 'modifiedTime': f't{self.version}'}

    def handle(self, route):
        req = route.request
        url = req.url
        if req.method == 'PATCH' and '/upload/' in url:
            self.data = json.loads(req.post_data)
            self.uploads.append(copy.deepcopy(self.data))
            self.version += 1
            return route.fulfill(json=self.meta())
        if '/files?' in url and 'appDataFolder' in url:
            return route.fulfill(json={'files': [self.meta()]})
        if '/files/f1?alt=media' in url:
            return route.fulfill(json=self.data)
        if '/files/f1?fields=' in url:
            if self.bump_meta_once:
                self.bump_meta_once = False
                self.version += 1
            return route.fulfill(json=self.meta())
        return route.fulfill(status=404, json={})


def main():
    srv = serve()
    tmp = tempfile.mkdtemp()
    drive = FakeDrive()
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(os.path.join(tmp, 'profile'), headless=True, channel='chromium',
                                                   args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        ctx.route('https://www.googleapis.com/**', drive.handle)
        sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
        ext_id = sw.url.split('/')[2]
        neis = ctx.new_page()
        neis.goto(f'http://localhost:{PORT}/mock-neis/sgb.html')
        panel = ctx.new_page()
        panel.goto(f'chrome-extension://{ext_id}/sidepanel/index.html')
        # 로그인 창 대신 저장된 토큰 (drive.js 는 session 저장소를 먼저 씀)
        panel.evaluate("chrome.storage.session.set({'sgb.driveToken': {token: 'fake', expiresAt: Date.now() + 3600000}})")
        expect(panel.get_by_text('나이스 생기부 화면 감지됨')).to_be_visible(timeout=10000)

        panel.get_by_role('button', name='구글 드라이브에서 받기').click()
        expect(panel.get_by_text('3학년 5반 자율·자치 2명')).to_be_visible(timeout=5000)  # draft 는 제외

        # 받은 뒤 웹앱에서 B 글을 고침 -> [입력 시작] 은 입력하지 않고 새 글을 받아 멈춤
        drive.data['records'][1]['final'] = '고친 글 B'
        drive.version += 1
        panel.get_by_role('button', name='입력 시작').click()
        expect(panel.locator('.alert-title', has_text='웹앱에서 바뀐 글을 새로 받았습니다')).to_be_visible(timeout=5000)
        assert neis.evaluate("cpr.core.Platform.INSTANCE.getAllRunningAppInstances()[0].lookup('grdMain').dataSet.getValue(4, 'spcfCn')") == ''

        panel.get_by_role('button', name='입력 시작').click()
        expect(panel.get_by_role('button', name='확인 완료 · 저장 (2명)')).to_be_visible(timeout=10000)
        assert neis.evaluate("cpr.core.Platform.INSTANCE.getAllRunningAppInstances()[0].lookup('grdMain').dataSet.getValue(4, 'spcfCn')") == '고친 글 B'
        panel.get_by_role('button', name='확인 완료 · 저장 (2명)').click()
        drive.bump_meta_once = True  # 올리기 직전 다른 기기가 올림 -> 다시 받아 처음부터
        panel.get_by_role('button', name='이대로 저장').click()
        expect(panel.get_by_text('2명 저장했습니다')).to_be_visible(timeout=15000)
        deadline = time.time() + 10
        while not drive.uploads and time.time() < deadline:
            panel.wait_for_timeout(200)
        assert len(drive.uploads) == 1, len(drive.uploads)
        assert drive.bump_meta_once is False and drive.version == 4  # 1 + 웹앱 수정 + 다른 기기 + 올리기: version 확인 뒤 다시 받아 올림

        up = drive.uploads[0]
        recs = {r['id']: r for r in up['records']}
        assert recs['30503|autonomy']['neis']['hash'] == h('드라이브 글 A')
        assert recs['30505|autonomy']['neis']['hash'] == h('고친 글 B')
        assert recs['30506|autonomy']['neis'] is None
        assert recs['30503|autonomy']['neis']['doneAt'].endswith('Z')
        # neis 말고는 그대로 (updatedAt, secrets, 다른 필드 포함)
        expect_file = copy.deepcopy(FILE)
        expect_file['records'][1]['final'] = '고친 글 B'
        for r in expect_file['records'][:2]:
            r['neis'] = recs[r['id']]['neis']
        assert up == expect_file, 'drive file changed beyond neis'

        # 다시 받아도 같은 표시면 올리지 않음, 목록은 '저장됨'
        panel.get_by_role('button', name='드라이브에서 다시 받기').click()
        expect(panel.locator('.badge', has_text='저장됨')).to_have_count(2, timeout=5000)
        panel.wait_for_timeout(500)
        assert len(drive.uploads) == 1

        # 더 새 버전 파일은 거부
        drive.data['schemaVersion'] = 3
        panel.get_by_role('button', name='드라이브에서 다시 받기').click()
        expect(panel.get_by_text('더 새 버전의 웹앱이')).to_be_visible(timeout=5000)
        assert neis.evaluate('window.__mockViolations') == []
        ctx.close()
    srv.shutdown()
    print('e2e drive ok')


if __name__ == '__main__':
    sys.exit(main())
