import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './index.css';
import { DevPanel } from './dev/DevPanel';

async function deferRender() {
  if (import.meta.env.VITE_USE_MOCKS === 'true') {
    const { worker } = await import('./mocks/browser.js');
    return worker.start({ onUnhandledRequest: 'bypass' });
  }
}

deferRender().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
      <DevPanel />
    </React.StrictMode>,
  );
});
