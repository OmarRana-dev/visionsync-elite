// auth.js — VisionSync Elite | Google Sign-In via Chrome Identity API + Firebase Firestore

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBMLd0WLDelhXVXbZ-MZUlFo7nxt9pauQA",
  projectId: "visionsync-elite",
};

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
          reject(new Error(chrome.runtime.lastError?.message || 'Auth was cancelled'));
          return;
        }
        // Extract the access_token from the hash fragment
        const hashPart = redirectUrl.includes('#') ? redirectUrl.split('#')[1] : redirectUrl.split('?')[1];
        const params = new URLSearchParams(hashPart);
        const token = params.get('access_token');
        if (!token) {
          reject(new Error('No access token found in redirect URL'));
          return;
        }
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
  if (!res.ok) throw new Error(`Failed to fetch profile: ${res.status}`);
  return res.json(); // { id, name, email, picture }
}

// ─────────────────────────────────────────────
// Save / update user document in Firestore (non-blocking)
// ─────────────────────────────────────────────
async function saveUserToFirestore(profile) {
  try {
    const url = `${FIRESTORE_BASE}/users/${profile.id}?key=${FIREBASE_CONFIG.apiKey}`;
    const res = await fetch(url, {
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
    if (!res.ok) console.warn('[VisionSync] Firestore save failed (non-critical):', await res.text());
  } catch (err) {
    // Firestore failure is non-critical — user is still locally authenticated
    console.warn('[VisionSync] Firestore error (non-critical):', err.message);
  }
}

// ─────────────────────────────────────────────
// Full login flow: OAuth → profile → persist locally → sync to DB
// ─────────────────────────────────────────────
async function loginWithGoogle() {
  const token = await signInWithGoogle();
  const profile = await fetchGoogleProfile(token);

  // CRITICAL: Save to local storage FIRST, before any network calls that might fail
  const vsUser = {
    name:    profile.name,
    email:   profile.email,
    photo:   profile.picture || '',
    googleId: profile.id,
    token:   token
  };

  await new Promise((resolve) => chrome.storage.local.set({ vsUser }, resolve));

  // Then attempt Firestore sync (failure won't break auth)
  saveUserToFirestore(profile); // intentionally NOT awaited

  return vsUser;
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
  await new Promise((resolve) => chrome.storage.local.remove(['vsUser'], resolve));
}

// Export for use in popup.js
window.vsAuth = { loginWithGoogle, getCurrentUser, signOut };
