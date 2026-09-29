// Shared test support for the wells / workspace / correlation tests (not imported by app code).
// Tests use the real data layer + hooks; MSW answers the PostgREST / RPC / API requests with the mock handlers.
import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { handlers as wellsHandlers, SUPABASE_URL, resetWellsMock } from '../../mocks/handlers/wells';
import { handlers as geoHandlers } from '../../mocks/handlers/geo';

export const REST = `${SUPABASE_URL}/rest/v1`;

/** supabase client whose fetch is resolved at call time, so MSW (started after import) can intercept it. */
export async function createTestSupabase() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(SUPABASE_URL, 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (...args) => globalThis.fetch(...args) },
  });
}

/** Default open-alerts response for tests that render the wells page. */
export const alertsHandler = (rows = []) => http.get(`${REST}/alerts`, () => HttpResponse.json(rows));

export function createServer(...extra) {
  return setupServer(...extra, alertsHandler(), ...wellsHandlers, ...geoHandlers);
}

/** Node's fetch needs absolute URLs; the app calls relative `/api/...`. Wrap whatever fetch is installed now. */
export function allowRelativeFetch() {
  const inner = globalThis.fetch;
  globalThis.fetch = (input, init) => inner(typeof input === 'string' && input.startsWith('/') ? `http://localhost:3000${input}` : input, init);
  return () => {
    globalThis.fetch = inner;
  };
}

export function resetMocks() {
  resetWellsMock();
}

export function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } });
}

/** Render `ui` at `route`, mounted on `path` (so useParams works) inside Query + Router providers. */
export function renderRoute(ui, { path = '/', route = '/', client = makeQueryClient() } = {}) {
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

/** Like renderRoute but takes a full <Routes> element (nested routes, layouts with <Outlet/>). */
export function renderApp(routes, { route = '/', client = makeQueryClient() } = {}) {
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{routes}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
