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
    segment: 'База', // как на главной: «День 1 — база» (личные финансы)
    days: [1],
    prices: { vip: 27900, premium: 19900, standard: 14900 },
  },
  day2: {
    label: 'День 2 · 25 октября',
    segment: 'Следующий уровень', // «День 2 — следующий уровень» (не только бизнес)
    days: [2],
    prices: { vip: 36900, premium: 28900, standard: 21900 },
  },
  both: {
    // Пакеты «2 дня» = сумма двух дней − круглая скидка:
    // Standard 149+219=368 −49 → 319; Premium 199+289=488 −69 → 419; VIP 279+369=648 −99 → 549.
    label: 'Оба дня',
    segment: 'пакет',
    days: [1, 2],
    prices: { standard: 31900, premium: 41900, vip: 54900 },
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

// ============================================================
// Отображение билета в письме (номер, дата/время) + .ics календаря.
// Год события зашит: форум один — Frankenplatz 2026.
// ============================================================

/** Человекочитаемый номер билета: FP-2026-0417 (из счётчика ticket_no в БД). */
export function formatTicketNo(no) {
  const n = Number(no);
  if (!Number.isInteger(n) || n < 1) return null; // нет номера — вызывающий даст запасной код
  return `FP-2026-${String(n).padStart(4, '0')}`;
}

/**
 * Подпись «Дата и время» для письма по КЛЮЧУ ПРОДУКТА (payload.product), а не по
 * числу дней: day1 и day2 оба дают days=1, но это разные даты. Неизвестный
 * продукт → показываем весь форум (безопасный дефолт).
 */
export function ticketDateTimeLabel(product) {
  if (product === 'day1') return '24 октября, 09:30 — 18:00';
  if (product === 'day2') return '25 октября, 09:30 — 18:00';
  return '24–25 октября, 09:30 — 18:00'; // both / неизвестно
}

/** Параметр дня для ссылки на .ics: day1→'1', day2→'2', иначе 'both'. */
export function icsDayParam(product) {
  if (product === 'day1') return '1';
  if (product === 'day2') return '2';
  return 'both';
}

/**
 * Одно событие форума для .ics. Время — в UTC (суффикс Z), чтобы не тащить
 * VTIMEZONE: даты фиксированы, конвертация выверена вручную.
 *   День 1 (24.10.2026) — CEST (+02:00): 09:30→07:30Z, 18:00→16:00Z.
 *   День 2 (25.10.2026) — CET  (+01:00, летнее время кончается в ночь на 25-е):
 *                         09:30→08:30Z, 18:00→17:00Z.
 */
const ICS_EVENTS = {
  '1': {
    uid: 'frankenplatz-2026-day1@frankenplatz.ch',
    start: '20261024T073000Z',
    end: '20261024T160000Z',
    summary: 'Frankenplatz 2026 — День 1',
  },
  '2': {
    uid: 'frankenplatz-2026-day2@frankenplatz.ch',
    start: '20261025T083000Z',
    end: '20261025T170000Z',
    summary: 'Frankenplatz 2026 — День 2',
  },
};

const ICS_LOCATION = 'Trafo Baden\\, Brown-Boveri-Platz 1\\, 5400 Baden';
const ICS_DTSTAMP = '20260201T000000Z'; // метка создания файла (фиксирована — детерминизм)

function icsEvent(ev) {
  return [
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${ICS_DTSTAMP}`,
    `DTSTART:${ev.start}`,
    `DTEND:${ev.end}`,
    `SUMMARY:${ev.summary}`,
    `LOCATION:${ICS_LOCATION}`,
    'DESCRIPTION:Форум о личных финансах в Швейцарии. QR-билет — в письме о покупке.',
    'URL:https://frankenplatz.ch',
    'END:VEVENT',
  ];
}

/**
 * Собрать .ics (RFC 5545) для дня 'day': '1' | '2' | 'both'.
 * Переводы строк — CRLF (требование спецификации). Чистая функция — тестируется без HTTP.
 */
export function buildEventIcs(day) {
  const events =
    day === 'both'
      ? [...icsEvent(ICS_EVENTS['1']), ...icsEvent(ICS_EVENTS['2'])]
      : icsEvent(ICS_EVENTS[day] || ICS_EVENTS['1']);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Frankenplatz//Tickets//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}
