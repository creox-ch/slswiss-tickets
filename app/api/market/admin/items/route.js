import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../../lib/supabase';
import { sessionEmailFromRequest, isAdminEmail, normalizeEmail } from '../../../../../lib/market-auth';
import { validateItem } from '../../../../../lib/market-items';
import { resolveTab } from '../../../../../lib/market-moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Модераторские списки и заведение вещей за продавца.
 *
 * GET  /api/market/admin/items?status=pending — очередь на проверку (или другой статус)
 * POST /api/market/admin/items                — завести вещь ЗА продавца
 *
 * Второе — не костыль, а условие пакета «Под ключ»: человек присылает коробку,
 * а фотографируем, описываем и выкладываем мы. Продавца находим по email; если
 * его ещё нет, заводим — так же, как при первом входе в кабинет.
 */

/** Модератор из сессии или ответ с отказом. */
async function requireModerator(req) {
  const email = sessionEmailFromRequest(req, process.env.MARKET_SESSION_SECRET);
  if (!email) {
    return { error: NextResponse.json({ ok: false, error: 'Нужно войти.' }, { status: 401 }) };
  }
  if (!isAdminEmail(email, process.env.MARKET_ADMIN_EMAILS)) {
    // 404, а не 403: посторонний не должен узнать, что такой раздел вообще есть.
    return { error: NextResponse.json({ ok: false, error: 'Не найдено.' }, { status: 404 }) };
  }
  return { email };
}

export async function GET(req) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, error: 'База не подключена.' }, { status: 503 });
    }
    const { error } = await requireModerator(req);
    if (error) return error;

    // Значение из адреса не берём как есть: `?status=draft` отдавал чужие
    // незаконченные черновики, а произвольное — роняло запрос в 500.
    const status = resolveTab(new URL(req.url).searchParams.get('status'));

    let query = supabaseAdmin
      .from('market_items')
      .select(
        'id, item_no, brand, title, category, condition, size, material, color, price_rappen, recommended_price_rappen, has_docs, description_ru, photos, status, moderation_note, created_at, seller_id'
      )
      .order('created_at', { ascending: true });

    if (status !== 'all') query = query.eq('status', status);

    const { data: items, error: itemsErr } = await query;
    if (itemsErr) throw new Error(`supabase select items: ${itemsErr.message}`);

    // Продавцов подтягиваем одним запросом: модератору важно видеть, чья вещь,
    // а join через PostgREST здесь только усложнил бы выборку.
    const ids = [...new Set((items || []).map((i) => i.seller_id).filter(Boolean))];
    let sellers = {};
    if (ids.length) {
      const { data: rows, error: sellersErr } = await supabaseAdmin
        .from('market_sellers')
        .select('id, email, name, package')
        .in('id', ids);
      if (sellersErr) throw new Error(`supabase select sellers: ${sellersErr.message}`);
      sellers = Object.fromEntries((rows || []).map((s) => [s.id, s]));
    }

    return NextResponse.json({
      ok: true,
      items: (items || []).map((i) => ({ ...i, seller: sellers[i.seller_id] || null })),
    });
  } catch (e) {
    console.error('[market/admin/items GET] error', e);
    return NextResponse.json({ ok: false, error: 'Не получилось загрузить.' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, error: 'База не подключена.' }, { status: 503 });
    }
    const { error } = await requireModerator(req);
    if (error) return error;

    const body = await req.json().catch(() => ({}));
    const sellerEmail = normalizeEmail(body.sellerEmail);
    if (!sellerEmail || sellerEmail.indexOf('@') < 1) {
      return NextResponse.json({ ok: false, error: 'Укажи e-mail продавца.' }, { status: 400 });
    }

    const check = validateItem(body, { forPublication: false });
    if (!check.ok) return NextResponse.json({ ok: false, errors: check.errors }, { status: 400 });

    const sellerId = await findOrCreateSeller(sellerEmail, body.sellerName);

    // Приоритет в каталоге обещан пакетом «Под ключ» (249 CHF). Поле в базе было
    // с самого начала, но не проставлялось нигде — обещание висело пустым.
    const { data: seller, error: pkgErr } = await supabaseAdmin
      .from('market_sellers')
      .select('package')
      .eq('id', sellerId)
      .maybeSingle();
    if (pkgErr) throw new Error(`supabase select package: ${pkgErr.message}`);
    const priority = seller?.package === 'turnkey';

    const { data, error: insErr } = await supabaseAdmin
      .from('market_items')
      // Сразу в очередь, а не в черновики: черновик чужой вещи модератору
      // недоступен целиком, и заведённая им вещь застревала намертво —
      // отправить её на проверку мог только продавец, который по пакету
      // «Под ключ» как раз ничего не делает.
      .insert({ ...check.value, seller_id: sellerId, status: 'pending', priority })
      .select('id, item_no, status')
      .maybeSingle();
    if (insErr) throw new Error(`supabase insert item: ${insErr.message}`);

    return NextResponse.json({ ok: true, item: data, sellerId });
  } catch (e) {
    console.error('[market/admin/items POST] error', e);
    return NextResponse.json({ ok: false, error: 'Не получилось завести вещь.' }, { status: 500 });
  }
}

/** Продавец по адресу; заводим, если такого ещё нет (коробка пришла раньше входа). */
async function findOrCreateSeller(email, name) {
  const { data: existing, error: selErr } = await supabaseAdmin
    .from('market_sellers')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (selErr) throw new Error(`supabase select seller: ${selErr.message}`);
  if (existing) return existing.id;

  const { data: created, error: insErr } = await supabaseAdmin
    .from('market_sellers')
    .insert({ email, name: name ? String(name).slice(0, 200) : null })
    .select('id')
    .maybeSingle();
  if (insErr) throw new Error(`supabase insert seller: ${insErr.message}`);
  return created ? created.id : null;
}
