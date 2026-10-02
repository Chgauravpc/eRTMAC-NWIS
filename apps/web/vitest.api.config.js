import { defineConfig } from 'vitest/config';

// Tests of the Vercel Node functions in api/ (BE-20). Run with `npm run test:api`.
// A separate config because the frontend's setup file needs a DOM and these run in plain Node, like production.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['api/**/*.test.js'],
    globals: true,
    testTimeout: 10000,
  },
});
