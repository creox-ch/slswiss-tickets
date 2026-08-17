import { test, expect } from '@playwright/test';

/**
 * Integration: публичный каталог.
 *
 * Проверяем то, что живёт ровно на HTTP-границе и юнит-тестом не ловится, —
 * договор CORS. Сама выборка и проекция полей покрыты tests/unit/market-catalog.spec.js;
 * настоящего Supabase здесь нет (в playwright.config.js стоит заглушечный URL),
 * поэтому запрос за данными обрывается — и это тоже полезная проверка: даже на
 * ошибке ответ обязан оставаться корректным по CORS, иначе браузер покажет
 * посетителю не «каталог не загрузился», а невнятную ошибку доступа.
 */

const CATALOG = '/api/market/catalog';
const OURS = 'https://frankenplatz.ch';
const THEIRS = 'https://evil.example.com';

test.describe('/api/market/catalog — CORS', () => {
  test('предполётный запрос со своего сайта разрешает GET', async ({ request }) => {
    const res = await request.fetch(CATALOG, { method: 'OPTIONS', headers: { origin: OURS } });
    expect(res.status()).toBe(204);
    const headers = res.headers();
    expect(headers['access-control-allow-origin']).toBe(OURS);
    expect(headers['access-control-allow-methods']).toContain('GET');
  });

  test('чужому сайту ACAO не выписываем', async ({ request }) => {
    const res = await request.fetch(CATALOG, { method: 'OPTIONS', headers: { origin: THEIRS } });
    expect(res.status()).toBe(204);
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();
  });

  test('ответ помечен Vary: Origin — иначе CDN отдаст чужой ACAO', async ({ request }) => {
    const res = await request.get(CATALOG, { headers: { origin: OURS } });
    expect(res.headers()['vary']).toContain('Origin');
  });

  test('заголовки CORS остаются и когда база недоступна', async ({ request }) => {
    const res = await request.get(CATALOG, { headers: { origin: OURS } });
    // 200 с живой базой, 500/503 без неё — важно, что ответ читаем для браузера
    expect(res.headers()['access-control-allow-origin']).toBe(OURS);
    expect(await res.json()).toHaveProperty('ok');
  });

  test('запрос без origin (curl, мониторинг) не отвергаем', async ({ request }) => {
    const res = await request.get(CATALOG);
    expect([200, 500, 503]).toContain(res.status());
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();
  });

  test('каталог только читают: POST сюда не ходит', async ({ request }) => {
    const res = await request.post(CATALOG, { data: {} });
    expect(res.status()).toBe(405);
  });
});
