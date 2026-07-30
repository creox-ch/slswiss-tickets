/**
 * Каталог билетов форума Frankenplatz + расчёт заказа.
 *
 * Цены server-authoritative: клиент присылает только ВЫБОР (день, категория,
 * ланч), а сумму считает сервер — как и во всём билетном стенде, клиентской
 * цене не верим. Всё в рапенах (1 CHF = 100). Без НДС (цель — держаться ниже
 * порога НДС), поэтому налоговых строк в заказе нет.
 *
 * Чистый модуль без сети и env — легко тестировать.
 */

/** Событие форума (тот же slug, что у форм в submissions). */
export const FORUM_EVENT_SLUG = 'frankenplatz-2026-10';

/** Единая скидка Early Bird — на билеты (НЕ на ланч). Действует до объявления всех спикеров. */
export const EB_DISCOUNT = 0.25;

/** Ланч — доп к билету, за каждый день. Early Bird на него не распространяется. */
export const LUNCH_RAPPEN = 3500; // 35.00 CHF / день

/**
 * Обычные (не-EB) цены, рапены. Продукт × категория ряда.
 * Front/VIP-пакеты на 2 дня — ЗАГЛУШКИ (Иванна пришлёт настоящие), помечены
 * в `provisional`: не показываем как финальные и не открываем в продажу, пока
 * не подтверждены.
 */
const PRODUCTS = {
  day1: {
    label: 'День 1 · 24 октября',
    segment: 'B2C',
    days: [1],
    prices: { vip: 27900, premium: 19900, standard: 14900 },
  },
  day2: {
    label: 'День 2 · 25 октября',
    segment: 'B2B',
    days: [2],
    prices: { vip: 36900, premium: 28900, standard: 21900 },
  },
  both: {
    label: 'Оба дня',
    segment: 'пакет',
    days: [1, 2],
    prices: { standard: 31900, vip: 55900, premium: 42900 },
    provisional: ['vip', 'premium'], // Front/VIP пакеты пока не подтверждены
  },
};

/** Категории рядов: подпись, ряды и мягкий лимит мест (продажу не блокирует — только уведомляет). */
export const CATEGORIES = {
  vip: { label: 'VIP', rows: '1–2', limit: 30 },
  premium: { label: 'Premium', rows: '3–5', limit: 45 },
  standard: { label: 'Standard', rows: '6–20', limit: 225 },
};

/** Цена Early Bird из обычной: −25%, округление до целого франка (совпадает с числами Иванны). */
export function ebPrice(regularRappen) {
  const francs = regularRappen / 100;
  return Math.round(francs * (1 - EB_DISCOUNT)) * 100;
}

/** Валиден ли выбор (известные продукт и категория, и такая категория есть у продукта). */
export function isValidSelection(product, category) {
  const p = PRODUCTS[product];
  return !!(p && CATEGORIES[category] && p.prices[category] != null);
}

/**
 * Провизорна ли цена (заглушка) для выбранной комбинации — например, VIP/Premium на 2 дня.
 * Такие в продажу не открываем, пока Иванна не подтвердит цену.
 */
export function isProvisional(product, category) {
  const p = PRODUCTS[product];
  return !!(p && (p.provisional || []).includes(category));
}

/**
 * Расчёт заказа: {product, category, lunch, earlyBird} → разбивка сумм в рапенах.
 * Кидает Error при неизвестных продукте/категории — вызывающий роут отвечает 400.
 */
export function priceOrder({ product, category, lunch, earlyBird }) {
  const p = PRODUCTS[product];
  if (!p) throw new Error('unknown product');
  const base = p.prices[category];
  if (base == null) throw new Error('unknown category');

  const days = p.days.length;
  const ticket = earlyBird ? ebPrice(base) : base;
  const lunchTotal = lunch ? LUNCH_RAPPEN * days : 0; // ланч на каждый день продукта

  return {
    ticket, // цена билета (с учётом EB)
    lunch: lunchTotal, // доп за ланч (без EB)
    total: ticket + lunchTotal,
    days,
    provisional: (p.provisional || []).includes(category),
  };
}

/** Человекочитаемое описание заказа — для Payrexx purpose, письма и payload. */
export function describeOrder({ product, category, lunch, earlyBird }) {
  const p = PRODUCTS[product];
  const c = CATEGORIES[category];
  const parts = [`${p ? p.label : product} · ${c ? c.label : category}`];
  if (earlyBird) parts.push('Early Bird');
  if (lunch) parts.push(`+ ланч (${p ? p.days.length : 1} дн.)`);
  return parts.join(' · ');
}

/** Продукт по ключу (для витрины/лимитов). */
export function getProduct(product) {
  return PRODUCTS[product] || null;
}

/** Все ключи продуктов (day1, day2, both). */
export const PRODUCT_KEYS = Object.keys(PRODUCTS);
