import { test, expect } from '@playwright/test';
import {
  normalizeCode,
  checkPromo,
  applyPromo,
  describePromo,
  promoPayload,
  MIN_CHARGE_RAPPEN,
} from '../../lib/promo';

/**
 * Промокоды: правила и расчёт скидки.
 *
 * Скидку считает сервер ДО создания gateway — купон на стороне Payrexx оставил
 * бы в заказе полную цену, а денег пришло бы меньше. Значит цена этой логики —
 * реальные деньги, и проверяем её по поведению, а не по тексту исходника.
 */

const code = (over = {}) => ({
  code: 'EXAMPLE10',
  scope: 'all',
  kind: 'percent',
  value: 20,
  max_uses: null,
  starts_at: null,
  expires_at: null,
  active: true,
  ...over,
});

const NOW = Date.parse('2026-08-20T12:00:00Z');

test.describe('нормализация кода', () => {
  test('регистр и пробелы не важны', () => {
    expect(normalizeCode('  example10 ')).toBe('EXAMPLE10');
    expect(normalizeCode('Sample-2026')).toBe('SAMPLE-2026');
  });

  test('кириллица в латинском коде не проходит', () => {
    // «С» из кириллицы в SAMPLE — классическая загадка поддержки: на вид код
    // верный, в базе не находится. Лучше сразу сказать «такого кода нет».
    expect(normalizeCode('РSAMPLE')).toBe('');
    expect(normalizeCode('promo code')).toBe('');
    expect(normalizeCode('a'.repeat(33))).toBe('');
    expect(normalizeCode(null)).toBe('');
  });
});

test.describe('годность кода', () => {
  test('обычный код проходит', () => {
    expect(checkPromo(code(), { scope: 'market', now: NOW }).ok).toBe(true);
  });

  test('несуществующий код объясняет, а не молчит', () => {
    const v = checkPromo(null, { scope: 'forum', now: NOW });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('unknown');
    expect(v.message).toContain('проверь написание');
  });

  test('выключенный, не начавшийся и просроченный различаются', () => {
    expect(checkPromo(code({ active: false }), { scope: 'all', now: NOW }).reason).toBe('inactive');
    expect(
      checkPromo(code({ starts_at: '2026-09-01T00:00:00Z' }), { scope: 'all', now: NOW }).reason
    ).toBe('not_started');
    expect(
      checkPromo(code({ expires_at: '2026-08-01T00:00:00Z' }), { scope: 'all', now: NOW }).reason
    ).toBe('expired');
  });

  test('код маркета не работает на билетах форума', () => {
    const v = checkPromo(code({ scope: 'market' }), { scope: 'forum', now: NOW });
    expect(v.reason).toBe('wrong_scope');
    expect(checkPromo(code({ scope: 'market' }), { scope: 'market', now: NOW }).ok).toBe(true);
    // scope 'all' работает везде
    expect(checkPromo(code({ scope: 'all' }), { scope: 'forum', now: NOW }).ok).toBe(true);
  });

  test('лимит считается по уже оплатившим', () => {
    const row = code({ max_uses: 20 });
    expect(checkPromo(row, { scope: 'all', uses: 19, now: NOW }).ok).toBe(true);
    expect(checkPromo(row, { scope: 'all', uses: 20, now: NOW }).reason).toBe('used_up');
    // без лимита не кончается никогда
    expect(checkPromo(code({ max_uses: null }), { scope: 'all', uses: 999, now: NOW }).ok).toBe(true);
  });

  test('момент истечения — граница, а не «в тот же день ещё можно»', () => {
    const row = code({ expires_at: '2026-08-20T12:00:00Z' });
    expect(checkPromo(row, { scope: 'all', now: NOW - 1 }).ok).toBe(true);
    expect(checkPromo(row, { scope: 'all', now: NOW }).reason).toBe('expired');
  });
});

test.describe('расчёт скидки', () => {
  test('процент считается от цены после Early Bird', () => {
    // Пакет «Маркет» с EB стоит 109, не 159: промокод идёт поверх.
    const r = applyPromo(10900, code({ kind: 'percent', value: 20 }));
    expect(r.base).toBe(10900);
    expect(r.discount).toBe(2180);
    expect(r.total).toBe(8720);
  });

  test('фиксированная скидка вычитается как есть', () => {
    const r = applyPromo(15900, code({ kind: 'amount', value: 5000 }));
    expect(r.discount).toBe(5000);
    expect(r.total).toBe(10900);
  });

  test('скидка не делает платёж бесплатным', () => {
    // Gateway на 0 создать нельзя. Код на 100% срезается до минимума, и это
    // видно по флагу — иначе казалось бы, что скидка сработала целиком.
    const r = applyPromo(8900, code({ kind: 'percent', value: 100 }));
    expect(r.total).toBe(MIN_CHARGE_RAPPEN);
    expect(r.capped).toBe(true);

    const fixed = applyPromo(8900, code({ kind: 'amount', value: 99999 }));
    expect(fixed.total).toBe(MIN_CHARGE_RAPPEN);
    expect(fixed.capped).toBe(true);
  });

  test('без кода цена не меняется', () => {
    const r = applyPromo(8900, null);
    expect(r).toMatchObject({ base: 8900, discount: 0, total: 8900, capped: false });
  });

  test('мусорное value не уводит цену вверх', () => {
    expect(applyPromo(8900, code({ kind: 'amount', value: -500 })).total).toBe(8900);
    expect(applyPromo(8900, code({ kind: 'percent', value: 999 })).total).toBe(MIN_CHARGE_RAPPEN);
  });
});

test.describe('след в заказе', () => {
  test('в payload видно, из чего сложилась сумма', () => {
    const row = code({ kind: 'percent', value: 20 });
    const applied = applyPromo(10900, row);
    expect(promoPayload(row, applied)).toMatchObject({
      code: 'EXAMPLE10',
      kind: 'percent',
      value: 20,
      discount_rappen: 2180,
      base_rappen: 10900,
    });
  });

  test('нулевая скидка следа не оставляет', () => {
    expect(promoPayload(code(), applyPromo(0, code()))).toBeNull();
    expect(promoPayload(null, null)).toBeNull();
  });

  test('описание читается в письме и в Payrexx', () => {
    expect(describePromo(code({ kind: 'percent', value: 20 }))).toBe('EXAMPLE10 −20%');
    expect(describePromo(code({ code: 'sample', kind: 'amount', value: 5000 }))).toBe(
      'SAMPLE −50 CHF'
    );
  });
});
