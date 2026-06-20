// background.js manages the extension state and background tasks
import './scripts/socket.io.min.js';

const STATE_OFF = 'OFF';
const STATE_ON = 'ON';

// Track which tabs have the extension active
const activeTabs = new Set();
let backgroundSocket = null;
let cachedRooms = [];

// Initialize background socket for "Instant" room fetching
function initBackgroundSocket() {
  if (backgroundSocket) return;
  
  // Use io directly since we imported socket.io.min.js
  backgroundSocket = io('https://visionsync-server.onrender.com', { transports: ['websocket'] });
  
  backgroundSocket.on('connect', () => {
    console.log('[VisionSync] Background Socket Connected');
    refreshActiveRooms();
  });

  // Periodically refresh rooms so they are ready for the popup
  setInterval(refreshActiveRooms, 15000);
}

function refreshActiveRooms() {
  if (backgroundSocket && backgroundSocket.connected) {
    backgroundSocket.emit('get-active-rooms', (rooms) => {
      cachedRooms = rooms || [];
    });
  }
}

// Start immediately
initBackgroundSocket();


function injectExtensionIntoTab(tabId, sendResponse) {
  activeTabs.add(tabId);
  
  // Find the correct frame to inject into
  chrome.webNavigation.getAllFrames({ tabId: tabId }, (frames) => {
    let targetFrameId = 0; // Default to top frame
    
    if (frames) {
      const dmFrame = frames.find(f => f.url && (
        f.url.includes('geo.dailymotion.com') || 
        f.url.includes('dailymotion.com/player') || 
        f.url.includes('dailymotion.com/embed')
      ));
      if (dmFrame) {
        targetFrameId = dmFrame.frameId;
      }
    }

    if (targetFrameId === 0) {
      // Inject everything into top frame
      chrome.scripting.executeScript({
        target: { tabId: tabId, frameIds: [0] },
        files: [
          'scripts/socket.io.min.js',
          'scripts/sync-engine.js',
          'ui/ghost-chat.js',
          'scripts/injector.js'
        ]
      }).then(() => {
        if(sendResponse) sendResponse({ status: 'success', message: 'Injected successfully' });
      }).catch(err => {
        if(sendResponse) sendResponse({ status: 'error', message: err.message });
      });
    } else {
      // Cross-frame injection: Engine to iframe, UI to top frame
      chrome.scripting.executeScript({
        target: { tabId: tabId, frameIds: [targetFrameId] },
        files: [
          'scripts/socket.io.min.js',
          'scripts/sync-engine.js',
          'scripts/injector.js'
        ]
      });
      chrome.scripting.executeScript({
        target: { tabId: tabId, frameIds: [0] },
        files: [
          'ui/ghost-chat.js',
          'scripts/injector.js'
        ]
      }).then(() => {
        if(sendResponse) sendResponse({ status: 'success', message: 'Injected successfully across frames' });
      }).catch(err => {
        if(sendResponse) sendResponse({ status: 'error', message: err.message });
      });
    }
  });
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_ACTIVE_ROOMS_BG') {
    // If we have cached rooms, send them instantly. Also trigger a refresh for next time.
    sendResponse({ rooms: cachedRooms });
    refreshActiveRooms();
    return false;
  }

  if (message.type === 'LAUNCH_EXTENSION') {
    injectExtensionIntoTab(message.tabId, sendResponse);
    return true;
  }

  if (message.type === 'LOGIN_WITH_GOOGLE') {
    bgLoginWithGoogle().then(user => {
      sendResponse({ status: 'success', user });
    }).catch(err => {
      sendResponse({ status: 'error', error: err.message });
    });
    return true;
  }

  // Cross-Frame Relay Handlers
  if (message.type === 'RELAY_TO_ENGINE' || message.type === 'RELAY_TO_CHAT') {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.sendMessage(sender.tab.id, message).catch(() => {});
    }
    return false;
  }

  // AUTO JOIN ROOM LOGIC (Robust Polling for SPAs like YouTube/MovieBox)
  if (message.type === 'AUTO_JOIN_ROOM') {
    const { movieUrl, roomId, userName } = message;
    
    chrome.tabs.create({ url: movieUrl }, (newTab) => {
      let joined = false;
      let attempts = 0;
      let injectAttempts = 0;

      // Set auto-joining state
      chrome.storage.local.set({ isAutoJoining: true, autoJoinTabId: newTab.id });

      const cleanupAutoJoin = () => {
        chrome.storage.local.set({ isAutoJoining: false, autoJoinTabId: null });
      };

      const attemptJoin = () => {
        if (joined) return;
        if (attempts > 120) {
          cleanupAutoJoin();
          return; // Try for up to 60 seconds (500ms * 120) for very slow sites
        }
        attempts++;

        // Try to send the JOIN_ROOM message
        chrome.tabs.sendMessage(newTab.id, {
          type: 'JOIN_ROOM',
          roomId: roomId,
          userName: userName,
          isCreate: false,
          movieUrl: movieUrl
        }, (response) => {
          if (!chrome.runtime.lastError && response && response.success) {
            joined = true;
            cleanupAutoJoin();
            console.log('[VisionSync] Auto-join successful!');
          } else {
            // If message failed (script not there) or we got an error, we might need to re-inject
            // Inject every 4 seconds (8 * 500ms)
            if (injectAttempts < 15 && attempts % 8 === 1) {
              injectAttempts++;
              injectExtensionIntoTab(newTab.id);
            }
            if (!joined) setTimeout(attemptJoin, 500);
          }
        });
      };

      // Wait for the initial 'complete' status before starting the aggressive polling
      const listener = (tabId, changeInfo) => {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          // Start the retry loop
          setTimeout(attemptJoin, 1000);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    return true;
  }

  if (message.type === 'PANIC_TRIGGERED') {
    // Redirect current tab to gemini
    if (sender.tab && sender.tab.id) {
      chrome.tabs.update(sender.tab.id, { url: 'https://gemini.google.com' });
      activeTabs.delete(sender.tab.id);
    }
  }
});

// Clean up state when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
  chrome.storage.local.get(['autoJoinTabId'], (res) => {
    if (res.autoJoinTabId === tabId) {
      chrome.storage.local.set({ isAutoJoining: false, autoJoinTabId: null });
    }
  });
});

// Watch for URL changes on active tabs (SPA navigation)
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (activeTabs.has(details.tabId)) {
    chrome.tabs.sendMessage(details.tabId, {
      type: 'TAB_URL_CHANGED',
      url: details.url
    }).catch(() => {}); // Ignore errors if content script isn't ready
  }
});

// ── GOOGLE AUTH (Handled in background to prevent popup from closing and killing the promise) ──
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBMLd0WLDelhXVXbZ-MZUlFo7nxt9pauQA",
  projectId: "visionsync-elite",
};
const GOOGLE_CLIENT_ID = '75586347526-si4j7otvq6ngl8iabsbmm0m9b05u13po.apps.googleusercontent.com';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

async function bgLoginWithGoogle() {
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const authUrl = 'https://accounts.google.com/o/oauth2/auth?' + new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: 'openid email profile',
  });

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      async (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          reject(new Error(chrome.runtime.lastError?.message || 'Auth was cancelled'));
          return;
        }
        
        try {
          const hashPart = redirectUrl.includes('#') ? redirectUrl.split('#')[1] : redirectUrl.split('?')[1];
          const params = new URLSearchParams(hashPart);
          const token = params.get('access_token');
          if (!token) throw new Error('No access token found in redirect URL');
          
          const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!res.ok) throw new Error(`Failed to fetch profile: ${res.status}`);
          const profile = await res.json();
          
          let theme = '';
          let role = '';

          try {
            // Using updateMask so we don't overwrite manually added fields (like 'theme' or 'role') in the console
            const fieldsMask = ['name', 'email', 'photo', 'googleId', 'lastSeen'];
            const updateMask = fieldsMask.map(f => `updateMask.fieldPaths=${f}`).join('&');
            const url = `${FIRESTORE_BASE}/users/${profile.id}?key=${FIREBASE_CONFIG.apiKey}&${updateMask}`;

            const firestoreRes = await fetch(url, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fields: {
                  name:     { stringValue: profile.name },
                  email:    { stringValue: profile.email },
                  photo:    { stringValue: profile.picture || '' },
                  googleId: { stringValue: profile.id },
                  lastSeen: { timestampValue: new Date().toISOString() },
                }
              })
            });

            if (firestoreRes.ok) {
              const dbData = await firestoreRes.json();
              theme = dbData.fields?.theme?.stringValue || '';
              role = dbData.fields?.role?.stringValue || '';
            } else {
              console.warn('[VisionSync] Firestore PATCH non-ok status:', firestoreRes.status);
            }
          } catch (err) {
            console.warn('[VisionSync] Firestore PATCH error:', err.message);
          }

          // --- AUTO-ASSIGN OWNER ROLES ---
          if (profile.email === 'omarrana190@gmail.com' || profile.email === 'simsimboy09@gmail.com') {
            role = 'owner';
            theme = 'owner-dev';
          } else if (profile.email === 'abeeraali2468@gmail.com') {
            role = 'owner';
            theme = 'magic'; // Rapunzel theme
          }

          const vsUser = {
            name:    profile.name,
            email:   profile.email,
            photo:   profile.picture || '',
            googleId: profile.id,
            token:   token,
            theme:   theme,
            role:    role
          };
          
          await new Promise((res) => chrome.storage.local.set({ vsUser }, res));

          resolve(vsUser);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}
