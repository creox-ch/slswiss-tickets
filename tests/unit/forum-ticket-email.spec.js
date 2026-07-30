import { test, expect } from '@playwright/test';
import { renderForumTicketHtml, renderForumTicketText } from '../../lib/forms';

// Письмо-билет — отдельный полный шаблон дизайнера (hero, крупный QR, таблица
// заказа, кнопка календаря, ссылки). Проверяем подстановку данных, форматы и XSS.
test.describe('письмо-билет форума', () => {
  const sub = {
    name: 'Аня',
    description: 'День 1 · 24 октября · Standard · Early Bird · + ланч (1 дн.)',
    amount: 20900,
    code: 'FP-2026-0417',
    dateTime: '24 октября, 09:30 — 18:00',
    icsUrl: 'https://slswiss-tickets.vercel.app/api/forum/ics?d=1',
  };
  const qrUrl = 'https://slswiss-tickets.vercel.app/api/qr?t=abc';

  test('HTML: бренд, имя, детали заказа, сумма, QR, номер, дата', () => {
    const html = renderForumTicketHtml(sub, qrUrl);
    expect(html).toContain('Frankenplatz.ch');
    expect(html).toContain('Билет у тебя');
    expect(html).toContain('Аня'); // имя в hero
    expect(html).toContain('День 1 · 24 октября · Standard · Early Bird · + ланч (1 дн.)');
    expect(html).toContain('209.00 CHF'); // 20900 рапенов → 209.00
    expect(html).toContain('api/qr?t=abc'); // НАШ QR, не внешний генератор
    expect(html).not.toContain('api.qrserver.com'); // внешний генератор из макета убран
    expect(html).toContain('FP-2026-0417'); // человеко-номер (код билета + заказ №)
    expect(html).toContain('24 октября, 09:30 — 18:00'); // дата/время из продукта
  });

  test('HTML: кнопка календаря ведёт на наш .ics, ссылки на сайт форума', () => {
    const html = renderForumTicketHtml(sub, qrUrl);
    expect(html).toContain('api/forum/ics?d=1'); // «Добавить в календарь»
    expect(html).toContain('frankenplatz.ch/index.html#program');
    expect(html).toContain('frankenplatz.ch/legal.html#agb');
    expect(html).toContain('frankenplatz.ch/calculators/index.html');
  });

  test('HTML экранирует пользовательский ввод (XSS не проходит)', () => {
    const html = renderForumTicketHtml(
      { name: '<script>alert(1)</script>', description: '<img onerror=x>', amount: 10000, code: 'FP-2026-0001' },
      'u'
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img onerror=x>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('text-версия рядом с HTML (анти-спам)', () => {
    const text = renderForumTicketText(sub);
    expect(text).toContain('Твой билет');
    expect(text).toContain('День 1 · 24 октября · Standard · Early Bird · + ланч (1 дн.)');
    expect(text).toContain('209.00 CHF');
    expect(text).toContain('FP-2026-0417');
    expect(text).toContain('24 октября, 09:30 — 18:00');
  });

  test('без имени и без номера не ломается (запасной прочерк)', () => {
    const html = renderForumTicketHtml({ amount: 0 }, 'u');
    expect(html).toContain('Билет у тебя 🎫'); // без имени — просто hero
    expect(html).toContain('0.00 CHF');
    expect(html).toContain('—'); // код-заглушка, когда номера нет
  });
});
