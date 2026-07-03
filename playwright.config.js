const { defineConfig } = require('@playwright/test');

/**
 * Два вида тестов в tests/:
 * - unit/  — чистые функции (lib/), браузер не нужен
 * - e2e/   — страницы через next dev; API мокается page.route,
 *            поэтому Supabase/Payrexx/Resend для тестов НЕ нужны.
 */
module.exports = defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
