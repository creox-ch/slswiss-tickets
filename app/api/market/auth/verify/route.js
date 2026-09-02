import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { MARKET_EVENT_SLUG, bestPackage } from '../../../../../lib/market-packages';
import {
  SESSION_COOKIE,
  hashToken,
  signSession,
  sessionCookieOptions,
} from '../../../../../lib/market-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/market/auth/verify?token=… — переход по ссылке из письма.
 *
 * Проверяем токен, гасим его, ставим подписанную cookie и уводим в кабинет.
 * Это обычная навигация браузера из почты, а не fetch — поэтому редирект,
 * а не JSON, и CORS не нужен.
 *
 * Токен гасим ДО выдачи сессии и условием `used_at is null` в самом update:
 * два одновременных перехода (превью ссылки в почтовике + живой клик) иначе
 * оба сочли бы себя первыми.
 */
export async function GET(req) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const base = process.env.PUBLIC_BASE_URL || url.origin;
  const secret = process.env.MARKET_SESSION_SECRET;

  const fail = (reason) => NextResponse.redirect(`${base}/market?login=${reason}`, 302);

  if (!token) return fail('invalid');
  if (!secret || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail('unavailable');
  }

  try {
    const { data: row, error: selErr } = await supabaseAdmin
      .from('market_auth_tokens')
      .select('id, email, expires_at, used_at')
      .eq('token_hash', hashToken(token))
      .maybeSingle();
    if (selErr) throw new Error(`supabase select token: ${selErr.message}`);

    if (!row) return fail('invalid');
    if (row.used_at) return fail('used');
    if (new Date(row.expires_at).getTime() <= Date.now()) return fail('expired');

    // Захват токена: .select() вернёт строку только победителю гонки.
    const { data: claimed, error: updErr } = await supabaseAdmin
      .from('market_auth_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('used_at', null)
      .select('id');
    if (updErr) throw new Error(`supabase claim token: ${updErr.message}`);
    if (!claimed || claimed.length === 0) return fail('used');

    await ensureSeller(row.email);

    const res = NextResponse.redirect(`${base}/market`, 302);
    res.cookies.set(
      SESSION_COOKIE,
      signSession(row.email, secret),
      sessionCookieOptions({ secure: base.startsWith('https://') })
    );
    return res;
  } catch (e) {
    console.error('[market/auth/verify] error', e);
    return fail('error');
  }
}

/**
 * Продавец заводится при первом входе, а не при оплате: до входа он нам нужен
 * только как строка в tickets. Пакет и имя подтягиваем из оплаты — так карточка
 * сразу знает, что человек купил. Модератор без оплаты тоже получает строку:
 * ему она пустая, но она делает сессию единообразной.
 */
async function ensureSeller(email) {
  const { data: existing, error: selErr } = await supabaseAdmin
    .from('market_sellers')
    .select('id, package')
    .eq('email', email)
    .maybeSingle();
  if (selErr) throw new Error(`supabase select seller: ${selErr.message}`);

  const now = new Date().toISOString();
  if (existing) {
    // Пакет догоняет оплату. Раньше существующей строке обновлялся только вход:
    // продавец, купивший «Онлайн» и позже доплативший за «Маркет», навсегда
    // оставался в кабинете с «Онлайн» — то есть не видел того, за что заплатил.
    // Берём старший из двух, а не последний по времени: покупка младшего пакета
    // поверх старшего ничего не должна отнимать.
    const patch = { last_login_at: now };
    const paidPackage = await latestPaidPackage(email);
    const best = bestPackage(existing.package, paidPackage);
    if (best && best !== existing.package) patch.package = best;

    await supabaseAdmin.from('market_sellers').update(patch).eq('id', existing.id);
    return existing.id;
  }

  const { data: paid, error: paidErr } = await supabaseAdmin
    .from('tickets')
    .select('reference_id, buyer_name, payload')
    .eq('event_slug', MARKET_EVENT_SLUG)
    .eq('buyer_email', email)
    .in('status', ['paid', 'checked_in'])
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paidErr) throw new Error(`supabase select ticket: ${paidErr.message}`);

  const payload = paid && paid.payload ? paid.payload : {};
  const { data: created, error: insErr } = await supabaseAdmin
    .from('market_sellers')
    .insert({
      email,
      name: paid ? paid.buyer_name : null,
      phone: payload.phone || null,
      ticket_reference: paid ? paid.reference_id : null,
      package: payload.package || null,
      last_login_at: now,
    })
    .select('id')
    .maybeSingle();
  // Гонка двух переходов подряд: строка уже есть — это не ошибка входа.
  if (insErr && !String(insErr.message).includes('duplicate')) {
    throw new Error(`supabase insert seller: ${insErr.message}`);
  }
  return created ? created.id : null;
}

/**
 * Старший из оплаченных пакетов этого адреса.
 *
 * Смотрим все оплаты, а не последнюю: человек мог доплатить за старший пакет,
 * а потом купить младший (так вышло на тестовой покупке 20.08) — и «последняя»
 * оплата отняла бы у него то, за что он заплатил раньше.
 */
async function latestPaidPackage(email) {
  const { data, error } = await supabaseAdmin
    .from('tickets')
    .select('payload')
    .eq('event_slug', MARKET_EVENT_SLUG)
    .eq('buyer_email', email)
    .in('status', ['paid', 'checked_in']);
  if (error) throw new Error(`supabase select tickets: ${error.message}`);

  let best = null;
  for (const row of data || []) {
    const pkg = row && row.payload ? row.payload.package : null;
    best = bestPackage(best, pkg);
  }
  return best;
}
