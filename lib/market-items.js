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
  // насчёт офлайна, не выбрасывая вещь из каталога. `pending` здесь потому,
  // что правка опубликованной вещи возвращает её на повторную проверку.
  approved_online: ['approved_market', 'reserved', 'sold', 'withdrawn', 'rejected', 'pending'],
  approved_market: [
    'approved_online',
    'reserved',
    'sold',
    'withdrawn',
    'returned',
    'rejected',
    'pending',
  ],
  // отклонённую вещь продавец может доработать и прислать снова
  rejected: ['draft', 'withdrawn'],
  // бронь либо доводит до продажи, либо истекает и возвращает вещь в каталог
  reserved: ['sold', 'approved_online', 'approved_market', 'withdrawn'],
  sold: [], // конечный статус: сделка зафиксирована, на ней считается комиссия
  withdrawn: ['draft'],
  returned: ['draft'],
};

/**
 * Статус словами — для человека. Служебные имена вроде `approved_online`
 * продавцу не показываем: он их не заводил и понимать не обязан.
 */
export const STATUS_TEXT = {
  draft: 'Черновик',
  pending: 'На проверке',
  approved_online: 'В каталоге',
  approved_market: 'В каталоге и на маркете',
  rejected: 'Не приняли',
  reserved: 'Забронирована',
  sold: 'Продана',
  withdrawn: 'Снята',
  returned: 'Возвращена',
};

/** Название статуса словами; неизвестный — нейтральное «эта вещь». */
export function statusLabel(status) {
  return STATUS_TEXT[status] || 'эта вещь';
}

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

/**
 * Обратная операция: «FM-2026-0042» → 42.
 *
 * Нужна там, где код вещи приезжает строкой из заявки покупателя, а найти по
 * нему надо строку в базе. Значение приходит из формы на статическом сайте,
 * то есть управляется кем угодно, — поэтому разбираем строго и на любой мусор
 * отвечаем null, а не «наверное, ноль».
 */
export function parseItemNo(code) {
  if (code === undefined || code === null) return null;
  const m = String(code).trim().toUpperCase().match(/^FM-(\d{4})-(\d{1,10})$/);
  if (!m) return null;
  const n = Number(m[2]);
  return Number.isInteger(n) && n > 0 ? n : null;
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

/**
 * Цена из формы: принимаем «450», «450.50», «450,50», число — и швейцарское
 * «1'200».
 *
 * Апостроф здесь обязателен: в Швейцарии тысячи разделяют именно им, продавцы
 * так и пишут. Раньше `1'200` не проходило проверку и человек получал
 * абстрактное «Укажи цену числом», не понимая, что не так с ценой.
 * Отбрасываем все три ходовых начертания апострофа — прямой, типографский
 * и обратный акцент, — плюс пробелы (включая неразрывный).
 */
export function parsePriceToRappen(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value)
    .replace(/[\s'’´`]/g, '')
    .replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/**
 * Проверка вещи перед сохранением.
 *
 * Проверяет ТОЛЬКО то, что пришло из формы. Готовность к публикации (включая
 * фото, которых в форме нет) считает canPublish по строке из базы.
 *
 * @param {object} input      сырые поля из формы
 * @param {object} [opts]
 * @param {boolean} [opts.forPublication=false] строгий режим: требует описание.
 *   Черновик можно сохранять недозаполненным — иначе продавец не сможет
 *   отложить вещь на потом.
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
      // photos здесь НЕТ намеренно. Фото приходят не из формы, а своим роутом и
      // живут в БД. Пока они были частью value, сохранение формы подставляло
      // пустой список: проверка публикации видела «ноль фото» при четырёх в базе,
      // а обновление затёрло бы их совсем. Фотографиями управляет только
      // /api/market/items/:id/photos.
    },
  };
}

/**
 * Что делает кнопка формы. Держим здесь, а не в роуте, чтобы список действий
 * и их смысл были в одном месте с таблицей переходов — иначе форма шлёт одно,
 * роут понимает другое (так и случилось с «сохранить черновик»: форма слала
 * `save`, роут о нём не знал и отвечал «неизвестное действие»).
 *
 * target === null — сохранение полей без смены статуса.
 */
const ACTIONS = {
  save: null,
  submit: 'pending',
  withdraw: 'withdrawn',
  draft: 'draft',
};

/**
 * Разбор действия из запроса.
 * @returns {{known: boolean, target: string|null}}
 */
export function resolveAction(action) {
  if (action === undefined || action === null || action === '') {
    return { known: true, target: null };
  }
  const key = String(action);
  if (!(key in ACTIONS)) return { known: false, target: null };
  return { known: true, target: ACTIONS[key] };
}

/**
 * Разрешено ли действие для вещи в этом статусе. Переход «в тот же статус» —
 * это не переход, а сохранение: черновик остаётся черновиком, и требовать для
 * него правила из таблицы незачем.
 */
/**
 * Кто и когда правит поля вещи.
 *
 * Пока вещь не опубликована, продавец правит свободно. У опубликованной правка
 * возвращает её на повторную проверку: одобряли конкретную вещь с конкретным
 * описанием, и право отбора (AGB 3.6) не должно обходиться сменой бренда сразу
 * после одобрения. У забронированной и проданной поля заперты совсем — цена
 * проданной вещи это основание для счёта на комиссию, и менять его задним
 * числом не должна та сторона, которая по счёту платит.
 */
const SELLER_EDIT = {
  draft: { allowed: true },
  pending: { allowed: true },
  rejected: { allowed: true },
  withdrawn: { allowed: true },
  returned: { allowed: true },
  approved_online: { allowed: true, backToPending: true },
  approved_market: { allowed: true, backToPending: true },
  reserved: {
    allowed: false,
    reason: 'Вещь забронирована — пока бронь жива, менять её нельзя. Напиши нам, если бронь надо снять.',
  },
  sold: {
    allowed: false,
    reason: 'Вещь продана. Её цена — основание для счёта на комиссию, поэтому правки закрыты.',
  },
};

/**
 * Правило правки для статуса: можно ли, уедет ли вещь на повторную проверку и
 * что сказать человеку, если нельзя.
 */
export function sellerEditRule(status) {
  const rule = SELLER_EDIT[status];
  if (!rule) {
    return {
      allowed: false,
      backToPending: false,
      reason: 'С вещью в этом состоянии сейчас ничего сделать нельзя.',
    };
  }
  return {
    allowed: !!rule.allowed,
    backToPending: !!rule.backToPending,
    reason: rule.reason || null,
  };
}

export function canApply(currentStatus, target) {
  if (!target) return true;
  if (target === currentStatus) return true;
  return canTransition(currentStatus, target);
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
