import { test, expect } from '@playwright/test';
import {
  compareAmounts,
  transactionAmount,
  transactionCurrency,
  describeMismatch,
} from '../../lib/payment-check';

/**
 * Сверка оплаченной суммы с ценой заказа.
 *
 * До 20.08 вебхук верил статусу `confirmed` и не смотрел на деньги: скидка,
 * выданная на стороне Payrexx, оставила бы в базе полную цену, а на счёте —
 * меньше. Расхождение всплывало бы при ручной сверке выручки, когда искать
 * концы уже поздно.
 */

test.describe('сумма транзакции', () => {
  test('берётся из транзакции, в рапенах', () => {
    expect(transactionAmount({ amount: 15900 })).toBe(15900);
    expect(transactionAmount({ invoice: { amount: 8900 } })).toBe(8900);
    expect(transactionCurrency({ currency: 'chf' })).toBe('CHF');
  });

  test('нет суммы — это «нечего сверять», а не ноль', () => {
    // Ноль означал бы «оплатили ничего» и поднял бы ложную тревогу на каждой
    // нестандартной транзакции.
    expect(transactionAmount({})).toBeNull();
    expect(transactionAmount(null)).toBeNull();
    expect(transactionAmount({ amount: 'abc' })).toBeNull();
  });
});

test.describe('сверка', () => {
  test('совпало — молчим', () => {
    const r = compareAmounts({ expected: 15900, paid: 15900, expectedCurrency: 'CHF', paidCurrency: 'CHF' });
    expect(r).toMatchObject({ status: 'match', mismatch: false, delta: 0 });
  });

  test('пришло меньше — это скидка мимо нас', () => {
    const r = compareAmounts({ expected: 15900, paid: 10900 });
    expect(r.status).toBe('underpaid');
    expect(r.mismatch).toBe(true);
    expect(r.delta).toBe(-5000);
  });

  test('пришло больше — тоже расхождение', () => {
    const r = compareAmounts({ expected: 8900, paid: 15900 });
    expect(r.status).toBe('overpaid');
    expect(r.mismatch).toBe(true);
  });

  test('чужая валюта не выдаётся за совпадение', () => {
    const r = compareAmounts({
      expected: 15900,
      paid: 15900,
      expectedCurrency: 'CHF',
      paidCurrency: 'EUR',
    });
    expect(r.status).toBe('currency');
    expect(r.mismatch).toBe(true);
  });

  test('нечего сверять — не тревога', () => {
    const r = compareAmounts({ expected: 15900, paid: null });
    expect(r.mismatch).toBe(false);
    expect(r.unknown).toBe(true);
  });

  test('в логе видно обе суммы и разницу', () => {
    const r = compareAmounts({ expected: 15900, paid: 10900 });
    const line = describeMismatch(r, 'mk-123');
    expect(line).toContain('mk-123');
    expect(line).toContain('159.00');
    expect(line).toContain('109.00');
    expect(describeMismatch(compareAmounts({ expected: 100, paid: 100 }), 'mk-1')).toBe('');
  });
});
