import { test, expect } from '@playwright/test';

/**
 * e2e: страница кабинета /market.
 *
 * Без валидной сессии страница показывает форму входа — её и проверяем; сам
 * запрос ссылки мокаем, чтобы не зависеть от Supabase и Resend.
 *
 * Вид «залогинен» здесь не воспроизвести: cookie подписывается секретом,
 * которого в тестовом окружении нет намеренно (см. playwright.config.js).
 * Подпись и срок сессии покрыты юнит-тестами lib/market-auth.js.
 */

test.describe('/market — вход', () => {
  test('гостю показываем форму, а не пустой кабинет', async ({ page }) => {
    await page.goto('/market');
    await expect(page.getByRole('heading', { name: 'Кабинет продавца' })).toBeVisible();
    await expect(page.getByLabel(/E-mail/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Прислать ссылку/i })).toBeVisible();
    // Обещание «пароль не нужен» — часть договорённости с продавцом
    await expect(page.getByText(/Пароль не нужен/i)).toBeVisible();
  });

  test('после отправки формы говорим одно и то же — по экрану не понять, есть адрес в базе или нет', async ({
    page,
  }) => {
    await page.route('**/api/market/auth/request', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, message: 'Если этот адрес есть у нас, письмо со ссылкой уже в пути.' }),
      })
    );

    await page.goto('/market');
    await page.getByLabel(/E-mail/i).fill('anna@example.ch');
    await page.getByRole('button', { name: /Прислать ссылку/i }).click();

    await expect(page.getByText(/письмо со ссылкой уже в пути/i)).toBeVisible();
    await expect(page.getByText(/действует 30 минут/i)).toBeVisible();
  });

  test('ошибку роута показываем человеку, а не молчим', async ({ page }) => {
    await page.route('**/api/market/auth/request', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Не получилось. Попробуй ещё раз.' }),
      })
    );

    await page.goto('/market');
    await page.getByLabel(/E-mail/i).fill('anna@example.ch');
    await page.getByRole('button', { name: /Прислать ссылку/i }).click();

    await expect(page.getByText(/Не получилось/i)).toBeVisible();
  });

  test('протухшая ссылка объясняет, что делать', async ({ page }) => {
    await page.goto('/market?login=expired');
    await expect(page.getByText(/Ссылка устарела/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Прислать ссылку/i })).toBeVisible();
  });

  test('использованная ссылка не выглядит поломкой', async ({ page }) => {
    await page.goto('/market?login=used');
    await expect(page.getByText(/уже входили/i)).toBeVisible();
  });

  test('адрес из письма подставляется в форму', async ({ page }) => {
    await page.goto('/market?email=anna%40example.ch');
    await expect(page.getByLabel(/E-mail/i)).toHaveValue('anna@example.ch');
  });
});
