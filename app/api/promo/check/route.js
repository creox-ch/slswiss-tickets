import { NextResponse } from 'next/server';
import { allowedOrigins as resolveOrigins } from '../../../../lib/forms';
import { resolvePromo } from '../../../../lib/promo-db';
import { priceOrder, isValidSelection, isProvisional } from '../../../../lib/forum-tickets';
import { packagePriceRappen, isValidPackage } from '../../../../lib/market-packages';
import { marketEarlyBirdActive } from '../../../../lib/market-early-bird';

export const runtime = 'nodejs';

/**
 * POST /api/promo/check — «сколько будет со скидкой», до перехода к оплате.
 *
 * Нужен, чтобы человек видел итог ДО того, как его перекинет в Payrexx: иначе
 * единственный способ узнать, работает ли код, — начать оплату. Считает ту же
 * цену теми же функциями, что и роуты покупки, и зовёт тот же resolvePromo:
 * витрина и касса не должны расходиться в ответе.
 *
 * Ничего не создаёт и не записывает — только считает.
 *
 * body: { promo, scope:'forum'|'market', ...выбор }
 *   forum:  { product, category, lunch? }
 *   market: { package }
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

/** Early Bird билетов форума — тот же флаг, что в /api/forum/create. */
function forumEarlyBirdActive() {
  return (process.env.FORUM_EARLY_BIRD || '1') !== '0';
}

export async function POST(req) {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);
  const json = (data, status = 200) => NextResponse.json(data, { status, headers: cors });

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ ok: false, error: 'Проверка кодов пока недоступна.' }, 503);
    }
    if (!origin || !allowedOrigins().includes(origin)) {
      return json({ ok: false, error: 'forbidden origin' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const scope = String(body.scope || '').trim();

    let base = null;
    if (scope === 'forum') {
      const product = String(body.product || '').trim();
      const category = String(body.category || '').trim();
      const lunch = body.lunch === true || body.lunch === 'true';
      if (!isValidSelection(product, category) || isProvisional(product, category)) {
        return json({ ok: false, error: 'Сначала выбери билет.' }, 400);
      }
      base = priceOrder({ product, category, lunch, earlyBird: forumEarlyBirdActive() }).total;
    } else if (scope === 'market') {
      const pkg = String(body.package || '').trim();
      if (!isValidPackage(pkg)) {
        return json({ ok: false, error: 'Сначала выбери пакет.' }, 400);
      }
      base = packagePriceRappen(pkg, await marketEarlyBirdActive(pkg));
    } else {
      return json({ ok: false, error: 'Неизвестная покупка.' }, 400);
    }

    const promo = await resolvePromo(body.promo, { scope, base });
    if (!promo.applied) {
      // Код не подошёл — это нормальный ответ витрине, а не ошибка запроса:
      // поле остаётся заполненным, человек читает причину и правит.
      return json({
        ok: true,
        applied: false,
        base,
        total: base,
        message: promo.message || 'Введи промокод.',
        reason: promo.error || null,
      });
    }

    return json({
      ok: true,
      applied: true,
      base,
      discount: promo.payload.discount_rappen,
      total: promo.total,
      code: promo.payload.code,
      description: promo.description,
    });
  } catch (e) {
    console.error('[promo/check] error', e);
    return json({ ok: false, error: 'Не получилось проверить код.' }, 500);
  }
}
