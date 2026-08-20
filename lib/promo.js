/**
 * Промокоды: нормализация, проверка и расчёт скидки.
 *
 * Почему свои коды, а не купоны Payrexx: цену считает только сервер, но вебхук
 * знает лишь ту сумму, которую мы сами записали в заказ. Скидка, выданная на
 * стороне Payrexx, прошла бы мимо нас — в базе осталась бы полная цена, а денег
 * пришло бы меньше, и учёт разъехался бы молча. Поэтому скидка применяется ДО
 * создания gateway: в Payrexx уходит уже итоговая сумма, и она же лежит в заказе.
 *
 * Чистый модуль: ни сети, ни env, ни БД. Строку кода достаёт вызывающий роут,
 * решение принимает эта логика — так её можно проверить тестами целиком.
 */

/** Минимальный платёж: gateway на 0 создать нельзя, да и банк такое не любит. */
export const MIN_CHARGE_RAPPEN = 100; // 1 CHF

/** На что действует код. 'all' — и билеты форума, и пакеты маркета. */
export const PROMO_SCOPES = ['forum', 'market', 'all'];

/** Тип скидки: процент от цены или фиксированная сумма в рапенах. */
export const PROMO_KINDS = ['percent', 'amount'];

/**
 * Нормализация введённого кода: регистр не важен, пробелы по краям тоже.
 * Разрешены латиница, цифры и дефис — код диктуют голосом и печатают руками,
 * и кириллическая «С» в латинском коде превращается в загадку поддержки.
 */
export function normalizeCode(input) {
  const raw = String(input ?? '')
    .trim()
    .toUpperCase();
  if (!raw) return '';
  if (raw.length > 32) return '';
  return /^[A-Z0-9-]+$/.test(raw) ? raw : '';
}

/** Человеку — понятная причина отказа. Промокод не секрет: молчать незачем. */
const REASONS = {
  unknown: 'Такого кода нет — проверь написание.',
  inactive: 'Этот код больше не действует.',
  not_started: 'Этот код ещё не начал действовать.',
  expired: 'Срок действия кода истёк.',
  used_up: 'Этот код уже разобрали.',
  wrong_scope: 'Этот код действует на другую покупку.',
};

function toTime(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Годится ли код для этой покупки.
 *
 * row — строка promo_codes (или null, если такого кода нет).
 * scope — 'forum' | 'market': что покупают прямо сейчас.
 * uses — сколько раз кодом уже ОПЛАТИЛИ (считает роут по таблице tickets, как
 *        Early Bird: pending-строки лимит не жгут, брошенная корзина никого не
 *        лишает скидки).
 */
export function checkPromo(row, { scope, uses = 0, now = Date.now() } = {}) {
  if (!row) return { ok: false, reason: 'unknown', message: REASONS.unknown };
  if (row.active === false) return { ok: false, reason: 'inactive', message: REASONS.inactive };

  if (row.scope && row.scope !== 'all' && row.scope !== scope) {
    return { ok: false, reason: 'wrong_scope', message: REASONS.wrong_scope };
  }

  const startsAt = toTime(row.starts_at);
  if (startsAt && now < startsAt) {
    return { ok: false, reason: 'not_started', message: REASONS.not_started };
  }

  const expiresAt = toTime(row.expires_at);
  if (expiresAt && now >= expiresAt) {
    return { ok: false, reason: 'expired', message: REASONS.expired };
  }

  const maxUses = Number(row.max_uses);
  if (Number.isFinite(maxUses) && maxUses > 0 && uses >= maxUses) {
    return { ok: false, reason: 'used_up', message: REASONS.used_up };
  }

  return { ok: true };
}

/**
 * Скидка в рапенах и итоговая сумма.
 *
 * Скидка считается от той цены, которая получилась после всех наших правил —
 * то есть поверх Early Bird. Оба числа сохраняются в заказе, чтобы потом было
 * видно, из чего сложилась сумма.
 *
 * Итог не опускается ниже MIN_CHARGE_RAPPEN: код на 100% или фикс больше цены
 * не делает платёж бесплатным (gateway на 0 не создать), а срезается до минимума
 * — и `capped` говорит, что так и было.
 */
export function applyPromo(baseRappen, row) {
  const base = Math.max(0, Math.round(Number(baseRappen) || 0));
  if (!row) return { base, discount: 0, total: base, capped: false };

  const value = Math.max(0, Math.round(Number(row.value) || 0));
  let discount =
    row.kind === 'percent' ? Math.round((base * Math.min(value, 100)) / 100) : Math.min(value, base);

  const maxDiscount = Math.max(0, base - MIN_CHARGE_RAPPEN);
  const capped = discount > maxDiscount;
  if (capped) discount = maxDiscount;

  return { base, discount, total: base - discount, capped };
}

/** Как скидка выглядит в описании заказа и в письме: «PROMO −20%» / «PROMO −30 CHF». */
export function describePromo(row) {
  if (!row) return '';
  const code = normalizeCode(row.code) || String(row.code || '');
  if (row.kind === 'percent') return `${code} −${Math.round(Number(row.value) || 0)}%`;
  const chf = (Math.round(Number(row.value) || 0) / 100).toFixed(2).replace(/\.00$/, '');
  return `${code} −${chf} CHF`;
}

/**
 * Что кладём в payload заказа. Отдельная функция, чтобы форма записи была одна
 * на оба роута: по этим полям потом сверяют выручку и считают, сколько раз
 * кодом реально заплатили.
 */
export function promoPayload(row, applied) {
  if (!row || !applied || !applied.discount) return null;
  return {
    code: normalizeCode(row.code) || String(row.code || ''),
    kind: row.kind,
    value: Math.round(Number(row.value) || 0),
    discount_rappen: applied.discount,
    base_rappen: applied.base,
    capped: applied.capped || false,
  };
}
