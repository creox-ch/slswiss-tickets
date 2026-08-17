/**
 * Фото вещей: где лежат, что принимаем, сколько штук.
 *
 * Шаг 4 ТЗ docs/TZ-market-cabinet.md. Чистый модуль — проверки одинаковы на
 * сервере и в браузере, а тесты на них не требуют ни сети, ни Storage.
 */
import { MAX_PHOTOS } from './market-items';

/** Публичный bucket Supabase Storage. */
export const PHOTO_BUCKET = 'market-items';

/** Что принимаем. HEIC с айфона браузер сам превращает в jpeg при сжатии. */
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * 5 МБ на файл. Клиент сжимает до ~1600px по длинной стороне (обычно 200–500 КБ),
 * так что до лимита долетает только то, что сжать не удалось.
 */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Длинная сторона после сжатия: каталог показывает картинку максимум в ~800px. */
export const TARGET_LONG_SIDE = 1600;

/** Качество JPEG при сжатии — компромисс между весом и фактурой ткани. */
export const TARGET_QUALITY = 0.82;

/** Расширение по типу — Storage отдаёт файл по имени, и оно должно быть честным. */
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Можно ли принять этот файл.
 * @returns {{ok: boolean, error: string|null}}
 */
export function checkPhoto({ type, size } = {}) {
  if (!type || !ALLOWED_MIME.includes(type)) {
    return { ok: false, error: 'Только JPG, PNG или WebP.' };
  }
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, error: 'Файл пустой.' };
  }
  if (bytes > MAX_PHOTO_BYTES) {
    return { ok: false, error: 'Фото тяжелее 5 МБ — попробуй другое.' };
  }
  return { ok: true, error: null };
}

/** Есть ли ещё место: пятое фото добавляем, шестое — нет. */
export function canAddPhoto(photos) {
  const list = Array.isArray(photos) ? photos : [];
  return list.length < MAX_PHOTOS;
}

/**
 * Путь файла в bucket: `<itemId>/<случайное имя>.<ext>`.
 *
 * Папка по вещи — чтобы удалить всё её фото одним запросом. Имя случайное:
 * bucket публичный, и по предсказуемому имени можно было бы подсмотреть фото
 * чужого черновика.
 */
export function photoPath(itemId, mime, random) {
  const ext = EXT[mime];
  if (!itemId || !ext) return null;
  const name = String(random || '').replace(/[^a-z0-9]/gi, '');
  if (name.length < 8) return null;
  return `${itemId}/${name}.${ext}`;
}

/** Полный URL публичного файла — его и показывает каталог. */
export function photoPublicUrl(supabaseUrl, path) {
  if (!supabaseUrl || !path) return null;
  return `${String(supabaseUrl).replace(/\/$/, '')}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

/**
 * Принадлежит ли путь этой вещи. Без проверки удаление по присланному пути
 * стало бы способом стереть чужое фото.
 */
export function belongsToItem(path, itemId) {
  if (!path || !itemId) return false;
  return String(path).startsWith(`${itemId}/`);
}
