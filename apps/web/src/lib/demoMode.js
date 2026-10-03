// Demo mode: the in-browser sample data and mock logins (MSW) switched on at run time, so a production build
// can offer judges "explore with sample data" next to the real sign-in. No Supabase, Space or network needed.
//
//   ?demo=1 in the URL (or the login-page button) turns it on and remembers it in this browser;
//   ?demo=0 turns it off (and remembers that too).
//   VITE_DEMO_DEFAULT=on  a visitor with no remembered choice starts in demo mode (a public site without a backend);
//   VITE_DEMO_MODE=off    removes the option from a build;  VITE_USE_MOCKS=true  forces mocks for everyone.
const KEY = 'nwis.demo';

export const demoAllowed = () => import.meta.env.VITE_DEMO_MODE !== 'off';
const demoDefault = () => import.meta.env.VITE_DEMO_DEFAULT === 'on';

function readFlag() {
  try {
    const param = new URLSearchParams(window.location.search).get('demo');
    if (param === '1' || param === '0') window.localStorage.setItem(KEY, param);
    const stored = window.localStorage.getItem(KEY);
    return stored === null ? demoDefault() : stored === '1';
  } catch {
    return demoDefault(); // storage blocked: nothing can be remembered, so the build's default applies
  }
}

/** True when the app should run on the mocks: built that way, or demo mode is on in this browser. */
export const isDemoActive = () => import.meta.env.VITE_USE_MOCKS === 'true' || (demoAllowed() && readFlag());

export function setDemoMode(on) {
  try {
    window.localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* nothing to remember */
  }
  // a full reload: the worker, the auth provider and the data layer all pick their mode once at start
  window.location.assign(window.location.pathname.startsWith('/login') ? '/login' : '/');
}
