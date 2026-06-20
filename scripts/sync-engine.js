// sync-engine.js: Handles Server-Coordinated Synchronization, Sockets, and Heartbeats
class SyncEngine {
  constructor() {
    this.videoElement = null;
    this.socket = null;
    this.currentRoomId = null;
    this.currentUserName = null;
    this.isRemoteSyncing = false;
    this.peerNames = {};
    this.hasJoinedOnce = false;
    this.pausedByRemoteBuffer = false; // Track if we were paused by a buffer lock
    this.sessionId = null;
    this.isHost = false;
    this.isApplyingNetworkState = false; // Prevent feedback loops
    this.syncThreshold = 2.0; // Higher threshold for "aggressive" seeking

    this.initSession();
    this.startVideoObserver();
    this.initSocket();

    // Listen for cross-frame engine commands
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'RELAY_TO_ENGINE') {
        if (typeof this[message.method] === 'function') {
          this[message.method](...message.args);
        }
      }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'JOIN_ROOM') {
        this.joinRoom(message.roomId, message.userName, message.isCreate, message.movieUrl, sendResponse);
        return true;
      } else if (message.type === 'GET_STATUS') {
        sendResponse({
          status: 'PONG',
          connected: !!this.currentRoomId,
          roomId: this.currentRoomId,
          userName: this.currentUserName
        });
      } else if (message.type === 'LEAVE_ROOM') {
        this.leaveRoom();
      } else if (message.type === 'GET_ACTIVE_ROOMS') {
        const sendRooms = () => {
          this.socket.emit('get-active-rooms', (rooms) => {
            sendResponse({ rooms });
          });
        };

        if (this.socket && this.socket.connected) {
          sendRooms();
        } else if (this.socket) {
          // Wait for connect with a timeout
          const onConnect = () => {
            clearTimeout(timeout);
            sendRooms();
          };
          const timeout = setTimeout(() => {
            this.socket.off('connect', onConnect);
            sendResponse({ rooms: [] });
          }, 2000);
          this.socket.once('connect', onConnect);
        } else {
          sendResponse({ rooms: [] });
        }
        return true;
      }
    });

    console.log('[VisionSync Elite] Server-Coordinated Engine Loaded');
  }

  callChat(method, ...args) {
    if (window.visionSyncChat) {
      window.visionSyncChat[method](...args);
    } else {
      chrome.runtime.sendMessage({ type: 'RELAY_TO_CHAT', method, args });
    }
  }

  initSession() {
    chrome.storage.local.get(['sessionId'], (result) => {
      if (result.sessionId) {
        this.sessionId = result.sessionId;
      } else {
        this.sessionId = 'sess-' + Math.random().toString(36).substring(2, 15);
        chrome.storage.local.set({ sessionId: this.sessionId });
      }
    });
  }

  initSocket() {
    this.socket = window.io('https://visionsync-server.onrender.com', { transports: ['websocket'] });

    // Heartbeat to keep Render awake during the movie
    setInterval(() => {
      if (this.socket && this.socket.connected) {
        this.socket.emit('ping');
      }
    }, 25000);

    this.socket.on('connect', () => {
      console.log('[VisionSync] Socket Connected:', this.socket.id);
      this.callChat('setSocketId', this.socket.id);
      if (this.currentRoomId && this.hasJoinedOnce) {
        // RECOVERY LOGIC: Use sessionId and handle errors
        this.socket.emit('join-room', this.currentRoomId, this.currentUserName, { 
          isCreate: this.isHost, 
          sessionId: this.sessionId 
        }, (response) => {
           if (response && response.success) {
             this.callChat('showNotification', 'Connection Restored! ⚡');
           } else if (response && response.error === 'Room does not exist!' && this.isHost) {
             // If I was the host, re-create it silently
             this.socket.emit('join-room', this.currentRoomId, this.currentUserName, { 
               isCreate: true, 
               sessionId: this.sessionId 
             });
             this.callChat('showNotification', 'Room Restored! 🏰');
           }
        });
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('[VisionSync] Socket Disconnected:', reason);
      if (this.currentRoomId) {
        this.callChat('showNotification', 'Reconnecting... ⏳');
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('[VisionSync] Connection Error:', error);
    });

    this.socket.on('existing-users', (users) => {
      console.log('[VisionSync] Existing users received:', users);
      Object.assign(this.peerNames, users);
      this.updateChatUserList();
    });

    this.socket.on('room-state', (state) => {
      console.log('[VisionSync] Initial State:', state);
      if (this.videoElement) {
        // STRONG FIX: If we are the host, don't let the server's initial empty state (0:00) reset our ongoing movie!
        if (this.isHost && state.currentTime === 0 && !state.isPlaying) {
          console.log('[VisionSync] Host protecting local playback state, broadcasting instead.');
          this.broadcast({ 
            type: this.videoElement.paused ? 'pause' : 'play', 
            time: this.videoElement.currentTime 
          });
          return;
        }

        this.isRemoteSyncing = true;
        
        // Only seek if the time difference is significant, prevents infinite buffering in MSE players
        if (Math.abs(this.videoElement.currentTime - state.currentTime) > 1.0) {
          if (this.videoElement.readyState >= 1) {
            this.videoElement.currentTime = state.currentTime;
          } else {
            this.videoElement.addEventListener('loadedmetadata', () => {
              if (Math.abs(this.videoElement.currentTime - state.currentTime) > 1.0) {
                this.videoElement.currentTime = state.currentTime;
              }
            }, { once: true });
          }
        }

        if (state.isPlaying) {
          this.videoElement.play().catch(() => {});
        } else {
          this.videoElement.pause();
        }
        setTimeout(() => { this.isRemoteSyncing = false; }, 300);
      }
    });

    this.socket.on('playback-sync', (data) => {
      if (!this.videoElement || this.isRemoteSyncing) return;
      
      this.isRemoteSyncing = true;
      
      // LATENCY COMPENSATION: Calculate how long the message took to arrive
      // We use the host's timestamp if available, otherwise server's
      const messageTime = data.hostTime || data.serverTimestamp || Date.now();
      const latencySeconds = Math.max(0, (Date.now() - messageTime) / 1000);
      
      // Compensate: If movie was playing, it advanced by 'latencySeconds' during travel
      const targetTime = data.time + (data.isPlaying ? latencySeconds : 0);
      const timeDiff = Math.abs(this.videoElement.currentTime - targetTime);
      
      console.log(`[VisionSync] Sync Event: ${data.type} (Latency: ${Math.round(latencySeconds * 1000)}ms)`);

      this.isApplyingNetworkState = true;

      if (data.type === 'pause' || data.type === 'waiting') {
        if (!this.videoElement.paused) this.videoElement.pause();
        if (data.type === 'waiting') {
          this.pausedByRemoteBuffer = true;
          this.callChat('showNotification', `Waiting for ${this.peerNames[data.socketId] || 'someone'}... ⏳`);
        }
        if (data.type === 'pause') {
          if (Math.abs(this.videoElement.currentTime - data.time) > 0.5) {
            this.videoElement.currentTime = data.time;
          }
          this.pausedByRemoteBuffer = false;
          this.callChat('showNotification', `Paused by ${this.peerNames[data.socketId] || 'someone'}`);
        }
      } else if (data.type === 'play' || data.type === 'playing') {
        const wasWaiting = this.pausedByRemoteBuffer;
        this.pausedByRemoteBuffer = false;
        
        // DRIFT CORRECTION: Instead of snapping, we "catch up" if the drift is small
        if (timeDiff > 0.3 && timeDiff < 1.5) {
          // If we are behind, speed up slightly. If ahead, slow down.
          const driftRate = targetTime > this.videoElement.currentTime ? 1.05 : 0.95;
          this.videoElement.playbackRate = (data.playbackRate || 1) * driftRate;
          console.log(`[VisionSync] Smoothing drift: Adjusting rate to ${this.videoElement.playbackRate.toFixed(2)}`);
          
          // Reset to normal rate after 1 second
          setTimeout(() => {
            if (this.videoElement) this.videoElement.playbackRate = data.playbackRate || 1;
          }, 1000);
        } else if (timeDiff >= 1.5) {
          // Hard seek only for large gaps
          this.videoElement.currentTime = targetTime;
        }

        if (this.videoElement.paused) {
          this.videoElement.play().catch(() => {});
        }
        
        if (wasWaiting) {
          this.callChat('showNotification', 'Resuming... ▶️');
        } else if (data.type === 'play') {
          this.callChat('showNotification', `Playing by ${this.peerNames[data.socketId] || 'someone'}`);
        }
      } else if (data.type === 'seek' || timeDiff > this.syncThreshold) {
        this.videoElement.currentTime = targetTime;
        if (data.type === 'seek') {
          this.callChat('showNotification', `Seeking by ${this.peerNames[data.socketId] || 'someone'}`);
        }
      }

      // Restore flag after a short delay to ignore the events we just triggered
      setTimeout(() => { this.isApplyingNetworkState = false; }, 200);

      // SYNC PLAYBACK SPEED
      if (data.playbackRate && this.videoElement.playbackRate !== data.playbackRate) {
        this.videoElement.playbackRate = data.playbackRate;
      }
      
      setTimeout(() => { this.isRemoteSyncing = false; }, 300);
    });

    this.socket.on('chat-message', (data) => {
      // PREVENT DUPLICATES: Only add if message is from SOMEONE ELSE
      if (data.senderId !== this.socket.id) {
        this.callChat('addMessage', data.text, false, data.sender, data.replyTo, data.msgId);
      }
    });

    this.socket.on('message-reaction', (data) => {
      this.callChat('addReaction', data.msgId, data.emoji, data.senderId);
    });

    this.socket.on('delete-message', (data) => {
      this.callChat('deleteMessage', data.msgId);
    });

    this.socket.on('emoji-reaction', (data) => {
      this.callChat('triggerEmojiBurst', data.emoji);
    });

    this.socket.on('user-joined', ({ socketId, userName }) => {
      this.peerNames[socketId] = userName;
      this.callChat('addSystemMessage', `${userName} joined`);
      this.updateChatUserList();
    });

    this.socket.on('user-left', ({ socketId, userName }) => {
      delete this.peerNames[socketId];
      this.callChat('addSystemMessage', `${userName} left`);
      this.updateChatUserList();
    });
  }

  broadcast(data) {
    if (!this.socket || !this.socket.connected || this.isApplyingNetworkState) return;

    if (data.type === 'CHAT') {
      this.socket.emit('chat-message', { roomId: this.currentRoomId, ...data });
    } else if (data.type === 'EMOJI') {
      this.socket.emit('emoji-reaction', { roomId: this.currentRoomId, emoji: data.emoji });
    } else if (data.type === 'MESSAGE_REACTION') {
      this.socket.emit('message-reaction', { roomId: this.currentRoomId, ...data });
    } else if (data.type === 'DELETE_MESSAGE') {
      this.socket.emit('delete-message', { roomId: this.currentRoomId, msgId: data.msgId });
    } else if (['play', 'pause', 'seek', 'waiting', 'playing', 'ratechange'].includes(data.type)) {
      this.socket.emit('playback-sync', {
        roomId: this.currentRoomId,
        type: data.type,
        time: data.time || (this.videoElement ? this.videoElement.currentTime : 0),
        isPlaying: data.type === 'play' || data.type === 'playing',
        playbackRate: this.videoElement ? this.videoElement.playbackRate : 1,
        hostTime: Date.now() // Send local timestamp for latency calculation
      });
    }
  }

  joinRoom(roomId, userName, isCreate, movieUrl, callback) {
    this.currentRoomId = roomId;
    this.currentUserName = userName;
    this.isHost = isCreate;
    
    this.socket.emit('join-room', roomId, userName, { isCreate, sessionId: this.sessionId, movieUrl }, (response) => {
      if (response && response.error) {
        // If room doesn't exist, don't show UI
        this.currentRoomId = null;
        if (callback) callback(response);
      } else {
        // Success: UI TRIGGER
        this.hasJoinedOnce = true;
        this.callChat('setRoomInfo', roomId, userName);
        this.callChat('addSystemMessage', `${userName} joined`);
        this.findVideoElement();
        if (callback) callback({ success: true });
      }
    });
  }

  leaveRoom() {
    if (this.socket) {
      this.socket.emit('leave-room', this.currentRoomId);
      this.currentRoomId = null;
      this.hasJoinedOnce = false;
    }
  }

  updateChatUserList() {
    // PREVENT DUPLICATES: Use a Set to ensure unique names in the UI
    const uniqueNames = new Set(Object.values(this.peerNames));
    const names = Array.from(uniqueNames);
    
    // Include yourself
    names.unshift(this.currentUserName + " (You)");
    this.callChat('updateOnlineUsers', names);
  }

  findVideoElement() {
    const isYouTube = window.location.hostname.includes('youtube.com');

    if (isYouTube) {
      // YouTube has multiple video elements (ads + real player).
      // Target the one inside the main player container.
      const playerContainer = document.querySelector('#movie_player, .html5-video-player');
      if (playerContainer) {
        this.videoElement = playerContainer.querySelector('video');
      }
      // Fallback: pick the video with the longest duration (ads are short)
      if (!this.videoElement) {
        const all = Array.from(document.querySelectorAll('video'));
        this.videoElement = all.sort((a, b) => (b.duration || 0) - (a.duration || 0))[0] || null;
      }
    } else {
      this.videoElement = document.querySelector('video');
    }

    if (this.videoElement) {
      this.attachVideoListeners();
    }
  }

  isYouTubeAdPlaying() {
    return !!document.querySelector('.ad-showing, .ytp-ad-player-overlay');
  }

  attachVideoListeners() {
    if (!this.videoElement) return;

    this.videoElement.addEventListener('play', () => {
      if (!this.isRemoteSyncing && !this.isYouTubeAdPlaying()) {
        this.broadcast({ type: 'play', time: this.videoElement.currentTime });
      }
    });

    this.videoElement.addEventListener('pause', () => {
      if (!this.isRemoteSyncing && !this.isYouTubeAdPlaying()) {
        this.broadcast({ type: 'pause', time: this.videoElement.currentTime });
      }
    });

    this.videoElement.addEventListener('seeking', () => {
      if (!this.isRemoteSyncing && !this.isYouTubeAdPlaying()) {
        this.broadcast({ type: 'seek', time: this.videoElement.currentTime });
      }
    });

    // BUFFER LOCK: Pause others when one user buffers
    this.videoElement.addEventListener('waiting', () => {
      if (!this.isRemoteSyncing && !this.isYouTubeAdPlaying()) {
        this.broadcast({ type: 'waiting', time: this.videoElement.currentTime });
      }
    });

    // AUTO RESUME: Notify others when buffering finishes
    this.videoElement.addEventListener('playing', () => {
      if (!this.isRemoteSyncing && !this.isYouTubeAdPlaying()) {
        this.broadcast({ type: 'playing', time: this.videoElement.currentTime });
      }
    });

    // SPEED SYNC: Sync playback speed changes
    this.videoElement.addEventListener('ratechange', () => {
      if (!this.isRemoteSyncing && !this.isYouTubeAdPlaying()) {
        this.broadcast({ type: 'ratechange', time: this.videoElement.currentTime });
      }
    });
  }

  startVideoObserver() {
    const observer = new MutationObserver(() => {
      if (!this.videoElement) this.findVideoElement();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

// Global initialization
window.visionSyncEngine = new SyncEngine();
