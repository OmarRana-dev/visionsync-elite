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

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_ACTIVE_ROOMS_BG') {
    // If we have cached rooms, send them instantly. Also trigger a refresh for next time.
    sendResponse({ rooms: cachedRooms });
    refreshActiveRooms();
    return false;
  }

  if (message.type === 'LAUNCH_EXTENSION') {
    const tabId = message.tabId;
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
          sendResponse({ status: 'success', message: 'Injected successfully' });
        }).catch(err => {
          sendResponse({ status: 'error', message: err.message });
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
          sendResponse({ status: 'success', message: 'Injected successfully across frames' });
        }).catch(err => {
          sendResponse({ status: 'error', message: err.message });
        });
      }
    });
    
    return true; // Keep message channel open for async response
  }

  // Cross-Frame Relay Handlers
  if (message.type === 'RELAY_TO_ENGINE' || message.type === 'RELAY_TO_CHAT') {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.sendMessage(sender.tab.id, message).catch(() => {});
    }
    return false;
  }

  // AUTO JOIN ROOM LOGIC
  if (message.type === 'AUTO_JOIN_ROOM') {
    const { movieUrl, roomId, userName } = message;
    
    chrome.tabs.create({ url: movieUrl }, (newTab) => {
      // Wait for the tab to load
      const listener = (tabId, changeInfo) => {
        if (tabId === newTab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          
          // Small delay to ensure Dailymotion iframes are mounted
          setTimeout(() => {
            // Launch extension
            chrome.runtime.sendMessage({ type: 'LAUNCH_EXTENSION', tabId: newTab.id }, () => {
              // Now automatically join
              setTimeout(() => {
                chrome.tabs.sendMessage(newTab.id, {
                  type: 'JOIN_ROOM',
                  roomId: roomId,
                  userName: userName,
                  isCreate: false,
                  movieUrl: movieUrl
                });
              }, 500); // Give scripts time to initialize
            });
          }, 1500);
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
