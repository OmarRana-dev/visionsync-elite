document.addEventListener('DOMContentLoaded', () => {
  const usernameInput = document.getElementById('usernameInput');
  const refreshBtn = document.getElementById('refreshBtn');
  const roomsGrid = document.getElementById('roomsGrid');

  // Load saved name
  chrome.storage.local.get(['userName'], (result) => {
    if (result.userName) {
      usernameInput.value = result.userName;
    }
  });

  usernameInput.addEventListener('input', () => {
    chrome.storage.local.set({ userName: usernameInput.value.trim() });
  });

  function fetchRooms() {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_ROOMS_BG' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.rooms) {
        showEmptyState();
        return;
      }

      const rooms = response.rooms;
      if (rooms.length === 0) {
        showEmptyState();
        return;
      }

      renderRooms(rooms);
    });
  }

  function showEmptyState() {
    roomsGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <h2>No Active Parties 🏜️</h2>
        <p>There are no active public watch parties right now.</p>
        <p>To create one, go to a movie on Dailymotion or MovieBox and launch VisionSync Elite.</p>
      </div>
    `;
  }

  function renderRooms(rooms) {
    roomsGrid.innerHTML = '';

    rooms.forEach(room => {
      const card = document.createElement('div');
      card.className = 'room-card';

      const isMagic = room.host.match(/abeera|jennie/i);
      const isBTS = room.host.match(/rose|ayesha/i);
      const isVIP = isMagic || isBTS;

      let hostDisplay = room.host;
      if (isMagic) hostDisplay = `👑 ${room.host} 🐰`;
      if (isBTS) hostDisplay = `🐻 ${room.host} 💜`;

      const safeUrl = room.movieUrl ? room.movieUrl.substring(0, 60) + (room.movieUrl.length > 60 ? '...' : '') : 'No URL Provided';

      card.innerHTML = `
        <div class="room-header">
          <div>
            <h3 class="host-name" style="color: ${isVIP ? '#ffcc70' : '#fff'}">${hostDisplay}</h3>
            <div class="host-badge">HOST</div>
          </div>
          <div class="users-badge ${isVIP ? 'vip' : ''}">
            <div class="dot" style="${isVIP ? 'background: #a26ed4; box-shadow: 0 0 8px #a26ed4;' : ''}"></div>
            ${room.users} Online
          </div>
        </div>
        <div class="movie-url" title="${room.movieUrl || 'Unknown'}">${safeUrl}</div>
        <button class="join-btn">JOIN PARTY</button>
      `;

      card.querySelector('.join-btn').addEventListener('click', () => {
        const userName = usernameInput.value.trim();
        if (!userName) {
          alert('Please enter your display name first!');
          usernameInput.focus();
          return;
        }

        if (!room.movieUrl) {
          alert('This room does not have a valid movie URL. Cannot auto-join.');
          return;
        }

        // Send AUTO_JOIN_ROOM command to background script
        chrome.runtime.sendMessage({
          type: 'AUTO_JOIN_ROOM',
          roomId: room.id,
          userName: userName,
          movieUrl: room.movieUrl
        });

        // The background script will open the tab and handle the rest!
      });

      roomsGrid.appendChild(card);
    });
  }

  refreshBtn.addEventListener('click', () => {
    fetchRooms();
  });

  // Initial fetch and auto-refresh every 10 seconds
  fetchRooms();
  setInterval(fetchRooms, 10000);
});
