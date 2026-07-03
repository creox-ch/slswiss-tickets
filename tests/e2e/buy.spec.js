import { test, expect } from '@playwright/test';

/** Покупка: /api/payrexx/create мокается — Payrexx не нужен. */

test('успешное создание оплаты: цена НЕ уходит с клиента, редирект на payUrl', async ({ page }) => {
  let requestBody = null;
  await page.route('**/api/payrexx/create', (route) => {
    requestBody = route.request().postDataJSON();
    // редиректим на /thanks вместо внешнего Payrexx — заодно проверяем страницу
    return route.fulfill({ json: { ok: true, payUrl: '/thanks' } });
  });

  await page.goto('/');
  await page.getByPlaceholder('Имя').fill('Иван');
  await page.getByPlaceholder('Email').fill('ivan@example.com');
  await page.getByRole('button', { name: 'Купить билет' }).click();

  await expect(page.getByText('Спасибо, оплата прошла!')).toBeVisible();
  // цену определяет сервер — клиент не должен присылать amount
  expect(requestBody.amount).toBeUndefined();
  expect(requestBody.email).toBe('ivan@example.com');
});

test('Payrexx не настроен (503) → понятная ошибка на странице', async ({ page }) => {
  await page.route('**/api/payrexx/create', (route) =>
    route.fulfill({ status: 503, json: { ok: false, error: 'Оплата через Payrexx пока недоступна' } })
  );

  await page.goto('/');
  await page.getByPlaceholder('Email').fill('ivan@example.com');
  await page.getByRole('button', { name: 'Купить билет' }).click();

  await expect(page.getByText('Оплата через Payrexx пока недоступна')).toBeVisible();
});

test('кнопка неактивна без email', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Купить билет' })).toBeDisabled();
});
