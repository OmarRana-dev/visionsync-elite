// ghost-chat.js: Shadow DOM UI, Dual-State (Dock & Chat), WhatsApp-Style, Full-Screen Reactions
class GhostChat {
  constructor() {
    this.container = null;
    this.shadowRoot = null;
    this.chatBody = null;
    this.chatContainer = null;
    this.unreadBadge = null;
    this.unreadCount = 0;
    this.roomId = '';
    this.lastUserName = 'You';

    this.init();
    console.log('[VisionSync Elite] GhostChat UI initialized');
  }

  init() {
    this.container = document.createElement('div');
    this.container.id = 'visionSync-ghost-container';

    // Inject into the highest layer
    const attachTarget = document.fullscreenElement || document.body;
    attachTarget.appendChild(this.container);

    this.shadowRoot = this.container.attachShadow({ mode: 'open' });
    this.render();
    this.localSocketId = 'local';

    this.currentUserEmail = '';
    this.currentUserTheme = '';
    this.currentUserRole = '';

    chrome.storage.local.get(['vsUser'], (res) => {
      if (res.vsUser) {
        this.currentUserEmail = res.vsUser.email || '';
        this.currentUserTheme = res.vsUser.theme || '';
        this.currentUserRole = res.vsUser.role || '';
      }
    });

    this.setupDrag();
    this.setupListeners();
    this.setupEmojiReactions();
    
    // Listen for cross-frame relay messages
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'RELAY_TO_CHAT') {
        if (typeof this[message.method] === 'function') {
          this[message.method](...message.args);
        }
      }
    });
  }

  callEngine(method, ...args) {
    if (window.visionSyncEngine) {
      window.visionSyncEngine[method](...args);
    } else {
      chrome.runtime.sendMessage({ type: 'RELAY_TO_ENGINE', method, args });
    }
  }

  setSocketId(id) {
    this.localSocketId = id;
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          top: 0;
          left: 0;
          z-index: 2147483647;
          pointer-events: none;
          display: none;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        :host(.active) {
          display: block;
        }

        /* --- Floating Dock (State A) --- */
        #visionSync-dock {
          position: fixed;
          right: 20px;
          top: 50%;
          transform: translateY(-50%);
          width: 50px;
          background: rgba(15, 15, 19, 0.35);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 25px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
          padding: 24px 0;
          box-shadow: 0 10px 40px rgba(0,0,0,0.6);
          pointer-events: auto;
          border: 1px solid rgba(255, 255, 255, 0.1);
          transition: all 0.4s cubic-bezier(0.19, 1, 0.22, 1);
        }
        .dock-icon {
          width: 26px;
          height: 26px;
          cursor: pointer;
          color: rgba(255, 255, 255, 0.5);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .dock-icon:hover {
          color: #fff;
          transform: scale(1.15) rotate(2deg);
        }
        .dock-icon svg {
          width: 100%;
          height: 100%;
        }
        .dock-icon.active {
          color: #e52e71;
          filter: drop-shadow(0 0 10px rgba(229, 46, 113, 0.5));
        }
        .dock-icon.muted {
          color: rgba(255, 255, 255, 0.4);
        }
        .dock-icon.exit {
          color: #ff4b2b;
          margin-top: 10px;
        }
        .dock-icon.exit:hover {
          color: #ff2a6d;
          transform: scale(1.1) translateX(-2px);
        }
        
        /* --- Active Chat Box (State B) --- */
        #chat-container {
          position: fixed;
          bottom: 30px;
          right: 90px;
          width: 330px;
          height: 500px;
          background: rgba(18, 18, 22, 0.85);
          backdrop-filter: blur(20px);
          border-radius: 20px;
          display: none;
          flex-direction: column;
          box-shadow: 0 20px 50px rgba(0,0,0,0.7);
          pointer-events: auto;
          border: 1px solid rgba(255, 255, 255, 0.08);
          overflow: hidden;
          transition: all 0.4s cubic-bezier(0.19, 1, 0.22, 1);
          transform: translateY(10px) scale(0.95);
          opacity: 0;
        }
        #chat-container.visible {
          display: flex;
          transform: translateY(0) scale(1);
          opacity: 1;
        }
        :host(.fullscreen) #chat-container {
          background: transparent !important;
          backdrop-filter: none !important;
          border: none !important;
          box-shadow: none !important;
        }
        :host(.fullscreen) #chat-header {
          background: rgba(18, 18, 22, 0.7) !important;
          backdrop-filter: blur(10px);
        }
        :host(.fullscreen) #online-users-container {
          background: rgba(18, 18, 22, 0.6) !important;
          backdrop-filter: blur(10px);
        }
        :host(.fullscreen) #chat-input-container {
          background: rgba(18, 18, 22, 0.7) !important;
          backdrop-filter: blur(10px);
        }

        #chat-header {
          padding: 14px 18px;
          background: rgba(255, 255, 255, 0.03);
          display: flex;
          flex-direction: column;
          align-items: center;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          cursor: grab;
        }
        #chat-header:active {
          cursor: grabbing;
        }
        #chat-container {
          position: fixed;
          bottom: 30px;
          right: 90px;
          width: 330px;
          height: 520px;
          background: rgba(18, 18, 22, 0.35);
          backdrop-filter: blur(25px) saturate(160%);
          -webkit-backdrop-filter: blur(25px) saturate(160%);
          border-radius: 20px;
          display: none;
          flex-direction: column;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5);
          pointer-events: auto;
          border: 1px solid rgba(255, 255, 255, 0.1);
          overflow: hidden;
          transition: transform 0.4s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.4s;
          transform: translateY(10px) scale(0.95);
          opacity: 0;
        }
        #chat-container.visible {
          display: flex;
          transform: translateY(0) scale(1);
          opacity: 1;
        }
        #chat-container.dragging {
          user-select: none;
        }
        .header-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
        }
        #online-users-container {
          padding: 8px 14px;
          background: rgba(255, 255, 255, 0.02);
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        #online-users {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
        }
        .notification {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.4);
          text-align: center;
          margin: 8px 0;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding-top: 8px;
        }
        .online-label {
          font-size: 9px;
          color: rgba(255, 255, 255, 0.45);
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-right: 2px;
        }
        .user-tag {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 10px;
          letter-spacing: 0.3px;
        }
        .header-btn {
          font-size: 10px;
          font-weight: 900;
          color: rgba(255, 255, 255, 0.4);
          cursor: pointer;
          transition: all 0.2s;
          letter-spacing: 0.5px;
        }
        .header-btn:hover {
          color: #fff;
          text-shadow: 0 0 8px #fff;
        }

        #chat-body {
          flex-grow: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          scrollbar-width: none;
          scroll-behavior: smooth;
        }
        #chat-body::-webkit-scrollbar {
          display: none;
        }

        /* --- WhatsApp Bubbles --- */
        .bubble {
          max-width: 82%;
          padding: 12px 16px;
          font-size: 13.5px;
          line-height: 1.5;
          position: relative;
          box-shadow: 0 4px 15px rgba(0,0,0,0.2);
          font-weight: 500;
        }
        .bubble.local {
          align-self: flex-end;
          background: linear-gradient(135deg, #054640, #075e54);
          color: #fff;
          border-radius: 18px 18px 4px 18px;
        }
        .bubble.remote {
          align-self: flex-start;
          background: #202c33;
          color: #fff;
          border-radius: 18px 18px 18px 4px;
        }
        .remote-name {
          font-size: 10px;
          font-weight: 800;
          color: #00a884;
          margin-bottom: 4px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        /* --- Rapunzel Premium Profile Easter Egg --- */
        .bubble.magic {
          background: linear-gradient(135deg, rgba(162,110,212,0.9), rgba(255,204,112,0.9)) !important;
          box-shadow: 0 4px 15px rgba(162,110,212,0.5) !important;
          color: #fff !important;
          border: 1px solid rgba(255,255,255,0.5) !important;
          text-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
          position: relative;
        }
        .bubble.magic::after {
          content: '🐰';
          position: absolute;
          bottom: -8px;
          right: -8px;
          font-size: 14px;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .remote-name.magic {
          color: #ffe4b5 !important;
          font-weight: 800;
        }
        .bubble.magic.local::after {
          right: auto;
          left: -8px;
        }

        /* --- Developer & Co Owner Theme --- */
        .bubble.owner-dev {
          background: linear-gradient(135deg, rgba(229, 46, 113, 0.9), rgba(255, 138, 0, 0.9)) !important;
          box-shadow: 0 4px 15px rgba(229, 46, 113, 0.5) !important;
          color: #fff !important;
          border: 1px solid rgba(255,255,255,0.5) !important;
          text-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
          position: relative;
        }
        .bubble.owner-dev::after {
          content: '👑';
          position: absolute;
          bottom: -8px;
          right: -8px;
          font-size: 14px;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .remote-name.owner-dev {
          color: #fff4e6 !important;
          font-weight: 900;
          letter-spacing: 1px;
        }
        .bubble.owner-dev.local::after {
          right: auto;
          left: -8px;
        }

        /* --- Reaction Bar --- */
        #reaction-bar {
          display: flex;
          justify-content: space-around;
          padding: 10px 14px;
          background: rgba(0, 0, 0, 0.3);
          border-top: 1px solid rgba(255, 255, 255, 0.05);
        }
        .reaction-item {
          font-size: 22px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .reaction-item:hover {
          transform: scale(1.4) translateY(-4px);
        }

        /* --- Input Area --- */
        #chat-input-container {
          padding: 14px 18px;
          background: rgba(10, 10, 12, 0.6);
          display: flex;
          gap: 12px;
          align-items: center;
        }
        #chat-input {
          flex-grow: 1;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 24px;
          padding: 10px 20px;
          color: #fff;
          font-size: 14px;
          outline: none;
          transition: all 0.3s;
        }
        #chat-input:focus {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.25);
        }

        /* Notifications */
        .notification {
          align-self: center;
          font-size: 10px;
          color: rgba(255, 255, 255, 0.35);
          background: rgba(255, 255, 255, 0.04);
          padding: 4px 12px;
          border-radius: 12px;
          margin: 4px 0;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          font-weight: bold;
        }



        /* Emoji particle effect */
        .emoji-particle {
          position: fixed;
          font-size: 32px;
          pointer-events: none;
          z-index: 2147483647;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));
          animation: floatUpBurst 3s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          opacity: 0;
        }
        @keyframes floatUpBurst {
          0% { transform: translateY(0) scale(0) rotate(0deg); opacity: 0; }
          20% { transform: translateY(-40px) scale(1.4) rotate(15deg); opacity: 1; }
          100% { transform: translateY(-500px) scale(0.6) rotate(-25deg); opacity: 0; }
        }

        /* --- BTS V (Taehyung) Theme --- */
        .bubble.bts {
          background: linear-gradient(135deg, #7b2ff7 0%, #b19cd9 100%) !important;
          color: white !important;
          border-bottom-left-radius: 4px;
          box-shadow: 0 4px 15px rgba(123, 47, 247, 0.4);
          position: relative;
        }
        .bubble.bts.local {
          border-bottom-left-radius: 18px;
          border-bottom-right-radius: 4px;
        }
        .remote-name.bts {
          color: #d1b3ff !important;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .bubble.bts::after {
          content: '🐻';
          position: absolute;
          bottom: -8px;
          right: -8px;
          font-size: 14px;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .bubble.bts.local::after {
          right: auto;
          left: -8px;
        }

        /* --- Floating Toast Notifications --- */
        #toast-container {
          position: fixed;
          top: 30px;
          right: 30px;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 10px;
          z-index: 2147483647;
          pointer-events: none;
        }
        .toast {
          background: rgba(15, 15, 19, 0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #fff;
          padding: 12px 20px;
          border-radius: 16px;
          font-size: 13px;
          font-weight: 600;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          gap: 12px;
          pointer-events: auto;
          animation: toastIn 0.5s cubic-bezier(0.19, 1, 0.22, 1) forwards,
                     toastOut 0.4s cubic-bezier(0.19, 1, 0.22, 1) 2.5s forwards;
        }
        @keyframes toastIn {
          from { transform: translateX(50px) scale(0.9); opacity: 0; }
          to { transform: translateX(0) scale(1); opacity: 1; }
        }
        @keyframes toastOut {
          to { transform: translateX(30px) scale(0.95); opacity: 0; }
        }

        /* --- Bubble Actions & Replies --- */
        .bubble { 
          position: relative; 
          padding-bottom: 24px !important; /* Make room for icons at bottom */
          min-width: 80px;
        }
        .bubble-actions {
          position: absolute;
          bottom: 4px;
          right: 8px;
          display: flex;
          gap: 8px;
          opacity: 0.6;
          transition: opacity 0.2s;
          z-index: 10;
        }
        .bubble:hover .bubble-actions { opacity: 1; }
        
        .action-icon {
          cursor: pointer;
          transition: all 0.2s;
          color: rgba(255,255,255,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .action-icon:hover { color: #fff; transform: scale(1.1); }
        .action-icon.active { color: #ff3b30 !important; }
        .action-icon svg { width: 14px; height: 14px; stroke-width: 2.5; }
        
        .reply-box {
          background: rgba(255,255,255,0.08);
          border-left: 3px solid #e52e71;
          padding: 6px 10px;
          border-radius: 6px;
          margin-bottom: 8px;
          font-size: 11px;
          max-width: 100%;
        }
        .reply-name { font-weight: 900; color: #e52e71; font-size: 9px; text-transform: uppercase; margin-bottom: 2px; }
        .reply-msg { opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        #reply-preview-bar {
          display: none;
          background: rgba(20, 20, 25, 0.98);
          border-top: 2px solid #e52e71;
          padding: 12px 18px;
          align-items: center;
          justify-content: space-between;
          animation: slideUp 0.3s cubic-bezier(0.19, 1, 0.22, 1) forwards;
        }
        #reply-preview-bar.visible { display: flex; }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }

        .reaction-badge-container {
          position: absolute;
          bottom: -12px;
          left: 12px;
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
          z-index: 11;
        }
        .reaction-badge {
          background: rgba(30, 30, 35, 0.95);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 12px;
          padding: 2px 8px;
          font-size: 11px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          display: flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
        }
        .reaction-badge.mine {
          border-color: #e52e71;
          background: rgba(229, 46, 113, 0.2);
        }

        /* --- Reaction Picker --- */
        .reaction-picker {
          position: absolute;
          top: -45px;
          background: rgba(20, 20, 25, 0.98);
          backdrop-filter: blur(15px);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 20px;
          padding: 8px 14px;
          display: none;
          gap: 12px;
          z-index: 1000;
          box-shadow: 0 10px 40px rgba(0,0,0,0.8);
          animation: popIn 0.3s cubic-bezier(0.19, 1, 0.22, 1) forwards;
          white-space: nowrap;
        }
        .remote .reaction-picker { left: 0; }
        .local .reaction-picker { right: 0; }
        .reaction-picker.visible { display: flex; }
        @keyframes popIn { from { transform: scale(0.5) translateY(20px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
        
        .picker-emoji { cursor: pointer; font-size: 22px; transition: transform 0.2s; }
        .picker-emoji:hover { transform: scale(1.4); }

      </style>

      <div id="toast-container"></div>

      <div id="visionSync-dock">
        <div class="dock-icon" id="copy-room-btn" title="Copy Room URL">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
        </div>
        <div class="dock-icon muted" id="toggle-chat-btn" title="Toggle Chat">
          <!-- Chat Closed SVG (Gray + Slash) -->
          <svg id="chat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            <line x1="3" y1="3" x2="21" y2="21" stroke="rgba(255,255,255,0.4)" stroke-width="2.5"></line>
          </svg>
          <span id="unread-badge" style="display:none; position:absolute; top: -8px; right: -8px; background: #ff0000; color: #fff; min-width: 18px; height: 18px; border-radius: 9px; font-size: 10px; align-items: center; justify-content: center; font-weight: 900; box-shadow: 0 2px 6px rgba(255,0,0,0.4); border: 2px solid #0f0f13;">0</span>
        </div>
        <div class="dock-icon exit" id="exit-room-btn" title="Exit Room and Cleanup">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
        </div>
      </div>

      <div id="chat-container">
        <div id="chat-header">
          <div class="header-top">
            <span class="header-btn" id="minimize-btn">MINIMIZE</span>
            <span style="font-size: 11px; color: rgba(255,255,255,0.9); font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase;">VisionSync <span style="color:#e52e71">Elite</span></span>
            <span class="header-btn" id="share-link-btn">SHARE</span>
          </div>
        </div>
        <div id="online-users-container">
          <div id="online-users" title="Online Users">🟢 Only You</div>
        </div>
        <div id="chat-body"></div>
        <div id="reaction-bar">
          <span class="reaction-item" data-emoji="❤️">❤️</span>
          <span class="reaction-item" data-emoji="😂">😂</span>
          <span class="reaction-item" data-emoji="🔥">🔥</span>
          <span class="reaction-item" data-emoji="👀">👀</span>
          <span class="reaction-item" data-emoji="🍿">🍿</span>
          <span class="reaction-item" data-emoji="💯">💯</span>
          <span class="reaction-item" data-emoji="✨">✨</span>
          <span class="reaction-item" data-emoji="😮">😮</span>
          <span class="reaction-item" data-emoji="😍">😍</span>
          <span class="reaction-item" data-emoji="👏">👏</span>
        </div>
        <div id="reply-preview-bar">
          <div style="flex-grow:1">
            <div id="reply-to-name" style="color:#e52e71; font-size:10px; font-weight:900; text-transform:uppercase">Replying to Jennie</div>
            <div id="reply-to-msg" style="color:rgba(255,255,255,0.6); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">Message preview...</div>
          </div>
          <span id="cancel-reply-btn" style="cursor:pointer; padding:5px; font-size:12px">✕</span>
        </div>
        <div id="chat-input-container">
          <input type="text" id="chat-input" placeholder="Type a message..." autocomplete="off">
        </div>
      </div>


    `;

    this.chatBody = this.shadowRoot.getElementById('chat-body');
    this.chatContainer = this.shadowRoot.getElementById('chat-container');
    this.unreadBadge = this.shadowRoot.getElementById('unread-badge');

    // Adaptive Fullscreen handler
    document.addEventListener('fullscreenchange', () => {
      const fsEl = document.fullscreenElement;
      if (fsEl) {
        fsEl.appendChild(this.container);
        this.container.classList.add('fullscreen');
      } else {
        document.body.appendChild(this.container);
        this.container.classList.remove('fullscreen');
      }
    });

    this.unreadCount = 0;
    this.roomId = '';
  }

  setupDrag() {
    const container = this.chatContainer;
    let isDragging = false;
    let initialX, initialY, xOffset = 0, yOffset = 0;

    const dragStart = (e) => {
      // Prevent drag when clicking buttons or input
      const interactive = e.target.closest('input, .header-btn, .reaction-item, #chat-body');
      if (interactive) return;

      e.preventDefault(); // Stop text selection
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
      isDragging = true;
      container.classList.add('dragging');
    };
    const dragEnd = () => {
      isDragging = false;
      container.classList.remove('dragging');
    };
    const drag = (e) => {
      if (isDragging) {
        e.preventDefault();
        xOffset = e.clientX - initialX;
        yOffset = e.clientY - initialY;
        container.style.transform = `translate3d(${xOffset}px, ${yOffset}px, 0)`;
      }
    };

    this.shadowRoot.getElementById('chat-header').addEventListener('mousedown', dragStart);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('mousemove', drag);
  }

  setupListeners() {
    const input = this.shadowRoot.getElementById('chat-input');
    const toggleChatBtn = this.shadowRoot.getElementById('toggle-chat-btn');
    const micBtn = this.shadowRoot.getElementById('toggle-mic-btn');
    const copyBtn = this.shadowRoot.getElementById('copy-room-btn');
    const exitBtn = this.shadowRoot.getElementById('exit-room-btn');
    const minBtn = this.shadowRoot.getElementById('minimize-btn');
    const shareBtn = this.shadowRoot.getElementById('share-link-btn');

    input.addEventListener('keypress', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim() !== '') {
        const text = input.value.trim();
        const msgId = 'msg-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

        // Add locally immediately
        this.addMessage(text, true, '', this.currentReply, msgId, this.currentUserEmail, this.currentUserTheme);

        if (text) {
          this.callEngine('broadcast', {
            type: 'CHAT',
            text: text,
            sender: this.lastUserName,
            userEmail: this.currentUserEmail || '',
            userTheme: this.currentUserTheme || '',
            replyTo: this.currentReply,
            msgId: msgId
          });
        }
        input.value = '';
        this.currentReply = null;
        this.shadowRoot.getElementById('reply-preview-bar').classList.remove('visible');
      }
    });

    // Cancel Reply Listener
    this.shadowRoot.getElementById('cancel-reply-btn').addEventListener('click', () => {
      this.currentReply = null;
      this.shadowRoot.getElementById('reply-preview-bar').classList.remove('visible');
    });

    input.addEventListener('keydown', (e) => e.stopPropagation());

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'UI_CLEANUP') this.cleanup();
    });

    toggleChatBtn.addEventListener('click', () => {
      const isVisible = this.chatContainer.classList.toggle('visible');
      const chatSvg = this.shadowRoot.getElementById('chat-svg');
      if (isVisible) {
        this.clearUnreadBadge();
        toggleChatBtn.classList.add('active');
        toggleChatBtn.classList.remove('muted');
        // Remove slash line
        chatSvg.innerHTML = `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>`;
      } else {
        toggleChatBtn.classList.remove('active');
        toggleChatBtn.classList.add('muted');
        // Add slash line
        chatSvg.innerHTML = `
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          <line x1="3" y1="3" x2="21" y2="21" stroke="rgba(255,255,255,0.4)" stroke-width="2.5"></line>
        `;
      }
    });

    minBtn.addEventListener('click', () => {
      this.chatContainer.classList.remove('visible');
      toggleChatBtn.classList.remove('active');
      toggleChatBtn.classList.add('muted');
      const chatSvg = this.shadowRoot.getElementById('chat-svg');
      chatSvg.innerHTML = `
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        <line x1="3" y1="3" x2="21" y2="21" stroke="rgba(255,255,255,0.4)" stroke-width="2.5"></line>
      `;
    });

    const copyFunc = () => {
      const url = this.roomId || window.location.href;
      navigator.clipboard.writeText(url).then(() => this.showNotification('URL Copied!'));
    };
    copyBtn.addEventListener('click', copyFunc);
    shareBtn.addEventListener('click', copyFunc);

    exitBtn.addEventListener('click', () => {
      if (confirm('Leave this watch party and cleanup room state?')) this.cleanup();
    });
  }

  cleanup() {
    this.container.classList.remove('active');

    // Clear chat payload and UI state
    this.chatBody.innerHTML = '';
    this.clearUnreadBadge();

    // Hide chat box panel securely
    this.chatContainer.classList.remove('visible');
    const toggleChatBtn = this.shadowRoot.getElementById('toggle-chat-btn');
    toggleChatBtn.classList.remove('active');
    toggleChatBtn.classList.add('muted');
    const chatSvg = this.shadowRoot.getElementById('chat-svg');
    chatSvg.innerHTML = `
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      <line x1="3" y1="3" x2="21" y2="21" stroke="rgba(255,255,255,0.4)" stroke-width="2.5"></line>
    `;

    this.callEngine('leaveRoom');
    chrome.storage.local.remove(['currentRoomId', 'isJoined']);
    // Do NOT remove the shadow DOM container so it can be reused on rejoin
    console.log('[VisionSync Elite] UI Cleaned up securely without unmounting');
  }

  setRoomInfo(roomId, userName) {
    this.roomId = roomId;
    this.lastUserName = userName;
    this.container.classList.add('active');

    // Ensure UI is visible in Full Screen
    const handleFullScreen = () => {
      const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsElement) {
        fsElement.appendChild(this.container);
      } else {
        document.body.appendChild(this.container);
      }
    };
    document.addEventListener('fullscreenchange', handleFullScreen);
    document.addEventListener('webkitfullscreenchange', handleFullScreen);
    handleFullScreen(); // Initial check

    // Rapunzel Dock & Chat Overhaul if VIP
    const dock = this.shadowRoot.getElementById('visionSync-dock');
    const chatContainer = this.shadowRoot.getElementById('chat-container');
    const isMagic = userName && userName.match(/abeera|jennie/i);
    const isBTS = userName && userName.match(/rose|ayesha/i);

    if (isMagic) {
      dock.style.background = 'rgba(128, 77, 168, 0.45)';
      dock.style.boxShadow = '0 10px 40px rgba(162,110,212,0.8)';
      dock.style.border = '1px solid rgba(255,204,112,0.6)';

      chatContainer.style.background = 'rgba(128, 77, 168, 0.35)';
      chatContainer.style.border = '1px solid rgba(255,204,112,0.4)';
      chatContainer.style.boxShadow = '0 20px 50px rgba(162,110,212,0.6)';
    } else if (isBTS) {
      dock.style.background = 'rgba(123, 47, 247, 0.45)';
      dock.style.boxShadow = '0 10px 40px rgba(123, 47, 247, 0.8)';
      dock.style.border = '1px solid rgba(177, 156, 217, 0.6)';

      chatContainer.style.background = 'rgba(123, 47, 247, 0.35)';
      chatContainer.style.border = '1px solid rgba(177, 156, 217, 0.4)';
      chatContainer.style.boxShadow = '0 20px 50px rgba(123, 47, 247, 0.6)';
    } else {
      dock.style.background = 'rgba(15, 15, 19, 0.35)';
      dock.style.boxShadow = '0 10px 40px rgba(0,0,0,0.6)';
      dock.style.border = '1px solid rgba(255, 255, 255, 0.1)';

      chatContainer.style.background = 'rgba(18, 18, 22, 0.35)';
      chatContainer.style.border = '1px solid rgba(255, 255, 255, 0.1)';
      chatContainer.style.boxShadow = '0 20px 50px rgba(0,0,0,0.5)';
    }

    this.showNotification('Room Joined');
  }

  setupEmojiReactions() {
    this.shadowRoot.querySelectorAll('.reaction-item').forEach(item => {
      item.addEventListener('click', () => {
        const emoji = item.dataset.emoji;
        this.triggerEmojiBurst(emoji);
        this.callEngine('broadcast', { type: 'EMOJI', emoji });
      });
    });
  }

  addMessage(text, isLocal, senderName = '', replyTo = null, msgId = null, senderEmail = '', senderTheme = '') {
    const bubble = document.createElement('div');
    bubble.classList.add('bubble', isLocal ? 'local' : 'remote');
    bubble.dataset.msgId = msgId || ('msg-' + Date.now());

    // 1. NAME (Remote or VIP Local)
    const trueName = isLocal ? this.lastUserName : senderName;
    const email = isLocal ? this.currentUserEmail : senderEmail;
    const theme = isLocal ? this.currentUserTheme : senderTheme;

    // Matches dynamic theme from database OR fallback to specific hardcoded Gmails
    const isOwnerDev = (theme === 'owner-dev') || (email && email.match(/omarrana190@gmail\.com|simsimboy09@gmail\.com/i));
    const isMagic = (theme === 'magic') || (email && email.match(/abeeraali2468@gmail\.com|abeera@gmail\.com|jennie@gmail\.com|sharifzada586@gmail\.com/i));
    const isBTS = (theme === 'bts') || (email && email.match(/rose@gmail\.com|ayesha@gmail\.com|arhamaroora@gmail\.com/i));

    if (isOwnerDev) bubble.classList.add('owner-dev');
    else if (isMagic) bubble.classList.add('magic');
    else if (isBTS) bubble.classList.add('bts');

    if ((!isLocal && senderName) || (isLocal && (isMagic || isBTS || isOwnerDev))) {
      const nameEl = document.createElement('div');
      nameEl.classList.add('remote-name');
      
      if (isOwnerDev) nameEl.classList.add('owner-dev');
      else if (isMagic) nameEl.classList.add('magic');
      else if (isBTS) nameEl.classList.add('bts');

      if (isLocal) {
        nameEl.style.textAlign = 'right';
        if (isOwnerDev) nameEl.style.color = '#ff6b6b';
        else if (isBTS) nameEl.style.color = '#d1b3ff';
        else if (isMagic) nameEl.style.color = '#ffe4b5';
      }

      if (isOwnerDev) {
        nameEl.textContent = `👑 Developer & Co Owner 👑`;
      } else if (isMagic) {
        nameEl.textContent = `👑 ${trueName} 🐰`;
      } else if (isBTS) {
        nameEl.textContent = `🐻 ${trueName} 💜`;
      } else {
        nameEl.textContent = senderName;
      }
      bubble.appendChild(nameEl);
    }

    // 2. REPLY RENDERING
    if (replyTo) {
      const replyEl = document.createElement('div');
      replyEl.classList.add('reply-box');
      replyEl.innerHTML = `
        <div class="reply-name">${replyTo.sender}</div>
        <div class="reply-msg">${replyTo.text}</div>
      `;
      bubble.appendChild(replyEl);
    }

    // 3. MESSAGE CONTENT
    const msgContent = document.createElement('div');
    msgContent.classList.add('message-text');
    msgContent.textContent = text;
    bubble.appendChild(msgContent);

    // 4. BUBBLE ACTIONS (CUSTOM SVG ICONS)
    const actions = document.createElement('div');
    actions.classList.add('bubble-actions');

    // Multiple Reactions Picker
    const picker = document.createElement('div');
    picker.classList.add('reaction-picker');
    ['❤️', '😂', '🔥', '😮', '👍', '😢'].forEach(emoji => {
      const eBtn = document.createElement('span');
      eBtn.classList.add('picker-emoji');
      eBtn.textContent = emoji;
      eBtn.onclick = (e) => {
        e.stopPropagation();
        const currentEmoji = bubble.dataset.myEmoji;

        // If same emoji, remove it. If different, change it.
        const newEmoji = (currentEmoji === emoji) ? null : emoji;
        bubble.dataset.myEmoji = newEmoji || "";

        this.addReactionToBubble(bubble, newEmoji, 'local');
        picker.classList.remove('visible');

        this.callEngine('broadcast', {
          type: 'MESSAGE_REACTION',
          msgId: bubble.dataset.msgId,
          emoji: newEmoji,
          senderId: this.localSocketId
        });
      };
      picker.appendChild(eBtn);
    });
    bubble.appendChild(picker);

    let deleteHtml = '';
    if (isLocal) {
      deleteHtml = `
        <div class="action-icon delete-btn" title="Delete Message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </div>
      `;
    }

    actions.innerHTML = `
      <div class="action-icon reply-btn" title="Reply">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>
      </div>
      <div class="action-icon react-btn" title="React">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
      </div>
      ${deleteHtml}
    `;
    bubble.appendChild(actions);

    // Click Listeners
    actions.querySelector('.reply-btn').addEventListener('click', () => {
      this.currentReply = { text, sender: isLocal ? 'You' : (senderName || 'Someone') };
      const bar = this.shadowRoot.getElementById('reply-preview-bar');
      this.shadowRoot.getElementById('reply-to-name').textContent = `Replying to ${this.currentReply.sender}`;
      this.shadowRoot.getElementById('reply-to-msg').textContent = text;
      bar.classList.add('visible');
      this.shadowRoot.getElementById('chat-input').focus();
    });

    const reactBtn = actions.querySelector('.react-btn');
    reactBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      picker.classList.toggle('visible');
    });

    if (isLocal) {
      actions.querySelector('.delete-btn').addEventListener('click', () => {
        bubble.remove();
        this.callEngine('broadcast', {
          type: 'DELETE_MESSAGE',
          msgId: bubble.dataset.msgId
        });
      });
    }

    // Close picker when clicking away
    document.addEventListener('click', () => picker.classList.remove('visible'));

    this.chatBody.appendChild(bubble);
    this.scrollToBottom();
    if (!isLocal) this.incrementUnreadBadge();
  }

  incrementUnreadBadge() {
    if (!this.chatContainer.classList.contains('visible')) {
      this.unreadCount++;
      const badge = this.unreadBadge;
      if (badge) {
        badge.style.display = 'flex';
        badge.textContent = this.unreadCount > 9 ? '9+' : this.unreadCount;
      }
    }
  }

  clearUnreadBadge() {
    this.unreadCount = 0;
    if (this.unreadBadge) this.unreadBadge.style.display = 'none';
  }

  showNotification(text) {
    // This is the TOAST system (Outside Chat)
    const container = this.shadowRoot.getElementById('toast-container');
    if (!container) return;

    // Filter: Join/Leave should NOT show as Toasts anymore as per user request
    if (text.includes('joined') || text.includes('left')) return;

    const toast = document.createElement('div');
    toast.classList.add('toast');

    // VIP Logic for Toast
    const isOwnerUser = (this.currentUserTheme === 'owner-dev') || (this.currentUserEmail && this.currentUserEmail.match(/omarrana190|simsimboy09/i));
    const isVIPUser = (this.currentUserTheme === 'magic') || (this.currentUserEmail && this.currentUserEmail.match(/abeeraali2468|abeera|jennie/i));
    const isBTSUser = (this.currentUserTheme === 'bts') || (this.currentUserEmail && this.currentUserEmail.match(/rose|ayesha/i));
    const magicKeywords = ['Highness', 'Queen', 'Kingdom', 'lanterns', 'power', 'Joined', 'joined'];
    const btsKeywords = ['Winter Bear', 'Borahae', 'Purple', 'Taehyung', 'Joined', 'joined'];

    const textHasMagicKeyword = magicKeywords.some(kw => text.includes(kw));
    const textHasBTSKeyword = btsKeywords.some(kw => text.includes(kw));

    const isOwnerDev = text.match(/omarrana190|simsimboy09|Developer|Co Owner/i) || isOwnerUser;
    const isMagic = text.match(/abeeraali2468|abeera|jennie|sharifzada586/i) || (isVIPUser && textHasMagicKeyword);
    const isBTS = text.match(/rose|ayesha|arhamaroora/i) || (isBTSUser && textHasBTSKeyword);

    let icon = '🔔';
    if (text.includes('Joined') || text.includes('joined')) icon = '🟢';
    if (text.includes('left') || text.includes('Left')) icon = '🔴';
    if (text.includes('Paused') || text.includes('paused')) icon = '⏸️';
    if (text.includes('Playing') || text.includes('playing')) icon = '▶️';
    if (text.includes('Seeking') || text.includes('seeking')) icon = '⏩';
    if (text.includes('Waiting')) icon = '⏳';

    if (isOwnerDev) {
      toast.style.background = 'linear-gradient(135deg, rgba(229, 46, 113, 0.9), rgba(255, 138, 0, 0.9))';
      toast.style.border = '1px solid rgba(255,255,255,0.4)';
      icon = '👑';
    } else if (isMagic) {
      toast.style.background = 'linear-gradient(135deg, rgba(162,110,212,0.9), rgba(255,204,112,0.9))';
      toast.style.border = '1px solid rgba(255,255,255,0.4)';
      icon = textHasMagicKeyword ? '☀️' : '✨';
    } else if (isBTS) {
      toast.style.background = 'linear-gradient(135deg, rgba(123,47,247,0.9), rgba(177,156,217,0.9))';
      toast.style.border = '1px solid rgba(177, 156, 217, 0.4)';
      icon = '🐻';
    }

    toast.innerHTML = `<span>${icon}</span> <span>${text}</span>`;
    container.appendChild(toast);

    // Auto-remove after animation
    setTimeout(() => toast.remove(), 3000);
  }


  addSystemMessage(text) {
    // This is the INTERNAL notification system (Inside Chat Body)
    const notif = document.createElement('div');
    notif.classList.add('notification');

    // VIP RECOGNITION FOR BURSTS (Only on JOIN)
    const isJoin = text.toLowerCase().includes('joined');
    const namePart = text.replace(/ joined/i, '').trim();

    const isMagic = namePart.match(/^(abeera|jennie)$/i);
    const isBTS = namePart.match(/^(rose|ayesha)$/i);

    if (isJoin) {
      if (isMagic) {
        this.triggerEmojiBurst('🌸');
        setTimeout(() => this.triggerEmojiBurst('✨'), 600);
      } else if (isBTS) {
        this.triggerEmojiBurst('💜');
        setTimeout(() => this.triggerEmojiBurst('🐻'), 600);
      }
    }

    let icon = '🔔';
    if (text.includes('joined')) icon = '🟢';
    if (text.includes('left')) icon = '🔴';

    notif.textContent = `${icon} ${text}`;
    this.chatBody.appendChild(notif);

    // Force scroll to bottom to fix full-screen "goes all the way up" issue
    setTimeout(() => this.scrollToBottom(), 50);
  }
  deleteMessage(msgId) {
    const bubble = this.shadowRoot.querySelector(`[data-msg-id="${msgId}"]`);
    if (bubble) bubble.remove();
  }

  addReaction(msgId, emoji, senderId) {
    const bubble = this.shadowRoot.querySelector(`[data-msg-id="${msgId}"]`);
    if (bubble) {
      this.addReactionToBubble(bubble, emoji, senderId);
    }
  }

  addReactionToBubble(bubble, emoji, senderId) {
    let container = bubble.querySelector('.reaction-badge-container');
    if (!container) {
      container = document.createElement('div');
      container.classList.add('reaction-badge-container');
      bubble.appendChild(container);
    }

    // Reaction structure: { [emoji]: [userId1, userId2] }
    if (!bubble.reactions) bubble.reactions = {};

    // 1. Remove sender's previous reaction if any
    for (const e in bubble.reactions) {
      bubble.reactions[e] = bubble.reactions[e].filter(id => id !== senderId);
      if (bubble.reactions[e].length === 0) delete bubble.reactions[e];
    }

    // 2. Add new reaction if not null
    if (emoji) {
      if (!bubble.reactions[emoji]) bubble.reactions[emoji] = [];
      bubble.reactions[emoji].push(senderId);
    }

    // 3. Render
    container.innerHTML = '';
    const myId = this.localSocketId || 'local';

    for (const e in bubble.reactions) {
      const badge = document.createElement('div');
      badge.classList.add('reaction-badge');
      if (bubble.reactions[e].includes(myId)) badge.classList.add('mine');

      badge.innerHTML = `<span>${e}</span> <span>${bubble.reactions[e].length}</span>`;
      container.appendChild(badge);
    }

    if (container.innerHTML === '') container.remove();
  }

  triggerEmojiBurst(emoji) {
    const burstCount = 12;
    for (let i = 0; i < burstCount; i++) {
      setTimeout(() => {
        const el = document.createElement('div');
        el.classList.add('emoji-particle');
        el.textContent = emoji;

        // Randomized positions across full screen
        const startX = Math.random() * 95; // 0 to 95vw
        const startY = 60 + Math.random() * 30; // Start mostly from lower half

        el.style.left = startX + 'vw';
        el.style.top = startY + 'vh';

        this.shadowRoot.appendChild(el);
        setTimeout(() => el.remove(), 3000);
      }, i * 100);
    }
  }

  scrollToBottom() {
    this.chatBody.scrollTop = this.chatBody.scrollHeight;
  }

  updateOnlineUsers(userNames) {
    const el = this.shadowRoot.getElementById('online-users');
    if (!el) return;

    const colors = [
      { bg: 'rgba(0, 168, 132, 0.15)', text: '#00d4a4' },
      { bg: 'rgba(229, 46, 113, 0.15)', text: '#ff5c93' },
      { bg: 'rgba(66, 133, 244, 0.15)', text: '#6da8ff' },
      { bg: 'rgba(255, 138, 0, 0.15)', text: '#ffac40' },
      { bg: 'rgba(156, 39, 176, 0.15)', text: '#ce93d8' },
      { bg: 'rgba(255, 235, 59, 0.15)', text: '#ffe082' },
      { bg: 'rgba(0, 188, 212, 0.15)', text: '#4dd0e1' },
      { bg: 'rgba(244, 67, 54, 0.15)', text: '#ef9a9a' },
    ];

    el.innerHTML = '';

    const label = document.createElement('span');
    label.classList.add('online-label');
    label.textContent = `🟢 ${userNames.length > 0 ? userNames.length : 0}`;
    el.appendChild(label);

    userNames.forEach((name, i) => {
      const tag = document.createElement('span');
      tag.classList.add('user-tag');

      if (name.match(/abeera|jennie/i)) {
        tag.style.background = 'linear-gradient(90deg, #a26ed4, #ffcc70)';
        tag.style.color = '#fff';
        tag.style.boxShadow = '0 0 10px rgba(162,110,212,0.6)';
        tag.textContent = `👑 ${name} 🐰`;
      } else {
        const color = colors[i % colors.length];
        tag.style.background = color.bg;
        tag.style.color = color.text;
        tag.textContent = name;
      }

      el.appendChild(tag);
    });
  }
}

// Global initialization
window.visionSyncChat = new GhostChat();
