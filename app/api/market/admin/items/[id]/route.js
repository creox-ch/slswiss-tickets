import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { sessionEmailFromRequest, isAdminEmail } from '../../../../../../lib/market-auth';
import { validateModeration, canModerate, resolveModeration } from '../../../../../../lib/market-moderation';
import { sendMarketDecisionEmail } from '../../../../../../lib/ticket';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Решение модератора по конкретной вещи.
 *
 * PATCH /api/market/admin/items/:id
 *   {action:'approve_online'|'approve_market'|'reject'|'price', note?, recommendedPrice?}
 *
 * Продавцу уходит письмо: решение по его вещи он должен узнать сам, а не
 * обнаружить, зайдя в кабинет через неделю.
 */
export async function PATCH(req, { params }) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, error: 'База не подключена.' }, { status: 503 });
    }

    const email = sessionEmailFromRequest(req, process.env.MARKET_SESSION_SECRET);
    if (!email) return NextResponse.json({ ok: false, error: 'Нужно войти.' }, { status: 401 });
    if (!isAdminEmail(email, process.env.MARKET_ADMIN_EMAILS)) {
      return NextResponse.json({ ok: false, error: 'Не найдено.' }, { status: 404 });
    }

    const { id } = await params;
    const { data: item, error: itemErr } = await supabaseAdmin
      .from('market_items')
      .select('id, status, brand, title, photos, description_ru, price_rappen, seller_id, item_no')
      .eq('id', id)
      .maybeSingle();
    if (itemErr) throw new Error(`supabase select item: ${itemErr.message}`);
    if (!item) return NextResponse.json({ ok: false, error: 'Вещь не найдена.' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { known, target } = resolveModeration(body.action);
    if (!known) {
      return NextResponse.json({ ok: false, error: 'Неизвестное решение.' }, { status: 400 });
    }
    if (!canModerate(item.status, target)) {
      return NextResponse.json(
        { ok: false, error: `Вещь в статусе «${item.status}» — так с ней нельзя.` },
        { status: 409 }
      );
    }

    const check = validateModeration(body, item);
    if (!check.ok) return NextResponse.json({ ok: false, errors: check.errors }, { status: 400 });

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('market_items')
      .update({ ...check.patch, updated_at: new Date().toISOString() })
      .eq('id', item.id)
      // статус мог измениться, пока модератор смотрел карточку: продавец успел
      // снять вещь с продажи. Тогда 409, а не молчаливая перезапись его решения.
      .eq('status', item.status)
      .select('id, status, recommended_price_rappen, moderation_note')
      .maybeSingle();
    if (updErr) throw new Error(`supabase update item: ${updErr.message}`);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: 'Статус вещи изменился — обнови страницу.' },
        { status: 409 }
      );
    }

    // Письмо — не критичный путь: решение уже записано, ронять ответ из-за
    // недоступной почты нельзя (как и в вебхуке оплаты).
    if (target) {
      try {
        await notifySeller(item, body.action, check.patch);
      } catch (mailErr) {
        console.error('[market/admin/items PATCH] email failed', mailErr);
      }
    }

    return NextResponse.json({ ok: true, item: updated });
  } catch (e) {
    console.error('[market/admin/items PATCH] error', e);
    return NextResponse.json({ ok: false, error: 'Не получилось применить решение.' }, { status: 500 });
  }
}

/** Письмо продавцу о решении по вещи. */
async function notifySeller(item, action, patch) {
  const { data: seller, error } = await supabaseAdmin
    .from('market_sellers')
    .select('email, name')
    .eq('id', item.seller_id)
    .maybeSingle();
  if (error) throw new Error(`supabase select seller: ${error.message}`);
  if (!seller || !seller.email) return;

  await sendMarketDecisionEmail({
    to: seller.email,
    name: seller.name,
    action,
    itemNo: item.item_no,
    brand: item.brand,
    title: item.title,
    note: patch.moderation_note || null,
    recommendedPriceRappen: patch.recommended_price_rappen || null,
  });
}
