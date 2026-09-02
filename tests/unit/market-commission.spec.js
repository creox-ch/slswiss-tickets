import { test, expect } from '@playwright/test';
import {
  COMMISSION_PERCENT,
  commissionRappen,
  parseSalePrice,
  parseSaleChannel,
  buildSale,
  summarizeSales,
} from '../../lib/market-commission';
import { resolveAction, canTransition, sellerEditRule } from '../../lib/market-items';

/**
 * Фиксация сделки и комиссия.
 *
 * Чужих денег мы не принимаем, поэтому комиссия держится не на платеже, а на
 * отметке в кабинете (AGB 5.5, 5.6). Эта отметка — учётный документ: ошибка
 * здесь превращается в неверный счёт живому человеку.
 */

test.describe('комиссия', () => {
  test('12% от цены сделки', () => {
    expect(COMMISSION_PERCENT).toBe(12);
    expect(commissionRappen(10000)).toBe(1200); // 100 CHF → 12 CHF
    expect(commissionRappen(47700)).toBe(5724); // 477 CHF → 57.24 CHF
  });

  test('округляется к ближайшему рапену, а не вниз', () => {
    // 12% от 33.33 = 3.9996 CHF. Систематическое округление вниз — подарок
    // одной из сторон на каждой сделке; Math.round честнее.
    expect(commissionRappen(3333)).toBe(400);
    expect(commissionRappen(1)).toBe(0);
  });

  test('мусор не превращается в счёт', () => {
    expect(commissionRappen(null)).toBe(0);
    expect(commissionRappen(-5000)).toBe(0);
    expect(commissionRappen('абв')).toBe(0);
  });
});

test.describe('цена продажи', () => {
  test('пустое поле означает «по цене каталога»', () => {
    // Чаще всего вещь уходит по витринной цене, и заставлять перепечатывать её
    // — лишний повод ошибиться.
    expect(parseSalePrice('', { catalogPriceRappen: 47700 })).toEqual({ ok: true, value: 47700 });
  });

  test('принимает запятую, пробелы и апострофы швейцарского формата', () => {
    expect(parseSalePrice('350,50').value).toBe(35050);
    expect(parseSalePrice("1'200").value).toBe(120000);
    expect(parseSalePrice(' 89 ').value).toBe(8900);
  });

  test('дешевле витрины — норма, дороже — тоже', () => {
    // На маркете торгуются, а на горячие позиции обещан аукцион: привязывать
    // верхнюю границу к цене каталога нельзя.
    expect(parseSalePrice('200', { catalogPriceRappen: 47700 }).ok).toBe(true);
    expect(parseSalePrice('900', { catalogPriceRappen: 47700 }).ok).toBe(true);
  });

  test('лишний ноль и копейки отсекаются', () => {
    expect(parseSalePrice('999999').ok).toBe(false);
    expect(parseSalePrice('2').ok).toBe(false); // ниже 5 CHF — не этот маркет
    expect(parseSalePrice('abc').ok).toBe(false);
  });

  test('без цены и без каталожной цены — отказ, а не ноль', () => {
    const r = parseSalePrice('', {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('за сколько продана');
  });
});

test.describe('канал сделки', () => {
  test('по умолчанию — маркет', () => {
    expect(parseSaleChannel('').value).toBe('market');
    expect(parseSaleChannel('online').value).toBe('online');
  });

  test('выдуманный канал не проходит', () => {
    expect(parseSaleChannel('telegram').ok).toBe(false);
  });
});

test.describe('запись о сделке', () => {
  test('собирает всё, на чём потом стоит счёт', () => {
    const sale = buildSale(
      { salePrice: '350', saleChannel: 'market' },
      { catalogPriceRappen: 47700, actor: 'seller', now: '2026-09-27T12:00:00Z' }
    );
    expect(sale.ok).toBe(true);
    expect(sale.value).toMatchObject({
      sold_price_rappen: 35000,
      commission_rappen: 4200,
      sale_channel: 'market',
      sold_by: 'seller',
      sold_at: '2026-09-27T12:00:00.000Z',
    });
  });

  test('«Под ключ»: отметку делаем мы, и это видно', () => {
    const sale = buildSale({ salePrice: '100' }, { actor: 'admin' });
    expect(sale.value.sold_by).toBe('admin');
    // Выдуманная роль не проходит молча в учётную запись.
    expect(buildSale({ salePrice: '100' }, { actor: 'кто-то' }).value.sold_by).toBe('seller');
  });

  test('плохая цена не создаёт запись', () => {
    expect(buildSale({ salePrice: '0' }, {}).ok).toBe(false);
  });
});

test.describe('сводка для счёта', () => {
  test('сходится построчно', () => {
    // Сумма построчных округлений не равна округлению суммы: если считать
    // комиссию от общей выручки, счёт разойдётся с карточками вещей на рапены,
    // и продавец это заметит первым.
    const rows = [
      { sold_price_rappen: 3333, commission_rappen: commissionRappen(3333) },
      { sold_price_rappen: 3333, commission_rappen: commissionRappen(3333) },
      { sold_price_rappen: 3333, commission_rappen: commissionRappen(3333) },
    ];
    const s = summarizeSales(rows);
    expect(s.count).toBe(3);
    expect(s.gross).toBe(9999);
    expect(s.commission).toBe(1200); // 3 × 400, а не round(9999 × 0.12) = 1200
    expect(s.net).toBe(8799);
  });

  test('старая строка без сохранённой комиссии считается на лету', () => {
    const s = summarizeSales([{ sold_price_rappen: 10000 }]);
    expect(s.commission).toBe(1200);
  });

  test('пусто — это нули, а не поломка', () => {
    expect(summarizeSales([])).toMatchObject({ count: 0, gross: 0, commission: 0 });
    expect(summarizeSales(null)).toMatchObject({ count: 0 });
  });
});

test.describe('место отметки в жизни вещи', () => {
  test('«Продана» — известное действие с переходом в sold', () => {
    expect(resolveAction('sold')).toEqual({ known: true, target: 'sold' });
  });

  test('продать можно то, что стоит в каталоге или забронировано', () => {
    expect(canTransition('approved_online', 'sold')).toBe(true);
    expect(canTransition('approved_market', 'sold')).toBe(true);
    expect(canTransition('reserved', 'sold')).toBe(true);
    // Черновик и отклонённую вещь продать нельзя: их не было в каталоге.
    expect(canTransition('draft', 'sold')).toBe(false);
    expect(canTransition('rejected', 'sold')).toBe(false);
  });

  test('проданная вещь — конечная точка, и цену в ней не правят', () => {
    // Цена проданной вещи — основание для счёта. Менять её задним числом не
    // должна та сторона, которая по счёту платит.
    expect(canTransition('sold', 'draft')).toBe(false);
    expect(canTransition('sold', 'approved_online')).toBe(false);
    expect(sellerEditRule('sold').allowed).toBe(false);
  });
});
