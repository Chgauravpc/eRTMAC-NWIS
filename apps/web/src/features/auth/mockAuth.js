// Mock-mode auth helpers. The mock DB is imported lazily so it never lands in the production bundle
// unless VITE_USE_MOCKS is on (dynamic import + only called in mock mode).
export const MOCK_SESSION_KEY = 'nwis.mock.session';

export function readStoredMockId() {
  try {
    return window.localStorage.getItem(MOCK_SESSION_KEY);
  } catch {
    return null;
  }
}

export function storeMockId(id) {
  try {
    if (id) window.localStorage.setItem(MOCK_SESSION_KEY, id);
    else window.localStorage.removeItem(MOCK_SESSION_KEY);
  } catch {
    /* storage unavailable (private mode): the session just will not survive a reload */
  }
}

/** All realistic mock profiles (one per role) from fixtures/profiles.json, ids resolved via mocks/ids.js. */
export async function loadMockProfiles() {
  const { db } = await import('../../mocks/db');
  return db.profiles.map((p) => ({ ...p }));
}

export async function loadMockProfile(id) {
  const { db } = await import('../../mocks/db');
  const p = db.getProfile(id);
  return p ? { ...p } : null;
}

/** Build the session object the AuthProvider holds in mock mode (same token shape the MSW auth handlers accept). */
export function mockSessionFor(profile) {
  return {
    access_token: `mock-token.${profile.id}`,
    refresh_token: `mock-refresh.${profile.id}`,
    token_type: 'bearer',
    user: { id: profile.id, email: profile.email },
  };
}
