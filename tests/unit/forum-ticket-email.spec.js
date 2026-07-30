import { test, expect } from '@playwright/test';
import { renderForumTicketHtml, renderForumTicketText } from '../../lib/forms';

// Письмо-билет строится тем же премиум-шаблоном (emailShell), что и письма
// калькуляторов — проверяем содержимое, форматирование суммы и экранирование.
test.describe('письмо-билет форума', () => {
  const sub = { name: 'Аня', description: 'День 1 · VIP · Early Bird', amount: 20900 };

  test('HTML: бренд Frankenplatz, детали заказа, сумма, QR, код', () => {
    const html = renderForumTicketHtml(sub, 'https://slswiss-tickets.vercel.app/api/qr?t=abc', 'abc123');
    expect(html).toContain('Frankenplatz');
    expect(html).toContain('Билет у тебя');
    expect(html).toContain('День 1 · VIP · Early Bird');
    expect(html).toContain('209.00 CHF'); // 20900 рапенов → 209.00
    expect(html).toContain('api/qr?t=abc'); // картинка QR
    expect(html).toContain('abc123'); // код билета
  });

  test('HTML экранирует пользовательский ввод (XSS не проходит)', () => {
    const html = renderForumTicketHtml(
      { name: '<script>alert(1)</script>', description: '<img onerror=x>', amount: 10000 },
      'u',
      't'
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img onerror=x>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('text-версия рядом с HTML (анти-спам)', () => {
    const text = renderForumTicketText(sub, 'abc123');
    expect(text).toContain('Твой билет');
    expect(text).toContain('День 1 · VIP · Early Bird');
    expect(text).toContain('209.00 CHF');
    expect(text).toContain('abc123');
  });

  test('без имени и без описания не ломается', () => {
    const html = renderForumTicketHtml({ amount: 0 }, 'u', 't');
    expect(html).toContain('Билет у тебя');
    expect(html).toContain('0.00 CHF');
  });
});
