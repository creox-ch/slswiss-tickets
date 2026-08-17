import { test, expect } from '@playwright/test';

/**
 * Integration: реальные роуты входа в кабинет (без page.route-мока).
 *
 * Проверяем ветки ДО обращения к базе — Supabase в тестах заглушечный
 * (см. playwright.config.js). Всё, что дальше запроса к БД, покрыто юнит-тестами
 * lib/market-auth.js.
 *
 * Главное здесь — что роут не превращается в справочник «чей это адрес»:
 * ответ должен быть одинаковым независимо от того, знаем мы человека или нет.
 */

const REQUEST = '/api/market/auth/request';
const VERIFY = '/api/market/auth/verify';
const LOGOUT = '/api/market/auth/logout';

test.describe('POST /api/market/auth/request', () => {
  test('кривой адрес → 400, и это единственный «особый» ответ', async ({ request }) => {
    const res = await request.post(REQUEST, { data: { email: 'не-почта' } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  test('пустое тело → 400', async ({ request }) => {
    const res = await request.post(REQUEST, { data: {} });
    expect(res.status()).toBe(400);
  });

  test('без MARKET_SESSION_SECRET роут честно отвечает 503, а не делает вид, что письмо ушло', async ({
    request,
  }) => {
    // В playwright.config.js секрет не задан: сессию подписать нечем.
    const res = await request.post(REQUEST, { data: { email: 'anna@example.ch' } });
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/недоступен/i);
  });
});

test.describe('GET /api/market/auth/verify', () => {
  test('без токена — уводит на страницу входа с понятной причиной', async ({ request }) => {
    const res = await request.get(`${VERIFY}`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toContain('/market?login=invalid');
  });

  test('токен есть, но вход не настроен → login=unavailable, а не 500', async ({ request }) => {
    const res = await request.get(`${VERIFY}?token=abc`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toContain('login=unavailable');
  });

  test('сессионную cookie на неудачной проверке не ставим', async ({ request }) => {
    const res = await request.get(`${VERIFY}?token=abc`, { maxRedirects: 0 });
    const setCookie = res.headers()['set-cookie'] || '';
    expect(setCookie).not.toContain('mk_session=');
  });
});

test.describe('POST /api/market/auth/logout', () => {
  test('гасит cookie сессии', async ({ request }) => {
    const res = await request.post(LOGOUT);
    expect(res.status()).toBe(200);
    const setCookie = res.headers()['set-cookie'] || '';
    expect(setCookie).toContain('mk_session=');
    expect(setCookie).toMatch(/Max-Age=0/i);
    expect(setCookie).toMatch(/HttpOnly/i);
  });
});
