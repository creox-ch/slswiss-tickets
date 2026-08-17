import { test, expect } from '@playwright/test';

/**
 * Integration: роуты вещей продавца.
 *
 * Проверяем главное свойство — без валидной сессии роуты не работают вообще.
 * Сессионная cookie подписывается секретом, которого в тестовом окружении нет
 * (см. playwright.config.js), поэтому любой запрос сюда приходит «гостем»:
 * ровно то, что нужно проверить.
 *
 * Ветки с реальными данными требуют живого Supabase и покрыты юнит-тестами
 * lib/market-items.js (валидация, переходы статусов).
 */

const ITEMS = '/api/market/items';

test.describe('/api/market/items — без сессии', () => {
  test('список чужих вещей не отдаём', async ({ request }) => {
    const res = await request.get(ITEMS);
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  test('создать вещь от чужого имени нельзя', async ({ request }) => {
    const res = await request.post(ITEMS, {
      data: { brand: 'Gucci', title: 'Сумка', category: 'bags', condition: 'ideal', price: '500' },
    });
    expect(res.status()).toBe(401);
  });

  test('правка чужой вещи — 401, а не 404 с подсказкой', async ({ request }) => {
    const res = await request.patch(`${ITEMS}/11111111-1111-1111-1111-111111111111`, {
      data: { action: 'submit' },
    });
    expect(res.status()).toBe(401);
  });

  test('удаление чужой вещи — 401', async ({ request }) => {
    const res = await request.delete(`${ITEMS}/11111111-1111-1111-1111-111111111111`);
    expect(res.status()).toBe(401);
  });

  test('подделанная cookie не открывает доступ', async ({ request }) => {
    const res = await request.get(ITEMS, {
      headers: { cookie: 'mk_session=YW5uYUBleGFtcGxlLmNofDk5OTk5OTk5OTk5OTk.deadbeef' },
    });
    expect(res.status()).toBe(401);
  });
});
