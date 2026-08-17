/**
 * Пороги и инварианты чистки брошенных корзин.
 *
 * Главное, что здесь проверяется, — чего чистка НЕ трогает. Ошибка в списке
 * статусов стоит билета: удалить `paid` значит забрать вход у человека, который
 * заплатил, и узнаем мы об этом от него на входе, а не из лога.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  abandonHours,
  purgeDays,
  cutoffIso,
  ABANDONABLE_STATUSES,
  PURGEABLE_STATUSES,
  DEFAULT_ABANDON_HOURS,
  DEFAULT_PURGE_DAYS,
  MIN_ABANDON_HOURS,
  MIN_PURGE_DAYS,
} from '../../lib/pending-cleanup.js';

test('без env — сутки до пометки, 30 дней до удаления', () => {
  expect(abandonHours(undefined)).toBe(DEFAULT_ABANDON_HOURS);
  expect(purgeDays(undefined)).toBe(DEFAULT_PURGE_DAYS);
});

test('env задаёт свои сроки', () => {
  expect(abandonHours('6')).toBe(6);
  expect(purgeDays('90')).toBe(90);
});

test('мусор в env не отключает и не ускоряет чистку — откат на дефолт', () => {
  for (const junk of ['', '  ', 'сутки', null, undefined, '-5', '0', 'NaN']) {
    expect(abandonHours(junk)).toBeGreaterThanOrEqual(MIN_ABANDON_HOURS);
    expect(purgeDays(junk)).toBeGreaterThanOrEqual(MIN_PURGE_DAYS);
  }
  // Именно дефолт, а не минимум: пустое значение = «настройки нет».
  expect(abandonHours('')).toBe(DEFAULT_ABANDON_HOURS);
  expect(purgeDays('')).toBe(DEFAULT_PURGE_DAYS);
});

test('слишком короткий срок поднимается до минимума, а не исполняется буквально', () => {
  // `PENDING_PURGE_DAYS=1` — почти наверняка опечатка. Удаление необратимо,
  // поэтому ниже недели не опускаемся.
  expect(purgeDays('1')).toBe(MIN_PURGE_DAYS);
  expect(abandonHours('0')).toBe(DEFAULT_ABANDON_HOURS); // 0 → «значения нет»
});

test('удаление не может обогнать пометку', () => {
  // Иначе строку снесло бы раньше, чем она успела стать failed, — и поздняя
  // оплата пришла бы в пустоту.
  expect(MIN_PURGE_DAYS * 24).toBeGreaterThan(DEFAULT_ABANDON_HOURS);
  expect(DEFAULT_PURGE_DAYS * 24).toBeGreaterThan(DEFAULT_ABANDON_HOURS);
});

test('отсечка считается назад от «сейчас»', () => {
  const now = new Date('2026-08-17T12:00:00.000Z');
  expect(cutoffIso(now, { hours: 24 })).toBe('2026-08-16T12:00:00.000Z');
  expect(cutoffIso(now, { days: 30 })).toBe('2026-07-18T12:00:00.000Z');
  expect(cutoffIso(now, {})).toBe('2026-08-17T12:00:00.000Z');
});

test('чистка не трогает оплаченное', () => {
  for (const money of ['paid', 'checked_in', 'refunded']) {
    expect(ABANDONABLE_STATUSES).not.toContain(money);
    expect(PURGEABLE_STATUSES).not.toContain(money);
  }
});

test('каждый статус из схемы БД разобран явно', () => {
  // Тот же приём, что в ticket-status.spec.js: новый статус в схеме обязан
  // получить решение «чистим или нет», а не унаследовать его молчанием.
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase-schema.sql'), 'utf8');
  const ticketsTable = sql.slice(sql.indexOf('public.tickets'));
  const m = ticketsTable.match(/check \(status in \(([^)]+)\)\)/);
  expect(m, 'не нашли check-constraint статусов в supabase-schema.sql').toBeTruthy();

  const fromSchema = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  const decided = new Set([...PURGEABLE_STATUSES, 'paid', 'checked_in', 'refunded']);

  expect(fromSchema.length).toBeGreaterThan(0);
  for (const status of fromSchema) {
    expect(decided.has(status), `статус '${status}' не отнесён ни к чистке, ни к деньгам`).toBe(
      true
    );
  }
});

test('помечаем только pending: failed уже помечен, второй раз не трогаем', () => {
  expect(ABANDONABLE_STATUSES).toEqual(['pending']);
  // А удалять можно и failed — но только те, по которым Payrexx молчал
  // (условие payrexx_tx_id is null стоит в самом роуте).
  expect(PURGEABLE_STATUSES).toContain('failed');
});
