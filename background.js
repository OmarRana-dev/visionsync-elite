// background.js — Service Worker (Manifest V3)
// VisionSync Elite: Zero-Latency Event-Driven P2P Sync Engine

// Import Socket.IO first (UMD format, must use importScripts in SW)
importScripts('./scripts/socket.io.min.js');

// ── Configuration (hardcoded — no build step needed) ──────────────────────
const SOCKET_URL = 'https://visionsync-server.onrender.com';
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBMLd0WLDelhXVXbZ-MZUlFo7nxt9pauQA',
  projectId: 'visionsync-elite',
};
const GOOGLE_CLIENT_ID = '75586347526-si4j7otvq6ngl8iabsbmm0m9b05u13po.apps.googleusercontent.com';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

// ── State ──────────────────────────────────────────────────────────────────
let socket = null;
let pendingInjections = new Map();
let syncStates = new Map();

// ── Socket.IO connection ───────────────────────────────────────────────────
function initSocket() {
  if (socket?.connected) return;

  socket = io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    console.log('[VisionSync BG] Socket connected:', socket.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('[VisionSync BG] Socket disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.error('[VisionSync BG] Connection error:', err.message);
  });
}

initSocket();

// ── Content-script injection ───────────────────────────────────────────────
const SUPPORTED_SITES = [
  'moviebox.com', 'movieboxpro.app', 'showbox.media',
  'netmirror.com', 'netmirror.app', 'netflix.com',
  'dailymotion.com', 'youtube.com', 'localhost'
];

function isSupportedUrl(url) {
  try {
    const { hostname } = new URL(url);
    return SUPPORTED_SITES.some(site => hostname.includes(site));
  } catch {
    return false;
  }
}

async function injectContentScripts(tabId) {
  // Avoid double injection by pinging first
  try {
    const existing = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (existing && existing.status === 'PONG') {
      console.log('[VisionSync BG] Already injected in tab', tabId);
      return { success: true, alreadyActive: true };
    }
  } catch {
    // Not injected yet — proceed
  }

  const files = [
    'scripts/firebase-config.js',
    'scripts/socket.io.min.js',
    'scripts/sync-engine.js',
    'ui/ghost-chat.js',
    'scripts/injector.js'
  ];

  for (const file of files) {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  }

  console.log('[VisionSync BG] Content scripts injected into tab', tabId);
  return { success: true };
}

// ── Google OAuth login (handled in background so token survives popup close) ─
async function loginWithGoogle() {
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const authUrl = 'https://accounts.google.com/o/oauth2/auth?' + new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: 'openid email profile',
  });

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        return reject(new Error(chrome.runtime.lastError?.message || 'Auth cancelled'));
      }
      const hashPart = redirectUrl.includes('#') ? redirectUrl.split('#')[1] : redirectUrl.split('?')[1];
      const params = new URLSearchParams(hashPart);
      const token = params.get('access_token');
      if (!token) return reject(new Error('No access token in redirect URL'));

      // Fetch Google profile
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!profileRes.ok) return reject(new Error('Failed to fetch profile'));
      const profile = await profileRes.json();

      // Persist to Firestore (optional, non-blocking)
      let theme = '', role = '';
      try {
        const fieldsMask = ['name', 'email', 'photo', 'googleId', 'lastSeen'];
        const updateMask = fieldsMask.map(f => `updateMask.fieldPaths=${f}`).join('&');
        const fsUrl = `${FIRESTORE_BASE}/users/${profile.id}?key=${FIREBASE_CONFIG.apiKey}&${updateMask}`;
        const fsRes = await fetch(fsUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              name: { stringValue: profile.name },
              email: { stringValue: profile.email },
              photo: { stringValue: profile.picture || '' },
              googleId: { stringValue: profile.id },
              lastSeen: { timestampValue: new Date().toISOString() },
            }
          })
        });
        if (fsRes.ok) {
          const fsData = await fsRes.json();
          theme = fsData.fields?.theme?.stringValue || '';
          role = fsData.fields?.role?.stringValue || '';
        }
      } catch (e) {
        console.warn('[VisionSync BG] Firestore sync skipped:', e.message);
      }

      const vsUser = {
        name: profile.name,
        email: profile.email,
        photo: profile.picture || '',
        googleId: profile.id,
        token,
        theme,
        role,
      };

      await new Promise(res => chrome.storage.local.set({ vsUser }, res));
      resolve(vsUser);
    });
  });
}

// ── Message handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message;

  switch (type) {

    // ── LAUNCH: inject scripts into the current tab ──────────────────────
    case 'LAUNCH_EXTENSION': {
      const tabId = message.tabId;
      if (!tabId) {
        sendResponse({ success: false, error: 'No tabId provided' });
        return true;
      }

      // Get the tab URL to verify it's supported
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          sendResponse({ success: false, error: 'Tab not found' });
          return;
        }

        // Allow injection on any page (removed site restriction — user chose to launch)
        injectContentScripts(tabId)
          .then(result => sendResponse(result))
          .catch(err => sendResponse({ success: false, error: err.message }));
      });
      return true; // async
    }

    // ── GOOGLE LOGIN (proxied through background so popup close doesn't kill it)
    case 'LOGIN_WITH_GOOGLE': {
      loginWithGoogle()
        .then(user => sendResponse({ status: 'success', user }))
        .catch(err => sendResponse({ status: 'error', error: err.message }));
      return true; // async
    }

    // ── SIGN OUT: revoke token + clear storage ───────────────────────────
    case 'SIGN_OUT': {
      chrome.storage.local.get(['vsUser'], async (result) => {
        const user = result.vsUser;
        if (user && user.token) {
          try {
            await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${user.token}`);
          } catch (e) { /* ignore */ }
          await new Promise(res => chrome.identity.removeCachedAuthToken({ token: user.token }, res));
        }
        await new Promise(res => chrome.storage.local.remove(['vsUser', 'authPending', 'userName'], res));
        sendResponse({ success: true });
      });
      return true; // async
    }

    // ── ACTIVE ROOMS: get from socket ────────────────────────────────────
    case 'GET_ACTIVE_ROOMS_BG': {
      if (socket && socket.connected) {
        socket.emit('get-active-rooms', (rooms) => {
          sendResponse({ rooms: rooms || [] });
        });
      } else {
        sendResponse({ rooms: [] });
      }
      return true;
    }

    // ── TAB SYNC STATE ───────────────────────────────────────────────────
    case 'REGISTER_TAB': {
      const { roomId, tabId: rTabId } = message;
      if (!syncStates.has(roomId)) syncStates.set(roomId, { tabs: [] });
      const state = syncStates.get(roomId);
      if (!state.tabs.includes(rTabId)) state.tabs.push(rTabId);
      sendResponse({ success: true });
      return true;
    }

    case 'UNREGISTER_TAB': {
      const { roomId, tabId: uTabId } = message;
      if (syncStates.has(roomId)) {
        const state = syncStates.get(roomId);
        state.tabs = state.tabs.filter(t => t !== uTabId);
        if (state.tabs.length === 0) syncStates.delete(roomId);
      }
      sendResponse({ success: true });
      return true;
    }

    default:
      break;
  }
});

// ── Auto-inject on supported sites when page loads ─────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && isSupportedUrl(tab.url)) {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      if (pong?.status === 'PONG') return; // already injected
    } catch {
      // not yet injected — inject
    }
    try {
      await injectContentScripts(tabId);
    } catch (e) {
      console.warn('[VisionSync BG] Auto-inject failed:', e.message);
    }
  }
});

// ── Tab cleanup ────────────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  syncStates.forEach((state, roomId) => {
    state.tabs = state.tabs.filter(t => t !== tabId);
    if (state.tabs.length === 0) syncStates.delete(roomId);
  });
});

// ── On install ────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[VisionSync Elite] Installed v' + chrome.runtime.getManifest().version);
  }
});

console.log('[VisionSync Elite] Background service worker started');