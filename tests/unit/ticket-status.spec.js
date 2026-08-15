/**
 * Таблица переходов при подтверждённой оплате.
 *
 * Два сценария, из-за которых этот файл существует (ревью платёжного контура
 * 2026-08-15). Оба не ловятся ни одним тестом, если логика заперта внутри
 * роута, и оба стоят денег:
 *
 * 1) Повторная доставка вебхука. Payrexx ретраит после нашего 500 и позволяет
 *    ручной re-send. Обработать `confirmed` дважды — значит выдать второй
 *    qr_token и второе письмо: у покупателя два разных QR, рабочий только
 *    последний.
 * 2) Воскрешение возврата. Поздний `confirmed` по уже `refunded` заказу
 *    возвращал билет в `paid` с новым QR — человек получал рабочий вход за
 *    возвращённые деньги. Чек-ин это не ловит: он видит честный `paid`.
 *
 * Здесь проверяется решение «можно ли», атомарность самого захвата строки —
 * условие `.in('status', ...)` в update внутри вебхука.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { canConfirmToPaid, CONFIRMABLE_STATUSES } from '../../lib/ticket-status.js';

test('pending → paid: обычный путь покупки', () => {
  expect(canConfirmToPaid('pending')).toBe(true);
});

test('failed → paid: вторая попытка оплаты прошла, отказ не запирает заказ', () => {
  expect(canConfirmToPaid('failed')).toBe(true);
});

test('paid → paid запрещён: второй qr_token и второе письмо на одну оплату', () => {
  expect(canConfirmToPaid('paid')).toBe(false);
});

test('checked_in → paid запрещён: человек уже вошёл', () => {
  expect(canConfirmToPaid('checked_in')).toBe(false);
});

test('refunded → paid ЗАПРЕЩЁН: деньги вернули, вход выдавать нельзя', () => {
  // Регресс: до 2026-08-15 сюда попадал поздний confirmed и воскрешал билет.
  expect(canConfirmToPaid('refunded')).toBe(false);
  expect(CONFIRMABLE_STATUSES).not.toContain('refunded');
});

test('неизвестный статус не открывает оплату (fail-closed)', () => {
  for (const v of ['', 'PAID', 'confirmed', 'что-то новое', null, undefined]) {
    expect(canConfirmToPaid(v)).toBe(false);
  }
});

test('каждый статус из схемы БД разобран явно', () => {
  // Если в supabase-schema.sql появится новый статус (подписка из Части 2 ТЗ
  // принесёт свои), тест упадёт и заставит принять решение, а не унаследовать
  // молчаливое «нельзя» по недосмотру.
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase-schema.sql'), 'utf8');
  // Именно таблица tickets: у submissions свой набор статусов, он тут ни при чём.
  const ticketsTable = sql.slice(sql.indexOf('public.tickets'));
  const m = ticketsTable.match(/check \(status in \(([^)]+)\)\)/);
  expect(m, 'не нашли check-constraint статусов в supabase-schema.sql').toBeTruthy();

  const fromSchema = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  const decided = new Set([...CONFIRMABLE_STATUSES, 'paid', 'checked_in', 'refunded']);

  expect(fromSchema.length).toBeGreaterThan(0);
  for (const status of fromSchema) {
    expect(decided.has(status), `статус '${status}' из схемы нигде не разобран`).toBe(true);
  }
});
