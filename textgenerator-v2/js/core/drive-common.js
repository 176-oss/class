// 드라이브 공통: 파일 이름, 범위, 오류. 순수 모듈 (contract 13-1).

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const DATA_FILE_NAME = 'sgb-data.json';
export const BACKUP_PREFIX = 'sgb-backup-';

/** 이 PC의 지역 날짜 'YYYYMMDD' */
export function dayStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
}

export function backupName(day) {
  return `${BACKUP_PREFIX}${day}.json`;
}

/** 파일이 바뀌었는지 비교하는 표시. 메타데이터가 없으면 null */
export function metaStamp(meta) {
  if (!meta || (!meta.version && !meta.modifiedTime)) return null;
  return `${meta.version ?? ''}|${meta.modifiedTime ?? ''}`;
}

export const DRIVE_MESSAGES = {
  auth: '구글 연결이 만료되었습니다',
  forbidden: '드라이브 접근 권한이 없습니다. 연결할 때 권한 상자를 체크했는지 확인하세요',
  blocked: '이 구글 계정으로는 연결할 수 없습니다. 학교 계정은 외부 앱이 막혀 있을 수 있으니 개인 구글 계정으로 연결해 주세요',
  popup: '구글 연결 창을 열지 못했습니다. 팝업 차단을 확인하세요',
  network: '인터넷 연결이 없어 올리지 못했습니다. 연결되면 올립니다',
  busy: '구글 드라이브가 잠시 바쁩니다. 조금 뒤 다시 올립니다',
  notfound: '드라이브에서 파일을 찾지 못했습니다',
  newer: '더 새 버전의 앱이 드라이브에 저장했습니다. 새로고침해 주세요',
  parse: '드라이브의 생기부 데이터 파일을 읽을 수 없습니다',
  conflict: '다른 기기에서 동시에 고치고 있어 올리지 못했습니다. 잠시 뒤 다시 올립니다',
  unknown: '구글 드라이브에 저장하지 못했습니다',
};

// 토큰과 응답 본문은 넣지 않는다. 문구는 kind로만 정해진다.
export class DriveError extends Error {
  constructor(kind, { status = null } = {}) {
    const k = DRIVE_MESSAGES[kind] ? kind : 'unknown';
    super(DRIVE_MESSAGES[k]);
    this.name = 'DriveError';
    this.kind = k;
    this.status = status;
    this.userMessage = DRIVE_MESSAGES[k];
  }
}

/** HTTP 응답 상태(+본문)를 DriveError 종류로 */
export function kindFromStatus(status, bodyText = '') {
  if (status === 401) return 'auth';
  if (status === 403) return /rateLimitExceeded|userRateLimitExceeded/.test(String(bodyText)) ? 'busy' : 'forbidden';
  if (status === 404) return 'notfound';
  if (status === 429 || status >= 500) return 'busy';
  return 'unknown';
}
