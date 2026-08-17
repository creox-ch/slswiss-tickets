import { test, expect } from '@playwright/test';

/**
 * Integration: cron-роуты закрыты секретом.
 *
 * Оба делают то, что нельзя дать дёрнуть постороннему: сводка отдаёт e-mail
 * подписчиков, чистка меняет и удаляет строки в таблице билетов. Vercel Cron
 * шлёт `Authorization: Bearer $CRON_SECRET` — проверяем, что без него и с
 * неверным значением роут не работает.
 *
 * CRON_SECRET совпадает с playwright.config.js webServer.env.
 * Ветка «секрет верный» до конца не проходит — там реальный Supabase, которого
 * в тестах нет; проверяем только, что она НЕ отбивается как unauthorized.
 */

const CRON_SECRET = 'test-cron-secret';
const ROUTES = ['/api/cron/cleanup-pending', '/api/cron/newsletter-digest'];

for (const route of ROUTES) {
  test.describe(`GET ${route}`, () => {
    test('без заголовка → 401', async ({ request }) => {
      const res = await request.get(route);
      expect(res.status()).toBe(401);
      expect(await res.json()).toMatchObject({ ok: false, error: 'unauthorized' });
    });

    test('чужой секрет → 401', async ({ request }) => {
      const res = await request.get(route, {
        headers: { authorization: 'Bearer wrong-secret' },
      });
      expect(res.status()).toBe(401);
    });

    test('секрет без префикса Bearer → 401', async ({ request }) => {
      const res = await request.get(route, { headers: { authorization: CRON_SECRET } });
      expect(res.status()).toBe(401);
    });

    test('верный секрет пропускается дальше (падает уже на БД, не на авторизации)', async ({
      request,
    }) => {
      const res = await request.get(route, {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      });
      expect(res.status()).not.toBe(401);
    });
  });
}
