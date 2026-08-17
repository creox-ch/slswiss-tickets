import { test, expect } from '@playwright/test';
import {
  CATALOG_STATUSES,
  catalogState,
  catalogAvailability,
  pickDescription,
  toPublicItem,
  sortForCatalog,
} from '../../lib/market-catalog';

const SUPA = 'https://dwcmiommviauwzkhkbki.supabase.co';

/** Одобренная вещь как она лежит в базе — со всем лишним, чего каталог знать не должен. */
const row = {
  id: '11111111-2222-3333-4444-555555555555',
  seller_id: '99999999-8888-7777-6666-555555555555',
  item_no: 42,
  qr_token: 'secret-qr',
  brand: 'Max Mara',
  title: 'Пальто, шерсть-кашемир',
  category: 'clothes',
  sex: 'f',
  size: '38 (M)',
  material: 'шерсть + кашемир',
  color: 'кэмел',
  condition: 'ideal',
  price_rappen: 59000,
  original_price_rappen: 129000,
  recommended_price_rappen: 62000,
  has_docs: true,
  description_ru: 'Надевалось несколько раз.',
  photos: ['11111111-2222-3333-4444-555555555555/abcd1234.jpg'],
  status: 'approved_market',
  moderation_note: 'взяли, бренд люксовый',
  priority: false,
  created_at: '2026-08-17T10:00:00Z',
};

test.describe('видимость в каталоге', () => {
  test('запрашиваем ровно четыре статуса, и все они видимые', () => {
    expect(CATALOG_STATUSES).toEqual(['approved_online', 'approved_market', 'reserved', 'sold']);
  });

  test('черновик, модерация и отказ наружу не уходят', () => {
    for (const status of ['draft', 'pending', 'rejected', 'withdrawn', 'returned']) {
      expect(toPublicItem({ ...row, status })).toBeNull();
    }
  });

  test('состояние для покупателя: свободна, бронь, продана', () => {
    expect(catalogState('approved_online')).toBe('available');
    expect(catalogState('approved_market')).toBe('available');
    expect(catalogState('reserved')).toBe('booked');
    expect(catalogState('sold')).toBe('sold');
  });

  test('на маркете — только допущенное туда', () => {
    expect(catalogAvailability('approved_market')).toBe('market');
    expect(catalogAvailability('approved_online')).toBe('online');
    // бронь затирает площадку — известное ограничение до event_id в Этапе 2
    expect(catalogAvailability('reserved')).toBe('online');
  });
});

test.describe('проекция вещи', () => {
  test('карточка собирается из разрешённых полей', () => {
    const pub = toPublicItem(row, { seller: { name: 'Ксения', email: 'k@example.com' }, supabaseUrl: SUPA });
    expect(pub).toMatchObject({
      no: 'FM-2026-0042',
      brand: 'Max Mara',
      category: 'clothes',
      condition: 'ideal',
      price: 590,
      originalPrice: 1290,
      verified: true,
      availability: 'market',
      state: 'available',
      description: 'Надевалось несколько раз.',
      seller: { name: 'Ксения' },
    });
    expect(pub.photos).toEqual([
      `${SUPA}/storage/v1/object/public/market-items/11111111-2222-3333-4444-555555555555/abcd1234.jpg`,
    ]);
  });

  test('внутреннее наружу не уезжает', () => {
    const pub = toPublicItem(row, { seller: { name: 'Ксения', email: 'k@example.com' }, supabaseUrl: SUPA });
    const keys = Object.keys(pub);
    for (const secret of [
      'id',
      'seller_id',
      'qr_token',
      'moderation_note',
      'recommended_price_rappen',
      'price_rappen',
      'item_no',
    ]) {
      expect(keys).not.toContain(secret);
    }
    // продавец — только имя: ни адреса, ни телефона, ни ссылки на оплату
    expect(Object.keys(pub.seller)).toEqual(['name']);
    expect(JSON.stringify(pub)).not.toContain('k@example.com');
    expect(JSON.stringify(pub)).not.toContain('secret-qr');
    expect(JSON.stringify(pub)).not.toContain('бренд люксовый');
  });

  test('без продавца и без фото карточка не разваливается', () => {
    const pub = toPublicItem({ ...row, photos: [] }, { supabaseUrl: SUPA });
    expect(pub.photos).toEqual([]);
    expect(pub.seller).toBeNull();
  });

  test('нулевая и мусорная цена превращаются в прочерк, а не в «0 CHF»', () => {
    expect(toPublicItem({ ...row, original_price_rappen: null }, {}).originalPrice).toBeNull();
    expect(toPublicItem({ ...row, original_price_rappen: 0 }, {}).originalPrice).toBeNull();
    expect(toPublicItem({ ...row, price_rappen: 'нет' }, {}).price).toBeNull();
  });

  test('неизвестный словарь не протаскивается в каталог', () => {
    expect(toPublicItem({ ...row, category: 'weapons' }, {}).category).toBeNull();
    expect(toPublicItem({ ...row, condition: 'убитое' }, {}).condition).toBeNull();
    expect(toPublicItem({ ...row, sex: 'x' }, {}).sex).toBe('f');
  });
});

test.describe('язык описания', () => {
  const multi = { description_ru: 'по-русски', description_de: 'auf Deutsch', description_en: null };

  test('берём запрошенный язык', () => {
    expect(pickDescription(multi, 'de')).toBe('auf Deutsch');
  });

  test('перевода ещё нет — показываем русский, а не пустоту', () => {
    expect(pickDescription(multi, 'en')).toBe('по-русски');
    expect(pickDescription(multi, 'it')).toBe('по-русски');
  });

  test('описания нет совсем', () => {
    expect(pickDescription({}, 'ru')).toBeNull();
    expect(pickDescription({ description_ru: '   ' }, 'ru')).toBeNull();
  });
});

test.describe('порядок в каталоге', () => {
  test('«Под ключ» вперёд, внутри — свежие сверху', () => {
    const sorted = sortForCatalog([
      { title: 'старая', priority: false, created_at: '2026-08-01T00:00:00Z' },
      { title: 'свежая', priority: false, created_at: '2026-08-16T00:00:00Z' },
      { title: 'под ключ', priority: true, created_at: '2026-08-02T00:00:00Z' },
    ]);
    expect(sorted.map((i) => i.title)).toEqual(['под ключ', 'свежая', 'старая']);
  });

  test('исходный массив не трогаем', () => {
    const input = [{ priority: false }, { priority: true }];
    sortForCatalog(input);
    expect(input[0].priority).toBe(false);
  });
});
