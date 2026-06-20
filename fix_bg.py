with open('background.js', 'r') as f:
    content = f.read()

# 1. Add injectExtensionIntoTab function before onMessage listener
helper_fn = """
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
"""

content = content.replace('// Listen for messages from popup or content scripts\n', helper_fn)

# 2. Replace the body of LAUNCH_EXTENSION with the helper call
old_launch = """  if (message.type === 'LAUNCH_EXTENSION') {
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
  }"""

new_launch = """  if (message.type === 'LAUNCH_EXTENSION') {
    injectExtensionIntoTab(message.tabId, sendResponse);
    return true;
  }"""

content = content.replace(old_launch, new_launch)

# 3. Fix AUTO_JOIN_ROOM
old_auto_join = "chrome.runtime.sendMessage({ type: 'LAUNCH_EXTENSION', tabId: newTab.id }, () => {"
new_auto_join = "injectExtensionIntoTab(newTab.id, () => {"
content = content.replace(old_auto_join, new_auto_join)

with open('background.js', 'w') as f:
    f.write(content)

