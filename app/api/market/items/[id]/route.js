import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { sessionEmailFromRequest } from '../../../../../lib/market-auth';
import { validateItem, canTransition, canPublish } from '../../../../../lib/market-items';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Одна вещь продавца.
 *
 * PATCH  /api/market/items/:id  — правка полей и/или смена статуса
 *        {action:'submit'}   черновик → на модерацию
 *        {action:'withdraw'} снять с продажи
 *        {action:'draft'}    вернуть в черновики (после отказа)
 * DELETE /api/market/items/:id  — удалить черновик
 *
 * Каждая операция проверяет, что вещь принадлежит текущему продавцу: id вещи
 * угадать несложно, и без этой проверки можно было бы править чужие карточки.
 */

const ACTION_TARGET = { submit: 'pending', withdraw: 'withdrawn', draft: 'draft' };

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Нужно войти в кабинет.' }, { status: 401 });
}

async function ownedItem(req, id) {
  const email = sessionEmailFromRequest(req, process.env.MARKET_SESSION_SECRET);
  if (!email) return { error: unauthorized() };

  const { data: seller, error: sellerErr } = await supabaseAdmin
    .from('market_sellers')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (sellerErr) throw new Error(`supabase select seller: ${sellerErr.message}`);
  if (!seller) return { error: unauthorized() };

  const { data: item, error: itemErr } = await supabaseAdmin
    .from('market_items')
    // photos и остальные поля нужны для проверки готовности к публикации:
    // фото приходят не с формой, а из своего роута — см. canPublish.
    .select('id, status, seller_id, photos, brand, title, description_ru, price_rappen')
    .eq('id', id)
    .maybeSingle();
  if (itemErr) throw new Error(`supabase select item: ${itemErr.message}`);

  // Чужая вещь и несуществующая вещь отвечают одинаково: по разнице ответов
  // можно было бы перебором узнать, что у соседа в каталоге.
  if (!item || item.seller_id !== seller.id) {
    return { error: NextResponse.json({ ok: false, error: 'Вещь не найдена.' }, { status: 404 }) };
  }
  return { item };
}

export async function PATCH(req, { params }) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, error: 'Кабинет пока недоступен.' }, { status: 503 });
    }
    const { id } = await params;
    const { item, error } = await ownedItem(req, id);
    if (error) return error;

    const body = await req.json().catch(() => ({}));
    const action = body.action ? String(body.action) : null;
    const target = action ? ACTION_TARGET[action] : null;
    if (action && !target) {
      return NextResponse.json({ ok: false, error: 'Неизвестное действие.' }, { status: 400 });
    }
    if (target && !canTransition(item.status, target)) {
      return NextResponse.json(
        { ok: false, error: `Из статуса «${item.status}» так нельзя.` },
        { status: 409 }
      );
    }

    const patch = {};
    // Поля правим, только если их прислали: PATCH без полей — это чистая
    // смена статуса, и затирать описание пустотой в этом случае нельзя.
    // Проверяем НЕ строго: строгую проверку делает canPublish ниже, по тому,
    // что реально лежит в базе, — фото форма не присылает.
    if (body.brand !== undefined || body.title !== undefined || body.price !== undefined) {
      const check = validateItem(body, { forPublication: false });
      if (!check.ok) return NextResponse.json({ ok: false, errors: check.errors }, { status: 400 });
      Object.assign(patch, check.value);
    }

    // Готовность к публикации считаем по сохранённой вещи с уже наложенной
    // правкой: человек в одном действии и поля дописал, и отправил.
    if (target === 'pending') {
      const ready = canPublish({ ...item, ...patch });
      if (!ready.ok) return NextResponse.json({ ok: false, errors: ready.errors }, { status: 400 });
    }

    if (target) patch.status = target;
    patch.updated_at = new Date().toISOString();

    const { data, error: updErr } = await supabaseAdmin
      .from('market_items')
      .update(patch)
      .eq('id', item.id)
      // статус мог измениться, пока человек заполнял форму (например, модератор
      // уже одобрил вещь) — тогда обновление не проходит, а не затирает решение
      .eq('status', item.status)
      .select('id, status')
      .maybeSingle();
    if (updErr) throw new Error(`supabase update item: ${updErr.message}`);
    if (!data) {
      return NextResponse.json(
        { ok: false, error: 'Статус вещи изменился — обнови страницу.' },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, item: data });
  } catch (e) {
    console.error('[market/items PATCH] error', e);
    return NextResponse.json({ ok: false, error: 'Не получилось сохранить.' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, error: 'Кабинет пока недоступен.' }, { status: 503 });
    }
    const { id } = await params;
    const { item, error } = await ownedItem(req, id);
    if (error) return error;

    // Удаляем только черновики. Всё, что уже видел модератор или каталог,
    // снимается статусом: история сделок и отказов должна оставаться.
    if (item.status !== 'draft') {
      return NextResponse.json(
        { ok: false, error: 'Удалить можно только черновик. Отправленную вещь можно снять.' },
        { status: 409 }
      );
    }

    const { error: delErr } = await supabaseAdmin
      .from('market_items')
      .delete()
      .eq('id', item.id)
      .eq('status', 'draft');
    if (delErr) throw new Error(`supabase delete item: ${delErr.message}`);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[market/items DELETE] error', e);
    return NextResponse.json({ ok: false, error: 'Не получилось удалить.' }, { status: 500 });
  }
}
