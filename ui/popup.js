// popup.js — VisionSync Elite

document.addEventListener('DOMContentLoaded', () => {

  // ── DOM References ─────────────────────────────────────
  const loginScreen       = document.getElementById('loginScreen');
  const loginStatusMsg    = document.getElementById('loginStatusMsg');
  const googleSignInBtn   = document.getElementById('googleSignInBtn');
  const userProfileStrip  = document.getElementById('userProfileStrip');
  const userAvatar        = document.getElementById('userAvatar');
  const userNameDisplay   = document.getElementById('userNameDisplay');
  const userEmailDisplay  = document.getElementById('userEmailDisplay');
  const signOutBtn        = document.getElementById('signOutBtn');

  const launchOverlay     = document.getElementById('launchOverlay');
  const launchBtn         = document.getElementById('launchBtn');
  const lobbyBtn          = document.getElementById('lobbyBtn');
  const mainApp           = document.getElementById('mainApp');
  const statusMsg         = document.getElementById('statusMsg');

  const usernameInput     = document.getElementById('usernameInput');
  const tabs              = document.querySelectorAll('.tab');
  const tabContents       = document.querySelectorAll('.tab-content');

  const generateBtn           = document.getElementById('generateBtn');
  const createResult          = document.getElementById('createResult');
  const generatedCodeDisplay  = document.getElementById('generatedCodeDisplay');
  const copyBtn               = document.getElementById('copyBtn');
  let currentGeneratedCode    = '';

  const roomIdInput       = document.getElementById('roomIdInput');
  const joinBtn           = document.getElementById('joinBtn');
  const activeRoomsSection= document.getElementById('activeRoomsSection');
  const activeRoomsList   = document.getElementById('activeRoomsList');

  const connectionControls= document.getElementById('connectionControls');
  const connectedView     = document.getElementById('connectedView');
  const currentRoomLink   = document.getElementById('currentRoomLink');
  const copyActiveBtn     = document.getElementById('copyActiveBtn');
  const leaveBtn          = document.getElementById('leaveBtn');
  const nameInputWrapper  = document.getElementById('nameInputWrapper');

  // ── Auth UI helpers ────────────────────────────────────
  function showLoginScreen() {
    loginScreen.style.display       = 'flex';
    userProfileStrip.style.display  = 'none';
    launchOverlay.style.display     = 'none';
    mainApp.style.display           = 'none';
    statusMsg.textContent           = '';
  }

  function showUserProfile(user) {
    loginScreen.style.display       = 'none';
    userProfileStrip.style.display  = 'flex';
    userAvatar.src = user.photo || 'icons/icon48.png';
    userNameDisplay.textContent  = user.name || 'User';
    userEmailDisplay.textContent = user.email || '';
    // Pre-fill display name with Google name
    usernameInput.value = user.name || '';
    chrome.storage.local.set({ userName: user.name });
  }

  // ── Auth Listeners ─────────────────────────────────────
  googleSignInBtn.addEventListener('click', () => {
    googleSignInBtn.disabled = true;
    loginStatusMsg.textContent = 'Opening Google Sign-In... Please complete in the new window.';
    chrome.runtime.sendMessage({ type: 'LOGIN_WITH_GOOGLE' }, (response) => {
      if (chrome.runtime.lastError) {
        // The popup likely closed because the Google window stole focus. This is normal.
        return;
      }
      if (response && response.status === 'success') {
        showUserProfile(response.user);
        checkTabAndShowApp();
      } else if (response && response.status === 'error') {
        loginStatusMsg.textContent = `Sign-in failed: ${response.error}`;
        console.error('[VisionSync] Auth error:', response.error);
        googleSignInBtn.disabled = false;
      }
    });
  });

  signOutBtn.addEventListener('click', async () => {
    await window.vsAuth.signOut();
    showLoginScreen();
  });

  // ── Tab Switching ──────────────────────────────────────
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.target).classList.add('active');
      if (tab.dataset.target === 'join') fetchActiveRooms();
    });
  });

  // ── Popup State Helpers ────────────────────────────────
  function showMainApp(msg, status = null) {
    launchOverlay.style.display = 'none';
    mainApp.style.display       = 'flex';
    statusMsg.textContent       = msg;
    if (status && status.connected) {
      showConnectedView(status.roomId);
    } else {
      showDisconnectedView();
      const activeTab = document.querySelector('.tab.active');
      if (activeTab && activeTab.dataset.target === 'join') fetchActiveRooms();
    }
  }

  function showConnectedView(roomId) {
    connectionControls.style.display = 'none';
    nameInputWrapper.style.display   = 'none';
    connectedView.style.display      = 'flex';
    currentRoomLink.textContent      = roomId;
    statusMsg.textContent            = `Connected to ${roomId}`;
  }

  function showDisconnectedView() {
    connectionControls.style.display = 'block';
    nameInputWrapper.style.display   = 'none'; // name comes from Google
    connectedView.style.display      = 'none';
    createResult.classList.remove('active');
    const activeTab = document.querySelector('.tab.active');
    if (activeTab && activeTab.dataset.target === 'join') fetchActiveRooms();
  }

  // ── Check the current tab and decide what to show ──────
  function checkTabAndShowApp() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabsList) => {
      if (!tabsList[0]) return;
      const activeTabId = tabsList[0].id;

      chrome.storage.local.get(['isAutoJoining', 'autoJoinTabId'], (res) => {
        if (res.isAutoJoining && res.autoJoinTabId === activeTabId) {
          // Block manual interaction on this tab during auto-join
          launchOverlay.style.display = 'none';
          mainApp.style.display       = 'none';
          statusMsg.textContent       = 'Auto-joining watch party... Please wait.';
          return;
        }

        chrome.tabs.sendMessage(activeTabId, { type: 'GET_STATUS' }, (response) => {
          if (!chrome.runtime.lastError && response && response.status === 'PONG') {
            showMainApp('VisionSync Active!', response);
          } else {
            launchOverlay.style.display = 'flex';
            mainApp.style.display       = 'none';
            statusMsg.textContent       = 'Ready to launch.';
          }
        });
      });
    });
  }

  // ── Fetch Active Rooms ─────────────────────────────────
  async function fetchActiveRooms() {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_ROOMS_BG' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.rooms || response.rooms.length === 0) {
        activeRoomsSection.style.display = 'none';
        return;
      }
      activeRoomsSection.style.display = 'block';
      activeRoomsList.innerHTML = '';
      response.rooms.forEach(room => {
        const item = document.createElement('div');
        item.style.cssText = `
          background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px; padding: 10px 14px; display: flex; justify-content: space-between;
          align-items: center; cursor: pointer; transition: all 0.2s; margin-bottom: 4px;`;
        item.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:2px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-weight:700;color:#fff;font-size:13px;">${room.host}'s Party</span>
              <span style="font-size:8px;color:#ff8a00;border:1px solid #ff8a00;padding:1px 4px;border-radius:4px;font-weight:900;text-transform:uppercase;">HOST</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:10px;color:#25d366;">● ${room.users} online</span>
              <span style="font-size:10px;color:rgba(255,255,255,0.2);font-family:monospace;">ID: ${room.id}</span>
            </div>
          </div>
          <button style="background:linear-gradient(90deg,#ff8a00,#e52e71);border:none;color:white;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;">JOIN</button>`;
        item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.06)'; item.style.borderColor = '#e52e71'; });
        item.addEventListener('mouseleave', () => { item.style.background = 'rgba(255,255,255,0.03)'; item.style.borderColor = 'rgba(255,255,255,0.08)'; });
        item.addEventListener('click', () => { roomIdInput.value = room.id; triggerJoinRoom(room.id, false); });
        activeRoomsList.appendChild(item);
      });
    });
  }

  // ── Launch Extension ───────────────────────────────────
  launchBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      statusMsg.textContent = 'Injecting VisionSync...';
      chrome.runtime.sendMessage({ type: 'LAUNCH_EXTENSION', tabId: tab.id }, (response) => {
        if (response && (response.status === 'success' || response.status === 'already_active')) {
          showMainApp('VisionSync Active!');
        } else {
          statusMsg.textContent = 'Injection failed.';
        }
      });
    } catch (err) {
      statusMsg.textContent = `Error: ${err.message}`;
    }
  });

  // ── Lobby Button ───────────────────────────────────────
  lobbyBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('ui/lobby.html') });
    window.close();
  });

  // ── Core Join Function ─────────────────────────────────
  async function triggerJoinRoom(roomId, isCreate = false) {
    const userName = usernameInput.value.trim();
    if (!userName) { statusMsg.textContent = 'No display name found.'; return; }
    if (!roomId)   { statusMsg.textContent = 'Invalid Room Link.'; return; }
    statusMsg.textContent = 'Joining room...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'JOIN_ROOM', roomId, userName, isCreate, movieUrl: tab.url
      }, (response) => {
        if (chrome.runtime.lastError || !response) {
          statusMsg.textContent = 'Error: Launch the extension first.';
          return;
        }
        if (response.error) {
          statusMsg.textContent = response.error;
        } else {
          showConnectedView(roomId);
          chrome.storage.local.set({ userName });
        }
      });
    }
  }

  // ── Create Flow ────────────────────────────────────────
  generateBtn.addEventListener('click', () => {
    const userName = usernameInput.value.trim();
    if (!userName) { statusMsg.textContent = 'No display name. Please sign in.'; return; }
    const randomCode = Math.random().toString(36).substring(2, 7);
    currentGeneratedCode = `vsync-${randomCode}`;
    generatedCodeDisplay.textContent = currentGeneratedCode;
    createResult.classList.add('active');
    statusMsg.textContent = 'Room created! Joining...';
    triggerJoinRoom(currentGeneratedCode, true);
  });

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentGeneratedCode).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
      triggerJoinRoom(currentGeneratedCode, true);
    });
  });

  joinBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (!roomId) { statusMsg.textContent = 'Please paste a valid Room Link.'; return; }
    triggerJoinRoom(roomId, false);
  });

  // ── Connected View ─────────────────────────────────────
  copyActiveBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentRoomLink.textContent).then(() => {
      copyActiveBtn.textContent = 'Copied!';
      setTimeout(() => { copyActiveBtn.textContent = 'Copy Link'; }, 2000);
    });
  });

  leaveBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { type: 'LEAVE_ROOM' });
      chrome.tabs.sendMessage(tab.id, { type: 'UI_CLEANUP' });
      showDisconnectedView();
      statusMsg.textContent = 'Left room.';
    }
  });

  // ── Startup: Auth Check → Show Correct Screen ──────────
  window.vsAuth.getCurrentUser().then((user) => {
    if (user) {
      showUserProfile(user);
      checkTabAndShowApp();
    } else {
      showLoginScreen();
    }
  });

});
