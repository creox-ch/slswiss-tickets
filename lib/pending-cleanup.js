/**
 * Брошенные корзины: билеты, застрявшие в `pending`.
 *
 * Каждое нажатие «Купить» создаёт строку `pending` ДО оплаты (иначе вебхуку
 * некуда возвращаться по `referenceId`). Человек закрыл вкладку — строка
 * осталась навсегда: в таблице копятся заказы, неотличимые с виду от
 * «оплата зависла», и вместе с ними e-mail людей, которые ничего не купили.
 *
 * Чистим в два шага, и они намеренно разные по необратимости:
 *
 *   1) `pending` → `failed` через ABANDON_HOURS (сутки). Строка остаётся.
 *      Это НЕ потеря: `failed` входит в CONFIRMABLE_STATUSES (lib/ticket-status),
 *      поэтому запоздалая оплата по той же ссылке всё равно выдаст билет.
 *   2) удаление через PURGE_DAYS (30 дней) — и только тех строк, по которым
 *      Payrexx не сказал ни слова (`payrexx_tx_id is null`, `paid_at is null`).
 *
 * Почему не удалять сразу на первом шаге: вебхук ищет билет по `reference_id`
 * и, не найдя строки, пишет warn и отвечает 200 (app/api/payrexx/webhook).
 * Удалённая корзина + поздний `confirmed` = деньги взяты, билета нет, следа нет.
 * Поэтому запись живёт заведомо дольше любой платёжной ссылки.
 */

/** Сутки — столько ждём оплату, прежде чем считать корзину брошенной. */
export const DEFAULT_ABANDON_HOURS = 24;

/** 30 дней — столько храним брошенную корзину, прежде чем удалить. */
export const DEFAULT_PURGE_DAYS = 30;

/**
 * Нижние границы. Опечатка в env не должна сносить свежие заказы: у пометки
 * граница мягкая (час), у удаления жёсткая (неделя) — удаление необратимо.
 */
export const MIN_ABANDON_HOURS = 1;
export const MIN_PURGE_DAYS = 7;

/**
 * Какие статусы имеет право трогать чистка. Денежных (`paid`, `checked_in`,
 * `refunded`) здесь нет и быть не может — инвариант закреплён тестом.
 */
export const ABANDONABLE_STATUSES = ['pending'];
export const PURGEABLE_STATUSES = ['pending', 'failed'];

/**
 * Целое положительное из env, иначе дефолт; ниже минимума — поднимаем до
 * минимума (а не «делаем как просили»): 0 в переменной означает опечатку,
 * а не «чистить всё немедленно».
 */
function positiveInt(raw, fallback, min) {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(n, min);
}

/** Через сколько часов `pending` считается брошенным (env PENDING_ABANDON_HOURS). */
export function abandonHours(raw) {
  return positiveInt(raw, DEFAULT_ABANDON_HOURS, MIN_ABANDON_HOURS);
}

/** Через сколько дней брошенная корзина удаляется (env PENDING_PURGE_DAYS). */
export function purgeDays(raw) {
  return positiveInt(raw, DEFAULT_PURGE_DAYS, MIN_PURGE_DAYS);
}

/** Момент отсечки: всё, что создано РАНЬШЕ, попадает под шаг. */
export function cutoffIso(now, { hours = 0, days = 0 } = {}) {
  const ms = hours * 3600 * 1000 + days * 24 * 3600 * 1000;
  return new Date(now.getTime() - ms).toISOString();
}
