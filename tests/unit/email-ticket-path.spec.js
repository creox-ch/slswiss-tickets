/**
 * Письма и путь к билету.
 *
 * Пока билетов не было, письма честно говорили «продажи не открыты» и вели
 * на калькуляторы. Продажи открылись — и тот же текст начал отговаривать
 * самого готового человека: он оставил контакты, а в ответ читал, что купить
 * нельзя. Такое расхождение письма с сайтом глазами не видно: письмо уходит
 * один раз, ошибку замечает только получатель.
 *
 * Тесты держат два условия: письма не утверждают, что продаж нет, и дают
 * дорогу к билетам. Плюс чистые адреса — редирект .html работает, но письма
 * живут вне охвата проверки ссылок сайта, поэтому проверяем здесь.
 */
import { test, expect } from '@playwright/test';
import {
  renderRegistrationHtml,
  renderRegistrationText,
  renderReportHtml,
  renderReportText,
  renderForumTicketHtml,
} from '../../lib/forms.js';

const REG = {
  name: 'Анна',
  email: 'anna@example.ch',
  event: 'frankenplatz-2026-10',
  payload: { 'Интерес': 'Оба дня' },
};

const REPORT = {
  email: 'anna@example.ch',
  form_key: 'calc-pension',
  role: 'Пенсия в Швейцарии',
  event: 'frankenplatz-2026-10',
  payload: { 'Возраст': '40', 'Доход': "9'500 CHF" },
};

/** Утверждения «продаж нет» — ровно то, что устарело в момент открытия продаж. */
const SALES_CLOSED = /продажи пока не открыт|продажи не открыт|ещё не продают|пока нельзя купить/i;

test('письмо ранней регистрации не утверждает, что продажи закрыты', () => {
  expect(renderRegistrationHtml(REG)).not.toMatch(SALES_CLOSED);
  expect(renderRegistrationText(REG)).not.toMatch(SALES_CLOSED);
});

test('письмо ранней регистрации ведёт на билеты', () => {
  expect(renderRegistrationHtml(REG)).toContain('/tickets');
  expect(renderRegistrationText(REG)).toContain('/tickets');
});

test('письмо ранней регистрации по-прежнему честно про статус: список ≠ место', () => {
  // Обещание «ты в списке» без оговорки читается как «место за мной».
  expect(renderRegistrationText(REG)).toMatch(/не держит|не билет/i);
});

test('письмо-отчёт калькулятора даёт дорогу к билетам', () => {
  expect(renderReportHtml(REPORT)).toContain('/tickets');
  expect(renderReportText(REPORT)).toContain('/tickets');
});

test('ссылки писем — чистые адреса, без .html', () => {
  const rendered = [
    renderRegistrationHtml(REG),
    renderRegistrationText(REG),
    renderReportHtml(REPORT),
    renderReportText(REPORT),
  ];
  for (const html of rendered) {
    expect(html).not.toMatch(/frankenplatz\.ch[^\s"'<)]*\.html/);
  }
});

test('письмо об оплаченном билете: ссылки тоже чистые', () => {
  const html = renderForumTicketHtml(
    {
      name: 'Анна',
      description: 'День 1 · 24 октября · Standard',
      amount: 20900,
      code: 'FP-2026-0417',
      dateTime: '24 октября, 09:30 — 18:00',
    },
    'https://slswiss-tickets.vercel.app/api/qr?t=abc'
  );
  expect(html).not.toMatch(/frankenplatz\.ch[^\s"'<)]*\.html/);
});
