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
 * Что предлагать в выборе файла на телефоне — шире, чем принимает сервер.
 *
 * Айфон снимает в HEIC. Со списком из одних jpeg/png/webp такие снимки в
 * системном выборе либо недоступны, либо конвертируются через раз — 20.08 на
 * живом телефоне из пяти фото загрузились два. Браузер всё равно перекодирует
 * картинку в JPEG перед отправкой (`shrink` в app/market/photo-uploader.jsx),
 * так что до сервера HEIC не доезжает, а человеку не нужно гадать, почему
 * половина фотоплёнки недоступна.
 */
export const PICKER_ACCEPT = [...ALLOWED_MIME, 'image/heic', 'image/heif'].join(',');

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
 *
 * Проверяем не префикс, а точную форму `<itemId>/<имя без слэшей>`: префикс
 * пропускал `<itemId>/../<чужая вещь>/x.jpg`. Supabase такой путь не разворачивает
 * и ничего лишнего не удалил (проверено на проде), но защита не должна держаться
 * на поведении чужого сервиса.
 */
export function belongsToItem(path, itemId) {
  if (!path || !itemId) return false;
  const parts = String(path).split('/');
  if (parts.length !== 2) return false;
  const [folder, name] = parts;
  if (folder !== String(itemId)) return false;
  return /^[a-z0-9]+\.(jpg|png|webp)$/i.test(name);
}

/**
 * Что за файл пришёл НА САМОМ ДЕЛЕ — по первым байтам.
 *
 * Заявленный тип приходит из формы и полностью под контролем отправителя:
 * PDF с заголовком `image/jpeg` проходил проверку и ложился в публичный bucket
 * (поймано при прогоне на проде). Опасность умеренная — Storage отдаёт файл с
 * нашим content-type, поэтому браузер не исполнит его как документ или скрипт, —
 * но хранить в каталоге вещей что попало незачем.
 *
 * @param {Buffer|Uint8Array} bytes начало файла (хватит первых 16 байт)
 * @returns {string|null} mime или null, если это не картинка известного формата
 */
export function sniffImageMime(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const b = bytes;

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, i) => b[i] === byte)) return 'image/png';

  // WebP: "RIFF" .... "WEBP"
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  if (riff.every((byte, i) => b[i] === byte) && webp.every((byte, i) => b[8 + i] === byte)) {
    return 'image/webp';
  }

  return null;
}
