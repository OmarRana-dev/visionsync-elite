// ghost-chat.js: Shadow DOM UI, Right-Aligned Transparent Facebook Live Style
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
    this.localSocketId = 'local';

    this.currentUserEmail = '';
    this.currentUserTheme = '';
    this.currentUserRole = '';
    this.currentUserPhoto = '';
    this.currentUserGoogleId = '';

    // customizable emoji reactions lists
    this.msgReactions = ['👍', '❤️', '😂', '😮', '😢']; // 5 customizable reactions for messages
    this.movieReactions = ['❤️', '😂', '🔥', '👀', '😢', '🍿', '💯', '✨']; // 8 customizable screen-burst emojis

    this.customizingSlotIndex = null; // index of slot being changed
    this.customizingTargetType = null; // 'msg' or 'movie'
    this.currentReply = null;
    this.typingTimeout = null;
    this.movieCustomizeActive = false;

    this.init();
    console.log('[VisionSync Elite] GhostChat UI initialized');
  }

  init() {
    this.container = document.createElement('div');
    this.container.id = 'visionSync-ghost-container';
    // CRITICAL: Host container must NOT create a stacking context.
    // No position, no z-index, no transform, no filter, no will-change.
    // Just a plain block div — fixed children inside Shadow DOM will
    // position relative to the REAL viewport.

    // Inject into fullscreen element or body
    const attachTarget = document.fullscreenElement || document.body;
    attachTarget.appendChild(this.container);

    this.shadowRoot = this.container.attachShadow({ mode: 'open' });
    this.render();

    chrome.storage.local.get(['vsUser', 'customMsgReactions', 'customMovieReactions'], (res) => {
      if (res.vsUser) {
        this.currentUserEmail = res.vsUser.email || '';
        this.currentUserTheme = res.vsUser.theme || '';
        this.currentUserRole = res.vsUser.role || '';
        this.currentUserPhoto = res.vsUser.photo || '';
        this.currentUserGoogleId = res.vsUser.googleId || '';
      }
      if (res.customMsgReactions) {
        this.msgReactions = res.customMsgReactions;
      }
      if (res.customMovieReactions) {
        this.movieReactions = res.customMovieReactions;
        this.renderMovieReactionItems();
      }

      if (this.currentUserGoogleId) {
        this.loadPreferences();
      }
    });

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
        /* --- Floating Dock --- */
        /* Visibility is controlled ENTIRELY by inline style from JS.
           dock.style.display = 'flex' | 'none' — bulletproof, no CSS override possible. */
        #visionSync-dock {
          position: fixed;
          right: 0px;
          top: 70%;
          transform: translateY(-50%);
          width: 48px;
          height: auto;
          background: rgba(15, 15, 19, 0.4);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 24px;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          padding: 18px 0;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
          pointer-events: auto;
          border: 1px solid rgba(255, 255, 255, 0.08);
          cursor: grab;
          user-select: none;
          z-index: 2147483647;
          transition: opacity 0.25s, transform 0.25s;
        }
        /* Dock hides when chat is open */
        #visionSync-dock.hidden {
          opacity: 0;
          pointer-events: none;
          transform: translateY(-50%) scale(0.8);
        }
        #visionSync-dock:active {
          cursor: grabbing;
        }
        /* Drag handle strip at top of dock */
        #dock-drag-handle {
          width: 24px;
          height: 4px;
          background: rgba(255,255,255,0.2);
          border-radius: 2px;
          cursor: grab;
        }
        .dock-icon {
          width: 24px;
          height: 24px;
          cursor: pointer;
          color: rgba(255, 255, 255, 0.5);
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .dock-icon:hover {
          color: #fff;
          transform: scale(1.15);
        }
        .dock-icon svg {
          width: 100%;
          height: 100%;
        }
        .dock-icon.active {
          color: #e52e71;
          filter: drop-shadow(0 0 8px rgba(229, 46, 113, 0.5));
        }
        .dock-icon.muted {
          color: rgba(255, 255, 255, 0.4);
        }
        .dock-icon.exit {
          color: #ff4b2b;
        }

        /* --- Chat container (Docked to right, full height) --- */
        #chat-container {
          position: fixed;
          top: 0;
          right: 0;
          width: 360px;
          height: 95vh;
          background: transparent !important;
          display: none;
          flex-direction: column;
          pointer-events: auto;
          z-index: 2147483647;
        }
        #chat-container.visible {
          display: flex;
        }


        #chat-body {
          flex-grow: 1;
          overflow-y: auto;
          // padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          scrollbar-width: none;
          scroll-behavior: smooth;
          pointer-events: auto;
          /* Fading mask on upper half of panel */
          mask-image: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0) 10%, rgba(0,0,0,1) 50%, rgba(0,0,0,1) 100%);
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0) 10%, rgba(0,0,0,1) 50%, rgba(0,0,0,1) 100%);
        }
        #chat-body::-webkit-scrollbar {
          display: none;
        }

        /* --- Facebook Live Message Item Layout --- */
        .message-row {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          width: 100%;
          animation: msgFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          position: relative;
        }
        @keyframes msgFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .chat-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
          border: 1.5px solid rgba(255, 255, 255, 0.12);
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .msg-content-area {
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          position: relative;
        }

        /* Header Row: Username + Time */
        .msg-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 2px;
        }
        .msg-username {
          font-size: 13.5px;
          font-weight: 700;
          color: #ffffff;
        }
        .msg-time {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.4);
          font-weight: 500;
        }

        /* Text - plain, borderless, subtle shadows */
        .msg-text-line {
          font-size: 13.5px;
          color: #ffffff;
          line-height: 1.45;
          font-weight: 500;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 2px 4px rgba(0, 0, 0, 0.5);
          word-break: break-word;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        /* Always visible custom action buttons */
        .msg-action-buttons {
          display: flex;
          gap: 6px;
          align-items: center;
          margin-left: auto;
          padding-left: 8px;
          flex-shrink: 0;
        }
        
        .msg-action-btn {
          cursor: pointer;
          color: rgba(255, 255, 255, 0.55);
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 50%;
          width: 24px;
          height: 24px;
        }
        .msg-action-btn:hover {
          color: #ff8a00;
          background: rgba(255, 255, 255, 0.12);
          transform: scale(1.1);
        }
        .msg-action-btn svg {
          width: 13px;
          height: 13px;
        }

        /* Message Reactions badges row */
        .msg-reactions-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 4px;
          flex-wrap: wrap;
        }
        .msg-reaction-badge {
          background: rgba(0, 0, 0, 0.45);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 1px 6px;
          font-size: 10px;
          display: flex;
          align-items: center;
          gap: 3px;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          color: rgba(255, 255, 255, 0.8);
          user-select: none;
        }
        .msg-reaction-badge.mine {
          border-color: #e52e71;
          background: rgba(229, 46, 113, 0.25);
        }

        /* Mini Quick-Reactions Overlay Panel (5 items) */
        .msg-reactions-picker-overlay {
          position: absolute;
          bottom: 24px;
          left: 0;
          background: rgba(18, 18, 22, 0.95);
          backdrop-filter: blur(15px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 16px;
          padding: 6px 10px;
          display: none;
          gap: 10px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.5);
          z-index: 1000;
        }
        .msg-reactions-picker-overlay.visible {
          display: flex;
        }
        .msg-picker-emoji {
          font-size: 18px;
          cursor: pointer;
          transition: transform 0.15s;
          user-select: none;
        }
        .msg-picker-emoji:hover {
          transform: scale(1.3);
        }
        .msg-picker-emoji.customizing {
          border: 1px dashed #ff8a00;
          border-radius: 4px;
          background: rgba(255, 138, 0, 0.1);
          animation: wobble 0.5s infinite alternate;
        }

        /* --- Minimalist Replies --- */
        .reply-box {
          border-left: 2px solid rgba(255, 255, 255, 0.35);
          padding-left: 8px;
          margin-bottom: 4px;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.5);
        }
        .reply-name {
          font-weight: 800;
          color: rgba(255, 255, 255, 0.7);
          margin-bottom: 1px;
          font-size: 9.5px;
          text-transform: uppercase;
        }
        .reply-msg {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 240px;
        }

        /* --- Bottom Container (Reactions, Typing, Input) --- */
        #users-and-input-container {
          background: transparent !important;
          border: none !important;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 8px;
          pointer-events: auto;
        }
        
        #typing-indicator {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.7);
          padding: 2px 8px;
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
        }
        .typing-dots {
          display: flex;
          gap: 3px;
          align-items: center;
        }
        .typing-dots span {
          width: 4px; height: 4px;
          background: #fff;
          border-radius: 50%;
          animation: typingDot 1.4s infinite both;
        }
        .typing-dots span:nth-child(2) { animation-delay: .2s; }
        .typing-dots span:nth-child(3) { animation-delay: .4s; }
        @keyframes typingDot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1.2); opacity: 1; }
        }

        #users-and-input-container {
          background: rgba(15, 15, 19, 0.4);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          border-top-left-radius: 16px;
          border-top-right-radius: 16px;
          padding-bottom: 8px;
          display: flex;
          flex-direction: column;
        }

        /* --- Movie reactions screen burst bar (8 slots) --- */
        #reaction-bar {
          display: flex;
          justify-content: space-around;
          align-items: center;
          // padding: 8px 12px;
        }
        .reaction-item {
          font-size: 20px;
          cursor: pointer;
          transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          user-select: none;
        }
        .reaction-item:hover {
          transform: scale(1.3) translateY(-2px);
        }
        .reaction-item.customizing {
          border: 1px dashed #ff8a00;
          border-radius: 4px;
          background: rgba(255, 138, 0, 0.1);
          animation: wobble 0.5s infinite alternate;
        }
        @keyframes wobble {
          from { transform: rotate(-4deg) scale(1.1); }
          to { transform: rotate(4deg) scale(1.1); }
        }

        /* --- Active User Bar --- */
        #active-user-bar {
          display: flex;
          align-items: center;
          gap: 5px;
          min-height: 0;
          overflow: hidden;
          flex-wrap: nowrap;
        }
        #active-user-bar:empty {
          display: none;
        }
        .active-user-avatar {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          object-fit: cover;
          border: 1.5px solid rgba(255,255,255,0.25);
          flex-shrink: 0;
          cursor: default;
          transition: transform 0.2s ease, opacity 0.3s ease;
          animation: avatar-pop-in 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
 
        @keyframes avatar-pop-in {
          from { transform: scale(0); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        .active-user-count {
          font-size: 10px;
          color: rgba(255,255,255,0.5);
          margin-left: 2px;
          white-space: nowrap;
        }

        /* --- Input Area --- */
        #input-row {
          display: flex;
        }

        .unified-input-wrapper {
          display: flex;
          flex-direction: column;
          flex-grow: 1;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 18px;
          padding: 10px 16px 8px 16px;
          transition: border-color 0.3s;
        }
        .unified-input-wrapper:focus-within {
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(255, 255, 255, 0.2);
        }

        #chat-input {
          flex-grow: 1;
          background: transparent;
          border: none;
          color: #fff;
          font-size: 13.5px;
          outline: none;
          resize: none;
          max-height: 120px;
          overflow-y: auto;
          font-family: inherit;
          line-height: 1.4;
          box-sizing: border-box;
          width: 100%;
          padding: 0;
        }
        #chat-input::-webkit-scrollbar { width: 4px; }
        #chat-input::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }

        .unified-actions-row {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 4px;
          margin-top: 4px;
        }

        .action-icon-btn {
          background: transparent;
          border: none;
          color: rgba(255,255,255,0.7);
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.2s, color 0.2s, background 0.2s;
        }
        .action-icon-btn:hover {
          color: #fff;
          background: rgba(255,255,255,0.1);
          transform: scale(1.05);
        }
        .action-icon-btn svg { width: 20px; height: 20px; }
        
        .send-btn, .minimize-btn {
          background: linear-gradient(90deg, #ff8a00, #e52e71);
          border: none;
          color: #fff;
          font-weight: 700;
          font-size: 12px;
          padding: 8px 16px;
          border-radius: 16px;
          cursor: pointer;
          transition: transform 0.2s, filter 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-left: 4px;
        }
        .send-btn { display: none; }
        .send-btn:hover, .minimize-btn:hover {
          transform: scale(1.05);
          filter: brightness(1.1);
        }
        .minimize-btn svg { width: 14px; height: 14px; }

        .chat-image {
          max-width: 100%;
          border-radius: 12px;
          margin-top: 6px;
          cursor: pointer;
          border: 1px solid rgba(255,255,255,0.1);
        }
        .chat-image-preview {
          max-height: 80px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.2);
          margin-bottom: 8px;
          display: none;
        }

        .input-btn {
          width: 32px; height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          background: rgba(255, 255, 255, 0.06);
          color: #fff;
          font-weight: bold;
          font-size: 14px;
          transition: all 0.2s;
          user-select: none;
        }
        .input-btn:hover {
          background: rgba(255, 255, 255, 0.12);
        }

        /* --- Chat controls bar (minimize + leave, inside chatbox) --- */
        #chat-controls-bar {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          padding: 4px 10px 0;
          pointer-events: auto;
        }
        .chat-ctrl-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.7);
          transition: all 0.2s;
          pointer-events: auto;
          user-select: none;
        }
        .chat-ctrl-btn:hover { background: rgba(255,255,255,0.14); color:#fff; }
        .chat-ctrl-btn.leave { border-color:rgba(255,75,43,0.4); color:#ff6b55; }
        .chat-ctrl-btn.leave:hover { background:rgba(255,75,43,0.2); }
        .chat-ctrl-btn svg { width:12px; height:12px; }

        /* --- Full Emoji Picker Container --- */
        #emoji-picker-container {
          position: absolute;
          bottom: 110px;
          right: 10px;
          width: 320px;
          background: rgba(18, 18, 22, 0.95);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 16px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.6);
          display: none;
          flex-direction: column;
          z-index: 2000;
          pointer-events: auto;
        }
        #emoji-picker-container.visible { display: flex; }
        /* Pinned slots row at top of picker */
        #picker-slots-row {
          display: none;
          gap: 8px;
          align-items: center;
          padding: 8px 12px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          flex-wrap: nowrap;
          overflow-x: auto;
        }
        #picker-slots-row.visible { display: flex; }
        .picker-slot {
          font-size: 22px;
          cursor: pointer;
          flex-shrink: 0;
          border-radius: 8px;
          padding: 3px 5px;
          transition: transform 0.15s, background 0.15s;
          position: relative;
        }
        .picker-slot:hover { background: rgba(255,255,255,0.1); transform: scale(1.2); }
        .picker-slot.active-slot {
          border: 1.5px solid #e52e71;
          background: rgba(229,46,113,0.15);
        }
        .picker-slot-label {
          position: absolute;
          bottom: -2px;
          right: 0;
          font-size: 7px;
          background: rgba(229,46,113,0.8);
          color: #fff;
          border-radius: 3px;
          padding: 0 2px;
          pointer-events: none;
        }
        .picker-header {
          padding: 10px 14px;
          font-size: 11px;
          font-weight: 800;
          color: rgba(255,255,255,0.4);
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .picker-grid {
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          gap: 6px;
          padding: 12px;
          max-height: 200px;
          overflow-y: auto;
        }
        .picker-grid span {
          font-size: 20px;
          cursor: pointer;
          text-align: center;
          transition: transform 0.15s;
          user-select: none;
        }
        .picker-grid span:hover { transform: scale(1.3); }

        /* Reply preview bar */
        #reply-preview-bar {
          display: none;
          background: rgba(20, 20, 25, 0.95);
          border-left: 3px solid #e52e71;
          padding: 8px 12px;
          border-radius: 6px;
          align-items: center;
          justify-content: space-between;
          font-size: 11px;
          margin-bottom: 4px;
          pointer-events: auto;
        }
        #reply-preview-bar.visible { display: flex; }

        /* System Messages / Notifications */
        .notification {
          align-self: center;
          font-size: 9px;
          color: rgba(255, 255, 255, 0.4);
          background: rgba(255, 255, 255, 0.05);
          padding: 3px 10px;
          border-radius: 10px;
          margin: 2px 0;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: bold;
        }
        
        .emoji-particle {
          position: fixed;
          font-size: 32px;
          pointer-events: none;
          z-index: 2147483647;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));
          animation: floatUpBurst 2.8s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          opacity: 0;
        }
        @keyframes floatUpBurst {
          0%   { transform: translateY(0) scale(0) rotate(0deg) translateX(0); opacity: 0; }
          15%  { transform: translateY(-40px) scale(1.4) rotate(12deg) translateX(0); opacity: 1; }
          100% { transform: translateY(-92vh) scale(0.5) rotate(-20deg) translateX(var(--drift, 0px)); opacity: 0; }
        }
      </style>

      <div id="visionSync-dock" style="display:none">
          <div id="dock-drag-handle"></div>

          <div class="dock-icon" id="copy-room-btn" title="Copy Room URL">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
        </div>
        <div class="dock-icon muted" id="toggle-chat-btn" title="Toggle Chat">
          <svg id="chat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            <line x1="3" y1="3" x2="21" y2="21" stroke="rgba(255,255,255,0.4)" stroke-width="2.5"></line>
          </svg>
          <span id="unread-badge" style="display:none; position:absolute; top: -8px; right: -8px; background: #ff0000; color: #fff; min-width: 16px; height: 16px; border-radius: 8px; font-size: 9px; align-items: center; justify-content: center; font-weight: 900; box-shadow: 0 2px 6px rgba(255,0,0,0.4); border: 2px solid #0f0f13;">0</span>
        </div>
        <div class="dock-icon exit" id="exit-room-btn" title="Exit Room">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
        </div>
      </div>

      <div id="chat-container">
        <div id="chat-body">
          <!-- Spacer at top allows flexing items to bottom while keeping scrolling working perfectly -->
          <div id="chat-body-spacer" style="margin-top: auto;"></div>
        </div>
        

        <div id="reply-preview-bar">
          <div style="flex-grow:1">
            <div id="reply-to-name" style="color:#e52e71; font-weight:900; text-transform:uppercase; font-size:9px;">Replying...</div>
            <div id="reply-to-msg" style="color:rgba(255,255,255,0.6); white-space:nowrap; overflow:hidden; text-overflow:ellipsis">Message preview</div>
          </div>
          <span id="cancel-reply-btn" style="cursor:pointer; padding:5px; font-size:12px">✕</span>
        </div>

        <div id="users-and-input-container">
          <div id="typing-indicator" style="display:none;">
            <span class="typing-text">someone is typing</span>
            <div class="typing-dots"><span></span><span></span><span></span></div>
          </div>

          <!-- Active User Bar -->
          <div id="active-user-bar"></div>

          <!-- Movie-level reaction bar (8 slots) -->
          <div id="reaction-bar" title="Double-click to collapse"></div>

          <div style="padding: 0 16px;">
            <img id="chat-image-preview" class="chat-image-preview" src="" />
          </div>

          <div id="input-row">
            <div class="unified-input-wrapper">
              <input type="file" id="image-upload-input" accept="image/*" style="display:none;">
              <textarea id="chat-input" placeholder="Type a message..." autocomplete="off" rows="1"></textarea>
              <div class="unified-actions-row">
                <button class="action-icon-btn" id="open-emoji-picker-btn" title="Add Emoji">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line>
                  </svg>
                </button>
                <button class="action-icon-btn" id="image-upload-btn" title="Send Image">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>
                  </svg>
                </button>
                <button class="send-btn" id="send-chat-btn">Send</button>
                <button class="minimize-btn" id="chat-minimize-btn" title="Minimize">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Central Emoji Picker -->
        <div id="emoji-picker-container">
          <div class="picker-header">
            <span id="picker-title">SELECT EMOJI</span>
            <span id="close-picker-btn" style="cursor:pointer;">✕</span>
          </div>
          <!-- Pinned slots row shown when a reaction bar opens the picker -->
          <div id="picker-slots-row"></div>
          <div class="picker-grid" id="picker-grid"></div>
        </div>
      </div>
    `;

    this.dock = this.shadowRoot.getElementById('visionSync-dock');
    this.chatBody = this.shadowRoot.getElementById('chat-body');
    this.chatContainer = this.shadowRoot.getElementById('chat-container');
    this.unreadBadge = this.shadowRoot.getElementById('unread-badge');

    this.renderMovieReactionItems();
    this.renderEmojiPicker();

    // Auto fullscreen injection - keep scroll pinned to bottom after move
    const handleFs = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl) {
        fsEl.appendChild(this.container);
      } else {
        document.body.appendChild(this.container);
      }
      // Restore scroll position after DOM re-attach
      requestAnimationFrame(() => this.scrollToBottom());
    };
    document.addEventListener('fullscreenchange', handleFs);
    document.addEventListener('webkitfullscreenchange', handleFs);

    // ResizeObserver: keep chat pinned to bottom when viewport resizes
    const ro = new ResizeObserver(() => {
      this.scrollToBottom();
    });
    // Observe after a tick so this.chatBody is assigned
    requestAnimationFrame(() => {
      if (this.chatBody) ro.observe(this.chatBody);
    });

    // Dismiss any open message reaction overlay on click outside (shadow root level)
    this.shadowRoot.addEventListener('click', (e) => {
      const overlays = this.shadowRoot.querySelectorAll('.msg-reactions-picker-overlay.visible');
      overlays.forEach(overlay => {
        if (!overlay.contains(e.target)) {
          overlay.classList.remove('visible');
        }
      });
    }, true);
  }

  // Renders the 8 movie-level burst reactions
  renderMovieReactionItems() {
    const bar = this.shadowRoot.getElementById('reaction-bar');
    if (!bar) return;
    bar.innerHTML = '';

    this.movieReactions.forEach((emoji, idx) => {
      const span = document.createElement('span');
      span.className = 'reaction-item';
      if (this.movieCustomizeActive) span.classList.add('customizing');
      span.textContent = emoji;
      span.dataset.idx = idx;

      span.addEventListener('click', () => {
        if (this.movieCustomizeActive) {
          this.toggleSlotCustomizing(idx, 'movie');
        } else {
          this.triggerEmojiBurst(emoji);
          this.callEngine('broadcast', { type: 'EMOJI', emoji });
        }
      });

      bar.appendChild(span);
    });

    // '+' button: pick any emoji for a one-off burst without touching saved slots
    const addBtn = document.createElement('span');
    addBtn.className = 'reaction-item';
    addBtn.style.cssText = 'font-size:14px; color:rgba(255,255,255,0.5); border:1px dashed rgba(255,255,255,0.25); border-radius:6px; padding:1px 4px;';
    addBtn.title = 'Burst any emoji';
    addBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:middle;">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `;
    addBtn.addEventListener('click', () => {
      this.burstPickerMode = true;
      const picker = this.shadowRoot.getElementById('emoji-picker-container');
      const title = this.shadowRoot.getElementById('picker-title');
      title.textContent = 'BURST ANY EMOJI';
      picker.classList.toggle('visible');
    });
    bar.appendChild(addBtn);
  }

  renderEmojiPicker() {
    const grid = this.shadowRoot.getElementById('picker-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const popularEmojis = [
      '👍', '❤️', '😂', '😮', '😢', '🔥', '👀', '🍿', '💯', '✨', '🎉', '👏',
      '👎', '🙌', '🙏', '😎', '🤔', '🥳', '😡', '😱', '💩', '🤡', '👽', '👻',
      '👑', '🐻', '🐰', '💜', '🌟', '💡', '💥', '🍕', '🍿', '🍺', '🎬', '🎮',
      '🎧', '🎤', '🚗', '✈️', '🌍', '⏰', '🔒', '💔', '💖', '✅', '❌', '🎵',
      '⚽', '🏀', '🐱', '🐶', '🦄', '🌈', '☀️', '🌧️', '🎂', '🎁', '🚀', '⚡'
    ];

    popularEmojis.forEach(emoji => {
      const span = document.createElement('span');
      span.textContent = emoji;
      span.addEventListener('click', () => {
        const picker = this.shadowRoot.getElementById('emoji-picker-container');

        if (this.customizingSlotIndex !== null) {
          if (this.customizingTargetType === 'msg') {
            // Replace message reaction slot
            this.msgReactions[this.customizingSlotIndex] = emoji;
            this.savePreference();
            // Refresh open active bubble picker if any
            const activeOverlays = this.shadowRoot.querySelectorAll('.msg-reactions-picker-overlay.visible');
            activeOverlays.forEach(overlay => this.populateOverlayReactions(overlay));
          } else if (this.customizingTargetType === 'movie') {
            // Replace movie reaction slot
            this.movieReactions[this.customizingSlotIndex] = emoji;
            this.savePreference();
            this.renderMovieReactionItems();
          }
          this.toggleSlotCustomizing(null, null);
        } else if (this.burstPickerMode) {
          // One-off burst — no slot replacement
          // Do not reset mode or close picker here, so user can burst multiple emojis
          this.triggerEmojiBurst(emoji);
          this.callEngine('broadcast', { type: 'EMOJI', emoji });
          return; // Return early to prevent picker.classList.remove('visible')
        } else if (this.msgReactionPickerMode) {
          // One-off message reaction
          this.msgReactionPickerMode = false;
          const targetMsgId = this.msgReactionPickerTarget;
          this.msgReactionPickerTarget = null;
          const title = this.shadowRoot.getElementById('picker-title');
          title.textContent = 'SELECT EMOJI';

          const bubble = this.shadowRoot.querySelector(`[data-msg-id="${targetMsgId}"]`);
          if (bubble) {
            const myId = this.localSocketId || 'local';
            const currentEmoji = bubble.dataset.myEmoji;
            const newEmoji = (currentEmoji === emoji) ? null : emoji;
            bubble.dataset.myEmoji = newEmoji || "";

            this.addReactionToBubble(bubble, newEmoji, myId);
            this.callEngine('broadcast', {
              type: 'MESSAGE_REACTION',
              msgId: targetMsgId,
              emoji: newEmoji,
              senderId: myId
            });
          }
        } else {
          // Standard input insertion
          const input = this.shadowRoot.getElementById('chat-input');
          input.value += emoji;
          input.dispatchEvent(new Event('input', { bubbles: true })); // Trigger auto-resize and send button toggle
          input.focus();
        }
        picker.classList.remove('visible');
      });
      grid.appendChild(span);
    });
  }

  toggleSlotCustomizing(idx, targetType) {
    // Clear customizing classes
    const movieItems = this.shadowRoot.querySelectorAll('.reaction-item');
    movieItems.forEach(el => el.classList.remove('customizing'));

    const overlayEmojis = this.shadowRoot.querySelectorAll('.msg-picker-emoji');
    overlayEmojis.forEach(el => el.classList.remove('customizing'));

    const title = this.shadowRoot.getElementById('picker-title');
    const picker = this.shadowRoot.getElementById('emoji-picker-container');

    if (idx === null) {
      this.customizingSlotIndex = null;
      this.customizingTargetType = null;
      title.textContent = 'SELECT EMOJI';
      picker.classList.remove('visible');

      // Also reset editing mode visual outlines
      if (this.movieCustomizeActive) {
        this.toggleMovieCustomizeMode();
      }

      // Reset any active message reaction overlays to un-click the gear
      const activeOverlays = this.shadowRoot.querySelectorAll('.msg-reactions-picker-overlay');
      activeOverlays.forEach(overlay => {
        if (overlay.customizeActive) {
          overlay.customizeActive = false;
          this.populateOverlayReactions(overlay);
        }
      });
    } else {
      this.customizingSlotIndex = idx;
      this.customizingTargetType = targetType;
      title.textContent = `REPLACE SLOT #${idx + 1}`;

      if (targetType === 'movie') {
        movieItems[idx].classList.add('customizing');
      } else if (targetType === 'msg') {
        const activeOverlays = this.shadowRoot.querySelectorAll('.msg-reactions-picker-overlay.visible');
        activeOverlays.forEach(overlay => {
          const item = overlay.querySelector(`[data-idx="${idx}"]`);
          if (item) item.classList.add('customizing');
        });
      }
      picker.classList.add('visible');
    }
  }

  toggleMovieCustomizeMode() {
    this.movieCustomizeActive = !this.movieCustomizeActive;
    const btn = this.shadowRoot.getElementById('customize-movie-btn');
    const items = this.shadowRoot.querySelectorAll('.reaction-item');
    if (this.movieCustomizeActive) {
      btn.classList.add('active');
      btn.style.color = '#ff8a00';
      items.forEach(el => el.classList.add('customizing'));
    } else {
      btn.classList.remove('active');
      btn.style.color = '';
      items.forEach(el => el.classList.remove('customizing'));
    }
  }

  savePreference() {
    chrome.storage.local.set({
      customMsgReactions: this.msgReactions,
      customMovieReactions: this.movieReactions
    });

    if (this.currentUserGoogleId) {
      // Use global FIREBASE_CONFIG injected via firebase-config.js
      const { apiKey, projectId } = window.FIREBASE_CONFIG || {};
      if (!apiKey || !projectId) {
        console.warn('[VisionSync] Firebase config not available');
        return;
      }
      // PATCH call updating BOTH customization slots on profile
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${this.currentUserGoogleId}?key=${apiKey}&updateMask.fieldPaths=messageReactions&updateMask.fieldPaths=screenReactions`;

      fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            messageReactions: {
              arrayValue: {
                values: this.msgReactions.map(e => ({ stringValue: e }))
              }
            },
            screenReactions: {
              arrayValue: {
                values: this.movieReactions.map(e => ({ stringValue: e }))
              }
            }
          }
        })
      }).catch(err => console.warn('[VisionSync] savePreference failed:', err));
    }
  }

  loadPreferences() {
    if (!this.currentUserGoogleId) return;
    // Use global FIREBASE_CONFIG injected via firebase-config.js
    const { apiKey, projectId } = window.FIREBASE_CONFIG || {};
    if (!apiKey || !projectId) {
      console.warn('[VisionSync] Firebase config not available');
      return;
    }
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${this.currentUserGoogleId}?key=${apiKey}`;

    fetch(url)
      .then(res => res.json())
      .then(data => {
        const msgVals = data.fields?.messageReactions?.arrayValue?.values;
        if (msgVals && Array.isArray(msgVals)) {
          const loadedMsg = msgVals.map(v => v.stringValue).filter(Boolean);
          if (loadedMsg.length === 5) {
            this.msgReactions = loadedMsg;
            chrome.storage.local.set({ customMsgReactions: loadedMsg });
          }
        }
        const movieVals = data.fields?.screenReactions?.arrayValue?.values;
        if (movieVals && Array.isArray(movieVals)) {
          const loadedMovie = movieVals.map(v => v.stringValue).filter(Boolean);
          if (loadedMovie.length > 0) {
            this.movieReactions = loadedMovie;
            chrome.storage.local.set({ customMovieReactions: loadedMovie });
            this.renderMovieReactionItems();
          }
        }
      })
      .catch(err => console.warn('[VisionSync] loadPreferences failed:', err));
  }

  setupListeners() {
    // ─── Dock Drag (left side, constrained to vertical movement only) ───
    const dock = this.shadowRoot.getElementById('visionSync-dock');
    const dockDragHandle = this.shadowRoot.getElementById('dock-drag-handle');
    let dockDragging = false, dockStartY = 0, dockStartTop = 0;

    const startDockDrag = (e) => {
      dockDragging = true;
      dockStartY = e.clientY || (e.touches && e.touches[0].clientY);
      dockStartTop = dock.getBoundingClientRect().top;
      dock.style.transform = 'none';
      dock.style.top = dockStartTop + 'px';
      e.preventDefault();
    };
    dockDragHandle.addEventListener('mousedown', startDockDrag);
    dockDragHandle.addEventListener('touchstart', startDockDrag, { passive: false });

    document.addEventListener('mousemove', (e) => {
      if (!dockDragging) return;
      const dy = e.clientY - dockStartY;
      const newTop = Math.max(10, Math.min(window.innerHeight - dock.offsetHeight - 10, dockStartTop + dy));
      dock.style.top = newTop + 'px';
    });
    document.addEventListener('touchmove', (e) => {
      if (!dockDragging) return;
      const dy = e.touches[0].clientY - dockStartY;
      const newTop = Math.max(10, Math.min(window.innerHeight - dock.offsetHeight - 10, dockStartTop + dy));
      dock.style.top = newTop + 'px';
    }, { passive: true });
    const stopDockDrag = () => { dockDragging = false; };
    document.addEventListener('mouseup', stopDockDrag);
    document.addEventListener('touchend', stopDockDrag);

    const input = this.shadowRoot.getElementById('chat-input');
    const sendBtn = this.shadowRoot.getElementById('send-chat-btn');
    const toggleChatBtn = this.shadowRoot.getElementById('toggle-chat-btn');
    const copyBtn = this.shadowRoot.getElementById('copy-room-btn');
    const exitBtn = this.shadowRoot.getElementById('exit-room-btn');
    const cancelReplyBtn = this.shadowRoot.getElementById('cancel-reply-btn');
    const closePickerBtn = this.shadowRoot.getElementById('close-picker-btn');
    const chatMinimizeBtn = this.shadowRoot.getElementById('chat-minimize-btn');
    const openEmojiPickerBtn = this.shadowRoot.getElementById('open-emoji-picker-btn');
    const reactionBar = this.shadowRoot.getElementById('reaction-bar');

    reactionBar.addEventListener('dblclick', () => {
      chatMinimizeBtn.click();
    });

    if (openEmojiPickerBtn) {
      openEmojiPickerBtn.addEventListener('click', () => {
        this.msgReactionPickerMode = false;
        this.burstPickerMode = false;
        this.customizingSlotIndex = null;
        const picker = this.shadowRoot.getElementById('emoji-picker-container');
        const title = this.shadowRoot.getElementById('picker-title');
        title.textContent = 'SELECT EMOJI';
        picker.classList.add('visible');
      });
    }

    let currentImageBase64 = null;
    const imageUploadBtn = this.shadowRoot.getElementById('image-upload-btn');
    const imageUploadInput = this.shadowRoot.getElementById('image-upload-input');
    const imagePreview = this.shadowRoot.getElementById('chat-image-preview');

    imageUploadBtn.addEventListener('click', () => imageUploadInput.click());

    imageUploadInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          let width = img.width;
          let height = img.height;

          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          currentImageBase64 = canvas.toDataURL('image/jpeg', 0.7);
          imagePreview.src = currentImageBase64;
          imagePreview.style.display = 'block';

          sendBtn.style.display = 'flex';
          chatMinimizeBtn.style.display = 'none';
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
      imageUploadInput.value = '';
    });

    const handleSendMessage = () => {
      const text = input.value.trim();
      if (!text && !currentImageBase64) return;

      const msgId = 'msg-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

      this.addMessage(text, true, '', this.currentReply, msgId, this.currentUserEmail, this.currentUserTheme, this.currentUserRole, this.currentUserPhoto, currentImageBase64);

      this.callEngine('broadcast', {
        type: 'CHAT',
        text: text,
        sender: this.lastUserName,
        userEmail: this.currentUserEmail || '',
        userTheme: this.currentUserTheme || '',
        userRole: this.currentUserRole || '',
        userPhoto: this.currentUserPhoto || '',
        replyTo: this.currentReply,
        msgId: msgId,
        imageUrl: currentImageBase64
      });

      input.value = '';
      input.style.height = 'auto'; // Reset height
      currentImageBase64 = null;
      imagePreview.src = '';
      imagePreview.style.display = 'none';

      this.currentReply = null;
      this.shadowRoot.getElementById('reply-preview-bar').classList.remove('visible');

      sendBtn.style.display = 'none';
      chatMinimizeBtn.style.display = 'flex';

      this.callEngine('broadcast', { type: 'TYPING', senderName: this.lastUserName, isTyping: false });
    };

    input.addEventListener('keypress', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });

    sendBtn.addEventListener('click', handleSendMessage);

    // Typing notice, auto-resize, and send/minimize toggle
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = (input.scrollHeight) + 'px';

      if (input.value.trim().length > 0 || currentImageBase64) {
        sendBtn.style.display = 'flex';
        chatMinimizeBtn.style.display = 'none';
      } else {
        sendBtn.style.display = 'none';
        chatMinimizeBtn.style.display = 'flex';
      }

      this.callEngine('broadcast', { type: 'TYPING', senderName: this.lastUserName, isTyping: true });
      if (this.typingTimeout) clearTimeout(this.typingTimeout);
      this.typingTimeout = setTimeout(() => {
        this.callEngine('broadcast', { type: 'TYPING', senderName: this.lastUserName, isTyping: false });
      }, 2500);
    });

    input.addEventListener('keydown', (e) => e.stopPropagation());

    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'UI_CLEANUP') this.cleanup();
    });

    toggleChatBtn.addEventListener('click', () => {
      this.chatContainer.classList.add('visible');
      if (this.dock) this.dock.style.display = 'none'; // hide dock
      this.clearUnreadBadge();
      toggleChatBtn.classList.add('active');
      toggleChatBtn.classList.remove('muted');
      const chatSvg = this.shadowRoot.getElementById('chat-svg');
      chatSvg.innerHTML = `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>`;
    });

    chatMinimizeBtn.addEventListener('click', () => {
      this.chatContainer.classList.remove('visible');
      if (this.dock) this.dock.style.display = 'flex'; // show dock
      toggleChatBtn.classList.remove('active');
      toggleChatBtn.classList.add('muted');
      const chatSvg = this.shadowRoot.getElementById('chat-svg');
      chatSvg.innerHTML = `
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        <line x1="3" y1="3" x2="21" y2="21" stroke="rgba(255,255,255,0.4)" stroke-width="2.5"></line>
      `;
    });


    closePickerBtn.addEventListener('click', () => {
      this.shadowRoot.getElementById('emoji-picker-container').classList.remove('visible');
      this.burstPickerMode = false;
      this.msgReactionPickerMode = false;
      const title = this.shadowRoot.getElementById('picker-title');
      title.textContent = 'SELECT EMOJI';
      this.toggleSlotCustomizing(null, null);
    });

    cancelReplyBtn.addEventListener('click', () => {
      this.currentReply = null;
      this.shadowRoot.getElementById('reply-preview-bar').classList.remove('visible');
    });

    copyBtn.addEventListener('click', () => {
      const url = this.roomId || window.location.href;
      navigator.clipboard.writeText(url).then(() => this.addSystemMessage('Room link copied!'));
    });

    exitBtn.addEventListener('click', () => {
      if (confirm('Leave this watch party?')) this.cleanup();
    });
  }

  cleanup() {
    // Hide dock via inline style (bulletproof)
    if (this.dock) this.dock.style.display = 'none';

    this.chatBody.innerHTML = '';
    this.clearUnreadBadge();
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
    console.log('[VisionSync Elite] UI Cleaned up securely without unmounting');
  }

  setRoomInfo(roomId, userName) {
    this.roomId = roomId;
    this.lastUserName = userName;

    console.log('[VisionSync] setRoomInfo called — showing dock for room:', roomId);

    // Show dock via INLINE STYLE — this is the most reliable method.
    // Inline styles have highest CSS specificity and cannot be overridden.
    const dock = this.dock || this.shadowRoot.getElementById('visionSync-dock');
    if (dock) {
      dock.style.display = 'flex';
      console.log('[VisionSync] Dock display set to flex');
    } else {
      console.error('[VisionSync] FATAL: Dock element not found in shadow DOM!');
    }

    const isMagic = userName && userName.match(/abeera|jennie/i);
    const isBTS = userName && userName.match(/rose|ayesha/i);

    if (isMagic) {
      dock.style.background = 'rgba(128, 77, 168, 0.4)';
      dock.style.boxShadow = '0 10px 40px rgba(162,110,212,0.6)';
    } else if (isBTS) {
      dock.style.background = 'rgba(123, 47, 247, 0.4)';
      dock.style.boxShadow = '0 10px 40px rgba(123, 47, 247, 0.6)';
    } else {
      dock.style.background = 'rgba(15, 15, 19, 0.4)';
      dock.style.boxShadow = '0 10px 40px rgba(0,0,0,0.5)';
    }
  }

  setupEmojiReactions() {
    // Left legacy signature empty
  }

  // Populate list of 5 emojis inside the message react overlay panel
  populateOverlayReactions(overlay) {
    overlay.innerHTML = '';

    this.msgReactions.forEach((emoji, idx) => {
      const span = document.createElement('span');
      span.className = 'msg-picker-emoji';
      if (overlay.customizeActive) span.classList.add('customizing');
      span.textContent = emoji;
      span.dataset.idx = idx;

      // Handle normal tap or customization tap
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetMsgId = overlay.dataset.targetMsgId;
        const myId = this.localSocketId || 'local';

        if (overlay.customizeActive) {
          this.toggleSlotCustomizing(idx, 'msg');
          return;
        }

        const bubble = this.shadowRoot.querySelector(`[data-msg-id="${targetMsgId}"]`);
        if (bubble) {
          const currentEmoji = bubble.dataset.myEmoji;
          const newEmoji = (currentEmoji === emoji) ? null : emoji;
          bubble.dataset.myEmoji = newEmoji || "";

          this.addReactionToBubble(bubble, newEmoji, myId);
          this.callEngine('broadcast', {
            type: 'MESSAGE_REACTION',
            msgId: targetMsgId,
            emoji: newEmoji,
            senderId: myId
          });
        }
        overlay.classList.remove('visible');
      });

      overlay.appendChild(span);
    });

    const settingsBtn = document.createElement('span');
    settingsBtn.className = 'msg-picker-emoji';
    settingsBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:middle;">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
      </svg>
    `;
    settingsBtn.style.cssText = 'font-size:12px; display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.7);';
    settingsBtn.title = 'Customize Slots';
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      overlay.customizeActive = !overlay.customizeActive;
      const emojis = overlay.querySelectorAll('.msg-picker-emoji:not(:last-child):not(:nth-last-child(2))');
      if (overlay.customizeActive) {
        settingsBtn.style.color = '#ff8a00';
        emojis.forEach(el => el.classList.add('customizing'));
      } else {
        settingsBtn.style.color = 'rgba(255,255,255,0.7)';
        emojis.forEach(el => el.classList.remove('customizing'));
        this.toggleSlotCustomizing(null, null);
      }
    });
    overlay.appendChild(settingsBtn);

    // '+' button: pick any emoji to react with
    const addBtn = document.createElement('span');
    addBtn.className = 'msg-picker-emoji';
    addBtn.style.cssText = 'font-size:14px; display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.7);';
    addBtn.title = 'React with any emoji';
    addBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:middle;">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `;
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.msgReactionPickerMode = true;
      this.msgReactionPickerTarget = overlay.dataset.targetMsgId;
      const picker = this.shadowRoot.getElementById('emoji-picker-container');
      const title = this.shadowRoot.getElementById('picker-title');
      title.textContent = 'REACT WITH EMOJI';
      picker.classList.add('visible');
      overlay.classList.remove('visible'); // Close the overlay
    });
    overlay.appendChild(addBtn);
  }

  // Facebook Live style message bubbles
  addMessage(text, isLocal, senderName = '', replyTo = null, msgId = null, senderEmail = '', senderTheme = '', senderRole = '', senderPhoto = '', imageUrl = null) {
    const row = document.createElement('div');
    row.className = 'message-row';

    const name = isLocal ? this.lastUserName : senderName;
    const photo = isLocal ? this.currentUserPhoto : senderPhoto;

    // Avatar
    const avatar = document.createElement('img');
    avatar.className = 'chat-avatar';
    avatar.src = photo || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><circle cx='50' cy='50' r='48' fill='%231f1f23'/><text x='50' y='55' font-family='sans-serif' font-size='40' fill='%23ffffff' text-anchor='middle' dominant-baseline='middle'>${name ? name.charAt(0).toUpperCase() : '?'}</text></svg>`;
    row.appendChild(avatar);

    // Content area
    const contentArea = document.createElement('div');
    contentArea.className = 'msg-content-area';

    // Header row
    const headerRow = document.createElement('div');
    headerRow.className = 'msg-header-row';

    const usernameSpan = document.createElement('span');
    usernameSpan.className = 'msg-username';
    usernameSpan.textContent = name;
    headerRow.appendChild(usernameSpan);

    const now = new Date();
    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    timeSpan.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    headerRow.appendChild(timeSpan);

    contentArea.appendChild(headerRow);

    // Minimalist reply box inside the content area
    if (replyTo) {
      const reply = document.createElement('div');
      reply.className = 'reply-box';

      const rName = document.createElement('div');
      rName.className = 'reply-name';
      rName.textContent = replyTo.sender;
      reply.appendChild(rName);

      const rMsg = document.createElement('div');
      rMsg.className = 'reply-msg';
      rMsg.textContent = replyTo.text;
      reply.appendChild(rMsg);

      contentArea.appendChild(reply);
    }

    // Message text line with reply arrow trigger
    const textLine = document.createElement('div');
    textLine.className = 'msg-text-line';

    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    textLine.appendChild(textSpan);

    // Always visible action buttons container
    const actionButtons = document.createElement('div');
    actionButtons.className = 'msg-action-buttons';

    // 1. Reply Arrow Button SVG
    const replyArrow = document.createElement('span');
    replyArrow.className = 'msg-action-btn';
    replyArrow.title = 'Reply';
    replyArrow.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 17 4 12 9 7"></polyline>
        <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
      </svg>
    `;
    replyArrow.addEventListener('click', () => {
      this.currentReply = { text, sender: name || 'Someone' };
      const bar = this.shadowRoot.getElementById('reply-preview-bar');
      this.shadowRoot.getElementById('reply-to-name').textContent = `Replying to ${this.currentReply.sender}`;
      this.shadowRoot.getElementById('reply-to-msg').textContent = text;
      bar.classList.add('visible');
      this.shadowRoot.getElementById('chat-input').focus();
    });
    actionButtons.appendChild(replyArrow);

    // Bubble reference for reactions storage
    const bubbleRef = document.createElement('div');
    bubbleRef.style.display = 'none';
    bubbleRef.dataset.msgId = msgId || 'msg-' + Date.now();
    contentArea.appendChild(bubbleRef);

    // Reactions row
    const reactionsRow = document.createElement('div');
    reactionsRow.className = 'msg-reactions-row';

    // 5-reactions picker overlay
    const pickerOverlay = document.createElement('div');
    pickerOverlay.className = 'msg-reactions-picker-overlay';
    pickerOverlay.dataset.targetMsgId = bubbleRef.dataset.msgId;
    this.populateOverlayReactions(pickerOverlay);
    contentArea.appendChild(pickerOverlay);

    // 2. Add Reaction Smiley Button SVG (Always visible next to reply)
    const reactionTrigger = document.createElement('span');
    reactionTrigger.className = 'msg-action-btn';
    reactionTrigger.title = 'Add Reaction';
    reactionTrigger.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
        <line x1="9" y1="9" x2="9.01" y2="9"></line>
        <line x1="15" y1="9" x2="15.01" y2="9"></line>
      </svg>
    `;
    reactionTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      pickerOverlay.classList.toggle('visible');
    });
    actionButtons.appendChild(reactionTrigger);

    textLine.appendChild(actionButtons);
    contentArea.appendChild(textLine);

    if (imageUrl) {
      const imgLine = document.createElement('div');
      imgLine.className = 'msg-image-line';
      const imgEl = document.createElement('img');
      imgEl.className = 'chat-image';
      imgEl.src = imageUrl;
      imgEl.addEventListener('click', () => {
        const win = window.open();
        if (win) { win.document.write(`<img src="${imageUrl}" style="max-width:100%;height:auto;display:block;margin:0 auto;" />`); }
      });
      imgLine.appendChild(imgEl);
      contentArea.appendChild(imgLine);
    }
    contentArea.appendChild(reactionsRow);
    row.appendChild(contentArea);

    this.chatBody.appendChild(row);
    this.scrollToBottom();

    if (!isLocal) {
      this.incrementUnreadBadge();
    }
  }

  showTypingIndicator(name, isTyping) {
    const indicator = this.shadowRoot.getElementById('typing-indicator');
    const textEl = indicator.querySelector('.typing-text');
    if (isTyping) {
      textEl.textContent = `${name || 'Someone'} is typing`;
      indicator.style.display = 'flex';
    } else {
      indicator.style.display = 'none';
    }
  }

  addReaction(msgId, emoji, senderId) {
    const bubble = this.shadowRoot.querySelector(`[data-msg-id="${msgId}"]`);
    if (bubble) {
      this.addReactionToBubble(bubble, emoji, senderId);
    }
  }

  addReactionToBubble(bubble, emoji, senderId) {
    const row = bubble.closest('.msg-content-area');
    if (!row) return;

    const reactionsRow = row.querySelector('.msg-reactions-row');
    if (!reactionsRow) return;

    if (!bubble.reactions) bubble.reactions = {};

    // Remove previous reaction from this sender if any
    for (const e in bubble.reactions) {
      bubble.reactions[e] = bubble.reactions[e].filter(id => id !== senderId);
      if (bubble.reactions[e].length === 0) delete bubble.reactions[e];
    }

    // Add new one
    if (emoji) {
      if (!bubble.reactions[emoji]) bubble.reactions[emoji] = [];
      bubble.reactions[emoji].push(senderId);
    }

    // Remove old badges
    const oldBadges = reactionsRow.querySelectorAll('.msg-reaction-badge');
    oldBadges.forEach(b => b.remove());

    const myId = this.localSocketId || 'local';

    for (const e in bubble.reactions) {
      const badge = document.createElement('div');
      badge.className = 'msg-reaction-badge';
      if (bubble.reactions[e].includes(myId)) badge.classList.add('mine');
      badge.innerHTML = `<span>${e}</span><span>${bubble.reactions[e].length}</span>`;

      badge.addEventListener('click', (eEvent) => {
        eEvent.stopPropagation();
        const mine = bubble.reactions[e].includes(myId);
        const newEmoji = mine ? null : e;

        // Track local emoji preference state
        bubble.dataset.myEmoji = newEmoji || "";
        this.addReactionToBubble(bubble, newEmoji, myId);

        this.callEngine('broadcast', {
          type: 'MESSAGE_REACTION',
          msgId: bubble.dataset.msgId,
          emoji: newEmoji,
          senderId: myId
        });
      });

      // Append badges into the reactions row
      reactionsRow.appendChild(badge);
    }
  }

  deleteMessage(msgId) {
    const bubble = this.shadowRoot.querySelector(`[data-msg-id="${msgId}"]`);
    if (bubble) {
      const row = bubble.closest('.message-row');
      if (row) row.remove();
    }
  }

  incrementUnreadBadge() {
    if (!this.chatContainer.classList.contains('visible')) {
      this.unreadCount++;
      this.unreadBadge.style.display = 'flex';
      this.unreadBadge.textContent = this.unreadCount > 9 ? '9+' : this.unreadCount;
    }
  }

  clearUnreadBadge() {
    this.unreadCount = 0;
    this.unreadBadge.style.display = 'none';
  }

  addSystemMessage(text) {
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.textContent = text;
    this.chatBody.appendChild(notif);
    this.scrollToBottom();
  }

  // Alias used by sync-engine.js callChat('showNotification', ...)
  // Engine calls this on play/pause/seek/reconnect events
  showNotification(text) {
    this.addSystemMessage(text);
  }

  triggerEmojiBurst(emoji) {
    const burstCount = 16;
    for (let i = 0; i < burstCount; i++) {
      setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'emoji-particle';
        el.textContent = emoji;

        // Full-screen spread: random position across the entire bottom of viewport
        const startX = 3 + Math.random() * 94;
        const startY = 75 + Math.random() * 20;

        el.style.left = startX + 'vw';
        el.style.top = startY + 'vh';
        // Slight random horizontal drift per particle
        el.style.setProperty('--drift', (Math.random() * 60 - 30) + 'px');

        this.shadowRoot.appendChild(el);
        setTimeout(() => el.remove(), 2800);
      }, i * 80);
    }
  }

  scrollToBottom() {
    this.chatBody.scrollTop = this.chatBody.scrollHeight;
  }

  updateOnlineUsers(users) {
    const bar = this.shadowRoot.getElementById('active-user-bar');
    if (!bar) return;

    bar.innerHTML = '';

    if (!users || users.length === 0) return;

    // Palette for deterministic fallback avatar colors (used when no photo)
    const palette = [
      '#e52e71', '#ff8a00', '#a259ff', '#00c2ff',
      '#11998e', '#ee0979', '#f7971e', '#764ba2'
    ];

    const getColor = (name) => {
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
      }
      return palette[Math.abs(hash) % palette.length];
    };

    const getInitial = (name) => {
      const cleaned = name.replace('(You)', '').trim();
      return cleaned.charAt(0).toUpperCase();
    };

    const buildInitialsAvatar = (name) => {
      const canvas = document.createElement('canvas');
      canvas.width = 20;
      canvas.height = 20;
      const ctx = canvas.getContext('2d');
      const color = getColor(name);

      // Background circle
      ctx.beginPath();
      ctx.arc(10, 10, 10, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Subtle radial highlight
      const grad = ctx.createRadialGradient(7, 5, 1, 10, 10, 10);
      grad.addColorStop(0, 'rgba(255,255,255,0.25)');
      grad.addColorStop(1, 'rgba(0,0,0,0.15)');
      ctx.beginPath();
      ctx.arc(10, 10, 10, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Initial letter
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(getInitial(name), 10, 11);

      return canvas.toDataURL();
    };

    users.forEach((user) => {
      // Support both old string format and new {name, photo} format
      const name = typeof user === 'object' ? user.name : user;
      const photo = typeof user === 'object' ? (user.photo || '') : '';
      const isMe = name.includes('(You)');
      const displayName = name.replace('(You)', '').trim() + (isMe ? ' (You)' : '');

      const img = document.createElement('img');
      img.className = 'active-user-avatar';
      img.title = displayName;

      if (photo) {
        // Real profile picture
        img.src = photo;
        img.onerror = () => { img.src = buildInitialsAvatar(name); };
      } else {
        // Fallback: canvas initials avatar
        img.src = buildInitialsAvatar(name);
      }

      // Highlight yourself with a warm glow
      if (isMe) {
        img.style.border = '1.5px solid rgba(255, 138, 0, 0.9)';
        img.style.boxShadow = '0 0 5px rgba(255, 138, 0, 0.6)';
      }

      bar.appendChild(img);
    });
  }
}

// Global initialization with error boundary
(function initGhostChat() {
  try {
    window.visionSyncChat = new GhostChat();
    console.log('[VisionSync Elite] GhostChat initialized successfully');
  } catch (error) {
    console.error('[VisionSync Elite] GhostChat initialization failed:', error);
    // Report error to background for debugging
    try {
      chrome.runtime.sendMessage({
        type: 'CONTENT_SCRIPT_ERROR',
        script: 'ghost-chat.js',
        error: error.message,
        stack: error.stack
      });
    } catch (e) {
      // Background might not be available
    }
  }
})();
