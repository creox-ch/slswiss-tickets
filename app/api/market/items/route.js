import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { sessionEmailFromRequest } from '../../../../lib/market-auth';
import { validateItem, canTransition } from '../../../../lib/market-items';
import { sendMarketQueueEmail } from '../../../../lib/ticket';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Вещи продавца: список и создание.
 *
 * GET  /api/market/items          — свои вещи (чужие не отдаём никогда)
 * POST /api/market/items          — создать; {action:'submit'} сразу отправляет
 *                                    на модерацию, иначе остаётся черновиком
 *
 * Продавца определяем по подписанной cookie, а не по параметру запроса: иначе
 * достаточно было бы подставить чужой seller_id.
 */

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Нужно войти в кабинет.' }, { status: 401 });
}

function notConfigured() {
  return NextResponse.json(
    { ok: false, error: 'Кабинет пока недоступен — база не подключена.' },
    { status: 503 }
  );
}

/** Продавец из cookie: возвращает {id} или null. */
async function currentSeller(req) {
  const email = sessionEmailFromRequest(req, process.env.MARKET_SESSION_SECRET);
  if (!email) return null;
  const { data, error } = await supabaseAdmin
    .from('market_sellers')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();
  if (error) throw new Error(`supabase select seller: ${error.message}`);
  return data || null;
}

export async function GET(req) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return notConfigured();
    const seller = await currentSeller(req);
    if (!seller) return unauthorized();

    const { data, error } = await supabaseAdmin
      .from('market_items')
      .select(
        'id, item_no, brand, title, category, condition, size, price_rappen, status, photos, moderation_note, created_at'
      )
      .eq('seller_id', seller.id)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`supabase select items: ${error.message}`);

    return NextResponse.json({ ok: true, items: data || [] });
  } catch (e) {
    console.error('[market/items GET] error', e);
    return NextResponse.json({ ok: false, error: 'Не получилось загрузить вещи.' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return notConfigured();
    const seller = await currentSeller(req);
    if (!seller) return unauthorized();

    const body = await req.json().catch(() => ({}));
    const submit = body.action === 'submit';

    // Строгая проверка — только при отправке на модерацию: черновик человек
    // сохраняет посреди заполнения, и терять его из-за пустого поля обидно.
    const check = validateItem(body, { forPublication: submit });
    if (!check.ok) {
      return NextResponse.json({ ok: false, errors: check.errors }, { status: 400 });
    }

    const status = submit ? 'pending' : 'draft';
    // Санити-чек: путь из черновика в модерацию описан в lib/market-items,
    // и создание не должно уметь обойти таблицу переходов.
    if (submit && !canTransition('draft', 'pending')) {
      return NextResponse.json({ ok: false, error: 'Нельзя отправить на модерацию.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('market_items')
      .insert({ ...check.value, seller_id: seller.id, status })
      .select('id, item_no, status')
      .maybeSingle();
    if (error) throw new Error(`supabase insert item: ${error.message}`);

    // Вещь можно создать сразу отправленной — тогда очередь узнаёт о ней здесь,
    // а не в PATCH. Ошибку письма глотаем: вещь уже сохранена, и терять её
    // из-за недоступного Resend неправильно.
    if (data && data.status === 'pending') {
      try {
        await sendMarketQueueEmail({
          itemNo: data.item_no,
          brand: check.value.brand,
          title: check.value.title,
          sellerEmail: seller.email,
          reason: 'new',
        });
      } catch (mailErr) {
        console.error('[market/items POST] queue email failed', mailErr);
      }
    }

    return NextResponse.json({ ok: true, item: data });
  } catch (e) {
    console.error('[market/items POST] error', e);
    return NextResponse.json({ ok: false, error: 'Не получилось сохранить вещь.' }, { status: 500 });
  }
}
