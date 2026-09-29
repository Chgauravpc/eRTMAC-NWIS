import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './index.css';

const useMocks = import.meta.env.VITE_USE_MOCKS === 'true';

// Only the API surfaces we mock are worth a warning when unhandled; static assets, Vite modules and
// map tiles are same-origin/third-party requests that are supposed to pass through.
const MOCKED_PREFIXES = ['/api/', '/rest/v1/', '/auth/v1/', '/storage/v1/', '/functions/v1/'];

async function startMocks() {
  const { worker } = await import('./mocks/browser.js');
  return worker.start({
    // WARN (not bypass): a missing handler shows up in the console instead of silently hitting the network.
    onUnhandledRequest(request, print) {
      const { pathname } = new URL(request.url);
      if (MOCKED_PREFIXES.some((p) => pathname.startsWith(p))) print.warning();
    },
  });
}

// DevPanel (bottom-right, mock mode only) is code-split so it never ships to production users.
const DevPanel = useMocks ? React.lazy(() => import('./dev/DevPanel').then((m) => ({ default: m.DevPanel }))) : null;

async function bootstrap() {
  if (useMocks) await startMocks();
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
      {DevPanel && (
        <React.Suspense fallback={null}>
          <DevPanel />
        </React.Suspense>
      )}
    </React.StrictMode>,
  );
}

bootstrap();
