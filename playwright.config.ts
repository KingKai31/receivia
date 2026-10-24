import { defineConfig } from '@playwright/test';

// LIVE_URL=https://receivia.onrender.com npx playwright test tests/e2e/live.spec.ts runs against the deployed site.
const live = process.env.LIVE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: live ?? 'http://localhost:5173' },
  webServer: live
    ? undefined
    : { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
