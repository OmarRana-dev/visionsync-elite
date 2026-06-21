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
    this.currentUserPhoto = '';

    chrome.storage.local.get(['vsUser'], (res) => {
      if (res.vsUser) {
        this.currentUserEmail = res.vsUser.email || '';
        this.currentUserTheme = res.vsUser.theme || '';
        this.currentUserRole = res.vsUser.role || '';
        this.currentUserPhoto = res.vsUser.photo || '';
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
        /* --- Floating Users Top Right --- */
        #floating-users-container {
          position: fixed;
          top: 20px;
          right: 20px;
          display: flex;
          gap: 12px;
          flex-direction: row-reverse;
          z-index: 10000;
          pointer-events: none;
        }
        .floating-user {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          animation: popInUser 0.4s cubic-bezier(0.19, 1, 0.22, 1);
        }
        @keyframes popInUser { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .floating-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.2);
          object-fit: cover;
          box-shadow: 0 4px 15px rgba(0,0,0,0.5);
          position: relative;
        }
        .floating-name {
          font-size: 10px;
          font-weight: 800;
          color: white;
          text-shadow: 0 2px 4px rgba(0,0,0,0.8);
          background: rgba(0,0,0,0.5);
          padding: 2px 6px;
          border-radius: 6px;
        }
        .avatar-crown-wrapper {
          position: relative;
          display: inline-block;
        }
        .avatar-crown-wrapper::after {
          content: '';
          position: absolute;
          top: -14px;
          left: 50%;
          transform: translateX(-50%);
          width: 24px;
          height: 24px;
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          z-index: 2;
          pointer-events: none;
        }
        .avatar-crown-wrapper.role-owner::after {
          background-image: url('data:image/svg+xml;utf8,<svg viewBox="0 0 24 24" fill="%23FFD700" xmlns="http://www.w3.org/2000/svg"><path d="M2 20h20v2H2zM2 8l4.5 4L12 3l5.5 9L22 8v10H2V8z"/></svg>');
          filter: drop-shadow(0 0 5px rgba(255,215,0,0.8));
        }
        .avatar-crown-wrapper.role-dev::after, .avatar-crown-wrapper.role-developer::after, .avatar-crown-wrapper.role-co-owner::after {
          background-image: url('data:image/svg+xml;utf8,<svg viewBox="0 0 24 24" fill="%23C0C0C0" xmlns="http://www.w3.org/2000/svg"><path d="M2 20h20v2H2zM2 8l4.5 4L12 3l5.5 9L22 8v10H2V8z"/></svg>');
          filter: drop-shadow(0 0 5px rgba(192,192,192,0.8));
        }

        /* --- Chat Container --- */
        #chat-container {
          position: fixed;
          bottom: 30px;
          right: 30px;
          width: 330px;
          height: 520px;
          background: transparent;
          display: none;
          flex-direction: column;
          pointer-events: none; /* Let clicks pass through body */
          z-index: 9999;
          transition: transform 0.4s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.4s;
          transform: translateY(10px) scale(0.95);
          opacity: 0;
        }
        #chat-container.visible {
          display: flex;
          transform: translateY(0) scale(1);
          opacity: 1;
        }
        #chat-drag-handle {
          height: 20px;
          cursor: grab;
          display: flex;
          justify-content: center;
          align-items: center;
          pointer-events: auto;
          margin-bottom: 10px;
        }
        #chat-drag-handle::after {
          content: '';
          width: 40px;
          height: 4px;
          background: rgba(255,255,255,0.3);
          border-radius: 2px;
        }
        #chat-drag-handle:active {
          cursor: grabbing;
        }
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
          mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 100%);
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 100%);
          pointer-events: none; /* Let clicks pass through body */
        }
        #chat-body::-webkit-scrollbar {
          display: none;
        }

        /* --- Message Rows & Avatars --- */
        .message-row {
          display: flex;
          gap: 8px;
          align-items: flex-end;
          max-width: 100%;
          align-self: flex-start; /* All messages left aligned FB Live style */
          animation: popInMsg 0.3s cubic-bezier(0.19, 1, 0.22, 1);
          pointer-events: auto; /* Make messages clickable */
        }
        @keyframes popInMsg { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

        .chat-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
          border: 1px solid rgba(255,255,255,0.1);
        }
        .chat-avatar.theme-owner-dev, .chat-avatar.theme-dev { border: 2px solid #ff8a00; box-shadow: 0 0 5px #e52e71; }
        .chat-avatar.theme-magic, .chat-avatar.theme-rapunzel { border: 2px solid #a26ed4; box-shadow: 0 0 5px #ffcc70; }
        .chat-avatar.theme-bts { border: 2px solid #d1b3ff; box-shadow: 0 0 5px #7b2ff7; }

        /* --- Facebook Live Bubbles --- */
        .bubble {
          max-width: 100%;
          padding: 8px 12px;
          font-size: 14px;
          line-height: 1.4;
          position: relative;
          font-weight: 500;
          color: white;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
          background: rgba(0,0,0,0.3);
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.05);
          backdrop-filter: blur(5px);
        }
        .remote-name {
          font-size: 11px;
          font-weight: 900;
          color: rgba(255,255,255,0.7);
          margin-bottom: 2px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.9);
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

        /* --- Full Emoji Picker --- */
        #full-emoji-picker {
          display: none;
          flex-wrap: wrap;
          gap: 4px;
          padding: 12px;
          background: rgba(15, 15, 20, 0.96);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-top: 1px solid rgba(255,255,255,0.1);
          border-radius: 16px 16px 0 0;
          max-height: 200px;
          overflow-y: auto;
          pointer-events: auto;
          animation: slideUp 0.25s cubic-bezier(0.19, 1, 0.22, 1);
        }
        #full-emoji-picker.visible {
          display: flex;
        }
        #full-emoji-picker::-webkit-scrollbar {
          width: 4px;
        }
        #full-emoji-picker::-webkit-scrollbar-track { background: transparent; }
        #full-emoji-picker::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.2);
          border-radius: 2px;
        }
        .emoji-grid-item {
          cursor: pointer;
          font-size: 20px;
          padding: 4px;
          border-radius: 6px;
          transition: transform 0.15s, background 0.15s;
          line-height: 1;
        }
        .emoji-grid-item:hover {
          transform: scale(1.3);
          background: rgba(255,255,255,0.1);
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

      <!-- Floating Users at Top Right -->
      <div id="floating-users-container"></div>

      <div id="chat-container">
        <div id="chat-drag-handle"></div>
        <div id="chat-body"></div>
        
        <div id="full-emoji-picker"></div>
        <div id="reply-preview-bar">
          <div style="flex-grow:1">
            <div id="reply-to-name" style="color:#e52e71; font-size:10px; font-weight:900; text-transform:uppercase">Replying</div>
            <div id="reply-to-msg" style="color:rgba(255,255,255,0.6); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">Message preview...</div>
          </div>
          <span id="cancel-reply-btn" style="cursor:pointer; padding:5px; font-size:12px">✕</span>
        </div>
        
        <div id="chat-input-wrapper">
          <div id="emoji-toggle-btn" title="Emojis">😀</div>
          <input type="text" id="chat-input" placeholder="Say something..." autocomplete="off">
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

    const dragHandle = this.shadowRoot.getElementById('chat-drag-handle');
    if (!dragHandle) return;

    const dragStart = (e) => {
      e.preventDefault();
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
      isDragging = true;
      container.style.cursor = 'grabbing';
    };
    const dragEnd = () => {
      isDragging = false;
      container.style.cursor = '';
    };
    const drag = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      xOffset = e.clientX - initialX;
      yOffset = e.clientY - initialY;
      container.style.transform = `translate3d(${xOffset}px, ${yOffset}px, 0)`;
    };

    dragHandle.addEventListener('mousedown', dragStart);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('mousemove', drag);
  }

  setupListeners() {
    const input = this.shadowRoot.getElementById('chat-input');
    const toggleChatBtn = this.shadowRoot.getElementById('toggle-chat-btn');
    const copyBtn = this.shadowRoot.getElementById('copy-room-btn');
    const exitBtn = this.shadowRoot.getElementById('exit-room-btn');
    const emojiToggleBtn = this.shadowRoot.getElementById('emoji-toggle-btn');
    const fullEmojiPicker = this.shadowRoot.getElementById('full-emoji-picker');

    // --- Build Full Emoji Picker ---
    const EMOJIS = [
      // Smileys
      '😀','😁','😂','🤣','😃','😄','😅','😆','😊','😉','😋','😎','😍','🥰','😘','😗','🤩','😏','😒','😞','😔','😟','😕','🙁','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','😱','😨','😰','😥','🤗','🫡','🤔','🫠','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','🥱','😴','🤤','😪','🫨','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤠',
      // Hands & Gestures
      '👍','👎','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👋','🤚','🖐️','✋','🖖','🫱','🤝','🙏','👏','🫶','💪','🦾','🙌',
      // Hearts
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','♾️',
      // Objects & Fun
      '🔥','⭐','✨','💫','🌟','🎉','🎊','🎈','🎁','🎶','🎵','🎤','📱','💻','🖥️','🎮','🍕','🍔','🍟','🌮','🍣','🍜','🍩','🍪','🍰','🎂','☕','🧋','🥤','🍺','🥂','🫧','🎬','🎥','📽️','🍿','🏆','⚽','🏀','🎯','🎲','🚀','🌈','⚡','🌙','☀️','🌊','🌸','🌺','🌻','🌹',
      // Symbols
      '💯','🔞','🆘','✅','❌','❓','❕','‼️','💬','💭','🔔','🔕','🆕','🆒','🎭','🎪','🙀',
    ];

    EMOJIS.forEach(em => {
      const btn = document.createElement('span');
      btn.classList.add('emoji-grid-item');
      btn.textContent = em;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        input.value += em;
        input.focus();
        // Don't close picker so user can pick multiple
      });
      fullEmojiPicker.appendChild(btn);
    });

    // Toggle picker visibility
    emojiToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fullEmojiPicker.classList.toggle('visible');
    });
    // Close picker when clicking outside
    document.addEventListener('click', () => fullEmojiPicker.classList.remove('visible'));

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
            userRole: this.currentUserRole || '',
            userPhoto: this.currentUserPhoto || '',
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

    const copyFunc = () => {
      const url = this.roomId || window.location.href;
      navigator.clipboard.writeText(url).then(() => this.showNotification('URL Copied!'));
    };
    copyBtn.addEventListener('click', copyFunc);

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

  addMessage(text, isLocal, senderName = '', replyTo = null, msgId = null, senderEmail = '', senderTheme = '', senderRole = '', senderPhoto = '') {
    const row = document.createElement('div');
    row.classList.add('message-row', isLocal ? 'local' : 'remote');

    // Identify user properties
    const trueName = isLocal ? this.lastUserName : senderName;
    const theme = isLocal ? this.currentUserTheme : senderTheme;
    const role = isLocal ? this.currentUserRole : senderRole;
    const photo = isLocal ? this.currentUserPhoto : senderPhoto;

    // Avatar Element
    const avatarWrapper = document.createElement('div');
    avatarWrapper.classList.add('avatar-crown-wrapper');
    if (role) avatarWrapper.classList.add(`role-${role}`); // injects .role-owner, .role-developer, etc.

    const avatarEl = document.createElement('img');
    avatarEl.classList.add('chat-avatar');
    avatarEl.src = photo || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'; // fallback
    
    if (theme === 'owner-dev' || theme === 'dev') avatarEl.classList.add('theme-owner-dev');
    else if (theme === 'magic' || theme === 'rapunzel') avatarEl.classList.add('theme-magic');
    else if (theme === 'bts') avatarEl.classList.add('theme-bts');
    
    avatarWrapper.appendChild(avatarEl);
    row.appendChild(avatarWrapper);

    // Bubble Element
    const bubble = document.createElement('div');
    bubble.classList.add('bubble', isLocal ? 'local' : 'remote');
    bubble.dataset.msgId = msgId || ('msg-' + Date.now());

    // Matches dynamic theme from database
    const isOwnerDev = (theme === 'owner-dev' || theme === 'dev');
    const isMagic = (theme === 'magic' || theme === 'rapunzel');
    const isBTS = (theme === 'bts');

    if (isOwnerDev) bubble.classList.add('owner-dev');
    else if (isMagic) bubble.classList.add('magic');
    else if (isBTS) bubble.classList.add('bts');

    // Always show name in FB Live style (unless it's a direct continuation which we can add later, for now always show)
    const nameEl = document.createElement('div');
    nameEl.classList.add('remote-name');
    
    if (isOwnerDev) nameEl.classList.add('owner-dev');
    else if (isMagic) nameEl.classList.add('magic');
    else if (isBTS) nameEl.classList.add('bts');

    // Role Logic for Titles
    let title = trueName;
    if (role === 'owner' && (theme === 'dev' || theme === 'owner-dev')) title = 'Developer & Co Owner';

    nameEl.textContent = title;
    bubble.appendChild(nameEl);

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

    row.appendChild(bubble);
    this.chatBody.appendChild(row);
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
    const isOwnerUser = (this.currentUserTheme === 'owner-dev' || this.currentUserTheme === 'dev');
    const isVIPUser = (this.currentUserTheme === 'magic' || this.currentUserTheme === 'rapunzel');
    const isBTSUser = (this.currentUserTheme === 'bts');
    
    const magicKeywords = ['Highness', 'Queen', 'Kingdom', 'lanterns', 'power', 'Joined', 'joined'];
    const btsKeywords = ['Winter Bear', 'Borahae', 'Purple', 'Taehyung', 'Joined', 'joined'];

    const textHasMagicKeyword = magicKeywords.some(kw => text.includes(kw));
    const textHasBTSKeyword = btsKeywords.some(kw => text.includes(kw));

    const isOwnerDev = text.match(/Developer|Co Owner/i) || isOwnerUser;
    const isMagic = isVIPUser && textHasMagicKeyword;
    const isBTS = isBTSUser && textHasBTSKeyword;

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

  updateOnlineUsers(usersArray) {
    const container = this.shadowRoot.getElementById('floating-users-container');
    if (!container) return;

    container.innerHTML = '';

    // Add local user to the list for display
    const localUser = {
      userName: this.lastUserName || 'You',
      userTheme: this.currentUserTheme,
      userRole: this.currentUserRole,
      userPhoto: this.currentUserPhoto
    };
    
    // Sort so local user is always first (or last depending on flex-direction)
    const allUsers = [localUser, ...usersArray];

    allUsers.forEach(u => {
      if (!u.userName) return;
      
      const wrapper = document.createElement('div');
      wrapper.classList.add('floating-user');

      const avatarWrap = document.createElement('div');
      avatarWrap.classList.add('avatar-crown-wrapper');
      if (u.userRole) avatarWrap.classList.add(`role-${u.userRole}`);

      const img = document.createElement('img');
      img.classList.add('floating-avatar');
      img.src = u.userPhoto || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
      
      if (u.userTheme === 'owner-dev' || u.userTheme === 'dev') img.classList.add('theme-owner-dev');
      else if (u.userTheme === 'magic' || u.userTheme === 'rapunzel') img.classList.add('theme-magic');
      else if (u.userTheme === 'bts') img.classList.add('theme-bts');
      
      avatarWrap.appendChild(img);
      
      const nameTag = document.createElement('div');
      nameTag.classList.add('floating-name');
      
      let title = u.userName;
      if (u.userRole === 'owner' && (u.userTheme === 'dev' || u.userTheme === 'owner-dev')) title = 'Developer & Co Owner';
      nameTag.textContent = title;

      wrapper.appendChild(avatarWrap);
      wrapper.appendChild(nameTag);
      container.appendChild(wrapper);
    });
  }
}

// Global initialization
window.visionSyncChat = new GhostChat();
