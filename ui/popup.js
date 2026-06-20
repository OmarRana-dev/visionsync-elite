document.addEventListener('DOMContentLoaded', () => {
  const launchOverlay = document.getElementById('launchOverlay');
  const launchBtn = document.getElementById('launchBtn');
  const mainApp = document.getElementById('mainApp');
  const statusMsg = document.getElementById('statusMsg');
  const usernameInput = document.getElementById('usernameInput');
  const nameInputWrapper = document.getElementById('nameInputWrapper');

  // Tabs
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  // Create Flow
  const generateBtn = document.getElementById('generateBtn');
  const createResult = document.getElementById('createResult');
  const generatedCodeDisplay = document.getElementById('generatedCodeDisplay');
  const copyBtn = document.getElementById('copyBtn');
  let currentGeneratedCode = '';

  // Join Flow
  const roomIdInput = document.getElementById('roomIdInput');
  const joinBtn = document.getElementById('joinBtn');
  const activeRoomsSection = document.getElementById('activeRoomsSection');
  const activeRoomsList = document.getElementById('activeRoomsList');

  // Connected View
  const connectionControls = document.getElementById('connectionControls');
  const connectedView = document.getElementById('connectedView');
  const activeRoomIdDisplay = document.getElementById('activeRoomIdDisplay');
  const currentRoomLink = document.getElementById('currentRoomLink');
  const copyActiveBtn = document.getElementById('copyActiveBtn');
  const leaveBtn = document.getElementById('leaveBtn');

  // --- Initial Setup / PING ---
  chrome.storage.local.get(['userName'], (result) => {
    if (result.userName) {
      usernameInput.value = result.userName;
    }
  });

  function showMainApp(msg, status = null) {
    launchOverlay.style.display = 'none';
    mainApp.style.display = 'flex';
    statusMsg.textContent = msg;

    if (status && status.connected) {
      showConnectedView(status.roomId);
    } else {
      showDisconnectedView();
      // If user is already on the join tab, fetch rooms immediately
      const activeTab = document.querySelector('.tab.active');
      if (activeTab && activeTab.dataset.target === 'join') {
        fetchActiveRooms();
      }
    }
  }

  function showConnectedView(roomId) {
    connectionControls.style.display = 'none';
    nameInputWrapper.style.display = 'none';
    connectedView.style.display = 'flex';
    currentRoomLink.textContent = roomId;
    statusMsg.textContent = `Connected to ${roomId}`;
  }

  function showDisconnectedView() {
    connectionControls.style.display = 'block';
    nameInputWrapper.style.display = 'block';
    connectedView.style.display = 'none';
    createResult.classList.remove('active');
    
    // Auto-fetch if we are on join tab
    const activeTab = document.querySelector('.tab.active');
    if (activeTab && activeTab.dataset.target === 'join') {
      fetchActiveRooms();
    }
  }

  // Check state on load
  chrome.tabs.query({ active: true, currentWindow: true }, (tabsList) => {
    if (tabsList[0]) {
      const url = tabsList[0].url || '';
      const isMovieSite = url.includes('moviebox') || url.includes('netmirror') || url.includes('dailymotion');

      chrome.tabs.sendMessage(tabsList[0].id, { type: 'GET_STATUS' }, (response) => {
        if (!chrome.runtime.lastError && response && response.status === 'PONG') {
          showMainApp('VisionSync Active!', response);
        } else {
          // If script is missing, show the launch button
          launchOverlay.style.display = 'block';
          mainApp.style.display = 'none';
          statusMsg.textContent = 'Extension not active on this tab.';
        }
      });
    }
  });

  // --- Tab Switching Logic ---
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.target);
      target.classList.add('active');

      if (tab.dataset.target === 'join') {
        fetchActiveRooms();
      }
    });
  });

  async function fetchActiveRooms() {
    // ASKING THE BACKGROUND SCRIPT IS INSTANT (already connected)
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_ROOMS_BG' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.rooms) {
        activeRoomsSection.style.display = 'none';
        return;
      }

      const rooms = response.rooms;
      if (rooms.length === 0) {
        activeRoomsSection.style.display = 'none';
        return;
      }

      activeRoomsSection.style.display = 'block';
      activeRoomsList.innerHTML = '';

      rooms.forEach(room => {
        const item = document.createElement('div');
        item.style.cssText = `
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          padding: 10px 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          margin-bottom: 4px;
        `;
        item.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-weight: 700; color: #fff; font-size: 13px;">${room.host}'s Party</span>
              <span style="font-size: 8px; color: #ff8a00; border: 1px solid #ff8a00; padding: 1px 4px; border-radius: 4px; font-weight: 900; text-transform: uppercase;">HOST</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
               <span style="font-size: 10px; color: #25d366;">● ${room.users} online</span>
               <span style="font-size: 10px; color: rgba(255,255,255,0.2); font-family: monospace;">ID: ${room.id}</span>
            </div>
          </div>
          <button style="
            background: linear-gradient(90deg, #ff8a00, #e52e71);
            border: none;
            color: white;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 800;
            cursor: pointer;
            box-shadow: 0 4px 10px rgba(229, 46, 113, 0.2);
          ">JOIN</button>
        `;
        
        item.addEventListener('mouseenter', () => {
          item.style.background = 'rgba(255,255,255,0.06)';
          item.style.borderColor = '#e52e71';
          item.style.transform = 'scale(1.02)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'rgba(255,255,255,0.03)';
          item.style.borderColor = 'rgba(255,255,255,0.08)';
          item.style.transform = 'scale(1)';
        });

        item.addEventListener('click', () => {
          roomIdInput.value = room.id;
          triggerJoinRoom(room.id, false);
        });

        activeRoomsList.appendChild(item);
      });
    });
  }

  // --- Launch Extension ---
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

  // --- Open Lobby ---
  const lobbyBtn = document.getElementById('lobbyBtn');
  if (lobbyBtn) {
    lobbyBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('ui/lobby.html') });
      window.close();
    });
  }

  // --- Core Join Function ---
  async function triggerJoinRoom(roomId, isCreate = false) {
    const userName = usernameInput.value.trim();
    if (!userName) {
      statusMsg.textContent = 'Please enter your Display Name.';
      return;
    }
    if (!roomId) {
      statusMsg.textContent = 'Invalid Room Link.';
      return;
    }

    statusMsg.textContent = 'Joining room...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'JOIN_ROOM',
        roomId: roomId,
        userName: userName,
        isCreate: isCreate,
        movieUrl: tab.url
      }, (response) => {
         if (chrome.runtime.lastError || !response) {
            statusMsg.textContent = 'Error: Cannot reach video page. Please launch the extension first.';
            return;
         }
         if (response.error) {
            statusMsg.textContent = response.error;
         } else {
            showConnectedView(roomId);
            chrome.storage.local.set({ userName: userName });
         }
      });
    }
  }

  // --- Create Flow Logic ---
  generateBtn.addEventListener('click', () => {
    const userName = usernameInput.value.trim();
    if (!userName) {
      statusMsg.textContent = 'Please enter your Display Name first.';
      return;
    }

    // Generate random code (vsync-xxxxx)
    const randomCode = Math.random().toString(36).substring(2, 7);
    currentGeneratedCode = `vsync-${randomCode}`;
    
    generatedCodeDisplay.textContent = currentGeneratedCode;
    createResult.classList.add('active');
    statusMsg.textContent = 'Room created! Joining...';

    // IMMEDIATELY JOIN
    triggerJoinRoom(currentGeneratedCode, true);
  });

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentGeneratedCode).then(() => {
      copyBtn.textContent = 'Copied! Joining...';
      setTimeout(() => {
        copyBtn.textContent = 'Copy Link / Join';
      }, 2000);
      
      // Auto join the room the user just created
      triggerJoinRoom(currentGeneratedCode, true);
    }).catch(err => {
      statusMsg.textContent = 'Failed to copy to clipboard.';
    });
  });

  // --- Join Flow Logic ---
  joinBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (!roomId) {
      statusMsg.textContent = 'Please paste a valid Room Link.';
      return;
    }
    triggerJoinRoom(roomId, false);
  });
  // --- Connected View Logic ---
  copyActiveBtn.addEventListener('click', () => {
    const roomId = currentRoomLink.textContent;
    navigator.clipboard.writeText(roomId).then(() => {
      copyActiveBtn.textContent = 'Copied!';
      setTimeout(() => copyActiveBtn.textContent = 'Copy Link', 2000);
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

});
