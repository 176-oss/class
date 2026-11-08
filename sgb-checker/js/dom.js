// 화면 만들기 도우미 (textgenerator-v2/js/dom.js의 h, clear를 복사). 글자는 언제나 텍스트 노드나 value로만 넣는다. HTML 문자열은 넣지 않는다.

const PROP_KEYS = new Set(['value', 'checked', 'indeterminate', 'selected', 'defaultValue']);

function isAttrs(x) {
  return x !== null && typeof x === 'object' && !(x instanceof Node) && !Array.isArray(x);
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) { appendChildren(el, c); continue; }
    if (c instanceof Node) { el.appendChild(c); continue; }
    el.appendChild(document.createTextNode(String(c)));
  }
}

function setClass(el, v) {
  if (!v) return;
  if (Array.isArray(v)) v = v.filter(Boolean).join(' ');
  else if (typeof v === 'object') v = Object.keys(v).filter((k) => v[k]).join(' ');
  if (v) el.setAttribute('class', v);
}

function setStyle(el, v) {
  if (!v) return;
  if (typeof v !== 'object') return; // 문자열 style 속성은 CSP(style-src 'self')가 막으므로 받지 않음
  for (const [k, val] of Object.entries(v)) {
    if (val === null || val === undefined || val === false) continue;
    if (k.startsWith('--') || k.includes('-')) el.style.setProperty(k, String(val));
    else el.style[k] = val;
  }
}

/**
 * h('button', { class: 'btn', onclick: fn, 'aria-label': '닫기', disabled: true }, '글자', otherNode)
 * - 문자열·숫자 자식은 텍스트 노드
 * - on* 속성은 addEventListener
 * - class: 문자열, 배열, {이름: 참거짓}
 * - style: 문자열 또는 객체
 * - aria-*: 참거짓도 'true'/'false' 문자열로
 * - data-*: 문자열로
 * - 참거짓 속성: true면 빈 값으로 넣고 false/null이면 뺌
 * - value, checked 등은 속성(property)으로, 자식을 넣은 뒤에 넣음 (select의 value)
 * - ref: (el) => {} 만든 뒤 부름
 */
export function h(tag, attrs, ...children) {
  if (!isAttrs(attrs)) { if (attrs !== undefined) children.unshift(attrs); attrs = {}; }
  const el = document.createElement(tag);
  const props = [];
  let ref = null;
  for (const [key, v] of Object.entries(attrs)) {
    if (key === 'class' || key === 'className') { setClass(el, v); continue; }
    if (key === 'style') { setStyle(el, v); continue; }
    if (key === 'ref') { ref = v; continue; }
    if (key === 'dataset') { for (const [dk, dv] of Object.entries(v || {})) if (dv !== null && dv !== undefined) el.dataset[dk] = String(dv); continue; }
    if (key.startsWith('on') && typeof v === 'function') { el.addEventListener(key.slice(2).toLowerCase(), v); continue; }
    if (PROP_KEYS.has(key)) { props.push([key, v]); continue; }
    if (v === null || v === undefined) continue;
    if (key.startsWith('aria-') || key.startsWith('data-')) { el.setAttribute(key, String(v)); continue; }
    if (v === false) continue;
    if (v === true) { el.setAttribute(key, ''); continue; }
    el.setAttribute(key === 'htmlFor' ? 'for' : key, String(v));
  }
  appendChildren(el, children);
  for (const [k, v] of props) { if (v !== null && v !== undefined) el[k] = v; }
  if (ref) ref(el);
  return el;
}

/** 요소 안을 비우고(자식이 있으면 바꿔 넣고) 요소를 돌려준다 */
export function clear(el, ...children) {
  const nodes = [];
  appendChildren({ appendChild: (n) => nodes.push(n) }, children);
  el.replaceChildren(...nodes);
  return el;
}

