import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { sessionEmailFromRequest } from '../../../../../../lib/market-auth';
import {
  PHOTO_BUCKET,
  checkPhoto,
  canAddPhoto,
  photoPath,
  belongsToItem,
} from '../../../../../../lib/market-photos';
import { MAX_PHOTOS } from '../../../../../../lib/market-items';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Фото вещи.
 *
 * POST   /api/market/items/:id/photos  — multipart, поле `file`
 * DELETE /api/market/items/:id/photos  — body {path}
 *
 * Файл проходит через сервер, а не грузится в Storage напрямую из браузера:
 * так проверка «эта вещь твоя, и фото у неё меньше пяти» происходит там, где
 * её нельзя обойти, и наружу не уезжает ключ с правом записи.
 */

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Нужно войти в кабинет.' }, { status: 401 });
}

/** Вещь текущего продавца или ответ с ошибкой. */
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
    .select('id, seller_id, photos, status')
    .eq('id', id)
    .maybeSingle();
  if (itemErr) throw new Error(`supabase select item: ${itemErr.message}`);
  if (!item || item.seller_id !== seller.id) {
    return { error: NextResponse.json({ ok: false, error: 'Вещь не найдена.' }, { status: 404 }) };
  }
  return { item };
}

export async function POST(req, { params }) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, error: 'Кабинет пока недоступен.' }, { status: 503 });
    }
    const { id } = await params;
    const { item, error } = await ownedItem(req, id);
    if (error) return error;

    const form = await req.formData().catch(() => null);
    const file = form ? form.get('file') : null;
    if (!file || typeof file === 'string') {
      return NextResponse.json({ ok: false, error: 'Файл не пришёл.' }, { status: 400 });
    }

    const check = checkPhoto({ type: file.type, size: file.size });
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 400 });

    const photos = Array.isArray(item.photos) ? item.photos : [];
    if (!canAddPhoto(photos)) {
      return NextResponse.json(
        { ok: false, error: `Больше ${MAX_PHOTOS} фото на вещь не нужно.` },
        { status: 409 }
      );
    }

    const path = photoPath(item.id, file.type, crypto.randomBytes(12).toString('hex'));
    if (!path) return NextResponse.json({ ok: false, error: 'Не тот формат.' }, { status: 400 });

    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await supabaseAdmin.storage
      .from(PHOTO_BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: false });
    if (upErr) throw new Error(`storage upload: ${upErr.message}`);

    // Список фото дописываем ПОСЛЕ успешной загрузки: если запись в БД не
    // пройдёт, в bucket останется осиротевший файл — это дешевле, чем ссылка
    // в карточке на файл, которого нет.
    const next = [...photos, path];
    const { error: updErr } = await supabaseAdmin
      .from('market_items')
      .update({ photos: next, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    if (updErr) throw new Error(`supabase update photos: ${updErr.message}`);

    return NextResponse.json({ ok: true, path, photos: next });
  } catch (e) {
    console.error('[market/items/photos POST] error', e);
    return NextResponse.json({ ok: false, error: 'Не получилось загрузить фото.' }, { status: 500 });
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

    const body = await req.json().catch(() => ({}));
    const path = body.path ? String(body.path) : null;
    // Путь пришёл от клиента: без этой проверки им можно было бы стереть
    // фото чужой вещи, просто подставив её папку.
    if (!path || !belongsToItem(path, item.id)) {
      return NextResponse.json({ ok: false, error: 'Это фото не от этой вещи.' }, { status: 400 });
    }

    const photos = Array.isArray(item.photos) ? item.photos : [];
    const next = photos.filter((p) => p !== path);

    const { error: delErr } = await supabaseAdmin.storage.from(PHOTO_BUCKET).remove([path]);
    if (delErr) throw new Error(`storage remove: ${delErr.message}`);

    const { error: updErr } = await supabaseAdmin
      .from('market_items')
      .update({ photos: next, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    if (updErr) throw new Error(`supabase update photos: ${updErr.message}`);

    return NextResponse.json({ ok: true, photos: next });
  } catch (e) {
    console.error('[market/items/photos DELETE] error', e);
    return NextResponse.json({ ok: false, error: 'Не получилось удалить фото.' }, { status: 500 });
  }
}
