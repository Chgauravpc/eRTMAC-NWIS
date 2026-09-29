import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// Heavy render tests (Plotly/Leaflet stubs, MSW round-trips) exceed the 1 s default under parallel load.
configure({ asyncUtilTimeout: 8000 });

afterEach(() => cleanup());

// jsdom lacks these; components (Leaflet, Plotly, wake lock, sound) probe for them.
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
