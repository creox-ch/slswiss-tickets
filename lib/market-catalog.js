/**
 * Публичный каталог бренд-маркета: что из вещи можно показать миру.
 *
 * Шаг 6 ТЗ docs/TZ-market-cabinet.md. Чистый модуль без сети и env — проекция
 * строки БД в карточку каталога и правила видимости живут здесь, а не в роуте:
 * так их видно целиком и покрывает юнит-тест.
 *
 * Главное правило: карточка собирается ПЕРЕЧИСЛЕНИЕМ полей, а не вычитанием
 * лишних из строки БД. Расширится таблица (реквизиты, заметки модератора,
 * контакты) — новое поле не уедет наружу само собой.
 */
import { CATEGORIES, CONDITIONS, SEXES, formatItemNo, isVisibleInCatalog } from './market-items';
import { photoPublicUrl } from './market-photos';

/** Статусы, которые каталог запрашивает у базы. Источник правды — market-items. */
export const CATALOG_STATUSES = [
  'approved_online',
  'approved_market',
  'reserved',
  'sold',
].filter(isVisibleInCatalog);

/**
 * Состояние вещи для покупателя. Каталог различает всего три:
 * свободна, под бронью (можно встать в очередь), продана (гаснет).
 */
export function catalogState(status) {
  if (status === 'sold') return 'sold';
  if (status === 'reserved') return 'booked';
  return 'available';
}

/**
 * Где вещь доступна: только онлайн или ещё и на офлайн-маркете.
 *
 * ⚠️ Считается по статусу, и на `reserved`/`sold` различие теряется: бронь
 * затирает `approved_market`. Пока это незаметно (проданные из каталога уходят,
 * забронированные показывают бронь, а не площадку), но чинится не здесь —
 * в Этапе 2, где вещь получает `event_id` при допуске на маркет. Тогда
 * доступность будет считаться по нему и переживёт смену статуса.
 */
export function catalogAvailability(status) {
  return status === 'approved_market' ? 'market' : 'online';
}

/**
 * Описание на языке посетителя с откатом на русский.
 *
 * de/en появятся на шаге 7 (машинный перевод при одобрении). До тех пор
 * возвращается русский текст — пустая карточка хуже нерусского языка.
 */
export function pickDescription(item, locale = 'ru') {
  const it = item && typeof item === 'object' ? item : {};
  const byLocale = { de: it.description_de, en: it.description_en, ru: it.description_ru };
  const wanted = byLocale[locale];
  return (wanted && String(wanted).trim()) || (it.description_ru && String(it.description_ru).trim()) || null;
}

/** Рапены → CHF числом. Ноль и мусор → null: «0 CHF» в карточке хуже прочерка. */
function chf(rappen) {
  const n = Number(rappen);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n) / 100;
}

/**
 * Строка market_items → карточка публичного каталога.
 *
 * @param {object} row      строка из базы
 * @param {object} [opts]
 * @param {object} [opts.seller]      строка market_sellers (нужно только имя)
 * @param {string} [opts.supabaseUrl] база для сборки ссылок на фото
 * @param {string} [opts.locale='ru'] язык описания
 * @returns {object|null} null, если вещь не для каталога
 */
export function toPublicItem(row, opts = {}) {
  const it = row && typeof row === 'object' ? row : {};
  if (!isVisibleInCatalog(it.status)) return null;

  const { seller, supabaseUrl, locale = 'ru' } = opts;

  const photos = (Array.isArray(it.photos) ? it.photos : [])
    .filter(Boolean)
    .map((p) => photoPublicUrl(supabaseUrl, p))
    .filter(Boolean);

  return {
    // публичный номер вместо uuid: он же на этикетке и в письмах, а uuid вещи
    // наружу не отдаём — по нему ходят роуты кабинета
    no: formatItemNo(it.item_no),
    brand: it.brand || null,
    title: it.title || null,
    category: CATEGORIES[it.category] ? it.category : null,
    sex: SEXES[it.sex] ? it.sex : 'f',
    size: it.size || null,
    material: it.material || null,
    color: it.color || null,
    condition: CONDITIONS[it.condition] ? it.condition : null,
    price: chf(it.price_rappen),
    // цена в бутике: показываем зачёркнутой, только если она выше нашей
    originalPrice: chf(it.original_price_rappen),
    // чек/сертификат/коробка. Наружу уходит факт, а не документы
    verified: !!it.has_docs,
    availability: catalogAvailability(it.status),
    state: catalogState(it.status),
    description: pickDescription(it, locale),
    photos,
    // пакет «Под ключ» обещает приоритет в каталоге — сортировка на стороне роута,
    // но флаг отдаём: витрине может понадобиться пометка
    priority: !!it.priority,
    // только имя. Email, телефон и ticket_reference продавца — не публичные данные,
    // связь с продавцом идёт через форму заявки, а не напрямую
    seller: seller && seller.name ? { name: String(seller.name) } : null,
  };
}

/**
 * Порядок вещей в каталоге: сначала приоритетные («Под ключ»), внутри —
 * свежие сверху. Сортируем у себя, а не в PostgREST, чтобы правило лежало
 * рядом с проекцией и проверялось тестом.
 */
export function sortForCatalog(items) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const pa = a && a.priority ? 1 : 0;
    const pb = b && b.priority ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const ta = Date.parse((a && a.created_at) || '') || 0;
    const tb = Date.parse((b && b.created_at) || '') || 0;
    return tb - ta;
  });
}
