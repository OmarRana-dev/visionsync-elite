// injector.js is responsible for setting up the environment on the host page
// It loads the required modules dynamically onto the page

console.log('[VisionSync Elite] Injector initialized');

// Check if we already injected to prevent double-injections
if (!window._visionSyncInjected) {
  window._visionSyncInjected = true;
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ status: 'PONG' });
    }
  });
  
  console.log('[VisionSync Elite] Modules loaded securely via executeScript.');
} else {
  console.log('[VisionSync Elite] Already injected.');
}
