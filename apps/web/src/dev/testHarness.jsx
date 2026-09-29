// Shared test helpers (used by *.test.* files of risk / rig / alerts). Not imported by the app.
import React from 'react';
import { configure, render } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setupServer } from 'msw/node';
import { handlers } from '../mocks/handlers';
import { db } from '../mocks/db';
import { ACTIVE_WELLBORE_ID, MOCK_USER_ID } from '../mocks/ids';
import { resetMockAlertViews } from '../mocks/handlers/alerts';
import { resetSoundForTests } from '../features/alerts/sound';
import { resetViewedForTests } from '../lib/hooks/alerts';
import { setMockConnection } from '../lib/realtime';

// The whole suite runs in parallel on loaded machines: be generous with async waits.
configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 30000 });

export const clone = (x) => JSON.parse(JSON.stringify(x));

export function createServer() {
  return setupServer(...handlers);
}

/** Node's fetch rejects relative URLs; resolve them against the jsdom origin like a browser would. */
export function installRelativeFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' && input.startsWith('/') ? new URL(input, window.location.origin).href : input;
    return original(url, init);
  };
  return () => {
    globalThis.fetch = original;
  };
}

/** Back to the fixtures: alerts, risk scores, stream state, alert views, sound, "viewed" memory. */
export function resetMockState() {
  db.reset();
  resetMockAlertViews();
  resetViewedForTests();
  resetSoundForTests();
  setMockConnection(true);
  localStorage.removeItem('nwis_mock_role');
}

export function makeProfile(role = 'rtoc_engineer', extra = {}) {
  return {
    id: MOCK_USER_ID,
    email: `${role}@example.test`,
    full_name: 'Test User',
    role,
    assigned_wellbore_ids: role === 'rig_engineer' ? [ACTIVE_WELLBORE_ID] : [],
    ...extra,
  };
}

/** Render `ui` with a fresh QueryClient and a router at `route` (with an optional route `path` pattern). */
export function renderApp(ui, { route = '/', path = '*', strict = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const utils = render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
  return { ...utils, queryClient };
}

/** Fake Notification constructor that records every notification shown. */
export function installFakeNotification(permission = 'granted') {
  const original = globalThis.Notification;
  const shown = [];
  class FakeNotification {
    constructor(title, options) {
      this.title = title;
      this.options = options;
      this.closed = false;
      shown.push(this);
    }

    close() {
      this.closed = true;
    }

    static requestPermission = async () => FakeNotification.permission;
  }
  FakeNotification.permission = permission;
  globalThis.Notification = FakeNotification;
  return {
    shown,
    restore: () => {
      globalThis.Notification = original;
    },
  };
}
