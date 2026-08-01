import { test, expect } from '@playwright/test';

/**
 * Integration: реальный обработчик POST/OPTIONS /api/forms (без page.route-мока).
 *
 * Дёргаем роут напрямую через request-фикстуру и проверяем guard-ветки,
 * которые срабатывают ДО вставки в Supabase, — это самый чувствительный слой
 * (белый список origin, согласие GDPR, ловушки ботов), а юнит-тесты его не
 * покрывают: они проверяют чистые функции lib/forms, а e2e мокают весь роут.
 *
 * Успешную вставку (200 + id) тут НЕ проверяем — она требует живого Supabase.
 * SUPABASE_* в playwright.config.js — заглушки только чтобы пройти проверку
 * «база подключена»; до реального клиента эти ветки не доходят.
 */

const ALLOWED = 'https://creox.ch'; // есть в DEFAULT_ORIGINS (см. lib/forms)
const FORMS = '/api/forms';

test.describe('POST /api/forms — защита до записи в БД', () => {
  test('чужой origin → 403 forbidden origin', async ({ request }) => {
    const res = await request.post(FORMS, {
      headers: { origin: 'https://evil.example' },
      data: { source: 'creox', consent: true },
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: 'forbidden origin' });
  });

  test('без заголовка Origin → 403 (прямой curl/скрипт мимо CORS)', async ({ request }) => {
    const res = await request.post(FORMS, {
      // request-фикстура не шлёт Origin для API-запросов — как серверный клиент
      data: { source: 'creox', consent: true },
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: 'forbidden origin' });
  });

  test('свой origin, но без source → 400 source is required', async ({ request }) => {
    const res = await request.post(FORMS, {
      headers: { origin: ALLOWED },
      data: {},
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: 'source is required' });
  });

  test('свой origin, есть source, но нет согласия → 400', async ({ request }) => {
    const res = await request.post(FORMS, {
      headers: { origin: ALLOWED },
      data: { source: 'creox' }, // consent не передан
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('согласие');
  });

  test('honeypot заполнен → 200 ok skipped (тихо не пишем бота)', async ({ request }) => {
    const res = await request.post(FORMS, {
      headers: { origin: ALLOWED },
      data: { source: 'creox', consent: true, website: 'http://spam.example' },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: true });
  });

  test('time-trap: заполнено быстрее человека → 200 ok skipped', async ({ request }) => {
    const res = await request.post(FORMS, {
      headers: { origin: ALLOWED },
      data: { source: 'creox', consent: true, elapsed_ms: 300 }, // < MIN_FILL_MS (2500)
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: true });
  });
});

test.describe('OPTIONS /api/forms — CORS preflight', () => {
  test('свой origin → 204 + ACAO эхом на этот origin', async ({ request }) => {
    const res = await request.fetch(FORMS, {
      method: 'OPTIONS',
      headers: { origin: ALLOWED },
    });
    expect(res.status()).toBe(204);
    expect(res.headers()['access-control-allow-origin']).toBe(ALLOWED);
  });

  test('чужой origin → 204, но БЕЗ ACAO (браузер заблокирует)', async ({ request }) => {
    const res = await request.fetch(FORMS, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status()).toBe(204);
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();
  });
});
