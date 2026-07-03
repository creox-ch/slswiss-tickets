import { test, expect } from '@playwright/test';

/**
 * Сканер: /api/checkin мокается через page.route — Supabase не нужен.
 * Проверяем ручной ввод токена (камеру в CI не эмулируем).
 */

/** Открыть /scan и вручную отправить токен на проверку. */
async function submitToken(page, token) {
  await page.getByText('Ввести код вручную').click();
  await page.getByPlaceholder('qr_token').fill(token);
  await page.getByRole('button', { name: 'Проверить' }).click();
}

test('первый скан оплаченного билета → ✅ Вход', async ({ page }) => {
  await page.route('**/api/checkin', (route) =>
    route.fulfill({ json: { result: 'ok', message: 'добро пожаловать', name: 'Иван', event: 'Тест' } })
  );
  await page.goto('/scan');
  await submitToken(page, 'tok-ok');
  await expect(page.getByText('✅ Вход')).toBeVisible();
  await expect(page.getByText('Иван')).toBeVisible();
});

test('повторный скан → ⚠️ Уже входил', async ({ page }) => {
  await page.route('**/api/checkin', (route) =>
    route.fulfill({ json: { result: 'already', message: 'уже входил' } })
  );
  await page.goto('/scan');
  await submitToken(page, 'tok-already');
  await expect(page.getByText('⚠️ Уже входил')).toBeVisible();
});

test('неизвестный токен → ❌ Невалиден', async ({ page }) => {
  await page.route('**/api/checkin', (route) =>
    route.fulfill({ json: { result: 'invalid', message: 'билет не найден' } })
  );
  await page.goto('/scan');
  await submitToken(page, 'tok-bad');
  await expect(page.getByText('❌ Невалиден')).toBeVisible();
});

test('ключ сканера: 401 auth открывает поле, ключ уходит заголовком X-Staff-Key', async ({ page }) => {
  const seenKeys = [];
  await page.route('**/api/checkin', (route) => {
    const key = route.request().headers()['x-staff-key'] || null;
    seenKeys.push(key);
    if (!key) {
      return route.fulfill({ status: 401, json: { result: 'auth', message: 'нужен ключ сканера' } });
    }
    return route.fulfill({ json: { result: 'ok', message: 'добро пожаловать' } });
  });

  await page.goto('/scan');
  await submitToken(page, 'tok-1');
  await expect(page.getByText('🔑 Нужен ключ')).toBeVisible();

  // после auth-ответа секция с ключом раскрыта — вводим ключ и пробуем другой токен
  await page.getByPlaceholder('ключ для персонала (если включён)').fill('sesame');
  await page.getByPlaceholder('qr_token').fill('tok-2');
  await page.getByRole('button', { name: 'Проверить' }).click();

  await expect(page.getByText('✅ Вход')).toBeVisible();
  expect(seenKeys).toEqual([null, 'sesame']);
});
