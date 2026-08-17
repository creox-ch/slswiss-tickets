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
    // ленивый клиент создаётся только на insert/select, куда эти тесты не заходят.
    // CHECKIN_STAFF_KEY / PAYREXX_WEBHOOK_SIGNING_KEY / CRON_SECRET — фиксированные
    // значения, чтобы integration-тесты проверяли auth-ветку сканера, HMAC-подпись
    // вебхука и защиту cron-роутов на HTTP-границе (детерминированно, без внешних
    // сервисов).
    env: {
      ...process.env,
      SUPABASE_URL: process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key',
      CHECKIN_STAFF_KEY: process.env.CHECKIN_STAFF_KEY || 'test-staff-key',
      PAYREXX_WEBHOOK_SIGNING_KEY: process.env.PAYREXX_WEBHOOK_SIGNING_KEY || 'test-webhook-signing-key',
      CRON_SECRET: process.env.CRON_SECRET || 'test-cron-secret',
    },
  },
});
