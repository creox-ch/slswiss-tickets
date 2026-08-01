import { test, expect } from '@playwright/test';

/**
 * Integration: реальный обработчик POST /api/checkin (без page.route-мока).
 *
 * e2e (tests/e2e/scan.spec.js) проверяют UI сканера на МОКАх. Здесь — что сам
 * роут отбивает вход без ключа персонала ДО обращения к БД: иначе токен из QR
 * мог бы «сжечь» кто угодно. Ветки с реальным билетом требуют живого Supabase и
 * тут не проверяются.
 *
 * STAFF_KEY совпадает с CHECKIN_STAFF_KEY в playwright.config.js webServer.env.
 */

const STAFF_KEY = 'test-staff-key';
const CHECKIN = '/api/checkin';

test.describe('POST /api/checkin — ключ сканера до обращения к БД', () => {
  test('ключ включён, заголовок не передан → 401 auth', async ({ request }) => {
    const res = await request.post(CHECKIN, { data: { token: 'whatever' } });
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ result: 'auth' });
  });

  test('неверный ключ сканера → 401 auth', async ({ request }) => {
    const res = await request.post(CHECKIN, {
      headers: { 'x-staff-key': 'wrong' },
      data: { token: 'whatever' },
    });
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ result: 'auth' });
  });

  test('верный ключ, но токен не передан → invalid (не доходя до БД)', async ({ request }) => {
    const res = await request.post(CHECKIN, {
      headers: { 'x-staff-key': STAFF_KEY },
      data: {},
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ result: 'invalid', message: 'нет токена' });
  });
});
