// auth.js — VisionSync Elite | Google Sign-In via Chrome Identity API + Firebase Firestore
// ⚠️ Replace GOOGLE_CLIENT_ID below with your Web Client ID from Firebase > Authentication > Sign-in method > Google

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBMLd0WLDelhXVXbZ-MZUlFo7nxt9pauQA",
  projectId: "visionsync-elite",
};

// ⚠️ REPLACE THIS with your Web Client ID from Firebase Authentication > Sign-in method > Google
const GOOGLE_CLIENT_ID = '75586347526-si4j7otvq6ngl8iabsbmm0m9b05u13po.apps.googleusercontent.com';

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

// ─────────────────────────────────────────────
// Sign in with Google (using Chrome Identity API)
// ─────────────────────────────────────────────
async function signInWithGoogle() {
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
      (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          reject(chrome.runtime.lastError || new Error('Auth cancelled'));
          return;
        }
        // Extract the access_token from the hash fragment
        const params = new URLSearchParams(redirectUrl.replace(/.*#/, ''));
        const token = params.get('access_token');
        if (!token) { reject(new Error('No token in redirect')); return; }
        resolve(token);
      }
    );
  });
}

// ─────────────────────────────────────────────
// Fetch Google user profile using the access token
// ─────────────────────────────────────────────
async function fetchGoogleProfile(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('Failed to fetch user info');
  return res.json(); // { id, name, email, picture }
}

// ─────────────────────────────────────────────
// Save / update user document in Firestore
// ─────────────────────────────────────────────
async function saveUserToFirestore(profile) {
  const url = `${FIRESTORE_BASE}/users/${profile.id}?key=${FIREBASE_CONFIG.apiKey}`;
  await fetch(url, {
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
}

// ─────────────────────────────────────────────
// Full login flow: Sign in → fetch profile → save to DB → cache locally
// ─────────────────────────────────────────────
async function loginWithGoogle() {
  const token = await signInWithGoogle();
  const profile = await fetchGoogleProfile(token);
  await saveUserToFirestore(profile);

  // Cache in local extension storage for instant access on popup open
  await chrome.storage.local.set({
    vsUser: {
      name:    profile.name,
      email:   profile.email,
      photo:   profile.picture,
      googleId: profile.id,
      token:   token
    }
  });

  return profile;
}

// ─────────────────────────────────────────────
// Get current cached user (no network call)
// ─────────────────────────────────────────────
async function getCurrentUser() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['vsUser'], (result) => {
      resolve(result.vsUser || null);
    });
  });
}

// ─────────────────────────────────────────────
// Sign out — clear local cache
// ─────────────────────────────────────────────
async function signOut() {
  await chrome.storage.local.remove(['vsUser']);
}

// Export for use in popup.js
window.vsAuth = { loginWithGoogle, getCurrentUser, signOut };
