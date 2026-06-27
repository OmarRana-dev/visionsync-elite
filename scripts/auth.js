// auth.js — VisionSync Elite | Google Sign-In via Chrome Identity API + Firebase Firestore
// Firebase config is loaded from firebase-config.js (injected at build time)
// Do NOT hardcode API keys here!

const FIREBASE_CONFIG = window.FIREBASE_CONFIG || {};
const GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || '';
const FIRESTORE_BASE = window.FIRESTORE_BASE || '';

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
    const fieldsMask = ['name', 'email', 'photo', 'googleId', 'lastSeen'];
    const updateMask = fieldsMask.map(f => `updateMask.fieldPaths=${f}`).join('&');
    const url = `${FIRESTORE_BASE}/users/${profile.id}?key=${FIREBASE_CONFIG.apiKey}&${updateMask}`;

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
    if (res.ok) {
      const data = await res.json();
      return {
        theme: data.fields?.theme?.stringValue || '',
        role: data.fields?.role?.stringValue || ''
      };
    }
    console.warn('[VisionSync] Firestore PATCH failed:', await res.text());
  } catch (err) {
    console.warn('[VisionSync] Firestore error:', err.message);
  }
  return { theme: '', role: '' };
}

// ─────────────────────────────────────────────
// Full login flow: OAuth → profile → persist locally → sync to DB
// ─────────────────────────────────────────────
async function loginWithGoogle() {
  const token = await signInWithGoogle();
  const profile = await fetchGoogleProfile(token);

  // Sync with Firestore first (or fallback) to fetch role/theme
  const dbData = await saveUserToFirestore(profile);

  let theme = dbData.theme;
  let role = dbData.role;


  const vsUser = {
    name:    profile.name,
    email:   profile.email,
    photo:   profile.picture || '',
    googleId: profile.id,
    token:   token,
    theme:   theme,
    role:    role
  };

  await new Promise((resolve) => chrome.storage.local.set({ vsUser }, resolve));

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
  const user = await getCurrentUser();
  if (user && user.token) {
    try {
      // Revoke the token on Google's end
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${user.token}`);
    } catch (e) {
      console.warn('Failed to revoke token', e);
    }
    // Remove the cached token from Chrome Identity API
    await new Promise((resolve) => chrome.identity.removeCachedAuthToken({ token: user.token }, resolve));
  }
  await new Promise((resolve) => chrome.storage.local.remove(['vsUser'], resolve));
}

// Export for use in popup.js
window.vsAuth = { loginWithGoogle, getCurrentUser, signOut };
