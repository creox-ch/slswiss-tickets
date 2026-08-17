import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { allowedOrigins as resolveOrigins } from '../../../../lib/forms';
import { CATALOG_STATUSES, toPublicItem, sortForCatalog } from '../../../../lib/market-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Публичный каталог бренд-маркета.
 *
 * GET /api/market/catalog?lang=ru — одобренные вещи для витрины на frankenplatz.ch
 *
 * Отдельный роут, а не PostgREST с anon-ключом: RLS закрыта наглухо (см.
 * supabase-market-cabinet.sql), и наружу должны уехать только одобренные вещи и
 * только разрешённые поля. Проекция — в lib/market-catalog.js.
 *
 * Данные публичные: витрину читает статика frankenplatz.ch из браузера.
 * Поэтому, в отличие от /api/forms, чужой origin здесь НЕ отвергаем — 403 на
 * GET без побочных эффектов ломал бы curl, мониторинг и предпросмотры, ничего
 * не защищая. Origin решает только одно: ставить ли ACAO, то есть пустит ли
 * браузер ответ в чужой скрипт.
 */

/** Сколько вещей отдаём за раз. Каталог рассчитан на сотни, не на тысячи. */
const MAX_ITEMS = 500;

/** Языки каталога: пакет обещает три (de/en появятся на шаге 7). */
const LOCALES = ['ru', 'de', 'en'];

function allowedList() {
  return resolveOrigins(process.env.FORMS_ALLOWED_ORIGINS);
}

/**
 * CORS-заголовки. `Vary: Origin` обязателен: ответ кэшируется на CDN, и без
 * него один origin получил бы ACAO, выписанный другому.
 */
function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowedList().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export async function OPTIONS(req) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function GET(req) {
  const cors = corsHeaders(req.headers.get('origin'));
  const json = (body, status = 200, extra = {}) =>
    NextResponse.json(body, { status, headers: { ...cors, ...extra } });

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ ok: false, error: 'Каталог временно недоступен.' }, 503);
    }

    const params = new URL(req.url).searchParams;
    const langParam = String(params.get('lang') || 'ru').toLowerCase();
    const locale = LOCALES.includes(langParam) ? langParam : 'ru';

    const { data: rows, error: itemsErr } = await supabaseAdmin
      .from('market_items')
      .select(
        'item_no, brand, title, category, sex, size, material, color, condition, ' +
          'price_rappen, original_price_rappen, has_docs, ' +
          'description_ru, description_de, description_en, photos, status, priority, created_at, seller_id'
      )
      .in('status', CATALOG_STATUSES)
      .limit(MAX_ITEMS);
    if (itemsErr) throw new Error(`supabase select catalog: ${itemsErr.message}`);

    // Имена продавцов — одним запросом. Берём только name: остальное в market_sellers
    // публичным не является, и выбирать его незачем даже на сервере.
    const ids = [...new Set((rows || []).map((r) => r.seller_id).filter(Boolean))];
    let sellers = {};
    if (ids.length) {
      const { data: sellerRows, error: sellersErr } = await supabaseAdmin
        .from('market_sellers')
        .select('id, name')
        .in('id', ids);
      if (sellersErr) throw new Error(`supabase select sellers: ${sellersErr.message}`);
      sellers = Object.fromEntries((sellerRows || []).map((s) => [s.id, s]));
    }

    const items = sortForCatalog(rows || [])
      .map((r) =>
        toPublicItem(r, {
          seller: sellers[r.seller_id] || null,
          supabaseUrl: process.env.SUPABASE_URL,
          locale,
        })
      )
      .filter(Boolean);

    return json(
      { ok: true, items, count: items.length, locale },
      200,
      // Минута кэша: каталог меняется редко, а «продано» не должно висеть
      // часами. stale-while-revalidate прячет поход в базу от посетителя.
      { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }
    );
  } catch (e) {
    console.error('[market/catalog GET] error', e);
    return json({ ok: false, error: 'Не получилось загрузить каталог.' }, 500);
  }
}
