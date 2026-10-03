// Demo mode: the in-browser sample data and mock logins (MSW) switched on at run time, so a production build
// can offer judges "explore with sample data" next to the real sign-in. No Supabase, Space or network needed.
//
//   ?demo=1 in the URL (or the login-page button) turns it on and remembers it in this browser;
//   ?demo=0 turns it off. VITE_DEMO_MODE=off removes the option from a build. VITE_USE_MOCKS=true still forces mocks.
const KEY = 'nwis.demo';

export const demoAllowed = () => import.meta.env.VITE_DEMO_MODE !== 'off';

function readFlag() {
  try {
    const param = new URLSearchParams(window.location.search).get('demo');
    if (param === '1') window.localStorage.setItem(KEY, '1');
    if (param === '0') window.localStorage.removeItem(KEY);
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false; // storage blocked: demo mode needs the URL parameter each time, which also fails: stay real
  }
}

/** True when the app should run on the mocks: built that way, or demo mode is on in this browser. */
export const isDemoActive = () => import.meta.env.VITE_USE_MOCKS === 'true' || (demoAllowed() && readFlag());

export function setDemoMode(on) {
  try {
    if (on) window.localStorage.setItem(KEY, '1');
    else window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to remember */
  }
  // a full reload: the worker, the auth provider and the data layer all pick their mode once at start
  window.location.assign(window.location.pathname.startsWith('/login') ? '/login' : '/');
}
