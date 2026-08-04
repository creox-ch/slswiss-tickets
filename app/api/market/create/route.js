import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '../../../../lib/supabase';
import { createGateway } from '../../../../lib/payrexx';
import { allowedOrigins as resolveOrigins } from '../../../../lib/forms';
import {
  packagePriceRappen,
  describePackage,
  isValidPackage,
  ebLimitFor,
  MARKET_EVENT_SLUG,
} from '../../../../lib/market-packages';

export const runtime = 'nodejs';

/**
 * POST /api/market/create — покупка пакета бренд-маркета Frankenplatz (FASHION REBORN).
 *
 * Параллельно /api/forum/create (билеты), но продукт другой: участие в маркете,
 * без QR-входа. Живёт в той же таблице tickets (event_slug='frankenplatz-market-2026',
 * детали в payload), переиспользует Payrexx-gateway и вебхук (ветка по event_slug).
 *
 * Цену считает ТОЛЬКО сервер по каталогу (lib/market-packages): клиент шлёт лишь
 * ВЫБОР пакета. Кнопка живёт на frankenplatz.ch → кросс-доменный POST (CORS +
 * жёсткий Origin-чек, тот же белый список, что у /api/forms).
 *
 * Early Bird пакета «Маркет»: первым N (ebLimit) оплатившим — цена ниже. «Первые N»
 * считаем по числу уже ОПЛАЧЕННЫХ market-строк на момент оформления.
 *
 * body: { package: 'online'|'market'|'turnkey', email, name?, phone? }
 */

function allowedOrigins() {
  return resolveOrigins(process.env.FORMS_ALLOWED_ORIGINS);
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowedOrigins().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export async function OPTIONS(req) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

/**
 * Активна ли ещё Early Bird цена пакета: сколько market-строк со скидкой уже
 * оплачено < лимита. Мягкий счётчик (пороги «первых N» — маркетинговые):
 * при одновременных оформлениях EB могут получить чуть больше N, что не вредно.
 */
async function earlyBirdActive(pkg) {
  const limit = ebLimitFor(pkg);
  if (!limit) return false;
  const { count, error } = await supabaseAdmin
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('event_slug', MARKET_EVENT_SLUG)
    .eq('payload->>package', pkg)
    .eq('payload->>earlyBird', 'true')
    .in('status', ['paid', 'checked_in']);
  if (error) throw new Error(`supabase count: ${error.message}`);
  return (count || 0) < limit;
}

export async function POST(req) {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);
  const json = (data, status = 200) => NextResponse.json(data, { status, headers: cors });

  try {
    if (!process.env.PAYREXX_API_SECRET) {
      return json({ ok: false, error: 'Оплата пока недоступна — Payrexx не подключён.' }, 503);
    }

    if (!origin || !allowedOrigins().includes(origin)) {
      return json({ ok: false, error: 'forbidden origin' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const pkg = String(body.package || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const name = body.name ? String(body.name).trim().slice(0, 200) : null;
    const phone = body.phone ? String(body.phone).trim().slice(0, 60) : null;

    if (!isValidPackage(pkg)) {
      return json({ ok: false, error: 'Неизвестный пакет — обнови страницу и попробуй ещё раз.' }, 400);
    }
    if (!email || email.indexOf('@') < 1) {
      return json({ ok: false, error: 'Проверь e-mail — на него придёт подтверждение.' }, 400);
    }

    // Сумму считает сервер (клиентской цене не верим).
    const earlyBird = await earlyBirdActive(pkg);
    const amount = packagePriceRappen(pkg, earlyBird);
    const description = describePackage(pkg, earlyBird);

    const referenceId = `mk-${crypto.randomUUID()}`;
    const forumBase = process.env.FORUM_BASE_URL || 'https://frankenplatz.ch';

    // 1) pending-строка заказа маркета
    const { error: insErr } = await supabaseAdmin.from('tickets').insert({
      reference_id: referenceId,
      event_name: 'Frankenplatz Market',
      event_slug: MARKET_EVENT_SLUG,
      buyer_email: email,
      buyer_name: name,
      amount, // рапены, уже с учётом EB
      currency: 'CHF',
      status: 'pending',
      payload: { package: pkg, earlyBird, description, phone },
    });
    if (insErr) throw new Error(`supabase insert: ${insErr.message}`);

    // 2) Payrexx gateway — возвращаемся на brand-market.html
    const gateway = await createGateway({
      referenceId,
      amount,
      currency: 'CHF',
      purpose: `Frankenplatz Market — ${description}`,
      successUrl: `${forumBase}/brand-market.html?status=paid`,
      failedUrl: `${forumBase}/brand-market.html?status=failed`,
      cancelUrl: `${forumBase}/brand-market.html?status=cancelled`,
    });

    return json({ ok: true, referenceId, payUrl: gateway.link, amount });
  } catch (e) {
    console.error('[market/create] error', e);
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
}
