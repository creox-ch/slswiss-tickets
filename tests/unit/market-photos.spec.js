import { test, expect } from '@playwright/test';
import {
  PHOTO_BUCKET,
  ALLOWED_MIME,
  MAX_PHOTO_BYTES,
  TARGET_LONG_SIDE,
  checkPhoto,
  canAddPhoto,
  photoPath,
  photoPublicUrl,
  belongsToItem,
} from '../../lib/market-photos';
import { MAX_PHOTOS } from '../../lib/market-items';

const ITEM = '3f1a2b4c-0000-4000-8000-000000000001';
const RANDOM = 'a1b2c3d4e5f6a7b8';

test.describe('приём файла', () => {
  test('обычное фото с телефона проходит', () => {
    expect(checkPhoto({ type: 'image/jpeg', size: 350 * 1024 })).toEqual({ ok: true, error: null });
    expect(checkPhoto({ type: 'image/png', size: 900 * 1024 }).ok).toBe(true);
    expect(checkPhoto({ type: 'image/webp', size: 120 * 1024 }).ok).toBe(true);
  });

  test('не картинку не берём — под видом фото может приехать что угодно', () => {
    expect(checkPhoto({ type: 'application/pdf', size: 1000 }).ok).toBe(false);
    expect(checkPhoto({ type: 'text/html', size: 1000 }).ok).toBe(false);
    expect(checkPhoto({ type: 'image/svg+xml', size: 1000 }).ok).toBe(false); // svg = исполняемый код
    expect(checkPhoto({}).ok).toBe(false);
  });

  test('пустой и слишком тяжёлый файл отбиваются', () => {
    expect(checkPhoto({ type: 'image/jpeg', size: 0 }).ok).toBe(false);
    const heavy = checkPhoto({ type: 'image/jpeg', size: MAX_PHOTO_BYTES + 1 });
    expect(heavy.ok).toBe(false);
    expect(heavy.error).toMatch(/5 МБ/);
  });

  test('лимит и целевой размер — те, на которые рассчитан Storage', () => {
    expect(MAX_PHOTO_BYTES).toBe(5 * 1024 * 1024);
    expect(TARGET_LONG_SIDE).toBe(1600);
    expect(ALLOWED_MIME).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(PHOTO_BUCKET).toBe('market-items');
  });
});

test.describe('сколько фото', () => {
  test('пятое добавляем, шестое — нет', () => {
    expect(canAddPhoto([])).toBe(true);
    expect(canAddPhoto(new Array(MAX_PHOTOS - 1).fill('x'))).toBe(true);
    expect(canAddPhoto(new Array(MAX_PHOTOS).fill('x'))).toBe(false);
  });

  test('кривой список не роняет проверку', () => {
    expect(canAddPhoto(null)).toBe(true);
    expect(canAddPhoto('фото')).toBe(true);
  });
});

test.describe('путь файла', () => {
  test('папка по вещи + случайное имя + честное расширение', () => {
    expect(photoPath(ITEM, 'image/jpeg', RANDOM)).toBe(`${ITEM}/${RANDOM}.jpg`);
    expect(photoPath(ITEM, 'image/png', RANDOM)).toBe(`${ITEM}/${RANDOM}.png`);
    expect(photoPath(ITEM, 'image/webp', RANDOM)).toBe(`${ITEM}/${RANDOM}.webp`);
  });

  test('без вещи, с чужим типом и с коротким именем пути нет', () => {
    expect(photoPath(null, 'image/jpeg', RANDOM)).toBe(null);
    expect(photoPath(ITEM, 'application/pdf', RANDOM)).toBe(null);
    expect(photoPath(ITEM, 'image/jpeg', 'abc')).toBe(null); // угадываемое имя
  });

  test('в имени остаются только буквы и цифры — выйти из папки вещи нельзя', () => {
    // Слэши и точки вырезаются, поэтому попытка обхода превращается в обычное имя
    // внутри папки вещи, а не в путь наружу.
    expect(photoPath(ITEM, 'image/jpeg', '../../secret-file')).toBe(`${ITEM}/secretfile.jpg`);
    expect(photoPath(ITEM, 'image/jpeg', 'a1b2c3d4/../x')).toBe(`${ITEM}/a1b2c3d4x.jpg`);
    // Имя генерит сервер (crypto.randomBytes), это защита от опечатки, а не от атаки:
    // после чистки коротких имён не остаётся — они отсекаются как угадываемые.
    expect(photoPath(ITEM, 'image/jpeg', '../..')).toBe(null);
  });
});

test.describe('публичный URL и принадлежность', () => {
  test('URL собирается из адреса проекта и пути', () => {
    expect(photoPublicUrl('https://x.supabase.co', `${ITEM}/a.jpg`)).toBe(
      `https://x.supabase.co/storage/v1/object/public/market-items/${ITEM}/a.jpg`
    );
    expect(photoPublicUrl('https://x.supabase.co/', `${ITEM}/a.jpg`)).toContain('.co/storage');
    expect(photoPublicUrl(null, 'a.jpg')).toBe(null);
  });

  test('удалить можно только фото своей вещи', () => {
    expect(belongsToItem(`${ITEM}/a.jpg`, ITEM)).toBe(true);
    expect(belongsToItem('другая-вещь/a.jpg', ITEM)).toBe(false);
    expect(belongsToItem(null, ITEM)).toBe(false);
    expect(belongsToItem(`${ITEM}/a.jpg`, null)).toBe(false);
  });
});
