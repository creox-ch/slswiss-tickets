const { defineConfig } = require('@playwright/test');

/**
 * Три вида тестов в tests/:
 * - unit/         — чистые функции (lib/), браузер не нужен
 * - e2e/          — страницы через next dev; API мокается page.route,
 *                   поэтому Supabase/Payrexx/Resend для тестов НЕ нужны.
 * - integration/  — реальные API-роуты через request-фикстуру (без мока).
 *                   Проверяем только ветки ДО обращения к БД (origin/consent/
 *                   honeypot/time-trap), поэтому заглушечных SUPABASE_* ниже
 *                   достаточно: ленивый supabaseAdmin не инстанцируется, пока
 *                   тест не дойдёт до insert (эти ветки туда не доходят).
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
    // Заглушки, чтобы /api/forms прошёл проверку «база подключена» и integration-
    // тесты дошли до реальных guard-веток. К настоящему Supabase не ходим —
    // ленивый клиент создаётся только на insert, куда эти тесты не заходят.
    env: {
      ...process.env,
      SUPABASE_URL: process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key',
    },
  },
});
