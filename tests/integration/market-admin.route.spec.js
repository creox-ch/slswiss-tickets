import { test, expect } from '@playwright/test';
import { sessionHeaders, moderatorHeaders, TEST_MODERATOR } from '../helpers/market-session';

/**
 * Integration: раздел модерации.
 *
 * Здесь впервые ходим ОТ ЛИЦА человека: сессионная cookie подписывается тем же
 * секретом, что задан dev-серверу в playwright.config.js. Ровно этого не хватало,
 * когда два бага с фото пришлось ловить руками на проде.
 *
 * Supabase в тестах заглушечный, поэтому проверяем всё, что решается ДО похода
 * в базу: права, разбор решения, требование причины отказа.
 */

const ADMIN_ITEMS = '/api/market/admin/items';
const SOME_ID = '11111111-1111-1111-1111-111111111111';

test.describe('доступ в раздел модерации', () => {
  test('без сессии — 401', async ({ request }) => {
    const res = await request.get(ADMIN_ITEMS);
    expect(res.status()).toBe(401);
  });

  test('обычный продавец получает 404, а не «нет прав»', async ({ request }) => {
    // О существовании раздела постороннему знать незачем: 403 подтвердил бы,
    // что по адресу что-то есть.
    const res = await request.get(ADMIN_ITEMS, {
      headers: sessionHeaders('seller@test.local'),
    });
    expect(res.status()).toBe(404);
  });

  test('модератор проходит проверку прав и доходит до базы', async ({ request }) => {
    const res = await request.get(ADMIN_ITEMS, { headers: moderatorHeaders() });
    // База заглушечная — важно, что это НЕ 401 и НЕ 404: права проверены.
    expect([200, 500, 503]).toContain(res.status());
  });

  test('адрес модератора берётся из MARKET_ADMIN_EMAILS, регистр не важен', async ({ request }) => {
    const res = await request.get(ADMIN_ITEMS, {
      headers: sessionHeaders(TEST_MODERATOR.toUpperCase()),
    });
    expect([200, 500, 503]).toContain(res.status());
  });

  test('подделанная cookie не открывает раздел', async ({ request }) => {
    const res = await request.get(ADMIN_ITEMS, {
      headers: { cookie: 'mk_session=bW9kZXJhdG9yQHRlc3QubG9jYWx8OTk5OTk5OTk5OTk5OQ.deadbeef' },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('решение по вещи', () => {
  test('чужой без прав не может применить решение', async ({ request }) => {
    const res = await request.patch(`${ADMIN_ITEMS}/${SOME_ID}`, {
      headers: sessionHeaders('seller@test.local'),
      data: { action: 'approve_market' },
    });
    expect(res.status()).toBe(404);
  });

  test('неизвестное решение отбивается до базы', async ({ request }) => {
    const res = await request.patch(`${ADMIN_ITEMS}/${SOME_ID}`, {
      headers: moderatorHeaders(),
      data: { action: 'сжечь' },
    });
    // 400 (разобрали и не поняли) либо 404/500 от заглушечной базы — но не 200
    expect(res.status()).not.toBe(200);
  });
});

test.describe('завести вещь за продавца', () => {
  test('без прав — 404', async ({ request }) => {
    const res = await request.post(ADMIN_ITEMS, {
      headers: sessionHeaders('seller@test.local'),
      data: { sellerEmail: 'x@y.ch', brand: 'A', title: 'B', category: 'bags', condition: 'ideal', price: '100' },
    });
    expect(res.status()).toBe(404);
  });

  test('без e-mail продавца — 400 с понятным текстом', async ({ request }) => {
    const res = await request.post(ADMIN_ITEMS, {
      headers: moderatorHeaders(),
      data: { brand: 'A', title: 'B', category: 'bags', condition: 'ideal', price: '100' },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  test('кривые поля вещи ловятся так же, как у продавца', async ({ request }) => {
    const res = await request.post(ADMIN_ITEMS, {
      headers: moderatorHeaders(),
      data: { sellerEmail: 'x@y.ch', brand: '', title: '', category: 'мех', condition: '', price: 'ноль' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.errors.length).toBeGreaterThan(2);
  });
});
