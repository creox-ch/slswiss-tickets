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
  formatTicketNo,
  ticketDateTimeLabel,
  icsDayParam,
  buildEventIcs,
} from '../../lib/forum-tickets';

// Цены Иванны (обычная / Early Bird), CHF → рапены.
const EXPECT = {
  day1: { vip: [27900, 20900], premium: [19900, 14900], standard: [14900, 11200] },
  day2: { vip: [36900, 27700], premium: [28900, 21700], standard: [21900, 16400] },
  both: { standard: [31900, 23900], premium: [41900, 31400], vip: [54900, 41200] },
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

  test('все пакеты «2 дня» открыты в продажу (провизорных нет)', () => {
    expect(isProvisional('both', 'vip')).toBe(false);
    expect(isProvisional('both', 'premium')).toBe(false);
    expect(isProvisional('both', 'standard')).toBe(false);
    expect(priceOrder({ product: 'both', category: 'vip' }).provisional).toBe(false);
    expect(priceOrder({ product: 'both', category: 'premium' }).provisional).toBe(false);
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
    // Схема зала: те же цифры, что в карточках на frankenplatz.ch/tickets и на
    // странице оплаты. Расхождение здесь покупатель увидит при рассадке.
    expect(CATEGORIES.vip.limit).toBe(45);
    expect(CATEGORIES.premium.limit).toBe(75);
    expect(CATEGORIES.standard.limit).toBe(180);
    expect(CATEGORIES.vip.rows).toBe('1–3');
    expect(CATEGORIES.premium.rows).toBe('4–8');
    expect(CATEGORIES.standard.rows).toBe('9–20');
    // Зал на 300 мест — сумма категорий должна сходиться с ним.
    const seats = Object.values(CATEGORIES).reduce((n, c) => n + c.limit, 0);
    expect(seats).toBe(300);
    expect(PRODUCT_KEYS).toEqual(['day1', 'day2', 'both']);
    expect(FORUM_EVENT_SLUG).toBe('frankenplatz-2026-10');
  });
});

test.describe('билет форума — номер, дата, .ics', () => {
  test('formatTicketNo: FP-2026-NNNN с ведущими нулями', () => {
    expect(formatTicketNo(1)).toBe('FP-2026-0001');
    expect(formatTicketNo(417)).toBe('FP-2026-0417');
    expect(formatTicketNo(12345)).toBe('FP-2026-12345'); // не режем, если номеров >9999
  });

  test('formatTicketNo: нет номера → null (вызывающий даст запасной код)', () => {
    expect(formatTicketNo(null)).toBeNull();
    expect(formatTicketNo(undefined)).toBeNull();
    expect(formatTicketNo(0)).toBeNull();
    expect(formatTicketNo('abc')).toBeNull();
  });

  test('ticketDateTimeLabel: по продукту, дефолт — весь форум', () => {
    expect(ticketDateTimeLabel('day1')).toContain('24 октября');
    expect(ticketDateTimeLabel('day2')).toContain('25 октября');
    expect(ticketDateTimeLabel('both')).toContain('24–25 октября');
    expect(ticketDateTimeLabel(undefined)).toContain('24–25 октября'); // неизвестно → весь форум
  });

  test('icsDayParam: day1→1, day2→2, иначе both', () => {
    expect(icsDayParam('day1')).toBe('1');
    expect(icsDayParam('day2')).toBe('2');
    expect(icsDayParam('both')).toBe('both');
    expect(icsDayParam(undefined)).toBe('both');
  });

  test('buildEventIcs: валидный VCALENDAR, CRLF, время в UTC', () => {
    const ics = buildEventIcs('1');
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('\r\n'); // RFC 5545 требует CRLF
    expect(ics).toContain('DTSTART:20261024T073000Z'); // день 1, 09:30 CEST = 07:30Z
    expect(ics).toContain('DTEND:20261024T160000Z');
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(1);
  });

  test('buildEventIcs: день 2 — с учётом конца летнего времени (CET +01:00)', () => {
    const ics = buildEventIcs('2');
    expect(ics).toContain('DTSTART:20261025T083000Z'); // 09:30 CET = 08:30Z
    expect(ics).toContain('DTEND:20261025T170000Z'); // 18:00 CET = 17:00Z
  });

  test('buildEventIcs: both — два события', () => {
    const ics = buildEventIcs('both');
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(2);
    expect(ics).toContain('20261024T073000Z');
    expect(ics).toContain('20261025T083000Z');
  });
});
