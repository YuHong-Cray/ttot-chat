// ── State ──
let ws = null;
let token = localStorage.getItem('chat_token');
let myUsername = localStorage.getItem('chat_username') || '';
let myUserId = null;
let myRole = null;
let currentPrivatePartner = null;
let currentGroup = null;
let groupsInfo = {}; // groupId -> { name, memberCount? }
const privateMessages = {};
const unreadCounts = {}; // friendId -> unread private message count
let newMsgToastTimer = null;
const groupMessages = {}; // groupId -> [messages]
let typingTimer = null;
const TYPING_TIMEOUT = 2000;
let soundEnabled = localStorage.getItem('chat_sound') !== 'off';

// ── Call state ──
let pc = null;
let localStream = null;
let remoteStream = null;
let callState = 'idle'; // idle | calling | ringing | connected
let callPartnerId = null;
let callPartnerName = '';
let callMode = 'audio';
let callTimerInterval = null;
let callStartTime = null;
let callTimeoutId = null;
const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ── Conference state ──
let confLocalStream = null;
let confPeerConnections = new Map();
let confRemoteStreams = new Map();
let currentConfRoom = null;
let confMicEnabled = true;
let confCamEnabled = false;
let confChatEnabled = false;
let confTimerInterval = null;
let confStartTime = null;
let confScreenEnabled = false;
let _screenShareBusy = false;
let _cameraWasOnBeforeScreen = false;
let _confScreenLastStop = 0;
let _pendingConfInvite = null;
let _confAutoInviteUserId = null; // friend to auto-invite when a meeting is started from their 会议 button
let _confRemoteSharing = null;   // userId of the remote participant currently sharing their screen
let _confScreenStream = null;    // the local getDisplayMedia stream for screen sharing

// Friend & admin state
let friendIds = [];          // array of userIds
let outgoingIds = [];        // array of userIds I sent requests to
let incomingReqs = [];       // [{ requestId, userId }]
let pendingUsers = [];       // for admin: [{ id, username, created_at }]

const $ = (s) => document.querySelector(s);
const authOverlay = $('#auth-overlay');
const chatContainer = $('#chat-container');
const loginForm = $('#login-form');
const registerForm = $('#register-form');
const tabs = document.querySelectorAll('.tab');
const msgInput = $('#msg-input');
const sendBtn = $('#send-btn');
const inputArea = $('#input-area');
const messagesEl = $('#messages');
const userListEl = $('#user-list');
const userCountEl = $('#user-count');
const userSearch = $('#user-search');
const typingIndicator = $('#typing-indicator');
const myNameEl = $('#my-name');
const logoutBtn = $('#logout-btn');
const fileInput = $('#file-input');
const uploadBtn = $('#upload-btn');
const screenshotBtn = $('#screenshot-btn');
const lightbox = $('#lightbox');
const lightboxImg = lightbox?.querySelector('img');
const privateBar = $('#private-bar');
const privateName = $('#private-name');
const deleteFriendBtn = $('#delete-friend-btn');
const backToPublic = $('#back-to-public');
const adminPanel = $('#admin-panel');
const adminToggle = $('#admin-toggle');
const adminBody = $('#admin-body');
const adminList = $('#admin-list');
const changePwBtn = $('#change-pw-btn');
const confRoomBtn = $('#conf-room-btn');
const pwModal = $('#pw-modal');
const pwForm = $('#pw-form');
const pwCancel = $('#pw-cancel');
const soundToggle = $('#sound-toggle');
const profileBtn = $('#profile-btn');
const footerMore = $('#footer-more');
const footerExtra = $('#footer-extra');
const profileModal = $('#profile-modal');
const profileForm = $('#profile-form');
const profileCancel = $('#profile-cancel');
const profileAvatarPreview = $('#profile-avatar-preview');
const profileAvatarBtn = $('#profile-avatar-btn');
const profileAvatarInput = $('#profile-avatar-input');

// ── Group DOM refs ──
const groupSection = $('#group-section');
const groupList = $('#group-list');
const createGroupBtn = $('#create-group-btn');
const createGroupModal = $('#create-group-modal');
const createGroupForm = $('#create-group-form');
const createGroupCancel = $('#create-group-cancel');
const cgName = $('#cg-name');
const cgFriendList = $('#cg-friend-list');
const groupBar = $('#group-bar');
const groupBarName = $('#group-bar-name');
const backFromGroup = $('#back-from-group');
const inviteGroupModal = $('#invite-group-modal');
const igFriendList = $('#ig-friend-list');
const inviteGroupBtn = $('#invite-group-btn');
const inviteGroupCancel = $('#invite-group-cancel');
const inviteGroupError = $('#invite-group-error');

// ── Moments DOM refs ──
const momentsBtn = $('#moments-btn');
const momentsPage = $('#moments-page');
const momentsBack = $('#moments-back');
const momentsFeed = $('#moments-feed');
const momentsLoading = $('#moments-loading');
const miContent = $('#mi-content');
const miImageBtn = $('#mi-image-btn');
const miImageInput = $('#mi-image-input');
const miImagePreview = $('#mi-image-preview');
const miLinkUrl = $('#mi-link-url');
const miLinkTitle = $('#mi-link-title');
const miMusicUrl = $('#mi-music-url');
const miVideoUrl = $('#mi-video-url');
const miError = $('#mi-error');
const miSubmit = $('#mi-submit');
const createMomentModal = $('#create-moment-modal');
const mmContent = $('#mm-content');
const mmSubmit = $('#mm-submit');
const mmCancel = $('#mm-cancel');

// ── Call DOM refs ──
const incomingCallEl = $('#incoming-call');
const incomingCallIcon = $('#incoming-call-icon');
const incomingCallerName = $('#incoming-caller-name');
const incomingCallMode = $('#incoming-call-mode');
const callAcceptBtn = $('#call-accept-btn');
const callDeclineBtn = $('#call-decline-btn');
const callOverlay = $('#call-overlay');
const remoteVideo = $('#remote-video');
const localVideo = $('#local-video');
const callTimer = $('#call-timer');
const callMicBtn = $('#call-mic-btn');
const callCamBtn = $('#call-cam-btn');
const callHangupBtn = $('#call-hangup-btn');
const callStatus = $('#call-status');
const callAudioPlaceholder = $('#call-audio-placeholder');
const callAudioName = $('#call-audio-name');

// ── Conference DOM refs ──
const confRoomModal = $('#conf-room-modal');
const confCreateBtn = $('#conf-create-btn');
const confJoinBtn = $('#conf-join-btn');
const confJoinInput = $('#conf-join-input');
const confRoomClose = $('#conf-room-close');
const confRoomError = $('#conf-room-error');
const confOverlay = $('#conf-overlay');
const confVideoGrid = $('#conf-video-grid');
const confTimer = $('#conf-timer');
const confMicBtn = $('#conf-mic-btn');
const confCamBtn = $('#conf-cam-btn');
const confScreenBtn = $('#conf-screen-btn');
const confParticipantsBtn = $('#conf-participants-btn');
const confInviteBtn = $('#conf-invite-btn');
const confHostBtn = $('#conf-host-btn');
const confLeaveBtn = $('#conf-leave-btn');
const confChatArea = $('#conf-chat-area');
const confChatMessages = $('#conf-chat-messages');
const confChatInput = $('#conf-chat-input');
const confChatSend = $('#conf-chat-send');
const confChatParticipantList = $('#conf-chat-participant-list');
const confInviteFriends = $('#conf-invite-friends');
const confInviteFriendList = $('#conf-invite-friend-list');
const confInvite = $('#conf-invite');
const confInviteTitle = $('#conf-invite-title');
const confInviteDesc = $('#conf-invite-desc');
const confAcceptBtn = $('#conf-accept-btn');
const confDeclineBtn = $('#conf-decline-btn');
const confMainArea = $('#conf-main-area');
const confMainVideo = $('#conf-main-video');
const confMainPlaceholder = $('#conf-main-placeholder');
const confEndBtn = $('#conf-end-btn');

// ── Tab switching ──
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    loginForm.classList.toggle('hidden', tab.dataset.tab !== 'login');
    registerForm.classList.toggle('hidden', tab.dataset.tab !== 'register');
  });
});

// ── HTTP helpers ──
async function api(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

// ── Auth ──
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const [username, password] = e.target.querySelectorAll('input');
  const errEl = e.target.querySelector('.auth-error');
  try {
    const data = await api('POST', '/api/login', { username: username.value, password: password.value });
    onAuthSuccess(data.token, data.username, data.role);
  } catch (err) {
    if (err.pending) errEl.textContent = '账号待管理员审批，请等待';
    else errEl.textContent = err.error || '登录失败';
  }
});

// SMS 验证码发送 (带倒计时)
const sendCodeBtn = $('#send-code-btn');
let codeCountdown = 0;
sendCodeBtn.addEventListener('click', async () => {
  if (codeCountdown > 0) return;
  const phone = $('#reg-phone').value.trim();
  const errEl = registerForm.querySelector('.auth-error');
  if (!/^1\d{10}$/.test(phone)) {
    errEl.textContent = '请输入正确的11位手机号';
    return;
  }
  errEl.textContent = '';
  sendCodeBtn.disabled = true;
  sendCodeBtn.textContent = '发送中...';
  try {
    const data = await api('POST', '/api/sms/send-code', { phone });
    errEl.style.color = '#4caf50';
    errEl.textContent = data.message || '验证码已发送';
    // 开始60秒倒计时
    codeCountdown = 60;
    sendCodeBtn.textContent = `${codeCountdown}s`;
    const timer = setInterval(() => {
      codeCountdown--;
      if (codeCountdown <= 0) {
        clearInterval(timer);
        sendCodeBtn.textContent = '重新发送';
        sendCodeBtn.disabled = false;
      } else {
        sendCodeBtn.textContent = `${codeCountdown}s`;
      }
    }, 1000);
  } catch (err) {
    errEl.style.color = '#e74c3c';
    errEl.textContent = err.error || '发送失败';
    sendCodeBtn.disabled = false;
    sendCodeBtn.textContent = '发送验证码';
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = $('#reg-phone').value.trim();
  const code = $('#reg-code').value.trim();
  const inputs = e.target.querySelectorAll('input[type="password"]');
  const password = inputs[0].value;
  const confirm = inputs[1].value;
  const errEl = e.target.querySelector('.auth-error');
  if (password !== confirm) {
    errEl.textContent = '两次密码输入不一致';
    return;
  }
  try {
    const data = await api('POST', '/api/register', { phone, code, password });
    onAuthSuccess(data.token, data.username, data.role);
  } catch (err) {
    errEl.textContent = err.error || '注册失败';
  }
});

function onAuthSuccess(newToken, name, role) {
  token = newToken;
  myUsername = name;
  myRole = role;
  localStorage.setItem('chat_token', token);
  localStorage.setItem('chat_username', name);
  authOverlay.classList.add('hidden');
  chatContainer.classList.remove('hidden');
  myNameEl.innerHTML = name + (role === 'admin' ? '<span class="admin-badge">管理员</span>' : '');
  if (role === 'admin') adminPanel.classList.remove('hidden');
  msgInput.focus();
  // Ask for notification permission so new-message bubbles can be shown.
  try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch {}
  connectWebSocket();
}

logoutBtn.addEventListener('click', () => {
  if (ws) ws.close();
  token = null;
  myUsername = '';
  myUserId = null;
  myRole = null;
  currentPrivatePartner = null;
  Object.keys(privateMessages).forEach(k => delete privateMessages[k]);
  friendIds = []; outgoingIds = []; incomingReqs = [];
  localStorage.removeItem('chat_token');
  localStorage.removeItem('chat_username');
  chatContainer.classList.add('hidden');
  adminPanel.classList.add('hidden');
  messagesEl.innerHTML = '';
  userListEl.innerHTML = '';
  authOverlay.classList.remove('hidden');
  loginForm.querySelector('input').focus();
});

// ── Auto login ──
if (token && myUsername) {
  // Validate token via lightweight API call first
  api('GET', '/api/friends/statuses').then(() => {
    myNameEl.textContent = myUsername;
    authOverlay.classList.add('hidden');
    chatContainer.classList.remove('hidden');
    msgInput.focus();
    connectWebSocket();
  }).catch(() => {
    token = null;
    myUsername = '';
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_username');
  });
}

// ── Change Password ──
changePwBtn.addEventListener('click', () => {
  pwModal.classList.remove('hidden');
  pwForm.querySelectorAll('input').forEach(i => i.value = '');
  pwForm.querySelector('.auth-error').textContent = '';
  pwForm.querySelector('.auth-success').textContent = '';
  pwForm.querySelector('input').focus();
});

pwCancel.addEventListener('click', () => pwModal.classList.add('hidden'));
pwModal.addEventListener('click', (e) => { if (e.target === pwModal) pwModal.classList.add('hidden'); });

pwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const [oldPw, newPw, confirmPw] = e.target.querySelectorAll('input');
  const errEl = e.target.querySelector('.auth-error');
  const okEl = e.target.querySelector('.auth-success');
  errEl.textContent = '';
  okEl.textContent = '';

  if (newPw.value !== confirmPw.value) {
    errEl.textContent = '两次新密码输入不一致';
    return;
  }

  try {
    const data = await api('POST', '/api/change-password', { oldPassword: oldPw.value, newPassword: newPw.value });
    okEl.textContent = '密码修改成功！';
    oldPw.value = '';
    newPw.value = '';
    confirmPw.value = '';
    setTimeout(() => pwModal.classList.add('hidden'), 1500);
  } catch (err) {
    errEl.textContent = err.error || '修改失败';
  }
});

// ── Profile ──
profileBtn.addEventListener('click', openProfileModal);

async function openProfileModal() {
  profileModal.classList.remove('hidden');
  profileForm.querySelector('.auth-error').textContent = '';
  profileForm.querySelector('.auth-success').textContent = '';
  try {
    const data = await api('GET', `/api/profile/${myUserId}`);
    document.getElementById('pf-nickname').value = data.nickname || '';
    document.getElementById('pf-fullname').value = data.full_name || '';
    document.getElementById('pf-birthdate').value = data.birth_date || '';
    document.getElementById('pf-occupation').value = data.occupation || '';
    document.getElementById('pf-birthplace').value = data.birthplace || '';
    if (data.avatar) {
      profileAvatarPreview.src = data.avatar;
    } else {
      profileAvatarPreview.src = '';
      profileAvatarPreview.style.background = '#f0f2f5';
      profileAvatarPreview.alt = '';
    }
  } catch {
    // loaded with empty fields
  }
}

profileCancel.addEventListener('click', () => profileModal.classList.add('hidden'));
profileModal.addEventListener('click', (e) => { if (e.target === profileModal) profileModal.classList.add('hidden'); });

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = profileForm.querySelector('.auth-error');
  const okEl = profileForm.querySelector('.auth-success');
  errEl.textContent = '';
  okEl.textContent = '';
  try {
    await api('POST', '/api/profile', {
      nickname: document.getElementById('pf-nickname').value,
      full_name: document.getElementById('pf-fullname').value,
      birth_date: document.getElementById('pf-birthdate').value,
      occupation: document.getElementById('pf-occupation').value,
      birthplace: document.getElementById('pf-birthplace').value,
    });
    okEl.textContent = '保存成功！';
  } catch (err) {
    errEl.textContent = err.error || '保存失败';
  }
});

// Avatar upload
profileAvatarBtn.addEventListener('click', () => profileAvatarInput.click());
profileAvatarInput.addEventListener('change', async () => {
  const file = profileAvatarInput.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('avatar', file);
  try {
    const res = await fetch('/api/profile/avatar', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    profileAvatarPreview.src = data.url;
    profileForm.querySelector('.auth-success').textContent = '头像已更新';
  } catch (err) {
    profileForm.querySelector('.auth-error').textContent = err.message || '头像上传失败';
  }
  profileAvatarInput.value = '';
});

// ── Sound Toggle ──
if (!soundEnabled) soundToggle.classList.add('muted');
soundToggle.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundToggle.classList.toggle('muted', !soundEnabled);
  soundToggle.innerHTML = soundEnabled ? '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>' : '🔕';
  localStorage.setItem('chat_sound', soundEnabled ? 'on' : 'off');
});

// ── Footer more toggle ──
footerMore.addEventListener('click', () => {
  footerExtra.classList.toggle('hidden');
});

// ── Call event listeners ──
callAcceptBtn.addEventListener('click', acceptCall);
callDeclineBtn.addEventListener('click', declineCall);
callHangupBtn.addEventListener('click', endCall);
callMicBtn.addEventListener('click', toggleMic);
callCamBtn.addEventListener('click', toggleCamera);

// ── Conference event listeners ──
confCreateBtn.addEventListener('click', () => {
  if (!ws) return;
  confRoomError.textContent = '';
  ws.send(JSON.stringify({ type: 'conference_create' }));
});
confJoinBtn.addEventListener('click', () => {
  const code = confJoinInput.value.trim();
  if (!code) { confRoomError.textContent = '请输入会议码'; return; }
  confRoomError.textContent = '';
  if (!ws) return;
  ws.send(JSON.stringify({ type: 'conference_join', roomCode: code }));
  confJoinInput.value = '';
  if (!currentConfRoom) {
    currentConfRoom = { code, hostId: null, participants: [{ userId: myUserId, username: myUsername }] };
    showConfOverlay();
    startConfLocalStream();
  }
});
confRoomBtn.addEventListener('click', () => {
  confRoomModal.classList.remove('hidden');
  confRoomError.textContent = '';
  confJoinInput.value = '';
});
confRoomClose.addEventListener('click', () => confRoomModal.classList.add('hidden'));
confRoomModal.addEventListener('click', (e) => { if (e.target === confRoomModal) confRoomModal.classList.add('hidden'); });
confLeaveBtn.addEventListener('click', leaveConference);
confMicBtn.addEventListener('click', toggleConfMic);
confCamBtn.addEventListener('click', toggleConfCam);
confScreenBtn.addEventListener('click', toggleConfScreen);
confChatSend.addEventListener('click', sendConfChat);
confChatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendConfChat(); });
confParticipantsBtn.addEventListener('click', toggleConfChat);
confInviteBtn.addEventListener('click', openConfInvite);
confAcceptBtn.addEventListener('click', acceptConfInvite);
confDeclineBtn.addEventListener('click', declineConfInvite);
confHostBtn.addEventListener('click', transferHost);
confEndBtn.addEventListener('click', () => {
  if (!currentConfRoom || !ws) return;
  if (!confirm('确定要结束会议吗？所有参会者将被断开。')) return;
  ws.send(JSON.stringify({ type: 'conference_end', roomCode: currentConfRoom.code }));
  leaveConference();
});

// ── Admin panel ──
let allUsers = [];

adminToggle.addEventListener('click', async () => {
  const open = adminBody.classList.toggle('hidden');
  adminToggle.textContent = open ? '展开' : '收起';
  if (!open) await refreshAllAdminData();
});

// Admin tab switching
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('admin-pending-section').classList.toggle('hidden', tab.dataset.atab !== 'pending');
    document.getElementById('admin-all-section').classList.toggle('hidden', tab.dataset.atab !== 'all');
    if (tab.dataset.atab === 'all') renderAllUsersList();
  });
});

async function refreshAllAdminData() {
  await Promise.all([refreshPendingUsers(), refreshAllUsers()]);
}

async function refreshPendingUsers() {
  try {
    const data = await api('GET', '/api/admin/pending');
    pendingUsers = data.users;
    renderPendingList();
  } catch {}
}

async function refreshAllUsers() {
  try {
    const data = await api('GET', '/api/admin/users');
    allUsers = data.users;
    if (!document.getElementById('admin-all-section').classList.contains('hidden')) {
      renderAllUsersList();
    }
  } catch {}
}

function renderPendingList() {
  const list = document.getElementById('admin-pending-list');
  const empty = document.querySelector('#admin-pending-section .admin-empty');
  list.innerHTML = '';
  if (pendingUsers.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  pendingUsers.forEach((u) => {
    const div = document.createElement('div');
    div.className = 'admin-user';
    div.innerHTML = `
      <span class="aname">${u.username}</span>
      <button class="admin-approve" data-id="${u.id}">通过</button>
      <button class="admin-reject" data-id="${u.id}">拒绝</button>
    `;
    div.querySelector('.admin-approve').addEventListener('click', async () => {
      await api('POST', '/api/admin/approve', { userId: u.id });
      renderSystem(`已批准用户 ${u.username}`);
      await refreshAllAdminData();
    });
    div.querySelector('.admin-reject').addEventListener('click', async () => {
      await api('POST', '/api/admin/reject', { userId: u.id });
      renderSystem(`已拒绝用户 ${u.username}`);
      await refreshAllAdminData();
    });
    list.appendChild(div);
  });
}

function renderAllUsersList() {
  const list = document.getElementById('admin-all-list');
  list.innerHTML = '';
  allUsers.forEach((u) => {
    const div = document.createElement('div');
    div.className = 'admin-user';
    const statusText = u.status === 'active' ? '' : ` (${u.status})`;
    const roleText = u.role === 'admin' ? ' 👑' : '';
    div.innerHTML = `
      <span class="aname">${u.username}${roleText}${statusText}</span>
      ${u.role !== 'admin' ? `<button class="admin-delete" data-id="${u.id}">删除</button>` : ''}
    `;
    if (u.role !== 'admin') {
      div.querySelector('.admin-delete').addEventListener('click', async () => {
        if (!confirm(`确定删除用户「${u.username}」？此操作不可撤销！`)) return;
        try {
          const res = await api('POST', '/api/admin/delete-user', { userId: u.id });
          renderSystem(res.message || `已删除用户 ${u.username}`);
          await refreshAllAdminData();
        } catch (err) {
          renderSystem(err.error || '删除失败');
        }
      });
    }
    list.appendChild(div);
  });
}

// ── Private chat ──
backToPublic.addEventListener('click', leavePrivateChat);
backFromGroup.addEventListener('click', leaveGroupChat);

function enterPrivateChat(userId, name) {
  if (userId === myUserId) return;
  if (currentGroup) leaveGroupChat();
  currentPrivatePartner = { id: userId, name };
  privateName.textContent = name;
  privateBar.classList.remove('hidden');
  deleteFriendBtn.onclick = (e) => { e.stopPropagation(); deleteFriend(userId, name); };
  // Clear this friend's unread badge.
  if (unreadCounts[userId]) { delete unreadCounts[userId]; updateUnreadBadge(userId, 0); }
  stopTitleFlash();
  renderCurrentView();
  updateUserListSelection(userId);
  loadPrivateHistory(userId);
}

// Load persisted private-message history between me and a partner.
async function loadPrivateHistory(userId) {
  const key = getPrivateKey(userId);
  try {
    const data = await api('GET', `/api/messages/${userId}`);
    const history = (data.messages || []).map(m => {
      const type = m.type === 'image' ? 'private_image' : m.type === 'video' ? 'private_video' : 'private_message';
      const base = {
        msgId: 'pm_' + m.id,
        created_at: m.created_at,
        fromUserId: m.sender_id,
        fromName: m.sender_name || getDisplayName(m.sender_id),
        isPrivate: true,
        type,
      };
      if (type === 'private_message') base.text = m.content;
      else base.url = m.content;
      return base;
    });
    const existing = privateMessages[key] || [];
    if (existing.length === 0) {
      privateMessages[key] = history;
    } else {
      const existingSigs = new Set(existing.map(m => `${m.fromUserId}|${m.type}|${m.text || m.url || ''}`));
      const missing = history.filter(h => !existingSigs.has(`${h.fromUserId}|${h.type}|${h.text || h.url || ''}`));
      privateMessages[key] = missing.concat(existing);
    }
    privateMessages[key].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    if (currentPrivatePartner && currentPrivatePartner.id === userId) renderCurrentView();
  } catch { /* history load is best-effort */ }
}

async function deleteFriend(userId, name) {
  if (!confirm(`确定删除好友 ${name || ''}？此操作会清空你们在本地的聊天记录。`)) return;
  try {
    await api('POST', '/api/friends/remove', { userId });
    // Clear this friend's local message cache + current chat view (local only)
    const key = getPrivateKey(userId);
    delete privateMessages[key];
    if (currentPrivatePartner && currentPrivatePartner.id === userId) messagesEl.innerHTML = '';
    renderSystem('已删除好友');
    if (typeof fetchFriendStatuses === 'function') fetchFriendStatuses();
    leavePrivateChat();
  } catch (err) {
    renderSystem(err.error || '删除失败');
  }
}

function leavePrivateChat() {
  currentPrivatePartner = null;
  privateBar.classList.add('hidden');
  renderCurrentView();
  updateUserListSelection(null);
}

function updateUserListSelection(selectedId) {
  userListEl.querySelectorAll('li').forEach((li) => {
    li.classList.toggle('active', li.dataset.userId == selectedId);
  });
}

function getPrivateKey(userId) {
  return [myUserId, userId].sort().join('-');
}

function storePrivateMessage(data) {
  const partnerId = data.fromUserId == myUserId ? (data.targetUserId || data.toUserId) : data.fromUserId;
  if (!partnerId) return;
  const key = getPrivateKey(partnerId);
  if (!privateMessages[key]) privateMessages[key] = [];
  const msg = { ...data, isPrivate: true };
  if (!msg.msgId) msg.msgId = 'pm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  if (!msg.created_at) msg.created_at = new Date().toISOString();
  privateMessages[key].push(msg);
}

// ── Unread message badges / new-message toast ──
function updateUnreadBadge(userId, count) {
  const li = userListEl.querySelector(`li[data-user-id="${userId}"]`);
  if (!li) return;
  let wrap = li.querySelector('.user-avatar-wrap');
  if (!wrap) wrap = li;
  let badge = wrap.querySelector('.unread-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'unread-badge';
      wrap.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = 'flex';
  } else if (badge) {
    badge.remove();
  }
}
function showNewMsgToast(text) {
  let toast = document.getElementById('chat-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'chat-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(newMsgToastTimer);
  newMsgToastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// Flash the tab title to get attention (taskbar/tab icon effect).
let titleTimer = null, titleFlashOn = false;
function startTitleFlash() {
  const base = '企业里的同事圈';
  titleFlashOn = false;
  clearInterval(titleTimer);
  titleTimer = setInterval(() => {
    titleFlashOn = !titleFlashOn;
    document.title = titleFlashOn ? '🔴 新消息' : base;
  }, 1000);
}
function stopTitleFlash() {
  clearInterval(titleTimer);
  titleTimer = null;
  document.title = '企业里的同事圈';
}
// Native browser notification (floating bubble) — requires permission.
function showSystemNotification(title, body) {
  try {
    if (!window.Notification) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => { if (p === 'granted') new Notification(title, { body }); });
    }
  } catch { /* ignore */ }
}
// Stop tab-title flashing when the window regains focus.
window.addEventListener('focus', stopTitleFlash);
document.addEventListener('visibilitychange', () => { if (!document.hidden) stopTitleFlash(); });
// Called when a private message arrives from a friend. Always shows a float
// notification; the unread badge only accumulates when we're NOT viewing that chat.
function notifyNewPrivateMsg(data) {
  const friendId = Number(data.fromUserId);
  if (!friendId) return;
  const text = `${data.fromName || '好友'} 发来新消息`;
  showNewMsgToast(text);          // in-page toast
  startTitleFlash();              // tab/taskbar icon flash
  showSystemNotification('企业里的同事圈', text);  // native floating bubble
  if (currentPrivatePartner && Number(currentPrivatePartner.id) === friendId) return; // already reading it
  unreadCounts[friendId] = (unreadCounts[friendId] || 0) + 1;
  updateUnreadBadge(friendId, unreadCounts[friendId]);
}

// ── Group functions ──

async function fetchGroups() {
  try {
    const data = await api('GET', '/api/groups');
    groupsInfo = {};
    data.groups.forEach(g => groupsInfo[g.id] = { name: g.name, creatorId: g.creator_id });
    renderGroupList(data.groups);
    groupSection.classList.remove('hidden');
  } catch { groupSection.classList.add('hidden'); }
}

function renderGroupList(groups) {
  groupList.innerHTML = '';
  groups.forEach(g => {
    const li = document.createElement('li');
    li.dataset.groupId = g.id;
    if (currentGroup && currentGroup.id === g.id) li.classList.add('active');

    const icon = document.createElement('span');
    icon.className = 'group-icon';
    icon.innerHTML = '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5Z"/></svg>';
    li.appendChild(icon);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'gname';
    nameSpan.textContent = g.name;
    li.appendChild(nameSpan);

    const inviteBtn = document.createElement('button');
    inviteBtn.className = 'g-invite';
    inviteBtn.textContent = '+';
    inviteBtn.title = '邀请好友';
    inviteBtn.addEventListener('click', (e) => { e.stopPropagation(); openInviteModal(g.id); });
    li.appendChild(inviteBtn);

    if (g.creator_id === myUserId) {
      const renameBtn = document.createElement('button');
      renameBtn.className = 'g-rename';
      renameBtn.textContent = '改名';
      renameBtn.title = '重命名群组';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newName = prompt('输入新的群名称：', g.name);
        if (newName && newName.trim() && newName.trim() !== g.name) {
          api('PUT', `/api/groups/${g.id}`, { name: newName.trim() }).then(() => {
            g.name = newName.trim();
            nameSpan.textContent = newName.trim();
            if (currentGroup && currentGroup.id === g.id) {
              currentGroup.name = newName.trim();
              groupBarName.textContent = newName.trim();
            }
            renderSystem('群名称已更新');
          }).catch(err => renderSystem(err.error || '重命名失败'));
        }
      });
      li.appendChild(renameBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'g-delete';
      deleteBtn.textContent = '删除';
      deleteBtn.title = '删除群组';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`确定删除群聊「${g.name}」？此操作不可撤销！`)) {
          api('DELETE', `/api/groups/${g.id}`).then(() => {
            if (currentGroup && currentGroup.id === g.id) leaveGroupChat();
            renderSystem('群聊已删除');
            fetchGroups();
          }).catch(err => renderSystem(err.error || '删除失败'));
        }
      });
      li.appendChild(deleteBtn);
    } else {
      const leaveBtn = document.createElement('button');
      leaveBtn.className = 'g-leave';
      leaveBtn.textContent = '退出';
      leaveBtn.title = '退出群聊';
      leaveBtn.addEventListener('click', (e) => { e.stopPropagation(); leaveGroup(g.id); });
      li.appendChild(leaveBtn);
    }

    li.addEventListener('click', () => enterGroupChat(g));
    groupList.appendChild(li);
  });
}

function enterGroupChat(group) {
  if (currentPrivatePartner) leavePrivateChat();
  currentGroup = group;
  groupBarName.textContent = group.name;
  groupBar.classList.remove('hidden');
  privateBar.classList.add('hidden');
  typingIndicator.classList.add('hidden');
  renderCurrentView();
  updateGroupListSelection(group.id);
  // Load messages if not yet loaded
  if (!groupMessages[group.id]) {
    loadGroupMessages(group.id);
  }
}

function leaveGroupChat() {
  currentGroup = null;
  groupBar.classList.add('hidden');
  renderCurrentView();
  updateGroupListSelection(null);
}

function updateGroupListSelection(groupId) {
  groupList.querySelectorAll('li').forEach(li => {
    li.classList.toggle('active', li.dataset.groupId == groupId);
  });
}

async function loadGroupMessages(groupId) {
  try {
    const data = await api('GET', `/api/groups/${groupId}/messages`);
    groupMessages[groupId] = (data.messages || []).map(m => {
      const isImage = m.type === 'image' || m.type === 'group_image';
      const isVideo = m.type === 'video' || m.type === 'group_video';
      return {
        ...m,
        // Server returns user_id/user_name; chat renderers expect userId/name.
        userId: m.user_id ?? m.userId,
        name: m.user_name ?? m.name ?? m.username ?? '',
        // For image/video, the URL is stored in `content`.
        url: m.url ?? m.content,
        type: isImage ? 'group_image' : isVideo ? 'group_video' : 'group_message',
      };
    });
    if (currentGroup && currentGroup.id == groupId) renderCurrentView();
  } catch {}
}

// Create group
createGroupBtn.addEventListener('click', async () => {
  createGroupModal.classList.remove('hidden');
  cgName.value = '';
  createGroupForm.querySelector('.auth-error').textContent = '';
  // Populate friend list
  cgFriendList.innerHTML = '';
  friendIds.forEach(fid => {
    const displayN = getDisplayName(fid);
    const name = displayN !== '未知' ? displayN : ((window._userNames && window._userNames[fid]) || '用户' + fid);
    const item = document.createElement('div');
    item.className = 'friend-select-item';
    item.innerHTML = `<span class="friend-select-avatar">${name.charAt(0).toUpperCase()}</span><span class="friend-select-name">${name}</span><input type="checkbox" data-userid="${fid}">`;
    item.querySelector('input').addEventListener('change', function () {
      item.classList.toggle('selected', this.checked);
    });
    item.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        const cb = item.querySelector('input');
        cb.checked = !cb.checked;
        item.classList.toggle('selected', cb.checked);
      }
    });
    cgFriendList.appendChild(item);
  });
});

createGroupCancel.addEventListener('click', () => createGroupModal.classList.add('hidden'));
createGroupModal.addEventListener('click', (e) => { if (e.target === createGroupModal) createGroupModal.classList.add('hidden'); });

createGroupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = createGroupForm.querySelector('.auth-error');
  errEl.textContent = '';
  const selected = [];
  cgFriendList.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
    selected.push(parseInt(cb.dataset.userid));
  });
  if (selected.length === 0) { errEl.textContent = '请至少选择一位好友'; return; }
  try {
    await api('POST', '/api/groups', { name: cgName.value.trim(), memberIds: selected });
    createGroupModal.classList.add('hidden');
    await fetchGroups();
    renderSystem('群聊创建成功！');
  } catch (err) {
    errEl.textContent = err.error || '创建失败';
  }
});

// Invite to group
let _inviteGroupId = null;
async function openInviteModal(groupId) {
  _inviteGroupId = groupId;
  inviteGroupModal.classList.remove('hidden');
  inviteGroupError.textContent = '';
  igFriendList.innerHTML = '';
  // Fetch current members
  let memberIds = [];
  try {
    const memData = await api('GET', `/api/groups/${groupId}/members`);
    memberIds = memData.members.map(m => m.id);
  } catch {}
  friendIds.forEach(fid => {
    if (memberIds.includes(fid)) return;
    const displayN = getDisplayName(fid);
    const name = displayN !== '未知' ? displayN : ((window._userNames && window._userNames[fid]) || '用户' + fid);
    const item = document.createElement('div');
    item.className = 'friend-select-item';
    item.innerHTML = `<span class="friend-select-avatar">${name.charAt(0).toUpperCase()}</span><span class="friend-select-name">${name}</span><input type="checkbox" data-userid="${fid}">`;
    item.querySelector('input').addEventListener('change', function () {
      item.classList.toggle('selected', this.checked);
    });
    item.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        const cb = item.querySelector('input');
        cb.checked = !cb.checked;
        item.classList.toggle('selected', cb.checked);
      }
    });
    igFriendList.appendChild(item);
  });
}

inviteGroupBtn.addEventListener('click', async () => {
  if (!_inviteGroupId) return;
  inviteGroupError.textContent = '';
  const selected = [];
  igFriendList.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
    selected.push(parseInt(cb.dataset.userid));
  });
  if (selected.length === 0) { inviteGroupError.textContent = '请选择好友'; return; }
  try {
    for (const uid of selected) {
      await api('POST', `/api/groups/${_inviteGroupId}/invite`, { userId: uid });
    }
    inviteGroupModal.classList.add('hidden');
    renderSystem('已邀请好友加入群聊');
    // Refresh member count
    fetchGroups();
  } catch (err) {
    inviteGroupError.textContent = err.error || '邀请失败';
  }
});

inviteGroupCancel.addEventListener('click', () => inviteGroupModal.classList.add('hidden'));
inviteGroupModal.addEventListener('click', (e) => { if (e.target === inviteGroupModal) inviteGroupModal.classList.add('hidden'); });

// Leave group
async function leaveGroup(groupId) {
  if (!confirm('确定退出该群聊？')) return;
  try {
    await api('POST', `/api/groups/${groupId}/leave`);
    // Clear this group's local message cache (your message box only).
    delete groupMessages[groupId];
    if (currentGroup && currentGroup.id == groupId) leaveGroupChat();
    fetchGroups();
    renderSystem('已退出群聊');
  } catch (err) {
    renderSystem(err.error || '退出失败');
  }
}

// ── Moments (同事圈) ──
let momentsPageNum = 1;
let momentsHasMore = true;
let momentsLoadingFlag = false;
let momentsViewUserId = null; // null = friends feed, number = user's moments

// Open moments
async function openMoments(userId) {
  momentsViewUserId = userId || null;
  momentsPageNum = 1;
  momentsHasMore = true;
  momentsFeed.innerHTML = '';
  // Reset inline input
  miContent.value = '';
  miUploadedUrls = [];
  miImagePreview.innerHTML = '';
  miLinkUrl.value = ''; miLinkUrl.style.display = 'none';
  miLinkTitle.value = ''; miLinkTitle.style.display = 'none';
  miMusicUrl.value = ''; miMusicUrl.style.display = 'none';
  miVideoUrl.value = ''; miVideoUrl.style.display = 'none';
  miError.textContent = '';
  momentsPage.classList.remove('hidden');
  await loadMoments();
}

function closeMoments() {
  momentsPage.classList.add('hidden');
}

momentsBtn.addEventListener('click', () => openMoments(null));
momentsBack.addEventListener('click', closeMoments);

async function loadMoments() {
  if (momentsLoadingFlag || !momentsHasMore) return;
  momentsLoadingFlag = true;
  momentsLoading.classList.remove('hidden');

  try {
    const url = momentsViewUserId
      ? `/api/moments/user/${momentsViewUserId}?page=${momentsPageNum}`
      : `/api/moments/friends?page=${momentsPageNum}`;
    const data = await api('GET', url);
    const moments = data.moments || [];
    momentsHasMore = data.hasMore;
    moments.forEach(m => renderMomentCard(m));
    momentsPageNum++;
  } catch {}
  momentsLoadingFlag = false;
  momentsLoading.classList.add('hidden');
}

// Scroll to load more
momentsFeed.addEventListener('scroll', () => {
  if (momentsFeed.scrollTop + momentsFeed.clientHeight >= momentsFeed.scrollHeight - 200) {
    loadMoments();
  }
});

function renderMomentCard(m) {
  const card = document.createElement('div');
  card.className = 'moment-card';
  card.dataset.momentId = m.id;

  // Header: avatar + name + time
  const header = document.createElement('div');
  header.className = 'moment-header';
  const avatarUrl = getAvatarUrl(m.userId);
  if (avatarUrl) {
    const img = document.createElement('img');
    img.className = 'moment-avatar';
    img.src = avatarUrl;
    header.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'moment-avatar-placeholder';
    placeholder.textContent = (m.username.charAt(0) || '?').toUpperCase();
    header.appendChild(placeholder);
  }
  const info = document.createElement('div');
  info.innerHTML = `<div class="moment-user-name">${m.username}</div><div class="moment-time">${formatMomentTime(m.created_at)}</div>`;
  header.appendChild(info);
  card.appendChild(header);

  // Content text
  if (m.content) {
    const content = document.createElement('div');
    content.className = 'moment-content';
    content.textContent = m.content;
    card.appendChild(content);
  }

  // Images (grid)
  if (m.images && m.images.length > 0) {
    const grid = document.createElement('div');
    const len = m.images.length;
    let imgClass = 'multi';
    if (len === 1) imgClass = 'single';
    else if (len === 2 || len === 4) imgClass = len === 2 ? 'two' : 'four';
    grid.className = `moment-images ${imgClass}`;
    m.images.forEach(url => {
      const img = document.createElement('img');
      img.src = url;
      img.loading = 'lazy';
      img.addEventListener('click', () => openLightbox(url));
      grid.appendChild(img);
    });
    card.appendChild(grid);
  }

  // Link
  if (m.link_url) {
    const a = document.createElement('a');
    a.className = 'moment-link';
    a.href = m.link_url;
    a.target = '_blank';
    a.innerHTML = m.link_title ? `<div class="moment-link-title">${m.link_title}</div><div style="color:var(--t-text-tertiary);font-size:12px;">${m.link_url}</div>` : m.link_url;
    card.appendChild(a);
  }

  // Music
  if (m.music_url) {
    const div = document.createElement('div');
    div.className = 'moment-music';
    div.textContent = '🎵 音乐';
    div.addEventListener('click', () => window.open(m.music_url));
    card.appendChild(div);
  }

  // Video
  if (m.video_url) {
    const div = document.createElement('div');
    div.className = 'moment-video';
    div.textContent = '🎬 视频';
    div.addEventListener('click', () => window.open(m.video_url));
    card.appendChild(div);
  }

  // Actions (like + comment + delete)
  const actions = document.createElement('div');
  actions.className = 'moment-actions';
  const likeBtn = document.createElement('button');
  likeBtn.className = `moment-action-btn${m.liked ? ' liked' : ''}`;
  likeBtn.innerHTML = `${m.liked ? '❤️' : '🤍'} <span>${m.likeCount || 0}</span>`;
  likeBtn.addEventListener('click', async () => {
    try {
      const res = await api('POST', `/api/moments/${m.id}/like`);
      m.liked = res.liked;
      m.likeCount += res.liked ? 1 : -1;
      likeBtn.innerHTML = `${res.liked ? '❤️' : '🤍'} <span>${m.likeCount}</span>`;
      likeBtn.classList.toggle('liked', res.liked);
    } catch {}
  });
  actions.appendChild(likeBtn);

  const commentBtn = document.createElement('button');
  commentBtn.className = 'moment-action-btn';
  commentBtn.innerHTML = `💬 <span>${m.commentCount || 0}</span>`;
  actions.appendChild(commentBtn);

  if (m.userId === myUserId) {
    const delBtn = document.createElement('button');
    delBtn.className = 'moment-action-btn';
    delBtn.textContent = '🗑️ 删除';
    delBtn.addEventListener('click', async () => {
      if (!confirm('确定删除这条动态？')) return;
      try {
        await api('DELETE', `/api/moments/${m.id}`);
        card.remove();
      } catch {}
    });
    actions.appendChild(delBtn);
  } else if (myRole === 'admin') {
    // Admin delete button for any user's moment
    const delBtn = document.createElement('button');
    delBtn.className = 'moment-action-btn';
    delBtn.textContent = '🗑️ 管理员删除';
    delBtn.addEventListener('click', async () => {
      if (!confirm('确定以管理员身份删除此动态？')) return;
      try {
        await api('POST', '/api/admin/delete-moment', { momentId: m.id });
        card.remove();
      } catch (err) {
        renderSystem(err.error || '删除失败');
      }
    });
    actions.appendChild(delBtn);
  }
  card.appendChild(actions);

  // Comments
  const commentsDiv = document.createElement('div');
  commentsDiv.className = 'moment-comments';

  if (m.comments && m.comments.length > 0) {
    m.comments.forEach(c => {
      const comment = document.createElement('div');
      comment.className = 'moment-comment';
      comment.innerHTML = `<span class="mc-name">${c.username}</span>${c.content}`;
      if (c.user_id === myUserId) {
        const del = document.createElement('button');
        del.className = 'mc-del';
        del.textContent = '×';
        del.addEventListener('click', async () => {
          try {
            await api('DELETE', `/api/moments/${m.id}/comment/${c.id}`);
            comment.remove();
            m.commentCount--;
            commentBtn.innerHTML = `💬 <span>${m.commentCount}</span>`;
          } catch {}
        });
        comment.appendChild(del);
      } else if (myRole === 'admin') {
        const del = document.createElement('button');
        del.className = 'mc-del';
        del.textContent = '×';
        del.title = '管理员删除评论';
        del.addEventListener('click', async () => {
          try {
            await api('POST', '/api/admin/delete-comment', { commentId: c.id });
            comment.remove();
            m.commentCount--;
            commentBtn.innerHTML = `💬 <span>${m.commentCount}</span>`;
          } catch {}
        });
        comment.appendChild(del);
      }
      commentsDiv.appendChild(comment);
    });
  }

  // Comment input
  const inputRow = document.createElement('div');
  inputRow.className = 'moment-comment-input';
  const commentInput = document.createElement('input');
  commentInput.type = 'text';
  commentInput.placeholder = '写评论...';
  commentInput.maxLength = 200;
  const commentSend = document.createElement('button');
  commentSend.textContent = '发送';
  commentSend.addEventListener('click', async () => {
    const text = commentInput.value.trim();
    if (!text) return;
    try {
      const res = await api('POST', `/api/moments/${m.id}/comment`, { content: text });
      commentInput.value = '';
      const c = document.createElement('div');
      c.className = 'moment-comment';
      c.innerHTML = `<span class="mc-name">${res.comment.username}</span>${res.comment.content}`;
      if (res.comment.user_id === myUserId) {
        const del = document.createElement('button');
        del.className = 'mc-del';
        del.textContent = '×';
        del.addEventListener('click', async () => {
          try {
            await api('DELETE', `/api/moments/${m.id}/comment/${res.comment.id}`);
            c.remove();
            m.commentCount--;
            commentBtn.innerHTML = `💬 <span>${m.commentCount}</span>`;
          } catch {}
        });
        c.appendChild(del);
      } else if (myRole === 'admin') {
        const del = document.createElement('button');
        del.className = 'mc-del';
        del.textContent = '×';
        del.title = '管理员删除评论';
        del.addEventListener('click', async () => {
          try {
            await api('POST', '/api/admin/delete-comment', { commentId: res.comment.id });
            c.remove();
            m.commentCount--;
            commentBtn.innerHTML = `💬 <span>${m.commentCount}</span>`;
          } catch {}
        });
        c.appendChild(del);
      }
      commentsDiv.appendChild(c);
      m.commentCount++;
      commentBtn.innerHTML = `💬 <span>${m.commentCount}</span>`;
    } catch {}
  });
  commentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commentSend.click();
  });
  inputRow.appendChild(commentInput);
  inputRow.appendChild(commentSend);
  commentsDiv.appendChild(inputRow);

  card.appendChild(commentsDiv);
  momentsFeed.appendChild(card);
}

// ── Inline moment creation ──
let miUploadedUrls = [];

miImageBtn.addEventListener('click', () => miImageInput.click());
miImageInput.addEventListener('change', async () => {
  const files = Array.from(miImageInput.files);
  if (miUploadedUrls.length + files.length > 9) {
    miError.textContent = '最多上传9张图片';
    return;
  }
  miImageInput.value = '';
  const formData = new FormData();
  files.forEach(f => formData.append('images', f));
  try {
    const res = await fetch('/api/moments/upload-images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    data.urls.forEach(url => {
      miUploadedUrls.push(url);
      const wrapper = document.createElement('span');
      wrapper.className = 'mm-preview-wrapper';
      const img = document.createElement('img');
      img.className = 'mm-preview-img';
      img.src = url;
      wrapper.appendChild(img);
      const rm = document.createElement('button');
      rm.className = 'mm-preview-remove';
      rm.textContent = '×';
      rm.addEventListener('click', () => {
        const idx = miUploadedUrls.indexOf(url);
        if (idx > -1) miUploadedUrls.splice(idx, 1);
        wrapper.remove();
      });
      wrapper.appendChild(rm);
      miImagePreview.appendChild(wrapper);
    });
  } catch (err) {
    miError.textContent = err.message || '图片上传失败';
  }
});

miSubmit.addEventListener('click', async () => {
  miError.textContent = '';
  const content = miContent.value.trim();
  const link_url = miLinkUrl.value.trim();
  const link_title = miLinkTitle.value.trim();
  const music_url = miMusicUrl.value.trim();
  const video_url = miVideoUrl.value.trim();

  if (!content && miUploadedUrls.length === 0 && !link_url && !music_url && !video_url) {
    miError.textContent = '请填写内容或添加图片';
    return;
  }
  try {
    await api('POST', '/api/moments', {
      content,
      imageUrls: miUploadedUrls,
      link_url, link_title, music_url, video_url,
    });
    // Reset input
    miContent.value = '';
    miUploadedUrls = [];
    miImagePreview.innerHTML = '';
    miLinkUrl.value = '';
    miLinkTitle.value = '';
    miMusicUrl.value = '';
    miVideoUrl.value = '';
    miLinkUrl.style.display = 'none';
    miLinkTitle.style.display = 'none';
    miMusicUrl.style.display = 'none';
    miVideoUrl.style.display = 'none';
    // Close moments page and return to inline feed in main chat
    closeMoments();
    // Reset inline feed pagination and force refresh
    _inlineMomentsPage = 1;
    _inlineMomentsHasMore = true;
    _inlineMomentsLoading = false;
    renderMomentsFeedInline();
  } catch (err) {
    miError.textContent = err.error || '发表失败';
  }
});

// Show URL fields on demand when the user enters certain patterns
miContent.addEventListener('input', () => {
  const val = miContent.value;
  const showLink = /https?:\/\/[^\s]+/.test(val);
  const showMusic = /music|song|audio|youtube|bilibili|soundcloud/i.test(val);
  const showVideo = /video|mp4|youtube|bilibili|stream/i.test(val);
  miLinkUrl.style.display = showLink ? 'block' : 'none';
  miLinkTitle.style.display = showLink ? 'block' : 'none';
  miMusicUrl.style.display = showMusic ? 'block' : 'none';
  miVideoUrl.style.display = showVideo ? 'block' : 'none';
});

function formatTime(t) {
  if (!t) return '';
  const d = new Date(t + 'Z');
  if (isNaN(d.getTime())) return t;
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  if (diff < 172800) return '昨天 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatMomentTime(t) {
  if (!t) return '';
  const d = new Date(t + 'Z');
  if (isNaN(d.getTime())) return t;
  const now = new Date();
  const today = now.toDateString() === d.toDateString();
  const yesterday = new Date(now - 86400000).toDateString() === d.toDateString();
  const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (today) return '今天 ' + timeStr;
  if (yesterday) return '昨天 ' + timeStr;
  const dateStr = d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  return dateStr + ' ' + timeStr;
}

// ── WebSocket ──
function connectWebSocket() {
  if (ws) ws.close();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    if (!token) { ws.close(); return; }
    ws.send(JSON.stringify({ type: 'auth', token }));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    switch (data.type) {
      case 'auth_ok':
        myUserId = data.userId;
        myRole = data.role;
        if (myRole === 'admin') {
          adminPanel.classList.remove('hidden');
          myNameEl.innerHTML = myUsername + '<span class="admin-badge">管理员</span>';
          refreshPendingUsers();
        }
        fetchFriendStatuses();
        fetchGroups();
        renderCurrentView();
        break;

      case 'auth_error':
        document.querySelector('#login-form .auth-error').textContent = '认证已失效，请重新登录';
        logoutBtn.click();
        break;

      case 'users':
        renderUserList(data.users);
        break;

      case 'friends_updated':
        fetchFriendStatuses();
        break;

      // ── Private ──
      case 'private_message':
        storePrivateMessage(data);
        if (data.fromUserId !== myUserId) { playNotificationSound(); notifyNewPrivateMsg(data); }
        if (currentPrivatePartner && isPartner(currentPrivatePartner.id, data)) {
          renderPrivateMessage(data);
        } else {
          renderSystem(`${data.fromName} 发来一条私密消息`);
        }
        break;
      case 'private_image':
        storePrivateMessage(data);
        if (data.fromUserId !== myUserId) { playNotificationSound(); notifyNewPrivateMsg(data); }
        if (currentPrivatePartner && isPartner(currentPrivatePartner.id, data)) {
          renderPrivateImage(data);
        } else {
          renderSystem(`${data.fromName} 发来一张私密图片`);
        }
        break;
      case 'private_video':
        storePrivateMessage(data);
        if (data.fromUserId !== myUserId) { playNotificationSound(); notifyNewPrivateMsg(data); }
        if (currentPrivatePartner && isPartner(currentPrivatePartner.id, data)) {
          renderPrivateVideo(data);
        } else {
          renderSystem(`${data.fromName} 发来一条私密视频`);
        }
        break;
      case 'private_message_recall':
        removePrivateMessage(data.msgId);
        break;
      case 'private_typing':
        if (currentPrivatePartner && data.fromUserId == currentPrivatePartner.id) {
          typingIndicator.textContent = data.isTyping ? `${data.fromName} 正在输入...` : '';
          typingIndicator.classList.toggle('hidden', !data.isTyping);
        }
        break;

      // ── Call signaling ──
      case 'call_request':
        if (callState !== 'idle') {
          ws.send(JSON.stringify({ type: 'call_response', targetUserId: data.fromUserId, accept: false }));
          return;
        }
        callState = 'ringing';
        window._pendingCallerId = data.fromUserId;
        window._pendingCallerName = data.fromName;
        window._pendingCallMode = data.mode;
        incomingCallerName.textContent = data.fromName;
        if (data.mode === 'video') {
          incomingCallIcon.innerHTML = '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>';
          incomingCallMode.textContent = '视频通话...';
        } else {
          incomingCallIcon.innerHTML = '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.09 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8 9.74a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>';
          incomingCallMode.textContent = '语音通话...';
        }
        incomingCallEl.classList.remove('hidden');
        playNotificationSound();
        break;
      case 'call_response':
        if (callState === 'calling' && data.fromUserId === callPartnerId) {
          if (data.accept) {
            callState = 'connected';
            callStatus.classList.add('hidden');
            createPeerConnection(false);
            startLocalStream().then(() => {
              if (!pc) return;
              pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => {
                  ws.send(JSON.stringify({ type: 'call_offer', targetUserId: callPartnerId, sdp: pc.localDescription }));
                })
                .catch(() => cleanupCall());
            });
          } else {
            renderSystem(`${callPartnerName} 拒绝了通话`);
            cleanupCall();
          }
        }
        break;
      case 'call_offer':
        if (callState === 'connected' && data.fromUserId === callPartnerId) {
          handleCallOffer(data);
        }
        break;
      case 'call_answer':
        if (callState === 'connected' && data.fromUserId === callPartnerId) {
          handleCallAnswer(data);
        }
        break;
      case 'call_ice':
        if (callState === 'connected' && data.fromUserId === callPartnerId) {
          handleCallICE(data);
        }
        break;
      case 'call_end':
        if (callState === 'ringing' && data.fromUserId === window._pendingCallerId) {
          incomingCallEl.classList.add('hidden');
          callState = 'idle';
          window._pendingCallerId = null;
          window._pendingCallerName = null;
          window._pendingCallMode = null;
          renderSystem('对方取消了通话');
        } else if (callState === 'connected' && data.fromUserId === callPartnerId) {
          renderSystem('通话已结束');
          cleanupCall();
        } else if (callState === 'calling' && data.fromUserId === callPartnerId) {
          renderSystem('对方已挂断');
          cleanupCall();
        }
        break;
      case 'call_toggle_video':
        if (data.videoEnabled) {
          callAudioPlaceholder.classList.add('hidden');
        } else {
          callAudioPlaceholder.classList.remove('hidden');
        }
        break;

      // ── Friend events ──
      case 'friend_request':
        renderSystem(`${data.fromName} 发来了好友请求`);
        // Auto-refresh to show accept button
        setTimeout(fetchFriendStatuses, 500);
        break;
      case 'friend_accepted':
        renderSystem(`${data.name} 已接受你的好友请求`);
        friendIds.push(data.userId);
        outgoingIds = outgoingIds.filter(id => id !== data.userId);
        renderUserListFromState();
        break;

      case 'friend_removed':
        renderSystem(`${data.name} 已删除好友关系`);
        friendIds = friendIds.filter(id => id !== data.userId);
        // Only refresh the friend list / leave the chat view. Do NOT clear the
        // other user's local message history (对方用户的消息框内容不变).
        if (currentPrivatePartner && currentPrivatePartner.id === data.userId) {
          messagesEl.innerHTML = '';
          leavePrivateChat();
        }
        renderUserListFromState();
        break;

      // ── Account approved ──
      case 'account_approved':
        renderSystem(data.message);
        break;

      // ── Profile events ──
      case 'profile_updated':
        if (window._userProfiles) {
          const p = window._userProfiles[data.userId] || {};
          if (data.avatar !== undefined) p.avatar = data.avatar;
          if (data.nickname !== undefined) p.nickname = data.nickname;
          if (data.full_name !== undefined) p.full_name = data.full_name;
          window._userProfiles[data.userId] = p;
        }
        if (window._userNames && data.userId && data.nickname) {
          window._userNames[data.userId] = data.nickname;
        }
        renderUserListFromState();
        break;

      // ── Group chat events ──
      case 'group_message':
      case 'group_image':
      case 'group_video':
        {
          const gid = data.groupId;
          if (!groupMessages[gid]) groupMessages[gid] = [];
          groupMessages[gid].push(data);
          if (currentGroup && currentGroup.id == gid) renderCurrentView();
          // Also render a system notification if not in this group view
          if (!currentGroup || currentGroup.id != gid) {
            const groupName = groupsInfo && groupsInfo[gid] ? groupsInfo[gid].name : '群聊';
            renderSystem(`[${groupName}] ${data.name || '用户'} 发了一条消息`);
            playNotificationSound();
          }
        }
        break;
      case 'group_created':
        // Added to a new group
        renderSystem(`您被 ${data.creatorName} 加入了群聊`);
        fetchGroups();
        break;
      case 'group_invited':
        renderSystem(`${data.fromName} 邀请您加入了群聊「${data.groupName}」`);
        fetchGroups();
        break;
      case 'group_member_joined':
        if (currentGroup && currentGroup.id == data.groupId) {
          renderSystem(`${data.name} 加入了群聊`);
        }
        fetchGroups();
        break;
      case 'group_member_left':
        if (currentGroup && currentGroup.id == data.groupId) {
          renderSystem(`${data.name} 退出了群聊`);
        }
        fetchGroups();
        break;
      case 'group_renamed':
        if (currentGroup && currentGroup.id == data.groupId) {
          currentGroup.name = data.name;
          groupBarName.textContent = data.name;
          renderSystem(`群聊已更名为「${data.name}」`);
        }
        fetchGroups();
        break;
      case 'group_deleted':
        if (currentGroup && currentGroup.id == data.groupId) {
          leaveGroupChat();
          renderSystem(`群聊「${data.name}」已被删除`);
        }
        fetchGroups();
        break;
      case 'group_message_deleted':
        // Remove message from DOM and cache
        if (currentGroup && currentGroup.id == data.groupId) {
          const msgEl = messagesEl.querySelector(`[data-msgid="${data.messageId}"]`);
          if (msgEl) msgEl.remove();
        }
        // Also remove from cache
        const gid = data.groupId;
        if (groupMessages[gid]) {
          groupMessages[gid] = groupMessages[gid].filter(m => m.id !== data.messageId);
        }
        break;

      // ── Conference (会议) events ──
      case 'conference_created':
        currentConfRoom = { code: data.roomCode, hostId: myUserId, participants: [{ userId: myUserId, username: myUsername }] };
        confRoomModal.classList.add('hidden');
        showConfOverlay();
        startConfLocalStream();
        // Do NOT show the invite modal here — it covers the meeting controls.
        // The host can invite more people with the ➕ (conf-invite-btn) button.
        // Auto-invite the friend whose 会议 button started this meeting.
        if (_confAutoInviteUserId && ws) {
          const fid = _confAutoInviteUserId;
          _confAutoInviteUserId = null;
          ws.send(JSON.stringify({ type: 'conference_invite', roomCode: currentConfRoom.code, targetUserId: fid }));
        }
        break;
      case 'conference_participants':
        if (!currentConfRoom) {
          currentConfRoom = { code: '', hostId: data.hostId, participants: [] };
          showConfOverlay();
          startConfLocalStream();
        }
        currentConfRoom.participants = data.participants || [];
        currentConfRoom.hostId = data.hostId;
        if (currentConfRoom.participants.length > 0) {
          const me = currentConfRoom.participants.find(p => p.userId === myUserId);
          if (!me) currentConfRoom.participants.push({ userId: myUserId, username: myUsername });
        }
        renderConfParticipantList();
        // Create peer connections to all existing participants (mesh topology)
        (data.participants || []).forEach(p => {
          if (p.userId !== myUserId && !confPeerConnections.has(p.userId)) {
            createConfPeerConnection(p.userId, false);
          }
        });
        break;
      case 'conference_participant_joined':
        if (currentConfRoom) {
          if (!currentConfRoom.participants) currentConfRoom.participants = [];
          if (!currentConfRoom.participants.find(p => p.userId === data.userId)) {
            currentConfRoom.participants.push({ userId: data.userId, username: data.username });
            renderConfParticipantList();
          }
        }
        break;
      case 'conference_new_peer':
        if (currentConfRoom && data.userId !== myUserId) {
          createConfPeerConnection(data.userId, true);
        }
        break;
      case 'conference_offer':
        handleConfOffer(data);
        break;
      case 'conference_answer':
        handleConfAnswer(data);
        break;
      case 'conference_ice':
        handleConfICE(data);
        break;
      case 'conference_participant_left':
        if (currentConfRoom && currentConfRoom.participants) {
          currentConfRoom.participants = currentConfRoom.participants.filter(p => p.userId !== data.userId);
          renderConfParticipantList();
        }
        removeConfVideoTile(data.userId);
        {
          const _pc = confPeerConnections.get(data.userId);
          if (_pc) { _pc.close(); confPeerConnections.delete(data.userId); }
        }
        break;
      case 'conference_chat':
        if (data.fromUserId !== myUserId) {
          addConfChat(data.fromName, data.text, false);
        }
        break;
      case 'conference_host_changed':
        if (currentConfRoom) {
          currentConfRoom.hostId = data.hostId;
          renderConfParticipantList();
          if (data.hostId === myUserId) {
            renderSystem('你已成为主持人');
          } else if (data.fromUserId === myUserId) {
            renderSystem('已转让主持人');
          } else {
            renderSystem('主持人已变更');
          }
        }
        break;
      case 'conference_screen_share':
        if (data.fromUserId !== myUserId) {
          // Show/hide remote shared screen in the CENTER (main area)
          if (data.enabled) {
            _confRemoteSharing = data.fromUserId;
            // Resolve the remote stream: prefer the stored peer stream, else the
            // remote tile's video (which already carries the shared screen).
            let remoteStream = confRemoteStreams.get(data.fromUserId);
            if (!remoteStream) {
              const remoteTile = confVideoGrid.querySelector(`[data-userid="${data.fromUserId}"]`);
              const tileVideo = remoteTile && remoteTile.querySelector('.conf-video');
              if (tileVideo && tileVideo.srcObject) remoteStream = tileVideo.srcObject;
            }
            if (remoteStream) {
              confMainVideo.srcObject = remoteStream;
              confMainArea.classList.add('sharing');
              confMainPlaceholder.classList.add('hidden');
              try { confMainVideo.play(); } catch (e) { /* ignore */ }
            }
          } else {
            if (_confRemoteSharing === data.fromUserId) _confRemoteSharing = null;
            if (!confScreenEnabled) {
              // Only clear main area if local user isn't sharing
              confMainVideo.srcObject = null;
              confMainVideo.pause();
              confMainArea.classList.remove('sharing');
              confMainPlaceholder.classList.remove('hidden');
            }
          }
          // Sync maximize state for remote user's tile
          const remoteTile = confVideoGrid.querySelector(`[data-userid="${data.fromUserId}"]`);
          if (remoteTile) {
            if (data.enabled) {
              remoteTile.classList.add('screenshare');
              const mb = remoteTile.querySelector('.conf-maximize-btn');
              if (mb) mb.textContent = '✕';
            } else {
              remoteTile.classList.remove('screenshare');
              const mb = remoteTile.querySelector('.conf-maximize-btn');
              if (mb) mb.textContent = '⛶';
            }
          }
        }
        break;
      case 'conference_invite':
        _pendingConfInvite = { roomCode: data.roomCode, fromName: data.fromName };
        confInviteTitle.textContent = `${data.fromName} 邀请您加入会议`;
        confInvite.classList.remove('hidden');
        playNotificationSound();
        break;
      case 'conference_error':
        renderSystem(data.message || '会议操作失败');
        break;
      case 'conference_ended':
        renderSystem('主持人已结束会议');
        leaveConference();
        break;
    }
  };

  ws.onclose = () => {
    if (!token) return;
    renderSystem('与服务器断开连接，3秒后重连...');
    setTimeout(connectWebSocket, 3000);
  };
}

function isPartner(partnerId, data) {
  return data.fromUserId == partnerId || data.fromUserId == myUserId;
}

// ── Friend statuses ──
async function fetchFriendStatuses() {
  try {
    const data = await api('GET', '/api/friends/statuses');
    friendIds = data.friendIds || [];
    outgoingIds = data.outgoingIds || [];
    incomingReqs = data.incoming || [];
    // Merge friend names so offline friends still display their real username
    // instead of a generic "用户X" fallback in dialogs (e.g. group creation).
    if (data.friendNames) {
      window._userNames = window._userNames || {};
      for (const id of Object.keys(data.friendNames)) {
        window._userNames[Number(id)] = data.friendNames[id];
      }
    }
    renderUserListFromState();
  } catch {}
}

async function sendFriendRequest(userId) {
  try {
    const data = await api('POST', '/api/friends/request', { targetUserId: userId });
    if (data.status === 'friends') {
      friendIds.push(userId);
    } else if (data.status === 'sent' || data.status === 'pending') {
      outgoingIds.push(userId);
    }
    renderUserListFromState();
  } catch (err) {
    renderSystem(err.error || '操作失败');
  }
}

async function acceptFriendRequest(requestId, userId) {
  try {
    await api('POST', '/api/friends/respond', { requestId, accept: true });
    friendIds.push(userId);
    incomingReqs = incomingReqs.filter(r => r.requestId !== requestId);
    outgoingIds = outgoingIds.filter(id => id !== userId);
    renderUserListFromState();
  } catch (err) {
    renderSystem(err.error || '操作失败');
  }
}

// ── Render current view ──
function renderCurrentView() {
  messagesEl.innerHTML = '';
  if (currentGroup) {
    inputArea.classList.remove('hidden');
    const msgs = groupMessages[currentGroup.id] || [];
    msgs.forEach((m) => {
      if (m.type === 'group_message') renderGroupMessage(m);
      else if (m.type === 'group_image') renderGroupImage(m);
      else if (m.type === 'group_video') renderGroupVideo(m);
    });
  } else if (currentPrivatePartner) {
    inputArea.classList.remove('hidden');
    const key = getPrivateKey(currentPrivatePartner.id);
    const msgs = privateMessages[key] || [];
    msgs.forEach((m) => {
      if (m.type === 'private_message' || m.type === 'message') renderPrivateMessage(m);
      else if (m.type === 'private_image' || m.type === 'image') renderPrivateImage(m);
      else if (m.type === 'private_video' || m.type === 'video') renderPrivateVideo(m);
    });
  } else {
    inputArea.classList.add('hidden');
    renderMomentsFeedInline();
  }
  scrollDown();
}

// ── Send text ──
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !ws) return;

  if (currentGroup) {
    ws.send(JSON.stringify({ type: 'group_message', text, groupId: currentGroup.id }));
  } else if (currentPrivatePartner) {
    if (!friendIds.includes(currentPrivatePartner.id)) {
      renderSystem('对方已不是好友，无法发送私密消息');
      leavePrivateChat();
      return;
    }
    const mid = newMsgId();
    ws.send(JSON.stringify({ type: 'private_message', text, targetUserId: currentPrivatePartner.id, msgId: mid }));
    const msg = { type: 'private_message', text, fromUserId: myUserId, fromName: myUsername, isPrivate: true, msgId: mid, created_at: new Date().toISOString() };
    storePrivateMessage(msg);
    renderPrivateMessage(msg);
  }

  msgInput.value = '';
  sendTyping(false);
}

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ── Paste an image directly into the chat ──
msgInput.addEventListener('paste', (e) => {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        uploadAndSend(file);
        return;
      }
    }
  }
});

// ── Typing ──
msgInput.addEventListener('input', () => {
  if (!ws) return;
  sendTyping(true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => sendTyping(false), TYPING_TIMEOUT);
});

function sendTyping(val) {
  if (currentPrivatePartner) {
    ws.send(JSON.stringify({ type: 'private_typing', isTyping: val, targetUserId: currentPrivatePartner.id }));
  }
}

// ── Image Upload ──
uploadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  fileInput.value = '';
  await uploadAndSend(file);
});

async function uploadAndSend(file) {
  const formData = new FormData();
  formData.append('image', file);
  const isVideo = file.type.startsWith('video/');
  showProgress(isVideo ? '正在上传视频...' : '正在上传图片...');
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    hideProgress();

    if (currentGroup) {
      const type = isVideo ? 'group_video' : 'group_image';
      ws.send(JSON.stringify({ type, url: data.url, groupId: currentGroup.id }));
    } else if (currentPrivatePartner) {
      if (!friendIds.includes(currentPrivatePartner.id)) {
        renderSystem('对方已不是好友，无法发送私密内容');
        return;
      }
      const type = isVideo ? 'private_video' : 'private_image';
      const msgType = isVideo ? 'private_video' : 'private_image';
      const renderFn = isVideo ? renderPrivateVideo : renderPrivateImage;
      const mid = newMsgId();
      ws.send(JSON.stringify({ type, url: data.url, targetUserId: currentPrivatePartner.id, msgId: mid }));
      const msg = { type: msgType, url: data.url, fromUserId: myUserId, fromName: myUsername, isPrivate: true, msgId: mid, created_at: new Date().toISOString() };
      storePrivateMessage(msg);
      renderFn(msg);
    } else {
      renderSystem('请先选择群聊或好友，再发送图片');
    }
  } catch (err) {
    hideProgress();
    renderSystem(`上传失败: ${err.message}`);
  }
}

// ── Screenshot ──
screenshotBtn.addEventListener('click', async () => {
  if (!navigator.mediaDevices) {
    renderSystem('截图功能需要HTTPS连接，请通过 https:// 访问');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    stream.getTracks().forEach(t => t.stop());
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `screenshot_${Date.now()}.png`, { type: 'image/png' });
      await uploadAndSend(file);
    }, 'image/png');
  } catch (err) {
    if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') throw err;
  }
});

// ── Progress toast ──
let progressEl = null;
function showProgress(text) {
  hideProgress();
  progressEl = document.createElement('div');
  progressEl.className = 'upload-progress';
  progressEl.innerHTML = `<div class="spinner"></div><span>${text}</span>`;
  document.body.appendChild(progressEl);
}
function hideProgress() {
  if (progressEl) { progressEl.remove(); progressEl = null; }
}

// ── Notification Sound ──
function playNotificationSound() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // First chime
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.frequency.value = 660;
    osc1.type = 'sine';
    gain1.gain.setValueAtTime(0.25, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.15);

    // Second chime (slightly higher)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.frequency.value = 880;
    osc2.type = 'sine';
    gain2.gain.setValueAtTime(0.25, ctx.currentTime + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc2.start(ctx.currentTime + 0.12);
    osc2.stop(ctx.currentTime + 0.3);
  } catch (e) { /* audio not supported */ }
}

// ── Render: Private messages ──
function renderPrivateMessage(data) {
  const isSelf = data.fromUserId === myUserId;
  const div = msgShell(isSelf, ' message-private');
  if (data.msgId) div.dataset.msgid = data.msgId;
  if (!isSelf) prependNameWithAvatar(div, data.fromName, data.fromUserId);
  div.appendChild(textEl(data.text));
  if (isSelf && canRecallPrivate(data)) div.appendChild(privateRecallBtn(data));
  div.appendChild(timeEl());
  messagesEl.appendChild(div);
  scrollDown();
}

function renderPrivateImage(data) {
  const isSelf = data.fromUserId === myUserId;
  const div = msgShell(isSelf, ' message-private');
  if (data.msgId) div.dataset.msgid = data.msgId;
  if (!isSelf) prependNameWithAvatar(div, data.fromName, data.fromUserId);
  div.appendChild(imgEl(data.url, '私密图片'));
  if (isSelf && canRecallPrivate(data)) div.appendChild(privateRecallBtn(data));
  div.appendChild(timeEl());
  messagesEl.appendChild(div);
  scrollDown();
}

// ── Render: Video ──
function videoEl(src) {
  const v = document.createElement('video');
  v.src = src;
  v.controls = true;
  v.preload = 'metadata';
  v.style.maxWidth = '360px';
  v.style.maxHeight = '300px';
  v.style.borderRadius = '8px';
  v.style.display = 'block';
  v.style.cursor = 'pointer';
  return v;
}

function renderPrivateVideo(data) {
  const isSelf = data.fromUserId === myUserId;
  const div = msgShell(isSelf, ' message-private');
  if (data.msgId) div.dataset.msgid = data.msgId;
  if (!isSelf) prependNameWithAvatar(div, data.fromName, data.fromUserId);
  const v = videoEl(data.url);
  v.style.border = '2px solid #ffcc80';
  div.appendChild(v);
  if (isSelf && canRecallPrivate(data)) div.appendChild(privateRecallBtn(data));
  div.appendChild(timeEl());
  messagesEl.appendChild(div);
  scrollDown();
}

// ── Render: Group messages ──
function renderGroupMessage(data) {
  const isSelf = data.userId === myUserId;
  const div = msgShell(isSelf, '');
  div.dataset.msgid = data.id;
  if (!isSelf) {
    const displayName = getDisplayName(data.userId);
    prependNameWithAvatar(div, displayName !== '未知' ? displayName : (data.name || displayName), data.userId);
  }
  div.appendChild(textEl(data.text || data.content));
  if (data.userId === myUserId && canRecall(data)) {
    div.appendChild(groupMsgDelBtn(data.id, '撤回'));
  } else if (myRole === 'admin' && data.userId !== myUserId) {
    div.appendChild(groupMsgDelBtn(data.id, '删除'));
  }
  div.appendChild(timeEl());
  messagesEl.appendChild(div);
  scrollDown();
}

function renderGroupImage(data) {
  const isSelf = data.userId === myUserId;
  const div = msgShell(isSelf, '');
  div.dataset.msgid = data.id;
  if (!isSelf) {
    const displayName = getDisplayName(data.userId);
    prependNameWithAvatar(div, displayName !== '未知' ? displayName : (data.name || displayName), data.userId);
  }
  div.appendChild(imgEl(data.url, '群图片'));
  if (data.userId === myUserId && canRecall(data)) {
    div.appendChild(groupMsgDelBtn(data.id, '撤回'));
  } else if (myRole === 'admin' && data.userId !== myUserId) {
    div.appendChild(groupMsgDelBtn(data.id, '删除'));
  }
  div.appendChild(timeEl());
  messagesEl.appendChild(div);
  scrollDown();
}

function renderGroupVideo(data) {
  const isSelf = data.userId === myUserId;
  const div = msgShell(isSelf, '');
  div.dataset.msgid = data.id;
  if (!isSelf) {
    const displayName = getDisplayName(data.userId);
    prependNameWithAvatar(div, displayName !== '未知' ? displayName : (data.name || displayName), data.userId);
  }
  div.appendChild(videoEl(data.url));
  if (data.userId === myUserId && canRecall(data)) {
    div.appendChild(groupMsgDelBtn(data.id, '撤回'));
  } else if (myRole === 'admin' && data.userId !== myUserId) {
    div.appendChild(groupMsgDelBtn(data.id, '删除'));
  }
  div.appendChild(timeEl());
  messagesEl.appendChild(div);
  scrollDown();
}

function renderSystem(text) {
  const div = document.createElement('div');
  div.className = 'system-msg';
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollDown();
}

// ── Moments feed inline (default view) ──
let _inlineMomentsPage = 1;
let _inlineMomentsHasMore = true;
let _inlineMomentsLoading = false;

async function renderMomentsFeedInline() {
  messagesEl.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'moments-feed-header';
  header.innerHTML = '<h2 style="font-size:16px;color:var(--t-text);">好友动态</h2>';
  messagesEl.appendChild(header);

  // Loading indicator
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'moments-feed-loading';
  loadingDiv.textContent = '加载中...';
  messagesEl.appendChild(loadingDiv);

  _inlineMomentsPage = 1;
  _inlineMomentsHasMore = true;
  _inlineMomentsLoading = false;

  await loadMoreInlineMoments();

  // Scroll to load more
  messagesEl.removeEventListener('scroll', handleInlineMomentsScroll);
  messagesEl.addEventListener('scroll', handleInlineMomentsScroll);
}

function handleInlineMomentsScroll() {
  if (messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - 200) {
    loadMoreInlineMoments();
  }
}

async function loadMoreInlineMoments() {
  if (_inlineMomentsLoading || !_inlineMomentsHasMore) return;
  _inlineMomentsLoading = true;
  try {
    const data = await api('GET', `/api/moments/friends?page=${_inlineMomentsPage}`);
    const moments = data.moments || [];
    _inlineMomentsHasMore = data.hasMore;

    // Remove loading indicator
    const loading = messagesEl.querySelector('.moments-feed-loading');
    if (loading) loading.remove();

    moments.forEach(m => renderInlineMomentCard(m));
    _inlineMomentsPage++;

    if (moments.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'system-msg';
      empty.textContent = '暂无好友动态 — 去添加好友或发表动态吧';
      messagesEl.appendChild(empty);
    }
  } catch {
    const loading = messagesEl.querySelector('.moments-feed-loading');
    if (loading) loading.remove();
    const err = document.createElement('div');
    err.className = 'system-msg';
    err.textContent = '加载动态失败';
    messagesEl.appendChild(err);
  }
  _inlineMomentsLoading = false;
}

function renderInlineMomentCard(m) {
  const card = document.createElement('div');
  card.className = 'inline-moment-card';

  // Header
  const header = document.createElement('div');
  header.className = 'inline-moment-header';
  header.textContent = `${m.username}  ·  ${formatMomentTime(m.created_at)}`;
  card.appendChild(header);

  // Content
  if (m.content) {
    const content = document.createElement('div');
    content.className = 'inline-moment-body';
    content.textContent = m.content;
    card.appendChild(content);
  }

  // Images (grid)
  if (m.images && m.images.length > 0) {
    const grid = document.createElement('div');
    const len = m.images.length;
    let imgClass = 'multi';
    if (len === 1) imgClass = 'single';
    else if (len === 2 || len === 4) imgClass = len === 2 ? 'two' : 'four';
    grid.className = `inline-moment-images ${imgClass}`;
    m.images.forEach(url => {
      const img = document.createElement('img');
      img.src = url;
      img.loading = 'lazy';
      img.addEventListener('click', () => openLightbox(url));
      grid.appendChild(img);
    });
    card.appendChild(grid);
  }

  // Actions
  const actions = document.createElement('div');
  actions.className = 'inline-moment-actions';

  const likeBtn = document.createElement('button');
  likeBtn.className = `inline-moment-btn${m.liked ? ' liked' : ''}`;
  likeBtn.innerHTML = `${m.liked ? '❤️' : '🤍'} ${m.likeCount || 0}`;
  likeBtn.addEventListener('click', async () => {
    try {
      const res = await api('POST', `/api/moments/${m.id}/like`);
      m.liked = res.liked;
      m.likeCount += res.liked ? 1 : -1;
      likeBtn.innerHTML = `${res.liked ? '❤️' : '🤍'} ${m.likeCount}`;
      likeBtn.classList.toggle('liked', res.liked);
    } catch {}
  });
  actions.appendChild(likeBtn);

  const commentBtn = document.createElement('button');
  commentBtn.className = 'inline-moment-btn';
  commentBtn.innerHTML = `💬 ${m.commentCount || 0}`;
  actions.appendChild(commentBtn);

  // Admin delete button for moment
  if (myRole === 'admin' && m.userId !== myUserId) {
    const delBtn = document.createElement('button');
    delBtn.className = 'inline-moment-btn';
    delBtn.textContent = '🗑️';
    delBtn.title = '管理员删除';
    delBtn.addEventListener('click', async () => {
      if (!confirm('确定以管理员身份删除此动态？')) return;
      try {
        await api('POST', '/api/admin/delete-moment', { momentId: m.id });
        card.remove();
      } catch (err) {
        renderSystem(err.error || '删除失败');
      }
    });
    actions.appendChild(delBtn);
  }

  // Self-delete button for own moment
  if (m.userId === myUserId) {
    const delBtn = document.createElement('button');
    delBtn.className = 'inline-moment-btn';
    delBtn.textContent = '🗑️';
    delBtn.title = '删除';
    delBtn.addEventListener('click', async () => {
      if (!confirm('确定删除这条动态？')) return;
      try {
        await api('DELETE', `/api/moments/${m.id}`);
        card.remove();
      } catch {}
    });
    actions.appendChild(delBtn);
  }

  card.appendChild(actions);

  // Comments container
  const commentsDiv = document.createElement('div');
  commentsDiv.className = 'inline-moment-comments';
  if (m.comments && m.comments.length > 0) {
    m.comments.forEach(c => {
      const comment = document.createElement('div');
      comment.className = 'inline-moment-comment';
      comment.innerHTML = `<span class="imc-name">${c.username}</span>${c.content}`;
      if (myRole === 'admin' && c.user_id !== myUserId) {
        const del = document.createElement('button');
        del.className = 'imc-del';
        del.textContent = '×';
        del.title = '管理员删除评论';
        del.addEventListener('click', async () => {
          try {
            await api('POST', '/api/admin/delete-comment', { commentId: c.id });
            comment.remove();
            m.commentCount--;
            commentBtn.innerHTML = `💬 ${m.commentCount}`;
          } catch {}
        });
        comment.appendChild(del);
      }
      commentsDiv.appendChild(comment);
    });
  }
  card.appendChild(commentsDiv);

  // Comment input (hidden by default)
  const commentInputRow = document.createElement('div');
  commentInputRow.className = 'inline-moment-comment-input';
  commentInputRow.style.display = 'none';
  const commentInput = document.createElement('input');
  commentInput.type = 'text';
  commentInput.placeholder = '写评论...';
  commentInput.maxLength = 200;
  const commentSend = document.createElement('button');
  commentSend.textContent = '发送';
  commentSend.addEventListener('click', async () => {
    const text = commentInput.value.trim();
    if (!text) return;
    try {
      const res = await api('POST', `/api/moments/${m.id}/comment`, { content: text });
      commentInput.value = '';
      const c = document.createElement('div');
      c.className = 'inline-moment-comment';
      c.innerHTML = `<span class="imc-name">${res.comment.username}</span>${res.comment.content}`;
      if (myRole === 'admin' && res.comment.user_id !== myUserId) {
        const del = document.createElement('button');
        del.className = 'imc-del';
        del.textContent = '×';
        del.title = '管理员删除评论';
        del.addEventListener('click', async () => {
          try {
            await api('POST', '/api/admin/delete-comment', { commentId: res.comment.id });
            c.remove();
            m.commentCount--;
            commentBtn.innerHTML = `💬 ${m.commentCount}`;
          } catch {}
        });
        c.appendChild(del);
      }
      commentsDiv.appendChild(c);
      m.commentCount++;
      commentBtn.innerHTML = `💬 ${m.commentCount}`;
    } catch {}
  });
  commentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commentSend.click();
  });
  commentInputRow.appendChild(commentInput);
  commentInputRow.appendChild(commentSend);
  card.appendChild(commentInputRow);

  commentBtn.addEventListener('click', () => {
    const isHidden = commentInputRow.style.display === 'none';
    commentInputRow.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) commentInput.focus();
  });

  messagesEl.appendChild(card);
  scrollDown();
}

// ── Render helpers ──
function msgShell(isSelf, extra) {
  const div = document.createElement('div');
  div.className = `message ${isSelf ? 'message-self' : 'message-other'}${extra}`;
  return div;
}
function prependName(div, name) {
  const n = document.createElement('div');
  n.className = 'msg-name';
  n.textContent = name;
  div.appendChild(n);
}
function prependNameWithAvatar(div, name, userId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'msg-name-wrapper';
  const url = getAvatarUrl(userId);
  if (url) {
    const img = document.createElement('img');
    img.className = 'msg-avatar';
    img.src = url;
    img.alt = '';
    wrapper.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.className = 'msg-avatar-placeholder';
    span.textContent = (name.charAt(0) || '?').toUpperCase();
    wrapper.appendChild(span);
  }
  const n = document.createElement('div');
  n.className = 'msg-name';
  n.textContent = name;
  wrapper.appendChild(n);
  div.appendChild(wrapper);
}
function textEl(t) {
  const e = document.createElement('div');
  e.textContent = t;
  return e;
}
function imgEl(src, alt) {
  const img = document.createElement('img');
  img.className = 'msg-media';
  img.src = src;
  img.alt = alt;
  img.loading = 'lazy';
  img.addEventListener('click', () => openLightbox(src));
  return img;
}
function timeEl() {
  const e = document.createElement('div');
  e.className = 'msg-time';
  e.textContent = now();
  return e;
}

// Admin delete button for group messages
function groupMsgDelBtn(msgId, label) {
  const btn = document.createElement('button');
  btn.className = 'admin-msg-del';
  btn.textContent = label;
  btn.title = label === '撤回' ? '撤回此消息' : '删除此消息';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(label === '撤回' ? '确定撤回此消息？' : '确定删除此消息？')) return;
    try {
      await api('POST', '/api/groups/delete-message', { messageId: msgId });
      const el = messagesEl.querySelector(`[data-msgid="${msgId}"]`);
      if (el) el.remove();
    } catch (err) {
      renderSystem(err.error || '操作失败');
    }
  });
  return btn;
}
/** A group message can be recalled by its sender within 2 minutes. */
function canRecall(msg) {
  if (!msg || !msg.created_at) return true;
  try {
    const created = new Date(String(msg.created_at).replace(' ', 'T') + 'Z').getTime();
    return (Date.now() - created) < 2 * 60 * 1000;
  } catch { return true; }
}

// ── Private message recall (within 10 minutes) ──
function newMsgId() { return 'pm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
function canRecallPrivate(msg) {
  if (!msg || !msg.created_at) return true;
  try {
    const created = new Date(String(msg.created_at).replace(' ', 'T') + 'Z').getTime();
    return (Date.now() - created) < 10 * 60 * 1000;
  } catch { return true; }
}
function removePrivateMessage(msgId) {
  if (!msgId) return;
  const el = messagesEl.querySelector(`[data-msgid="${msgId}"]`);
  if (el) el.remove();
  Object.values(privateMessages).forEach(arr => {
    const idx = arr.findIndex(m => m.msgId === msgId);
    if (idx > -1) arr.splice(idx, 1);
  });
}
function privateRecallBtn(data) {
  const btn = document.createElement('button');
  btn.className = 'admin-msg-del';
  btn.textContent = '撤回';
  btn.title = '撤回此消息';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('确定撤回此消息？')) return;
    const targetUserId = data.targetUserId || (currentPrivatePartner && currentPrivatePartner.id);
    if (ws && targetUserId) {
      ws.send(JSON.stringify({ type: 'private_message_recall', msgId: data.msgId, targetUserId }));
    }
    removePrivateMessage(data.msgId);
    renderSystem('已撤回');
  });
  return btn;
}

// ── User List ──
function renderUserList(users) {
  // Merge display names and profiles keyed by id (don't reset, so offline
  // friend names merged from /api/friends/statuses are not lost).
  window._userNames = window._userNames || {};
  window._userProfiles = window._userProfiles || {};
  users.forEach(u => {
    window._userNames[u.id] = u.name;
    window._userProfiles[u.id] = { avatar: u.avatar || '', full_name: u.full_name || '', nickname: u.nickname || '' };
  });
  renderUserListFromState();
}

function getAvatarUrl(userId) {
  const p = window._userProfiles && window._userProfiles[userId];
  return p ? p.avatar : '';
}
function getDisplayName(userId) {
  const p = window._userProfiles && window._userProfiles[userId];
  const names = window._userNames || {};
  const baseName = names[userId] || '未知';
  if (p && p.full_name) return p.full_name;
  if (p && p.nickname) return p.nickname;
  return baseName;
}

function renderUserListFromState() {
  const names = window._userNames || {};
  userListEl.innerHTML = '';
  const allIds = new Set([...Object.keys(names).map(Number), ...friendIds, ...outgoingIds, ...incomingReqs.map(r => r.userId)]);
  const q = (userSearch && userSearch.value || '').trim().toLowerCase();

  let count = 0;
  allIds.forEach((id) => {
    if (id === myUserId) return;
    const name = names[id] || '未知';
    // Skip entries with unknown name that aren't in pending request context
    if (name === '未知' && !outgoingIds.includes(id) && !incomingReqs.some(r => r.userId === id)) return;
    // Search filter: only show users whose name matches the search term.
    if (q && String(name).toLowerCase().indexOf(q) === -1) return;
    count++;

    const li = document.createElement('li');
    const avatarUrl = getAvatarUrl(id);
    const displayName = getDisplayName(id);

    li.dataset.userId = id;
    li.dataset.userName = name;
    if (currentPrivatePartner && id === currentPrivatePartner.id) li.classList.add('active');

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'user-avatar-wrap';
    if (avatarUrl) {
      const img = document.createElement('img');
      img.className = 'user-avatar';
      img.src = avatarUrl;
      img.alt = '';
      avatarWrap.appendChild(img);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'user-avatar-placeholder';
      placeholder.textContent = (displayName.charAt(0) || '?').toUpperCase();
      avatarWrap.appendChild(placeholder);
    }
    const unread = unreadCounts[id] || 0;
    if (unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'unread-badge';
      badge.textContent = unread > 99 ? '99+' : unread;
      avatarWrap.appendChild(badge);
    }
    li.appendChild(avatarWrap);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'uname';
    nameSpan.textContent = displayName;
    li.appendChild(nameSpan);

    // Determine action button
    if (friendIds.includes(id)) {
      // Friend → show chat button, extra actions collapsed
      const chatBtn = document.createElement('button');
      chatBtn.className = 'action-btn';
      chatBtn.innerHTML = '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5Z"/></svg>';
      chatBtn.title = '聊天';
      chatBtn.addEventListener('click', (e) => { e.stopPropagation(); enterPrivateChat(id, name); });
      li.appendChild(chatBtn);

      // Extra actions row (hidden by default, toggled by expand button)
      const expandBtn = document.createElement('button');
      expandBtn.className = 'action-btn expand';
      expandBtn.textContent = '···';
      expandBtn.title = '更多';
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        extrasRow.classList.toggle('show');
      });

      const extrasRow = document.createElement('div');
      extrasRow.className = 'user-extras';

      const callBtn = document.createElement('button');
      callBtn.className = 'action-btn call';
      callBtn.innerHTML = '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.09 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8 9.74a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>';
      callBtn.title = '语音通话';
      callBtn.addEventListener('click', (e) => { e.stopPropagation(); startCall(id, name, 'audio'); });
      extrasRow.appendChild(callBtn);

      const videoBtn = document.createElement('button');
      videoBtn.className = 'action-btn call';
      videoBtn.innerHTML = '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>';
      videoBtn.title = '会议';
      videoBtn.addEventListener('click', (e) => { e.stopPropagation(); startMeetingWith(id, name); });
      extrasRow.appendChild(videoBtn);

      // Append the extra actions first, then the "···" toggle last (far right).
      li.appendChild(extrasRow);
      li.appendChild(expandBtn);

      li.addEventListener('click', () => enterPrivateChat(id, name));
    } else {
      const incoming = incomingReqs.find(r => r.userId === id);
      if (incoming) {
        // Incoming request → show accept/reject
        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'action-btn accept text-btn';
        acceptBtn.textContent = '接受';
        acceptBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          acceptFriendRequest(incoming.requestId, id);
        });
        li.appendChild(acceptBtn);
        li.addEventListener('click', () => renderSystem(`对方还不是你的好友，无法私聊`));
      } else if (outgoingIds.includes(id)) {
        // Outgoing pending
        const btn = document.createElement('button');
        btn.className = 'action-btn pending text-btn';
        btn.textContent = '已发送';
        li.appendChild(btn);
        li.addEventListener('click', () => renderSystem(`等待对方通过好友申请`));
      } else {
        // Not friend → show add button
        const btn = document.createElement('button');
        btn.className = 'action-btn text-btn';
        btn.textContent = '加好友';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          sendFriendRequest(id);
        });
        li.appendChild(btn);
        li.addEventListener('click', () => renderSystem(`对方还不是你的好友，请先添加好友`));
      }
    }

    userListEl.appendChild(li);
  });

  userCountEl.textContent = count;
}
if (userSearch) {
  userSearch.addEventListener('input', renderUserListFromState);
}

// ── Lightbox ──
function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.classList.add('show');
}
lightbox.addEventListener('click', () => { lightbox.classList.remove('show'); lightboxImg.src = ''; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && lightbox.classList.contains('show')) { lightbox.classList.remove('show'); lightboxImg.src = ''; }
});

// ── Video / Voice Call ──

function startCall(userId, name, mode) {
  if (callState !== 'idle') { renderSystem('当前已有一个通话'); return; }
  if (!navigator.mediaDevices) {
    renderSystem('无法访问麦克风/摄像头：请通过 HTTPS 或 localhost 访问');
    return;
  }
  callState = 'calling';
  callPartnerId = userId;
  callPartnerName = name;
  callMode = mode;

  renderSystem(`正在呼叫 ${name}...`);
  ws.send(JSON.stringify({ type: 'call_request', targetUserId: userId, mode }));

  showCallOverlay();
  callStatus.textContent = '正在呼叫...';
  callStatus.classList.remove('hidden');

  callTimeoutId = setTimeout(() => {
    if (callState === 'calling') {
      renderSystem('对方未响应');
      cleanupCall();
    }
  }, 30000);
}

async function acceptCall() {
  if (callState !== 'ringing') return;
  incomingCallEl.classList.add('hidden');
  callState = 'connected';
  callMode = window._pendingCallMode || 'audio';
  callPartnerId = window._pendingCallerId;
  callPartnerName = window._pendingCallerName;

  showCallOverlay();
  callStatus.classList.add('hidden');
  createPeerConnection(true);
  ws.send(JSON.stringify({ type: 'call_response', targetUserId: callPartnerId, accept: true }));
  await startLocalStream();
}

function declineCall() {
  if (callState !== 'ringing') return;
  incomingCallEl.classList.add('hidden');
  ws.send(JSON.stringify({ type: 'call_response', targetUserId: window._pendingCallerId, accept: false }));
  callState = 'idle';
  window._pendingCallerId = null;
  window._pendingCallerName = null;
  window._pendingCallMode = null;
}

function endCall() {
  if (callState === 'calling' && callPartnerId) {
    ws.send(JSON.stringify({ type: 'call_end', targetUserId: callPartnerId }));
  } else if (callState === 'connected' && callPartnerId) {
    ws.send(JSON.stringify({ type: 'call_end', targetUserId: callPartnerId }));
    renderSystem('通话已结束');
  }
  cleanupCall();
}

function toggleMic() {
  if (!localStream) return;
  const t = localStream.getAudioTracks()[0];
  if (t) {
    t.enabled = !t.enabled;
    callMicBtn.innerHTML = t.enabled ? '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/></svg>' : '🔇';
    callMicBtn.classList.toggle('muted', !t.enabled);
  }
}

function toggleCamera() {
  if (!localStream) return;
  let vt = localStream.getVideoTracks()[0];
  if (vt) {
    vt.enabled = !vt.enabled;
    callCamBtn.innerHTML = vt.enabled ? '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>' : '🚫';
    callCamBtn.classList.toggle('muted', !vt.enabled);
    if (vt.enabled) {
      callAudioPlaceholder.classList.add('hidden');
    } else {
      callAudioPlaceholder.classList.remove('hidden');
    }
    ws.send(JSON.stringify({ type: 'call_toggle_video', targetUserId: callPartnerId, videoEnabled: vt.enabled }));
  } else if (callMode === 'audio') {
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then((vs) => {
        vt = vs.getVideoTracks()[0];
        if (vt && pc) {
          localStream.addTrack(vt);
          pc.addTrack(vt, localStream);
          callMode = 'video';
          callCamBtn.innerHTML = '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>';
          callCamBtn.classList.remove('muted');
          callAudioPlaceholder.classList.add('hidden');
          ws.send(JSON.stringify({ type: 'call_toggle_video', targetUserId: callPartnerId, videoEnabled: true }));
        }
      })
      .catch(() => renderSystem('无法打开摄像头'));
  }
}

function showCallOverlay() {
  callOverlay.classList.remove('hidden');
  callOverlay.style.display = 'flex';
  if (callMode === 'audio') {
    callAudioPlaceholder.classList.remove('hidden');
    callAudioName.textContent = callPartnerName;
  } else {
    callAudioPlaceholder.classList.add('hidden');
  }
  startCallTimer();
}

function hideCallOverlay() {
  callOverlay.classList.add('hidden');
  callOverlay.style.display = 'none';
}

function createPeerConnection(isAnswerer) {
  if (pc) { pc.close(); pc = null; }
  pc = new RTCPeerConnection(ICE_SERVERS);
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && callPartnerId) {
      ws.send(JSON.stringify({ type: 'call_ice', targetUserId: callPartnerId, candidate: event.candidate }));
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc && (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed')) {
      renderSystem('通话连接断开');
      cleanupCall();
    }
  };
}

async function startLocalStream() {
  try {
    const constraints = { audio: true, video: callMode === 'video' };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;

    if (pc) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    if (callMode === 'video') {
      callCamBtn.innerHTML = '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>';
      callCamBtn.classList.remove('muted');
    } else {
      callCamBtn.textContent = '🚫';
      callCamBtn.classList.add('muted');
    }
    callMicBtn.innerHTML = '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/></svg>';
    callMicBtn.classList.remove('muted');
  } catch (e) {
    renderSystem('无法访问麦克风/摄像头');
    cleanupCall();
  }
}

async function handleCallOffer(data) {
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'call_answer', targetUserId: callPartnerId, sdp: pc.localDescription }));
  } catch (e) {
    renderSystem('通话连接失败');
    cleanupCall();
  }
}

async function handleCallAnswer(data) {
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  } catch (e) {
    renderSystem('通话连接失败');
    cleanupCall();
  }
}

function handleCallICE(data) {
  if (!pc) return;
  try {
    pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (e) { /* ignore */ }
}

function cleanupCall() {
  if (callTimeoutId) { clearTimeout(callTimeoutId); callTimeoutId = null; }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (pc) { pc.close(); pc = null; }
  remoteStream = null;
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  hideCallOverlay();
  incomingCallEl.classList.add('hidden');
  stopCallTimer();
  callState = 'idle';
  callPartnerId = null;
  callPartnerName = '';
  window._pendingCallerId = null;
  window._pendingCallerName = null;
  window._pendingCallMode = null;
}

function startCallTimer() {
  callStartTime = Date.now();
  callTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    callTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
  callTimer.textContent = '00:00';
}

// ═══════════════════════════════════════════
// ── Conference (会议) Functions ──
// ═══════════════════════════════════════════

/**
 * Start a meeting (conference) with a friend from their 会议 button.
 * Creates a room and auto-invites the chosen friend; the meeting works even
 * with no camera/microphone (join as viewer and share the screen).
 */
function startMeetingWith(friendId, friendName) {
  if (!ws) return;
  _confAutoInviteUserId = friendId;
  ws.send(JSON.stringify({ type: 'conference_create' }));
}

/** Show a short message over the meeting overlay (errors are otherwise hidden). */
function confToast(text) {
  let el = document.getElementById('conf-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'conf-toast';
    el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.82);color:#fff;padding:10px 18px;border-radius:8px;z-index:9999;font-size:14px;max-width:80%;text-align:center;';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(confToast._t);
  confToast._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

function showConfOverlay() {
  confOverlay.classList.remove('hidden');
  confOverlay.style.display = 'flex';
  startConfTimer();
}

function hideConfOverlay() {
  confOverlay.classList.add('hidden');
  confOverlay.style.display = 'none';
}

function startConfTimer() {
  confStartTime = Date.now();
  confTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - confStartTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    confTimer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopConfTimer() {
  if (confTimerInterval) { clearInterval(confTimerInterval); confTimerInterval = null; }
  confTimer.textContent = '00:00';
}

async function startConfLocalStream() {
  try {
    confLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    addConfVideoTile(myUserId, myUsername, confLocalStream);
    confMicBtn.innerHTML = '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/></svg>';
    confMicBtn.classList.remove('muted');
    confCamBtn.textContent = '🚫';
    confCamBtn.classList.add('muted');
    confCamEnabled = false;
    confMicEnabled = true;
  } catch (e) {
    // No microphone/camera detected — still join the meeting as a viewer:
    // participants can watch/hear the others and share their screen.
    confLocalStream = null;
    confMicBtn.textContent = '🔇';
    confMicBtn.classList.add('muted');
    confCamBtn.textContent = '🚫';
    confCamBtn.classList.add('muted');
    confMicEnabled = false;
    confCamEnabled = false;
  }
}

function stopConfLocalStream() {
  if (confLocalStream) {
    confLocalStream.getTracks().forEach(t => t.stop());
    confLocalStream = null;
  }
  removeConfVideoTile(myUserId);
}

function addConfVideoTile(userId, username, stream) {
  let tile = confVideoGrid.querySelector(`[data-userid="${userId}"]`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'conf-video-tile';
    tile.dataset.userid = userId;
    const video = document.createElement('video');
    video.className = 'conf-video';
    video.autoplay = true;
    video.playsinline = true;
    tile.appendChild(video);
    const label = document.createElement('div');
    label.className = 'conf-video-label';
    label.textContent = username;
    tile.appendChild(label);
    // Sharing overlay (shown when user is sharing screen, to prevent feedback loop)
    const sharingOverlay = document.createElement('div');
    sharingOverlay.className = 'conf-sharing-overlay';
    sharingOverlay.textContent = '🖥️ 共享屏幕中';
    tile.appendChild(sharingOverlay);
    // Maximize button
    const maxBtn = document.createElement('button');
    maxBtn.className = 'conf-maximize-btn';
    maxBtn.textContent = '⛶';
    maxBtn.title = '最大化';
    maxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      tile.classList.toggle('screenshare');
      maxBtn.textContent = tile.classList.contains('screenshare') ? '✕' : '⛶';
    });
    tile.appendChild(maxBtn);
    // Resize handle
    const handle = document.createElement('div');
    handle.className = 'conf-resize-handle';
    tile.appendChild(handle);
    makeTileResizable(tile, handle);
    // Double-click to toggle maximize
    tile.addEventListener('dblclick', () => {
      tile.classList.toggle('screenshare');
      maxBtn.textContent = tile.classList.contains('screenshare') ? '✕' : '⛶';
    });
    confVideoGrid.appendChild(tile);
  }
  const video = tile.querySelector('.conf-video');
  video.srcObject = stream;
  if (userId === myUserId) video.muted = true;
}

function makeTileResizable(tile, handle) {
  let isResizing = false;
  let startX, startY, startW, startH;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startW = tile.offsetWidth;
    startH = tile.offsetHeight;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    if (!isResizing) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newW = Math.max(160, startW + dx);
    const newH = Math.max(120, startH + dy);
    tile.style.width = newW + 'px';
    tile.style.height = newH + 'px';
  }

  function onMouseUp() {
    isResizing = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
}

function removeConfVideoTile(userId) {
  const tile = confVideoGrid.querySelector(`[data-userid="${userId}"]`);
  if (tile) tile.remove();
}

function renderConfParticipantList() {
  confChatParticipantList.innerHTML = '';
  if (!currentConfRoom || !currentConfRoom.participants) return;
  const isHost = currentConfRoom.hostId === myUserId;
  confHostBtn.classList.toggle('hidden', !isHost);
  confEndBtn.classList.toggle('hidden', !isHost);
  currentConfRoom.participants.forEach(p => {
    const div = document.createElement('div');
    div.className = 'conf-participant-item';
    const isHost = currentConfRoom.hostId === p.userId;
    div.innerHTML = `
      <span>${p.username}${isHost ? ' 👑' : ''}</span>
      ${isHost ? '<span class="conf-host-badge">主持人</span>' : ''}
    `;
    if (currentConfRoom.hostId === myUserId && p.userId !== myUserId) {
      const transferBtn = document.createElement('button');
      transferBtn.className = 'conf-transfer-btn';
      transferBtn.textContent = '转让主持';
      transferBtn.addEventListener('click', () => {
        if (ws) {
          ws.send(JSON.stringify({
            type: 'conference_host_transfer',
            roomCode: currentConfRoom.code,
            targetUserId: p.userId,
          }));
        }
      });
      div.appendChild(transferBtn);
    }
    confChatParticipantList.appendChild(div);
  });
}

function leaveConference() {
  if (!currentConfRoom) return;
  stopConfLocalStream();
  confPeerConnections.forEach(pc => pc.close());
  confPeerConnections.clear();
  confRemoteStreams.clear();
  if (ws) {
    ws.send(JSON.stringify({ type: 'conference_leave', roomCode: currentConfRoom.code }));
  }
  hideConfOverlay();
  confVideoGrid.innerHTML = '';
  stopConfTimer();
  currentConfRoom = null;
  confChatArea.classList.add('hidden');
  confChatMessages.innerHTML = '';
  confChatParticipantList.innerHTML = '';
  confScreenEnabled = false;
  confCamEnabled = false;
  confMicEnabled = true;
  confInviteFriends.classList.add('hidden');
  confChatEnabled = false;
  _confRemoteSharing = null;
  confMainVideo.srcObject = null;
  confMainArea.classList.remove('sharing');
  confMainPlaceholder.classList.remove('hidden');
  _confScreenLastStop = 0;
}

function toggleConfMic() {
  confMicEnabled = !confMicEnabled;
  if (confLocalStream) {
    confLocalStream.getAudioTracks().forEach(t => t.enabled = confMicEnabled);
  }
  confMicBtn.innerHTML = confMicEnabled ? '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"/></svg>' : '🔇';
  confMicBtn.classList.toggle('muted', !confMicEnabled);
  if (currentConfRoom && ws) {
    ws.send(JSON.stringify({ type: 'conference_toggle_media', roomCode: currentConfRoom.code, mediaType: 'audio', enabled: confMicEnabled }));
  }
}

async function toggleConfCam() {
  confCamEnabled = !confCamEnabled;
  if (!confCamEnabled) {
    // Turn camera off
    if (confLocalStream) {
      confLocalStream.getVideoTracks().forEach(t => { t.enabled = false; });
    }
  } else {
    // Turn camera on
    if (!confLocalStream) {
      confLocalStream = new MediaStream();
    }
    if (confLocalStream) {
      const existing = confLocalStream.getVideoTracks();
      if (existing.length === 0) {
        // No video track yet — start camera stream and add to all peer connections
        try {
          const vstream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          const vt = vstream.getVideoTracks()[0];
          confLocalStream.addTrack(vt);
          const renegotiatePcs = [];
          confPeerConnections.forEach((pc, targetUserId) => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
              sender.replaceTrack(vt);
            } else {
              pc.addTrack(vt, confLocalStream);
              renegotiatePcs.push({ pc, targetUserId });
            }
          });
          // Trigger renegotiation for each PC that got a new track
          for (const { pc, targetUserId } of renegotiatePcs) {
            if (pc.signalingState !== 'stable') continue;
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              if (ws && currentConfRoom) {
                ws.send(JSON.stringify({
                  type: 'conference_offer', roomCode: currentConfRoom.code,
                  targetUserId, sdp: pc.localDescription,
                }));
              }
            } catch (e) {}
          }
          // Update local video tile to show camera feed
          const localTile = confVideoGrid.querySelector(`[data-userid="${myUserId}"]`);
          if (localTile) {
            const video = localTile.querySelector('.conf-video');
            if (video) {
              video.srcObject = null;
              video.srcObject = confLocalStream;
            }
          }
        } catch (e) {
          renderSystem('无法打开摄像头');
          confCamEnabled = false;
          confCamBtn.textContent = '🚫';
          confCamBtn.classList.add('muted');
          return;
        }
      } else {
        existing.forEach(t => { t.enabled = true; });
      }
    }
  }
  confCamBtn.innerHTML = confCamEnabled ? '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>' : '🚫';
  confCamBtn.classList.toggle('muted', !confCamEnabled);
  if (currentConfRoom && ws) {
    ws.send(JSON.stringify({ type: 'conference_toggle_media', roomCode: currentConfRoom.code, mediaType: 'video', enabled: confCamEnabled }));
  }
}

async function toggleConfScreen() {
  if (confScreenEnabled) {
    // ── Stop screen share ──
    confScreenEnabled = false; // Set first to prevent ended-event re-entry
    confScreenBtn.innerHTML = '<svg class="ticon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
    confScreenBtn.classList.remove('active');
    confMainVideo.srcObject = null;
    confMainArea.classList.remove('sharing');
    confMainPlaceholder.classList.remove('hidden');

    const myTile = confVideoGrid.querySelector(`[data-userid="${myUserId}"]`);
    if (myTile) {
      myTile.classList.remove('screenshare');
      myTile.classList.remove('sharing');
      const mb = myTile.querySelector('.conf-maximize-btn');
      if (mb) mb.textContent = '⛶';
    }

    // Stop the getDisplayMedia stream (screen tracks) — the camera was never
    // removed, so nothing to restore.
    if (_confScreenStream) {
      _confScreenStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
      _confScreenStream = null;
    }

    // Remove screen senders from peer connections & collect for renegotiation
    const affectedPeerIds = [];
    confPeerConnections.forEach((pc, targetUserId) => {
      const senders = pc.getSenders().filter(s => s.track && s.track.kind === 'video' && s.track._isScreen);
      senders.forEach(s => pc.removeTrack(s));
      if (senders.length > 0) affectedPeerIds.push(targetUserId);
    });

    // Update local video tile (show the camera, which was never removed)
    if (myTile) {
      const video = myTile.querySelector('.conf-video');
      if (video) {
        video.srcObject = null;
        video.srcObject = confLocalStream;
      }
    }

    // Renegotiate with each affected peer after track removal
    for (const targetUserId of affectedPeerIds) {
      const pc = confPeerConnections.get(targetUserId);
      if (!pc || pc.signalingState !== 'stable') continue;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (ws && currentConfRoom) {
          ws.send(JSON.stringify({
            type: 'conference_offer', roomCode: currentConfRoom.code,
            targetUserId, sdp: pc.localDescription,
          }));
        }
      } catch (e) {}
    }

    _confScreenLastStop = Date.now();

    if (ws && currentConfRoom) {
      ws.send(JSON.stringify({ type: 'conference_screen_share', roomCode: currentConfRoom.code, enabled: false }));
    }
  } else {
    // ── Start screen share ──
    if (_screenShareBusy) return;
    // Cooldown after last stop to prevent ended-event + click race
    if (Date.now() - _confScreenLastStop < 800) return;
    _screenShareBusy = true;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        confToast('屏幕共享需要HTTPS连接，请通过 https:// 访问');
        return;
      }
      if (!confLocalStream) {
        // No mic/camera detected — create an empty stream so screen sharing
        // still works (the screen tracks are added to it below).
        confLocalStream = new MediaStream();
      }

      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      _confScreenStream = screenStream;

      // Keep the camera on the local stream/tile (video window); do NOT replace
      // it. Add the screen as a SEPARATE stream/sender so the receiver maps the
      // shared screen to the CENTER (main area) and keeps the camera in the tile.
      const affectedPeerIds = new Set();
      screenStream.getVideoTracks().forEach(t => {
        t._isScreen = true;
        confPeerConnections.forEach((pc, uid) => {
          pc.addTrack(t, screenStream);
          affectedPeerIds.add(uid);
        });
      });
      screenStream.getAudioTracks().forEach(t => {
        confPeerConnections.forEach((pc, uid) => {
          pc.addTrack(t, screenStream);
          affectedPeerIds.add(uid);
        });
      });

      confScreenEnabled = true;
      confScreenBtn.textContent = '🛑';
      confScreenBtn.classList.add('active');

      // Show screen content in main area
      const screenTrack = screenStream.getVideoTracks()[0];
      if (screenTrack) {
        confMainVideo.srcObject = new MediaStream([screenTrack]);
        confMainArea.classList.add('sharing');
        confMainPlaceholder.classList.add('hidden');
      }

      // Update local tile — hide video and show sharing overlay to prevent feedback loop
      const localTile = confVideoGrid.querySelector(`[data-userid="${myUserId}"]`);
      if (localTile) {
        localTile.classList.add('screenshare');
        localTile.classList.add('sharing');
        const mb = localTile.querySelector('.conf-maximize-btn');
        if (mb) mb.textContent = '✕';
      }

      // Let receivers know we're sharing BEFORE the renegotiation, so they can
      // route the incoming screen track to the CENTER (main area) immediately.
      if (ws && currentConfRoom) {
        ws.send(JSON.stringify({ type: 'conference_screen_share', roomCode: currentConfRoom.code, enabled: true }));
      }

      // Renegotiate with affected peers so they receive the screen tracks
      for (const targetUserId of affectedPeerIds) {
        const pc = confPeerConnections.get(targetUserId);
        if (!pc || pc.signalingState !== 'stable') continue;
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (ws && currentConfRoom) {
            ws.send(JSON.stringify({
              type: 'conference_offer', roomCode: currentConfRoom.code,
              targetUserId, sdp: pc.localDescription,
            }));
          }
        } catch (e) {}
      }

      // Listen for browser-native stop
      screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        if (confScreenEnabled) toggleConfScreen();
      });
    } catch (e) {
      confToast('屏幕共享启动失败: ' + (e.message || ''));
    } finally {
      _screenShareBusy = false;
    }
  }
}

// ── Conference WebRTC ──

function createConfPeerConnection(targetUserId, isOfferer) {
  if (confPeerConnections.has(targetUserId)) {
    confPeerConnections.get(targetUserId).close();
  }
  const pc = new RTCPeerConnection(ICE_SERVERS);
  confPeerConnections.set(targetUserId, pc);

  if (confLocalStream) {
    confLocalStream.getTracks().forEach(track => pc.addTrack(track, confLocalStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate && currentConfRoom && ws) {
      ws.send(JSON.stringify({
        type: 'conference_ice', roomCode: currentConfRoom.code,
        targetUserId, candidate: event.candidate,
      }));
    }
  };

  pc.ontrack = (event) => {
    if (!event.streams[0]) return;
    const remoteStream = event.streams[0];
    // If this user is sharing their screen, route the stream to the CENTER
    // (main area) and leave the camera tile (stored earlier) untouched. This
    // handles the race where the renegotiated screen stream lands after the
    // conference_screen_share event.
    if (_confRemoteSharing === targetUserId) {
      confMainVideo.srcObject = remoteStream;
      confMainArea.classList.add('sharing');
      confMainPlaceholder.classList.add('hidden');
      try { confMainVideo.play(); } catch (e) { /* ignore */ }
      return;
    }
    confRemoteStreams.set(targetUserId, remoteStream);
    const displayName = (window._userNames && window._userNames[targetUserId]) || '用户' + targetUserId;
    addConfVideoTile(targetUserId, displayName, remoteStream);
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      pc.close();
      confPeerConnections.delete(targetUserId);
      removeConfVideoTile(targetUserId);
    }
  };

  if (isOfferer) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        if (ws && currentConfRoom) {
          ws.send(JSON.stringify({
            type: 'conference_offer', roomCode: currentConfRoom.code,
            targetUserId, sdp: pc.localDescription,
          }));
        }
      })
      .catch(() => {});
  }

  return pc;
}

async function handleConfOffer(data) {
  const pc = confPeerConnections.get(data.fromUserId);
  if (!pc) return;
  try {
    if (pc.signalingState !== 'stable') {
      try { await pc.setLocalDescription({ type: 'rollback' }); } catch (e) {}
    }
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (ws && currentConfRoom) {
      ws.send(JSON.stringify({
        type: 'conference_answer', roomCode: currentConfRoom.code,
        targetUserId: data.fromUserId, sdp: pc.localDescription,
      }));
    }
  } catch (e) {
    renderSystem('会议连接失败');
  }
}

async function handleConfAnswer(data) {
  const pc = confPeerConnections.get(data.fromUserId);
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  } catch (e) {}
}

function handleConfICE(data) {
  const pc = confPeerConnections.get(data.fromUserId);
  if (!pc) return;
  try {
    pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (e) {}
}

// ── Invite friends to conference ──

async function openConfInvite() {
  if (!currentConfRoom) return;
  confInviteFriendList.innerHTML = '';
  friendIds.forEach(fid => {
    const displayN = getDisplayName(fid);
    const name = displayN !== '未知' ? displayN : ((window._userNames && window._userNames[fid]) || '用户' + fid);
    const btn = document.createElement('button');
    btn.className = 'conf-invite-friend-btn';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      if (ws) {
        ws.send(JSON.stringify({ type: 'conference_invite', roomCode: currentConfRoom.code, targetUserId: fid }));
      }
      btn.textContent = '已邀请';
      btn.disabled = true;
    });
    confInviteFriendList.appendChild(btn);
  });
  confInviteFriends.classList.remove('hidden');
  confRoomModal.classList.remove('hidden');
}

function acceptConfInvite() {
  if (!_pendingConfInvite) return;
  confInvite.classList.add('hidden');
  const { roomCode } = _pendingConfInvite;
  _pendingConfInvite = null;
  // Show overlay and start local stream before joining
  currentConfRoom = { code: roomCode, hostId: null, participants: [{ userId: myUserId, username: myUsername }] };
  showConfOverlay();
  startConfLocalStream();
  // Auto-join the conference via modal
  confRoomModal.classList.remove('hidden');
  confJoinInput.value = roomCode;
  confJoinBtn.click();
  confRoomModal.classList.add('hidden');
}

function declineConfInvite() {
  confInvite.classList.add('hidden');
  _pendingConfInvite = null;
}

// ── Host transfer ──

function transferHost() {
  if (!currentConfRoom || !currentConfRoom.participants) return;
  // Show the participant list (inside the 沟通 box) for host selection.
  confChatArea.classList.remove('hidden');
  renderConfParticipantList();
}

// ── Meeting communication (沟通 / 参与者，由「👥 参与者」按钮打开) ──

function toggleConfChat() {
  confChatEnabled = !confChatEnabled;
  // Participant list and chat live in the SAME panel (沟通 box).
  confChatArea.classList.toggle('hidden', !confChatEnabled);
  if (confChatEnabled) {
    renderConfParticipantList();
    confChatInput.focus();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function addConfChat(fromName, text, isSelf) {
  const row = document.createElement('div');
  row.className = 'conf-chat-msg' + (isSelf ? ' self' : '');
  const name = isSelf ? '我' : (fromName || '对方');
  row.innerHTML = `<span class="conf-chat-sender">${escapeHtml(name)}</span><span class="conf-chat-text">${escapeHtml(text)}</span>`;
  confChatMessages.appendChild(row);
  confChatArea.classList.remove('hidden');
  confChatMessages.scrollTop = confChatMessages.scrollHeight;
}

function sendConfChat() {
  const text = confChatInput.value.trim();
  if (!text) return;
  if (!ws || !currentConfRoom) return;
  ws.send(JSON.stringify({ type: 'conference_chat', roomCode: currentConfRoom.code, text: text.slice(0, 2000) }));
  addConfChat(myUsername, text, true);
  confChatInput.value = '';
}

// ── Helpers ──
function now() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
