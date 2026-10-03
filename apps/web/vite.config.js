import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // One env file for the whole repo: <repo>/.env. Only VITE_* variables are exposed to the browser.
  envDir: '../..',
  build: {
    rollupOptions: {
      output: {
        // Long-lived libraries get their own files so a deploy of app code does not invalidate them.
        // (Plotly and Leaflet are not listed: they load on demand with the pages that use them.)
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run)\//.test(id)) return 'vendor-react';
          if (id.includes('@supabase') || id.includes('iceberg-js')) return 'vendor-supabase';
          if (/node_modules\/(@tanstack|date-fns|tailwind-merge|clsx|lucide-react)\//.test(id)) return 'vendor-misc';
          return undefined;
        },
      },
    },
    // Plotly is 4.7 MB by itself and is fetched only when the Correlation tab opens.
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
