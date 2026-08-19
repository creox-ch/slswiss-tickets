import { test, expect } from '@playwright/test';
import {
  renderMarketInterestHtml,
  renderMarketInterestText,
  renderMarketLoginHtml,
  renderRegistrationHtml,
} from '../../lib/forms';

/**
 * Письмо покупателю по заявке из каталога и брендирование писем маркета.
 *
 * До 19.08 покупатель не получал ничего — заявка уезжала нам, а он видел только
 * надпись на экране. А письма маркета приходили с шапкой форума: «форум о
 * деньгах в Швейцарии · 24–25 октября» в письме про пальто и маркет 27 сентября.
 */

const lead = {
  name: 'Аня',
  email: 'anna@example.ch',
  payload: {
    'Тип обращения': 'Бронь на маркете',
    'Бренд': 'Max Mara',
    'Вещь': 'Пальто, шерсть-кашемир',
    'Код вещи': 'FM-2026-0007',
    'Цена в каталоге': '477 CHF',
  },
};

test.describe('письмо покупателю по заявке', () => {
  test('называет вещь и говорит, что будет дальше', () => {
    const html = renderMarketInterestHtml(lead);
    expect(html).toContain('Пальто, шерсть-кашемир');
    expect(html).toContain('Max Mara');
    expect(html).toContain('Передаём продавцу');
  });

  test('не обещает брони, которой пока нет', () => {
    // Кнопка в каталоге называется «Забронировать», но вещь не резервируется:
    // срок не идёт, лист ожидания не работает. Письмо не должно утверждать
    // обратное — иначе человек приедет на маркет за «своей» вещью.
    const html = renderMarketInterestHtml(lead);
    expect(html).not.toMatch(/забронирован|зарезервирован|закреплена за тобой/i);
    expect(html).toContain('остаётся в каталоге');
  });

  test('предупреждает, что деньги идут мимо нас', () => {
    // Решение 17.08: чужие платежи не принимаем никогда. Покупатель должен
    // узнать это до встречи, а не на маркете.
    const html = renderMarketInterestHtml(lead);
    expect(html).toContain('платежей не принимаем');
    expect(html).toContain('27 сентября');
  });

  test('разное обращение — разный заголовок', () => {
    const price = renderMarketInterestHtml({ ...lead, payload: { ...lead.payload, 'Тип обращения': 'Предложить цену' } });
    const question = renderMarketInterestHtml({ ...lead, payload: { ...lead.payload, 'Тип обращения': 'Вопрос продавцу' } });
    expect(price).toContain('Предложение передадим');
    expect(question).toContain('Вопрос передадим');
  });

  test('текстовая версия не пустая и повторяет суть', () => {
    const txt = renderMarketInterestText(lead);
    expect(txt).toContain('Max Mara');
    expect(txt).toContain('платежей не принимаем');
    expect(txt.length).toBeGreaterThan(120);
  });

  test('без имени и без полей письмо всё равно собирается', () => {
    const html = renderMarketInterestHtml({ email: 'x@y.ch' });
    expect(html).toContain('Спасибо!');
    expect(html.length).toBeGreaterThan(500);
  });
});

test.describe('бренд письма', () => {
  test('письма маркета подписаны маркетом, а не форумом', () => {
    for (const html of [renderMarketInterestHtml(lead), renderMarketLoginHtml({ url: 'https://x/y', minutes: 30 })]) {
      expect(html).toContain('FASHION REBORN');
      expect(html).toContain('27 сентября');
      // Дата форума в письме про маркет — чужая и сбивает с толку.
      expect(html).not.toContain('24–25 октября');
      expect(html).not.toContain('форум о деньгах');
    }
  });

  test('письма форума остались форумными', () => {
    const html = renderRegistrationHtml({ name: 'Аня', email: 'a@b.ch', payload: {} });
    expect(html).toContain('24–25 октября');
    expect(html).toContain('форум о деньгах');
    expect(html).not.toContain('FASHION REBORN');
  });
});
