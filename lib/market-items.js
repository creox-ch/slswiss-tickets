/**
 * Вещи бренд-маркета: словари, статусы и валидация.
 *
 * Шаг 1 ТЗ docs/TZ-market-cabinet.md. Чистый модуль без сети и env — вся логика,
 * которую иначе размазало бы по роутам и экранам, живёт здесь и покрыта юнит-тестами.
 *
 * Цены — в рапенах (100 = 1.00 CHF), как везде в проекте.
 */

/** Категории каталога. Ключи совпадают с фильтрами на market-catalog.html. */
export const CATEGORIES = {
  clothes: 'Одежда',
  shoes: 'Обувь',
  bags: 'Сумки',
  acc: 'Аксессуары',
};

/** Кому вещь: женское / мужское / унисекс / детское. */
export const SEXES = { f: 'Женское', m: 'Мужское', u: 'Унисекс', k: 'Детское' };

/** Состояние. Порядок важен: от лучшего к худшему (сортировка в каталоге). */
export const CONDITIONS = {
  new: 'Новое',
  ideal: 'Идеальное',
  good: 'Хорошее',
  fair: 'Обычное',
};

/** Фото на вещь: без единого карточка в каталоге бессмысленна (решение 17.08). */
export const MIN_PHOTOS = 1;
export const MAX_PHOTOS = 5;

/** Границы цены: ниже 5 CHF это не люкс-маркет, выше 50 000 — почти наверняка опечатка. */
export const MIN_PRICE_RAPPEN = 500;
export const MAX_PRICE_RAPPEN = 5000000;

/**
 * Статусы вещи.
 *
 * draft            — продавец заполняет, видит только он
 * pending          — отправлено на модерацию
 * approved_online  — в каталоге, но НЕ на офлайн-маркете (мидл-бренды: «онлайн
 *                    можно всегда, на маркет по отбору»)
 * approved_market  — в каталоге и допущено на маркет, получает QR-этикетку
 * rejected         — не берём (AGB 3.6), с причиной в moderation_note
 * reserved         — есть активная бронь
 * sold             — продано, в каталоге гаснет
 * withdrawn        — продавец снял сам. Отдельно от returned: снятая вещь не даёт
 *                    права на возврат взноса (AGB 6.4)
 * returned         — не продана и возвращена продавцу после маркета
 */
export const ITEM_STATUSES = [
  'draft',
  'pending',
  'approved_online',
  'approved_market',
  'rejected',
  'reserved',
  'sold',
  'withdrawn',
  'returned',
];

/** Куда можно перейти из каждого статуса. Пустой массив — тупик. */
const TRANSITIONS = {
  draft: ['pending', 'withdrawn'],
  pending: ['approved_online', 'approved_market', 'rejected', 'draft', 'withdrawn'],
  // из одобренного можно двигать в обе стороны: модератор вправе передумать
  // насчёт офлайна, не выбрасывая вещь из каталога
  approved_online: ['approved_market', 'reserved', 'sold', 'withdrawn', 'rejected'],
  approved_market: ['approved_online', 'reserved', 'sold', 'withdrawn', 'returned', 'rejected'],
  // отклонённую вещь продавец может доработать и прислать снова
  rejected: ['draft', 'withdrawn'],
  // бронь либо доводит до продажи, либо истекает и возвращает вещь в каталог
  reserved: ['sold', 'approved_online', 'approved_market', 'withdrawn'],
  sold: [], // конечный статус: сделка зафиксирована, на ней считается комиссия
  withdrawn: ['draft'],
  returned: ['draft'],
};

/** Существует ли такой статус. */
export function isValidStatus(status) {
  return ITEM_STATUSES.includes(status);
}

/**
 * Разрешён ли переход. Неизвестные статусы — всегда false: лучше отказать,
 * чем протащить опечатку в БД мимо check-ограничения.
 */
export function canTransition(from, to) {
  if (!isValidStatus(from) || !isValidStatus(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/** Статусы, при которых вещь видна в публичном каталоге (проданное — гаснет, но видно). */
const VISIBLE = ['approved_online', 'approved_market', 'reserved', 'sold'];

/** Показываем ли вещь в каталоге. */
export function isVisibleInCatalog(status) {
  return VISIBLE.includes(status);
}

/** Можно ли по вещи оставить бронь: только свободная и одобренная. */
export function isBookable(status) {
  return status === 'approved_online' || status === 'approved_market';
}

/** Попадает ли вещь на офлайн-маркет (нужен QR-ярлык и место на вешалке). */
export function goesToMarket(status) {
  return status === 'approved_market';
}

/**
 * Публичный номер вещи: FM-2026-0042. Человеко-читаемый идентификатор для
 * этикетки, письма и разговора с продавцом; в БД лежит просто счётчик.
 */
export function formatItemNo(itemNo, year = 2026) {
  const n = Number(itemNo);
  if (!Number.isInteger(n) || n <= 0) return null;
  return `FM-${year}-${String(n).padStart(4, '0')}`;
}

/** Цена рапены → «159.00 CHF» для писем и карточек. */
export function formatPrice(rappen) {
  const n = Number(rappen);
  if (!Number.isFinite(n)) return null;
  return `${(n / 100).toFixed(2)} CHF`;
}

/** Строка из формы: обрезаем по длине, пустое → null. */
function str(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/** Цена из формы: принимаем и «450», и «450.50», и число. Возвращаем рапены или null. */
export function parsePriceToRappen(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/**
 * Проверка вещи перед сохранением.
 *
 * @param {object} input      сырые поля из формы
 * @param {object} [opts]
 * @param {boolean} [opts.forPublication=false] строгий режим: так проверяем перед
 *   отправкой на модерацию (нужны фото и описание). Черновик можно сохранять
 *   недозаполненным — иначе продавец не сможет отложить вещь на потом.
 * @returns {{ok: boolean, errors: string[], value: object|null}}
 *   value — очищенные поля, готовые к записи (null, если есть ошибки).
 */
export function validateItem(input, opts = {}) {
  const forPublication = !!opts.forPublication;
  const src = input && typeof input === 'object' ? input : {};
  const errors = [];

  const brand = str(src.brand, 80);
  const title = str(src.title, 200);
  const category = str(src.category, 20);
  const sex = str(src.sex, 2) || 'f';
  const condition = str(src.condition, 20);
  const price = parsePriceToRappen(src.price);
  const original = parsePriceToRappen(src.originalPrice);

  if (!brand) errors.push('Укажи бренд.');
  if (!title) errors.push('Укажи название вещи.');
  if (!category || !CATEGORIES[category]) errors.push('Выбери категорию.');
  if (!SEXES[sex]) errors.push('Выбери, кому вещь.');
  if (!condition || !CONDITIONS[condition]) errors.push('Выбери состояние.');

  if (price === null) {
    errors.push('Укажи цену числом, например 450 или 450.50.');
  } else if (price < MIN_PRICE_RAPPEN) {
    errors.push(`Цена ниже ${formatPrice(MIN_PRICE_RAPPEN)} — проверь, не ошибка ли.`);
  } else if (price > MAX_PRICE_RAPPEN) {
    errors.push(`Цена выше ${formatPrice(MAX_PRICE_RAPPEN)} — проверь, не лишний ли ноль.`);
  }

  if (src.originalPrice && original === null) {
    errors.push('Цена в бутике должна быть числом — или оставь поле пустым.');
  }
  if (price !== null && original !== null && original <= price) {
    errors.push('Цена в бутике должна быть выше твоей — иначе скидку показывать незачем.');
  }

  const photos = Array.isArray(src.photos) ? src.photos.filter(Boolean) : [];
  if (photos.length > MAX_PHOTOS) {
    errors.push(`Фото не больше ${MAX_PHOTOS}.`);
  }
  if (forPublication && photos.length < MIN_PHOTOS) {
    errors.push('Добавь хотя бы одно фото — без него карточку не показать.');
  }

  const description = str(src.description, 2000);
  if (forPublication && !description) {
    errors.push('Опиши вещь: состояние, дефекты, как носилась.');
  }

  if (errors.length) return { ok: false, errors, value: null };

  return {
    ok: true,
    errors: [],
    value: {
      brand,
      title,
      category,
      sex,
      condition,
      size: str(src.size, 40),
      material: str(src.material, 120),
      color: str(src.color, 60),
      price_rappen: price,
      original_price_rappen: original,
      has_docs: !!src.hasDocs,
      description_ru: description,
      photos,
    },
  };
}

/**
 * Готова ли СОХРАНЁННАЯ вещь к отправке на модерацию.
 *
 * Отдельно от validateItem намеренно: фото не приходят вместе с формой, они
 * лежат в БД и грузятся своим роутом. Проверять их по телу запроса — значит
 * либо ругаться на фото, которое есть (форма их не шлёт), либо пропускать
 * вещь совсем без фото (кнопка «отправить» из списка шлёт одно действие).
 * Оба случая мы уже словили живьём.
 *
 * @param {object} item строка market_items как она есть в базе
 * @returns {{ok: boolean, errors: string[]}}
 */
export function canPublish(item) {
  const it = item && typeof item === 'object' ? item : {};
  const errors = [];

  const photos = Array.isArray(it.photos) ? it.photos.filter(Boolean) : [];
  if (photos.length < MIN_PHOTOS) {
    errors.push('Добавь хотя бы одно фото — без него карточку не показать.');
  }
  if (photos.length > MAX_PHOTOS) {
    errors.push(`Фото не больше ${MAX_PHOTOS}.`);
  }
  if (!it.brand || !it.title) {
    errors.push('Заполни бренд и название.');
  }
  if (!it.description_ru) {
    errors.push('Опиши вещь: состояние, дефекты, как носилась.');
  }
  if (!Number.isFinite(Number(it.price_rappen)) || Number(it.price_rappen) <= 0) {
    errors.push('Укажи цену.');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Действует ли гарантия возврата взноса на эту вещь (AGB 6.2–6.3): нужны
 * документы подлинности И цена не выше рекомендованной нами. Рекомендации нет —
 * считаем, что условие по цене выполнено: мы её не давали, придраться не к чему.
 */
export function coveredByRefundGuarantee(item) {
  const it = item && typeof item === 'object' ? item : {};
  if (!it.has_docs) return false;
  const recommended = Number(it.recommended_price_rappen);
  const price = Number(it.price_rappen);
  if (!Number.isFinite(recommended) || recommended <= 0) return true;
  return Number.isFinite(price) && price <= recommended;
}
