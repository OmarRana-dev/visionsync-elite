// firebase-config.js — Shared Firebase configuration
// Loaded in: popup (window context) and background SW (self context)
// NOTE: Service worker uses hardcoded values in background.js
//       This file is only needed by popup.html and content scripts.

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBMLd0WLDelhXVXbZ-MZUlFo7nxt9pauQA',
  projectId: 'visionsync-elite',
};

const GOOGLE_CLIENT_ID = '75586347526-si4j7otvq6ngl8iabsbmm0m9b05u13po.apps.googleusercontent.com';

const SOCKET_URL = 'https://visionsync-server.onrender.com';

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

// Export to window (popup, content scripts)
try {
  if (typeof window !== 'undefined') {
    window.FIREBASE_CONFIG = FIREBASE_CONFIG;
    window.GOOGLE_CLIENT_ID = GOOGLE_CLIENT_ID;
    window.FIRESTORE_BASE = FIRESTORE_BASE;
    window.SOCKET_URL = SOCKET_URL;
  }
} catch (e) { /* service worker — handled in background.js directly */ }