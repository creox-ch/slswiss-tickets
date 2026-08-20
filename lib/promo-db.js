/**
 * Промокод из базы: поиск, счёт использований, готовое решение для роута.
 *
 * Отдельно от lib/promo.js: там чистые правила, здесь — единственное место,
 * которое ходит в БД. Оба роута покупки и роут проверки кода зовут одну и ту же
 * функцию, чтобы витрина и оплата не могли разойтись в ответе.
 */

import { supabaseAdmin } from './supabase';
import { normalizeCode, checkPromo, applyPromo, promoPayload, describePromo } from './promo';

/** Статусы, в которых заказ считается состоявшимся — только они жгут лимит. */
const USED_STATUSES = ['paid', 'checked_in'];

/**
 * Сколько раз кодом уже ОПЛАТИЛИ.
 *
 * Считаем по заказам, а не счётчиком в promo_codes: pending-строка от брошенной
 * корзины лимит жечь не должна (тот же принцип, что у Early Bird в
 * app/api/market/create). Порог мягкий: при одновременных оплатах код может
 * уйти чуть большему числу людей, чем max_uses, — это не вредно.
 */
async function countUses(code) {
  const { count, error } = await supabaseAdmin
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('payload->promo->>code', code)
    .in('status', USED_STATUSES);
  if (error) throw new Error(`supabase count promo uses: ${error.message}`);
  return count || 0;
}

/**
 * Разобрать введённый код для конкретной покупки.
 *
 * scope — 'forum' | 'market'; base — цена в рапенах ДО скидки (уже с Early Bird).
 *
 * Возвращает:
 *   { applied: false }                       — код не вводили
 *   { applied: false, error, message }       — код есть, но не подошёл
 *   { applied: true, row, result, payload, description, total }
 *
 * Роут решает сам, отказывать ли покупке: на витрине (промо-чек) отказ — это
 * подсказка, при оплате — причина не создавать gateway со скидкой.
 */
export async function resolvePromo(input, { scope, base, now = Date.now() } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) return { applied: false };

  const code = normalizeCode(raw);
  if (!code) {
    return { applied: false, error: 'unknown', message: 'Такого кода нет — проверь написание.' };
  }

  const { data: row, error } = await supabaseAdmin
    .from('promo_codes')
    .select('id, code, scope, kind, value, max_uses, starts_at, expires_at, active')
    .eq('code', code)
    .maybeSingle();
  // Сбой базы не превращаем в «кода нет»: иначе на любой аварии все коды разом
  // перестают работать без единого следа. Пусть роут отвечает 500.
  if (error) throw new Error(`supabase select promo: ${error.message}`);

  const uses = row ? await countUses(code) : 0;
  const verdict = checkPromo(row, { scope, uses, now });
  if (!verdict.ok) return { applied: false, error: verdict.reason, message: verdict.message };

  const result = applyPromo(base, row);
  if (!result.discount) {
    // Скидка съелась минимальным платежом — обещать её на витрине нечестно.
    return { applied: false, error: 'no_discount', message: 'Этот код здесь ничего не меняет.' };
  }

  return {
    applied: true,
    row,
    result,
    total: result.total,
    payload: promoPayload(row, result),
    description: describePromo(row),
  };
}
