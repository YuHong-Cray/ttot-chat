/**
 * ttot-chat — the DSH Web-GUI entry button.
 *
 * One source of truth for the classic script injected into the served
 * index.html (through webServer.tapIndex) and for the raw-HTML transform.
 * Loaded by lib/index.js (row config role: ui) and by lib/ui.js (the
 * standalone UI module named by an absolute-path row).
 */
export const BUTTON_ID = 'ttot-chat-ui'
export const BUTTON_MARKER = '__TTOT_CHAT_UI__'

const BUTTON_JS_LINES = [
  '(function () {',
  '  if (window.__TTOT_CHAT_UI__) return;',
  '  window.__TTOT_CHAT_UI__ = true;',
  '  var port = __TTOT_PORT__;',
  "  var url = location.protocol + '//' + location.hostname + ':' + port;",
  "  var btn = document.createElement('button');",
  "  btn.id = 'ttot-chat-btn';",
  "  btn.type = 'button';",
  "  btn.textContent = '💬';",
  "  btn.title = '打开 聊聊 (T-to-T 聊天) — ' + url;",
  "  btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 18px;border:none;border-radius:999px;background:#4d6bfe;color:#fff;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.25);';",
  "  btn.addEventListener('mouseenter', function () { btn.style.background = '#3a56d4'; });",
  "  btn.addEventListener('mouseleave', function () { btn.style.background = '#4d6bfe'; });",
  "  btn.addEventListener('click', function () { window.open(url, '_blank', 'noopener'); });",
  '  (document.body || document.documentElement).appendChild(btn);',
  '  function check() {',
  "    fetch(url + '/', { mode: 'no-cors', cache: 'no-store' })",
  "      .then(function () { btn.style.opacity = '1'; })",
  "      .catch(function () { btn.style.opacity = '0.55'; });",
  '  }',
  '  check();',
  '  setInterval(check, 30000);',
  '})()',
]

/** Classic script text; __TTOT_PORT__ is replaced by the transform. */
export const BUTTON_JS = BUTTON_JS_LINES.join('\n')

/**
 * Build the raw-HTML transform that injects the floating chat button before
 * </body>. Pure and idempotent: a second injection is skipped by marker.
 */
export function chatButtonTransform(port) {
  const script = '<script id="' + BUTTON_ID + '">' + BUTTON_JS.replace('__TTOT_PORT__', String(port)) + '</script>'
  return (html) => {
    if (html.indexOf(BUTTON_MARKER) !== -1) return html
    const idx = html.lastIndexOf('</body>')
    if (idx === -1) return html + script
    return html.slice(0, idx) + script + '\n' + html.slice(idx)
  }
}