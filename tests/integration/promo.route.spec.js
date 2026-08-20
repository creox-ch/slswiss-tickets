import { test, expect } from '@playwright/test';

/**
 * Integration: проверка промокода на витрине.
 *
 * Роут ничего не создаёт — он отвечает на вопрос «сколько будет со скидкой» до
 * перехода в Payrexx. Настоящего Supabase здесь нет (заглушечный URL в
 * playwright.config.js), поэтому проверяем то, что живёт на HTTP-границе:
 * кто вообще может спрашивать и что бывает до похода в базу. Сами правила
 * скидки покрыты tests/unit/promo.spec.js.
 */

const CHECK = '/api/promo/check';
const OURS = 'https://frankenplatz.ch';
const THEIRS = 'https://evil.example.com';

test.describe('/api/promo/check', () => {
  test('предполётный запрос со своего сайта разрешает POST', async ({ request }) => {
    const res = await request.fetch(CHECK, { method: 'OPTIONS', headers: { origin: OURS } });
    expect(res.status()).toBe(204);
    expect(res.headers()['access-control-allow-origin']).toBe(OURS);
  });

  test('чужому сайту коды не проверяем', async ({ request }) => {
    // Иначе по этому роуту можно перебирать чужие коды с любого домена.
    const res = await request.post(CHECK, {
      headers: { origin: THEIRS },
      data: { scope: 'market', package: 'market', promo: 'PODRUGA20' },
    });
    expect(res.status()).toBe(403);
  });

  test('без Origin — тоже отказ', async ({ request }) => {
    const res = await request.post(CHECK, {
      data: { scope: 'market', package: 'market', promo: 'PODRUGA20' },
    });
    expect(res.status()).toBe(403);
  });

  test('неизвестная покупка отсекается до похода в базу', async ({ request }) => {
    const res = await request.post(CHECK, {
      headers: { origin: OURS },
      data: { scope: 'нечто', promo: 'PODRUGA20' },
    });
    expect(res.status()).toBe(400);
  });

  test('несуществующий пакет не считаем', async ({ request }) => {
    const res = await request.post(CHECK, {
      headers: { origin: OURS },
      data: { scope: 'market', package: 'platinum', promo: 'PODRUGA20' },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  test('ответ остаётся читаемым для браузера, когда база недоступна', async ({ request }) => {
    // Здесь Supabase заглушечный: запрос за кодом обрывается. Важно, что человек
    // видит «не получилось проверить код», а не ошибку доступа от браузера.
    const res = await request.post(CHECK, {
      headers: { origin: OURS },
      data: { scope: 'market', package: 'market', promo: 'PODRUGA20' },
    });
    expect([200, 500, 503]).toContain(res.status());
    expect(res.headers()['access-control-allow-origin']).toBe(OURS);
  });
});
