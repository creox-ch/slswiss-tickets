import { test, expect } from '@playwright/test';
import crypto from 'crypto';

/**
 * Integration: реальный обработчик POST /api/payrexx/webhook (без мока).
 *
 * Юнит-тесты (tests/unit/payrexx.spec.js) уже проверяют саму verifyWebhookSignature.
 * Здесь — что РОУТ реально связывает проверку подписи с 401 на HTTP-границе и
 * корректно отрабатывает разбор тела + ранний выход, НЕ доходя до Supabase и
 * Payrexx API. Подделанный вебхук (репо публичный, URL известен) должен отлетать.
 *
 * SIGNING_KEY совпадает с PAYREXX_WEBHOOK_SIGNING_KEY в playwright.config.js.
 * Валидные кейсы шлём с телом БЕЗ reference/id → роут выходит на 200 «ignored»
 * до getTransaction/БД (иначе ушёл бы реальный запрос в Payrexx).
 */

const SIGNING_KEY = 'test-webhook-signing-key';
const sign = (raw) => crypto.createHmac('sha256', SIGNING_KEY).update(raw).digest('hex');
const WH = '/api/payrexx/webhook';

test.describe('POST /api/payrexx/webhook — подпись на HTTP-границе', () => {
  test('без заголовка подписи → 401 (подделка отклонена)', async ({ request }) => {
    const res = await request.post(WH, {
      headers: { 'content-type': 'application/json' },
      data: '{}',
    });
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: 'bad signature' });
  });

  test('неверная подпись → 401', async ({ request }) => {
    const res = await request.post(WH, {
      headers: { 'content-type': 'application/json', 'x-webhook-signature': 'deadbeef' },
      data: '{}',
    });
    expect(res.status()).toBe(401);
  });

  test('подпись верным ключом, но от ДРУГОГО тела → 401', async ({ request }) => {
    const res = await request.post(WH, {
      headers: { 'content-type': 'application/json', 'x-webhook-signature': sign('{"a":1}') },
      data: '{"a":2}', // тело не то, что подписали
    });
    expect(res.status()).toBe(401);
  });

  test('валидная подпись (JSON), но нет reference/id → 200 ignored, в БД/Payrexx не ходим', async ({ request }) => {
    const raw = '{}';
    const res = await request.post(WH, {
      headers: { 'content-type': 'application/json', 'x-webhook-signature': sign(raw) },
      data: raw,
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, note: 'no reference/id, ignored' });
  });

  test('валидная подпись (form-urlencoded), без reference/id → 200 ignored', async ({ request }) => {
    const raw = 'transaction[foo]=bar';
    const res = await request.post(WH, {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-webhook-signature': sign(raw),
      },
      data: raw,
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
