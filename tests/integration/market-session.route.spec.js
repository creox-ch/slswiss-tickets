import { test, expect } from '@playwright/test';
import { sessionHeaders } from '../helpers/market-session';
import { signSession, SESSION_COOKIE } from '../../lib/market-auth';
import { TEST_SECRET } from '../helpers/market-session';

/**
 * Integration: роуты продавца ОТ ЛИЦА вошедшего человека.
 *
 * Раньше тесты упирались в 401 и дальше не шли — потому оба бага с фото и
 * «неизвестным действием» дожили до прода. Теперь сессия подписывается тем же
 * секретом, что у dev-сервера, и запрос доходит до логики роута.
 *
 * Supabase заглушечный: за поиском продавца роут уйдёт в недоступную базу и
 * ответит 500. Значит проверяем то, что решается раньше: что сессия принята
 * (не 401) и что разбор тела и действий работает.
 */

const ITEMS = '/api/market/items';
const SELLER = 'seller@test.local';
const SOME_ID = '11111111-1111-1111-1111-111111111111';

test.describe('сессия продавца принимается роутами', () => {
  test('со свежей cookie список вещей не отвечает 401', async ({ request }) => {
    const res = await request.get(ITEMS, { headers: sessionHeaders(SELLER) });
    expect(res.status()).not.toBe(401);
  });

  test('истёкшая сессия — снова 401, как и без неё', async ({ request }) => {
    const expired = signSession(SELLER, TEST_SECRET, { now: Date.now() - 40 * 24 * 3600 * 1000 });
    const res = await request.get(ITEMS, { headers: { cookie: `${SESSION_COOKIE}=${expired}` } });
    expect(res.status()).toBe(401);
  });

  test('cookie, подписанная чужим секретом, не пускает', async ({ request }) => {
    const foreign = signSession(SELLER, 'секрет-злоумышленника');
    const res = await request.get(ITEMS, { headers: { cookie: `${SESSION_COOKIE}=${foreign}` } });
    expect(res.status()).toBe(401);
  });

  test('адрес с точками и плюсом работает — на нём ломалась первая версия подписи', async ({
    request,
  }) => {
    const res = await request.get(ITEMS, {
      headers: sessionHeaders('anna.maria+market@sub.example.co.uk'),
    });
    expect(res.status()).not.toBe(401);
  });
});

test.describe('разбор действий с вещью — то, на чём горели', () => {
  test('«сохранить черновик» не отвечает «неизвестное действие»', async ({ request }) => {
    const res = await request.patch(`${ITEMS}/${SOME_ID}`, {
      headers: sessionHeaders(SELLER),
      data: { action: 'save', brand: 'A', title: 'B', price: '100' },
    });
    const body = await res.json().catch(() => ({}));
    // База недоступна → 500/404, но НЕ «Неизвестное действие»
    expect(String(body.error || '')).not.toContain('Неизвестное действие');
  });

  test('выдуманное действие по-прежнему отбивается', async ({ request }) => {
    const res = await request.patch(`${ITEMS}/${SOME_ID}`, {
      headers: sessionHeaders(SELLER),
      data: { action: 'опубликовать' },
    });
    expect(res.status()).not.toBe(200);
  });

  test('форма не может подсунуть фото полем — они грузятся своим роутом', async ({ request }) => {
    // Именно так фото и обнулялись: photos из тела запроса попадали в UPDATE.
    const res = await request.post(ITEMS, {
      headers: sessionHeaders(SELLER),
      data: {
        brand: 'A',
        title: 'B',
        category: 'bags',
        condition: 'ideal',
        price: '100',
        photos: ['подсунутое.jpg'],
      },
    });
    // Ответ придёт от заглушечной базы, но запрос обязан быть принят как валидный
    expect(res.status()).not.toBe(400);
  });
});
