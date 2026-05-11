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
    
    // Inject necessary scripts sequentially
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: [
          'scripts/socket.io.min.js',
          'scripts/sync-engine.js',
          'ui/ghost-chat.js',
          'scripts/injector.js'
        ]
      }).then(() => {
        sendResponse({ status: 'success', message: 'Injected successfully' });
      }).catch((err) => {
        console.error('Injection failed:', err);
        sendResponse({ status: 'error', message: err.message });
      });
      return true; // Keep message channel open for async response
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
