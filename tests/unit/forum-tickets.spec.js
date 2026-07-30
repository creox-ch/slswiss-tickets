import { test, expect } from '@playwright/test';
import {
  priceOrder,
  ebPrice,
  describeOrder,
  isValidSelection,
  isProvisional,
  CATEGORIES,
  PRODUCT_KEYS,
  FORUM_EVENT_SLUG,
  LUNCH_RAPPEN,
} from '../../lib/forum-tickets';

// Цены Иванны (обычная / Early Bird), CHF → рапены.
const EXPECT = {
  day1: { vip: [27900, 20900], premium: [19900, 14900], standard: [14900, 11200] },
  day2: { vip: [36900, 27700], premium: [28900, 21700], standard: [21900, 16400] },
  both: { standard: [31900, 23900], vip: [55900, 41900], premium: [42900, 32200] },
};

test.describe('каталог билетов форума — цены', () => {
  test('обычная цена билета совпадает с прайсом', () => {
    for (const product of Object.keys(EXPECT)) {
      for (const cat of Object.keys(EXPECT[product])) {
        const out = priceOrder({ product, category: cat, lunch: false, earlyBird: false });
        expect(out.ticket, `${product}/${cat} обычная`).toBe(EXPECT[product][cat][0]);
        expect(out.total).toBe(EXPECT[product][cat][0]); // без ланча total = билет
      }
    }
  });

  test('Early Bird −25% округляется до франка и совпадает с прайсом', () => {
    for (const product of Object.keys(EXPECT)) {
      for (const cat of Object.keys(EXPECT[product])) {
        const out = priceOrder({ product, category: cat, lunch: false, earlyBird: true });
        expect(out.ticket, `${product}/${cat} EB`).toBe(EXPECT[product][cat][1]);
      }
    }
  });

  test('ebPrice: точечные значения (округление до целого франка)', () => {
    expect(ebPrice(27900)).toBe(20900); // 279 → 209.25 → 209
    expect(ebPrice(14900)).toBe(11200); // 149 → 111.75 → 112
    expect(ebPrice(31900)).toBe(23900); // 319 → 239.25 → 239
  });
});

test.describe('каталог билетов форума — ланч', () => {
  test('ланч +35/день, на однодневный билет = 35', () => {
    const out = priceOrder({ product: 'day1', category: 'standard', lunch: true, earlyBird: true });
    expect(out.lunch).toBe(LUNCH_RAPPEN); // 3500
    expect(out.total).toBe(11200 + 3500); // билет EB + ланч
  });

  test('на пакет «2 дня» ланч = 70 (по дню на каждый)', () => {
    const out = priceOrder({ product: 'both', category: 'standard', lunch: true, earlyBird: true });
    expect(out.days).toBe(2);
    expect(out.lunch).toBe(LUNCH_RAPPEN * 2); // 7000
    expect(out.total).toBe(23900 + 7000);
  });

  test('Early Bird на ланч НЕ действует (ланч всегда по полной)', () => {
    const eb = priceOrder({ product: 'day1', category: 'vip', lunch: true, earlyBird: true });
    const reg = priceOrder({ product: 'day1', category: 'vip', lunch: true, earlyBird: false });
    expect(eb.lunch).toBe(LUNCH_RAPPEN);
    expect(reg.lunch).toBe(LUNCH_RAPPEN); // одинаковый ланч при любой цене билета
    expect(eb.ticket).toBeLessThan(reg.ticket); // а вот билет по EB дешевле
  });
});

test.describe('каталог билетов форума — валидация и заглушки', () => {
  test('неизвестный продукт/категория → бросает (роут ответит 400)', () => {
    expect(() => priceOrder({ product: 'day3', category: 'vip' })).toThrow(/unknown product/);
    expect(() => priceOrder({ product: 'day1', category: 'gold' })).toThrow(/unknown category/);
  });

  test('VIP/Premium на 2 дня — провизорные (заглушки, в продажу не открываем)', () => {
    expect(isProvisional('both', 'vip')).toBe(true);
    expect(isProvisional('both', 'premium')).toBe(true);
    expect(isProvisional('both', 'standard')).toBe(false); // Standard-пакет подтверждён
    expect(priceOrder({ product: 'both', category: 'vip' }).provisional).toBe(true);
    expect(priceOrder({ product: 'day1', category: 'vip' }).provisional).toBe(false);
  });

  test('isValidSelection: только реальные комбинации', () => {
    expect(isValidSelection('day1', 'vip')).toBe(true);
    expect(isValidSelection('both', 'standard')).toBe(true);
    expect(isValidSelection('day3', 'vip')).toBe(false);
    expect(isValidSelection('day1', 'gold')).toBe(false);
  });
});

test.describe('каталог билетов форума — метаданные', () => {
  test('describeOrder — человекочитаемо, отражает EB и ланч', () => {
    const d = describeOrder({ product: 'day2', category: 'vip', lunch: true, earlyBird: true });
    expect(d).toContain('День 2');
    expect(d).toContain('VIP');
    expect(d).toContain('Early Bird');
    expect(d).toContain('ланч');
  });

  test('категории и продукты на месте', () => {
    expect(Object.keys(CATEGORIES)).toEqual(['vip', 'premium', 'standard']);
    expect(CATEGORIES.vip.limit).toBe(30);
    expect(CATEGORIES.premium.limit).toBe(45);
    expect(CATEGORIES.standard.limit).toBe(225);
    expect(PRODUCT_KEYS).toEqual(['day1', 'day2', 'both']);
    expect(FORUM_EVENT_SLUG).toBe('frankenplatz-2026-10');
  });
});
