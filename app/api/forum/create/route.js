import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '../../../../lib/supabase';
import { createGateway } from '../../../../lib/payrexx';
import { allowedOrigins as resolveOrigins } from '../../../../lib/forms';
import {
  priceOrder,
  describeOrder,
  isValidSelection,
  isProvisional,
  FORUM_EVENT_SLUG,
} from '../../../../lib/forum-tickets';
import { resolvePromo } from '../../../../lib/promo-db';

export const runtime = 'nodejs';

/**
 * POST /api/forum/create — покупка билета на форум Frankenplatz.
 *
 * ОТДЕЛЬНЫЙ роут от стенда SoiLüDi (/api/payrexx/create его не трогаем).
 * Живёт в той же таблице tickets (event_slug='frankenplatz-2026-10', детали
 * заказа в payload), переиспользует Payrexx-gateway, QR и вебхук.
 *
 * Цену считает ТОЛЬКО сервер по каталогу (lib/forum-tickets): клиент шлёт лишь
 * ВЫБОР. Кнопка покупки живёт на frankenplatz.ch → кросс-доменный POST (CORS +
 * жёсткий Origin-чек, тот же белый список, что у /api/forms).
 *
 * body: { product: 'day1'|'day2'|'both', category: 'vip'|'premium'|'standard',
 *         lunch?: bool, email, name?, phone? }
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

/** Early Bird включён по умолчанию; выключается FORUM_EARLY_BIRD=0 (после объявления всех спикеров). */
function earlyBirdActive() {
  return (process.env.FORUM_EARLY_BIRD || '1') !== '0';
}

export async function POST(req) {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);
  const json = (data, status = 200) => NextResponse.json(data, { status, headers: cors });

  try {
    // Payrexx не подключён? Понятное сообщение вместо крипто-ошибки.
    if (!process.env.PAYREXX_API_SECRET) {
      return json({ ok: false, error: 'Оплата пока недоступна — Payrexx не подключён.' }, 503);
    }

    // Жёсткий Origin-чек: покупку принимаем только с наших доменов.
    if (!origin || !allowedOrigins().includes(origin)) {
      return json({ ok: false, error: 'forbidden origin' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const product = String(body.product || '').trim();
    const category = String(body.category || '').trim();
    const lunch = body.lunch === true || body.lunch === 'true';
    const email = String(body.email || '').trim().toLowerCase();
    const name = body.name ? String(body.name).trim().slice(0, 200) : null;
    const phone = body.phone ? String(body.phone).trim().slice(0, 60) : null;

    // Валидация выбора и e-mail (нужен, чтобы прислать билет).
    if (!isValidSelection(product, category)) {
      return json({ ok: false, error: 'Неизвестный билет — обнови страницу и попробуй ещё раз.' }, 400);
    }
    // Провизорные цены (VIP/Premium на 2 дня) пока не в продаже.
    if (isProvisional(product, category)) {
      return json({ ok: false, error: 'Этот пакет ещё не в продаже. Скоро откроем.' }, 400);
    }
    if (!email || email.indexOf('@') < 1) {
      return json({ ok: false, error: 'Проверь e-mail — на него придёт билет.' }, 400);
    }

    // Сумму считает сервер (клиентской цене не верим).
    const earlyBird = earlyBirdActive();
    const order = priceOrder({ product, category, lunch, earlyBird });
    let description = describeOrder({ product, category, lunch, earlyBird });

    // Промокод применяем ДО создания gateway: скидка, выданная на стороне
    // Payrexx, прошла бы мимо нас — в заказе осталась бы полная цена, а денег
    // пришло бы меньше (см. lib/promo.js).
    const promo = await resolvePromo(body.promo, { scope: 'forum', base: order.total });
    if (promo.error) {
      // Человек ввёл код и ждёт скидку — молча продать по полной цене нельзя.
      return json({ ok: false, error: promo.message, promoError: promo.error }, 400);
    }
    const amount = promo.applied ? promo.total : order.total;
    if (promo.applied) description = `${description} · ${promo.description}`;

    const referenceId = `fp-${crypto.randomUUID()}`;
    const forumBase = process.env.FORUM_BASE_URL || 'https://frankenplatz.ch';

    // 1) pending-билет форума
    const { error: insErr } = await supabaseAdmin.from('tickets').insert({
      reference_id: referenceId,
      event_name: 'Frankenplatz 2026',
      event_slug: FORUM_EVENT_SLUG,
      buyer_email: email,
      buyer_name: name,
      amount, // рапены, уже с EB, ланчем и промокодом
      currency: 'CHF',
      status: 'pending',
      payload: {
        product,
        category,
        lunch,
        earlyBird,
        days: order.days,
        ticket_rappen: order.ticket,
        lunch_rappen: order.lunch,
        base_rappen: order.total,
        description,
        phone,
        ...(promo.applied ? { promo: promo.payload } : {}),
      },
    });
    if (insErr) throw new Error(`supabase insert: ${insErr.message}`);

    // 2) Payrexx gateway — возвращаемся на frankenplatz.ch
    const gateway = await createGateway({
      referenceId,
      amount,
      currency: 'CHF',
      purpose: `Frankenplatz — ${description}`,
      successUrl: `${forumBase}/tickets.html?status=paid`,
      failedUrl: `${forumBase}/tickets.html?status=failed`,
      cancelUrl: `${forumBase}/tickets.html?status=cancelled`,
    });

    return json({
      ok: true,
      referenceId,
      payUrl: gateway.link,
      amount,
      ...(promo.applied
        ? { promo: { code: promo.payload.code, discount: promo.payload.discount_rappen } }
        : {}),
    });
  } catch (e) {
    console.error('[forum/create] error', e);
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
}
