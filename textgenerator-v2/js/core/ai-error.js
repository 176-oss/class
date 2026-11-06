// AI 오류 형식. gemini.js 가 다시 내보낸다 (prompt.js 와 gemini.js 의 순환 import 를 피하려고 따로 둠).

export const AI_USER_MESSAGES = {
  key: 'API 키가 맞지 않거나 쓸 수 없는 키예요. 설정에서 키를 다시 확인해 주세요.',
  'quota-minute': '짧은 시간에 요청이 많았어요. 잠시 1분쯤 기다렸다가 다시 눌러 주세요.',
  'quota-day': '오늘 쓸 수 있는 양을 다 썼어요. 내일 다시 하거나, 설정에서 다른 모델을 골라 주세요.',
  busy: 'AI 서버가 지금 붐벼요. 조금 뒤에 다시 눌러 주세요.',
  timeout: '답이 너무 오래 걸려서 멈췄어요. 다시 눌러 주세요.',
  network: '인터넷 연결을 확인한 뒤 다시 눌러 주세요.',
  blocked: 'AI가 이 메모로는 답을 주지 않았어요. 메모 표현을 조금 바꿔서 다시 해 보세요.',
  parse: 'AI 답을 읽지 못했어요. 다시 눌러 주세요.',
  model: '설정에 적힌 모델을 찾을 수 없어요. 설정에서 모델 목록을 확인해 주세요.',
  aborted: '초안 만들기를 멈췄어요.',
  privacy: '이름이나 학번이 요청에 들어갈 뻔해서 보내지 않았어요. 메모를 확인해 주세요.',
  unknown: '알 수 없는 문제가 생겼어요. 잠시 뒤에 다시 해 주세요.',
};

export class AiError extends Error {
  /**
   * @param {string} kind key|quota-minute|quota-day|busy|timeout|network|blocked|parse|model|aborted|privacy|unknown
   * @param {string} [message] 개발용 설명 (화면에는 userMessage)
   * @param {object} [extra] { status, model, userMessage }
   */
  constructor(kind, message, extra = {}) {
    super(message || kind);
    this.name = 'AiError';
    this.kind = AI_USER_MESSAGES[kind] ? kind : 'unknown';
    this.userMessage = extra.userMessage || AI_USER_MESSAGES[this.kind];
    if (extra.status != null) this.status = extra.status;
    if (extra.model) this.model = extra.model;
  }
}
