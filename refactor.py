import re

with open('scripts/sync-engine.js', 'r') as f:
    content = f.read()

# Add callChat helper at the end of the constructor
content = content.replace('this.initSocket();', '''this.initSocket();

    // Listen for cross-frame engine commands
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'RELAY_TO_ENGINE') {
        if (typeof this[message.method] === 'function') {
          this[message.method](...message.args);
        }
      }
    });''')

# Add callChat method inside SyncEngine class
content = content.replace('initSession() {', '''callChat(method, ...args) {
    if (window.visionSyncChat) {
      window.visionSyncChat[method](...args);
    } else {
      chrome.runtime.sendMessage({ type: 'RELAY_TO_CHAT', method, args });
    }
  }

  initSession() {''')

# Send socket id to chat
content = content.replace('console.log(\'[VisionSync] Socket Connected:\', this.socket.id);', '''console.log('[VisionSync] Socket Connected:', this.socket.id);
      this.callChat('setSocketId', this.socket.id);''')

# Replace exact chunks
content = content.replace('''if (window.visionSyncChat) window.visionSyncChat.showNotification('Connection Restored! ⚡');''',
'''this.callChat('showNotification', 'Connection Restored! ⚡');''')

content = content.replace('''if (window.visionSyncChat) window.visionSyncChat.showNotification('Room Restored! 🏰');''',
'''this.callChat('showNotification', 'Room Restored! 🏰');''')

content = content.replace('''if (window.visionSyncChat && this.currentRoomId) {
        window.visionSyncChat.showNotification('Reconnecting... ⏳');
      }''',
'''if (this.currentRoomId) {
        this.callChat('showNotification', 'Reconnecting... ⏳');
      }''')

content = content.replace('''if (window.visionSyncChat) {
            window.visionSyncChat.showNotification(`Waiting for ${this.peerNames[data.socketId] || 'someone'}... ⏳`);
          }''', '''this.callChat('showNotification', `Waiting for ${this.peerNames[data.socketId] || 'someone'}... ⏳`);''')

content = content.replace('''if (window.visionSyncChat) {
            window.visionSyncChat.showNotification(`Paused by ${this.peerNames[data.socketId] || 'someone'}`);
          }''', '''this.callChat('showNotification', `Paused by ${this.peerNames[data.socketId] || 'someone'}`);''')

content = content.replace('''if (window.visionSyncChat) {
          if (wasWaiting) {
            window.visionSyncChat.showNotification('Resuming... ▶️');
          } else if (data.type === 'play') {
            window.visionSyncChat.showNotification(`Playing by ${this.peerNames[data.socketId] || 'someone'}`);
          }
        }''', '''if (wasWaiting) {
          this.callChat('showNotification', 'Resuming... ▶️');
        } else if (data.type === 'play') {
          this.callChat('showNotification', `Playing by ${this.peerNames[data.socketId] || 'someone'}`);
        }''')

content = content.replace('''if (window.visionSyncChat && data.type === 'seek') {
          window.visionSyncChat.showNotification(`Seeking by ${this.peerNames[data.socketId] || 'someone'}`);
        }''', '''if (data.type === 'seek') {
          this.callChat('showNotification', `Seeking by ${this.peerNames[data.socketId] || 'someone'}`);
        }''')

# Socket chat listeners
content = content.replace('''this.socket.on('chat-message', (data) => {
      if (window.visionSyncChat) {
        // PREVENT DUPLICATES: Only add if message is from SOMEONE ELSE
        if (data.senderId !== this.socket.id) {
          window.visionSyncChat.addMessage(data.text, false, data.sender, data.replyTo, data.msgId);
        }
      }
    });''', '''this.socket.on('chat-message', (data) => {
      // PREVENT DUPLICATES: Only add if message is from SOMEONE ELSE
      if (data.senderId !== this.socket.id) {
        this.callChat('addMessage', data.text, false, data.sender, data.replyTo, data.msgId);
      }
    });''')

content = content.replace('''this.socket.on('message-reaction', (data) => {
      if (window.visionSyncChat) {
        // Find the EXACT bubble using unique msgId
        const bubble = window.visionSyncChat.shadowRoot.querySelector(`[data-msg-id="${data.msgId}"]`);
        if (bubble) {
          window.visionSyncChat.addReactionToBubble(bubble, data.emoji, data.senderId);
          // Also sync the icon state if it's MINE (this part is tricky, usually handled by addReactionToBubble's render)
        }
      }
    });''', '''this.socket.on('message-reaction', (data) => {
      this.callChat('addReaction', data.msgId, data.emoji, data.senderId);
    });''')

content = content.replace('''this.socket.on('delete-message', (data) => {
      if (window.visionSyncChat) {
        const bubble = window.visionSyncChat.shadowRoot.querySelector(`[data-msg-id="${data.msgId}"]`);
        if (bubble) bubble.remove();
      }
    });''', '''this.socket.on('delete-message', (data) => {
      this.callChat('deleteMessage', data.msgId);
    });''')

content = content.replace('''this.socket.on('emoji-reaction', (data) => {
      if (window.visionSyncChat) {
        window.visionSyncChat.triggerEmojiBurst(data.emoji);
      }
    });''', '''this.socket.on('emoji-reaction', (data) => {
      this.callChat('triggerEmojiBurst', data.emoji);
    });''')

content = content.replace('''this.socket.on('user-joined', ({ socketId, userName }) => {
      this.peerNames[socketId] = userName;
      if (window.visionSyncChat) {
        window.visionSyncChat.addSystemMessage(`${userName} joined`);
        this.updateChatUserList();
      }
    });''', '''this.socket.on('user-joined', ({ socketId, userName }) => {
      this.peerNames[socketId] = userName;
      this.callChat('addSystemMessage', `${userName} joined`);
      this.updateChatUserList();
    });''')

content = content.replace('''this.socket.on('user-left', ({ socketId, userName }) => {
      delete this.peerNames[socketId];
      if (window.visionSyncChat) {
        window.visionSyncChat.addSystemMessage(`${userName} left`);
        this.updateChatUserList();
      }
    });''', '''this.socket.on('user-left', ({ socketId, userName }) => {
      delete this.peerNames[socketId];
      this.callChat('addSystemMessage', `${userName} left`);
      this.updateChatUserList();
    });''')

# In joinRoom
content = content.replace('''// Success: UI TRIGGER
        this.hasJoinedOnce = true;
        if (window.visionSyncChat) {
          window.visionSyncChat.setRoomInfo(roomId, userName);
          window.visionSyncChat.addSystemMessage(`${userName} joined`);
        }''', '''// Success: UI TRIGGER
        this.hasJoinedOnce = true;
        this.callChat('setRoomInfo', roomId, userName);
        this.callChat('addSystemMessage', `${userName} joined`);''')

# In updateChatUserList
content = content.replace('''updateChatUserList() {
    if (window.visionSyncChat) {
      // PREVENT DUPLICATES: Use a Set to ensure unique names in the UI
      const uniqueNames = new Set(Object.values(this.peerNames));
      const names = Array.from(uniqueNames);
      
      // Include yourself
      names.unshift(this.currentUserName + " (You)");
      window.visionSyncChat.updateOnlineUsers(names);
    }
  }''', '''updateChatUserList() {
    // PREVENT DUPLICATES: Use a Set to ensure unique names in the UI
    const uniqueNames = new Set(Object.values(this.peerNames));
    const names = Array.from(uniqueNames);
    
    // Include yourself
    names.unshift(this.currentUserName + " (You)");
    this.callChat('updateOnlineUsers', names);
  }''')

# Add DELETE_MESSAGE to broadcast
content = content.replace('''} else if (data.type === 'MESSAGE_REACTION') {
      this.socket.emit('message-reaction', { roomId: this.currentRoomId, ...data });
    } else if (['play', 'pause', 'seek', 'waiting', 'playing', 'ratechange'].includes(data.type)) {''',
'''} else if (data.type === 'MESSAGE_REACTION') {
      this.socket.emit('message-reaction', { roomId: this.currentRoomId, ...data });
    } else if (data.type === 'DELETE_MESSAGE') {
      this.socket.emit('delete-message', { roomId: this.currentRoomId, msgId: data.msgId });
    } else if (['play', 'pause', 'seek', 'waiting', 'playing', 'ratechange'].includes(data.type)) {''')

with open('scripts/sync-engine.js', 'w') as f:
    f.write(content)

