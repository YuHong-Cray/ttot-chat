(function () {
  if (window.__TTOT_CHAT_UI__) return;
  window.__TTOT_CHAT_UI__ = true;
  var cfg = __TTOT_CFG__;
  // Same-origin /ttot/ proxy when the plugin registered it; otherwise the
  // classic direct-port URL (the status probe is skipped there: cross-origin
  // fetch cannot read status).
  var CHAT_HREF = cfg && cfg.sameOrigin
    ? '/ttot/'
    : 'http://127.0.0.1:' + (cfg && cfg.port) + '/';

  // ── 1) The dsh-login gate injects its floating 账户 <a> as static index
  //      HTML (id dsh-login-acct, bottom-right). That entry now lives on the
  //      right Sidebar's guide page, so drop it from the page.
  function removeAccountButton() {
    var el = document.getElementById('dsh-login-acct');
    if (el) el.remove();
  }
  removeAccountButton();
  document.addEventListener('DOMContentLoaded', removeAccountButton);

  // ── 2) Floating 💬 chat pill, bottom-left. Kept for users who do not use
  //      the right Sidebar. Its default spot parks just ABOVE the settings
  //      trigger (the left sidebar's foot key), so it never covers that key;
  //      the pill is still draggable anywhere. A fresh storage key means an
  //      old saved position (the one over the settings key) does not return.
  var KEY = 'ttot-chat-btn-pos-v2';
  var btn = document.createElement('button');
  btn.id = 'ttot-chat-btn';
  btn.type = 'button';
  btn.textContent = '💬';
  btn.title = '打开 聊聊 (T-to-T 聊天) — ' + CHAT_HREF + '（可拖拽移动）';
  btn.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483000;padding:8px 14px;border:none;border-radius:999px;background:#4d6bfe;color:#fff;font-size:13px;font-weight:600;line-height:1;cursor:grab;box-shadow:0 4px 14px rgba(0,0,0,0.28);font-family:inherit;user-select:none;touch-action:none;';
  (document.body || document.documentElement).appendChild(btn);

  var userMoved = false;
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      btn.style.left = saved.left + 'px';
      btn.style.top = saved.top + 'px';
      btn.style.bottom = 'auto';
      userMoved = true;
    }
  } catch (e) { /* ignore */ }

  function findSettingsTrigger() {
    var cands = document.querySelectorAll('button[aria-haspopup="dialog"]');
    for (var i = 0; i < cands.length; i++) {
      var label = cands[i].getAttribute('aria-label') || '';
      if (label === '设置' || label === 'Settings') return cands[i];
    }
    return null;
  }

  // Park the pill just above the settings trigger, left-aligned with it, so
  // the key stays fully clickable. Re-checked on a light tick: the trigger
  // moves when the sidebar collapses/expands and mounts late (React).
  function placeDefault() {
    if (userMoved) return;
    var t = findSettingsTrigger();
    if (!t) {
      btn.style.left = '16px';
      btn.style.bottom = '16px';
      btn.style.top = 'auto';
      return;
    }
    var r = t.getBoundingClientRect();
    btn.style.top = Math.max(8, r.top - btn.offsetHeight - 10) + 'px';
    btn.style.left = Math.max(8, r.left) + 'px';
    btn.style.bottom = 'auto';
  }
  placeDefault();
  document.addEventListener('DOMContentLoaded', placeDefault);
  setInterval(placeDefault, 1000);

  var dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
  function clamp(v, max) { return Math.max(2, Math.min(v, max - 2)); }
  btn.addEventListener('pointerdown', function (ev) {
    dragging = true; moved = false;
    var r = btn.getBoundingClientRect();
    sx = ev.clientX; sy = ev.clientY; ox = r.left; oy = r.top;
    btn.style.cursor = 'grabbing';
    try { btn.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  });
  btn.addEventListener('pointermove', function (ev) {
    if (!dragging) return;
    var dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
    if (!moved) return;
    btn.style.left = clamp(ox + dx, window.innerWidth) + 'px';
    btn.style.top = clamp(oy + dy, window.innerHeight) + 'px';
    btn.style.bottom = 'auto';
  });
  btn.addEventListener('pointerup', function () {
    if (!dragging) return;
    dragging = false;
    btn.style.cursor = 'grab';
    if (!moved) { window.open(CHAT_HREF, '_blank', 'noopener'); return; }
    userMoved = true;
    try {
      localStorage.setItem(KEY, JSON.stringify({ left: parseInt(btn.style.left, 10), top: parseInt(btn.style.top, 10) }));
    } catch (e) { /* ignore */ }
  });
  btn.addEventListener('pointercancel', function () { dragging = false; btn.style.cursor = 'grab'; });
  btn.addEventListener('mouseenter', function () { btn.style.background = '#3a56d4'; });
  btn.addEventListener('mouseleave', function () { btn.style.background = '#4d6bfe'; });

  // ── 3) Guide-page doors: 聊天 + 账户 on the right Sidebar's start page,
  //      a 2×2 block with 工作区文件/新建终端. The guide DOM is React-owned
  //      (data-sidebar-right-guide), so the doors are re-verified on a cheap
  //      tick; a guide that is re-rendered or re-opened receives them again.
  var DOORS = [
    { href: CHAT_HREF, title: '聊天', description: '聊聊 · T-to-T 即时通讯', icon: '💬' },
    { href: '/dsh-login/account', title: '账户', description: '登录状态 · 用户管理 · 退出', icon: '👤' },
  ];

  var style = document.createElement('style');
  style.id = 'ttot-doors-style';
  // The native guide is a centred single column of 380px pills; the override
  // turns it into a centred 2-column grid (compass spans, the flex spacer
  // removed) so the four entry capsules read as one 2×2 block. The native
  // capsules already shrink to their column (max-width:100%), so no per-
  // capsule overrides are needed; the door tiles mirror the native capsule
  // metrics using the same design tokens.
  style.textContent =
    '[data-sidebar-right-guide]{display:grid !important;grid-template-columns:1fr 1fr !important;align-content:center !important;}' +
    '[data-sidebar-right-guide]::after{display:none !important;}' +
    '[data-sidebar-right-guide] > span[aria-hidden="true"]{grid-column:1 / -1;justify-self:center;}' +
    /* Equal tile sizes (both axes). Heights: the grid stretches the wrapper
       cells, not the capsule inside them, and the native capsules' content
       renders a couple of pixels taller than the injected ones (font metrics
       win per row), so pin every cell to one fixed height and make each
       capsule fill it. Widths: the native wrapper cells and the files pill
       cap at 380px while the injected cells stretch, so on a wide sidebar
       the bottom row comes out wider — give every cell the same box (full
       column, capped at 420px, centred) and make each capsule fill it. The
       four border boxes are then identical at any sidebar width. */
    '[data-sidebar-right-guide] > div{display:flex !important;height:76px !important;width:100% !important;max-width:420px !important;justify-self:center !important;}' +
    '[data-sidebar-right-guide] [data-sidebar-right-guide-entry],.ttot-door{height:100% !important;width:100% !important;max-width:100% !important;}' +
    '.ttot-door{display:flex;gap:14px;align-items:center;box-sizing:border-box;width:100%;max-width:100%;padding:14px 20px;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l4);border-radius:24px;cursor:pointer;text-decoration:none;}' +
    '.ttot-door:hover{background:var(--dsw-alias-interactive-bg-hover);}' +
    '.ttot-door.down{opacity:.55;}' +
    '.ttot-door-icon{display:flex;flex:none;align-items:center;justify-content:center;width:26px;height:26px;font-size:22px;line-height:1;}' +
    '.ttot-door-text{display:flex;flex-direction:column;gap:3px;min-width:0;}' +
    '.ttot-door-title{overflow:hidden;font-size:15px;line-height:1.4;white-space:nowrap;text-overflow:ellipsis;}' +
    '.ttot-door-desc{overflow:hidden;color:var(--dsh-alias-label-caption);font-size:13px;line-height:1.4;white-space:nowrap;text-overflow:ellipsis;}';
  document.head.appendChild(style);

  function makeDoor(door) {
    var cell = document.createElement('div');
    cell.setAttribute('data-ttot-door', door.href);
    var a = document.createElement('a');
    a.className = 'ttot-door';
    a.href = door.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = door.title + ' — ' + door.href + '（新标签页打开）';
    var icon = document.createElement('span');
    icon.className = 'ttot-door-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = door.icon;
    var text = document.createElement('span');
    text.className = 'ttot-door-text';
    var title = document.createElement('span');
    title.className = 'ttot-door-title';
    title.textContent = door.title;
    var desc = document.createElement('span');
    desc.className = 'ttot-door-desc';
    desc.textContent = door.description;
    text.appendChild(title);
    text.appendChild(desc);
    a.appendChild(icon);
    a.appendChild(text);
    cell.appendChild(a);
    return cell;
  }

  function syncDoors() {
    var guide = document.querySelector('[data-sidebar-right-guide]');
    if (!guide) return;
    var have = guide.querySelectorAll(':scope > [data-ttot-door]');
    if (have.length !== DOORS.length) {
      for (var i = 0; i < have.length; i++) have[i].remove();
      for (var j = 0; j < DOORS.length; j++) guide.appendChild(makeDoor(DOORS[j]));
    }
  }
  syncDoors();
  setInterval(syncDoors, 1500);

  // ── 4) One health probe for both entry points: dim the pill and the 聊天
  //      door while the chat server is unreachable (30-second cadence). The
  //      proxy answers 502 while the chat server is down; same-origin only,
  //      so the status is readable.
  function setDown(down) {
    btn.style.opacity = down ? '0.6' : '1';
    var door = document.querySelector('[data-ttot-door="' + CHAT_HREF + '"] .ttot-door');
    if (door) door.classList.toggle('down', down);
  }
  function probe() {
    if (CHAT_HREF.charAt(0) !== '/') return;
    fetch(CHAT_HREF, { cache: 'no-store' })
      .then(function (res) { setDown(!res.ok); })
      .catch(function () { setDown(true); });
  }
  probe();
  setInterval(probe, 30000);
})()
