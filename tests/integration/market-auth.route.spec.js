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

  // Раньше здесь проверялся ответ 503 «вход не настроен»: в тестах не было
  // MARKET_SESSION_SECRET. Теперь он задан (иначе не подписать сессию для
  // остальных тестов), поэтому проверяем противоположное: роут не отговаривается
  // ненастроенностью, а идёт работать. Ветка «секрета нет» осталась в коде и
  // сработала на проде ровно так, как задумано — переменную тогда завели не в тот проект.
  test('с валидным адресом роут не отговаривается «вход не настроен»', async ({ request }) => {
    const res = await request.post(REQUEST, { data: { email: 'anna@example.ch' } });
    const body = await res.json().catch(() => ({}));
    expect(String(body.error || '')).not.toMatch(/вход не настроен/i);
    // База заглушечная: дальше роут либо промолчит (адрес неизвестен), либо упадёт
    // на запросе к ней. Главное — что он туда дошёл.
    expect([200, 500]).toContain(res.status());
  });
});

test.describe('GET /api/market/auth/verify', () => {
  test('без токена — уводит на страницу входа с понятной причиной', async ({ request }) => {
    const res = await request.get(`${VERIFY}`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toContain('/market?login=invalid');
  });

  test('с непонятным токеном уводит на страницу входа, а не роняет 500', async ({ request }) => {
    const res = await request.get(`${VERIFY}?token=abc`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    // База в тестах заглушечная, поэтому причина будет error; важно, что человек
    // в любом случае оказывается на понятной странице, а не на белом экране.
    expect(res.headers()['location']).toMatch(/\/market\?login=(invalid|error|unavailable)/);
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
