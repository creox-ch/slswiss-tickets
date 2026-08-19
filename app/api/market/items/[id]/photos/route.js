import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '../../../../../../lib/supabase';
import { sessionEmailFromRequest, isAdminEmail } from '../../../../../../lib/market-auth';
import {
  PHOTO_BUCKET,
  checkPhoto,
  canAddPhoto,
  photoPath,
  belongsToItem,
  sniffImageMime,
} from '../../../../../../lib/market-photos';
import { MAX_PHOTOS, MIN_PHOTOS, sellerEditRule } from '../../../../../../lib/market-items';

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

/**
 * Вещь, с фото которой этому человеку можно работать, — или ответ с ошибкой.
 *
 * Обычно это своя вещь. Но по пакету «Под ключ» коробку разбирает организатор,
 * и фотографии грузит он же: продавец по условиям пакета не делает ничего.
 * Поэтому модератор работает с фото любой вещи — правила по статусу
 * (проданное и забронированное не трогаем) остаются общими для обоих.
 */
async function ownedItem(req, id) {
  const email = sessionEmailFromRequest(req, process.env.MARKET_SESSION_SECRET);
  if (!email) return { error: unauthorized() };

  const { data: item, error: itemErr } = await supabaseAdmin
    .from('market_items')
    .select('id, seller_id, photos, status')
    .eq('id', id)
    .maybeSingle();
  if (itemErr) throw new Error(`supabase select item: ${itemErr.message}`);

  const notFound = {
    error: NextResponse.json({ ok: false, error: 'Вещь не найдена.' }, { status: 404 }),
  };
  if (!item) return notFound;

  if (isAdminEmail(email, process.env.MARKET_ADMIN_EMAILS)) return { item, moderator: true };

  const { data: seller, error: sellerErr } = await supabaseAdmin
    .from('market_sellers')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (sellerErr) throw new Error(`supabase select seller: ${sellerErr.message}`);
  if (!seller) return { error: unauthorized() };

  // Чужая вещь и несуществующая отвечают одинаково: по разнице ответов можно
  // было бы перебором узнать, что у соседа в каталоге.
  if (item.seller_id !== seller.id) return notFound;
  return { item, moderator: false };
}

export async function POST(req, { params }) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, error: 'Кабинет пока недоступен.' }, { status: 503 });
    }
    const { id } = await params;
    const { item, error } = await ownedItem(req, id);
    if (error) return error;

    // У забронированной и проданной вещи фото трогать нельзя: покупатель уже
    // видел именно эту карточку.
    const rule = sellerEditRule(item.status);
    if (!rule.allowed) {
      return NextResponse.json({ ok: false, error: rule.reason }, { status: 409 });
    }

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

    const bytes = Buffer.from(await file.arrayBuffer());

    // Заявленному типу не верим: он приходит из формы. Смотрим первые байты —
    // так PDF или что угодно ещё не ляжет в каталог под видом фотографии.
    const realMime = sniffImageMime(bytes);
    if (!realMime || realMime !== file.type) {
      return NextResponse.json(
        { ok: false, error: 'Это не похоже на фото. Нужен JPG, PNG или WebP.' },
        { status: 400 }
      );
    }

    const path = photoPath(item.id, realMime, crypto.randomBytes(12).toString('hex'));
    if (!path) return NextResponse.json({ ok: false, error: 'Не тот формат.' }, { status: 400 });
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

    const rule = sellerEditRule(item.status);
    if (!rule.allowed) {
      return NextResponse.json({ ok: false, error: rule.reason }, { status: 409 });
    }

    const photos = Array.isArray(item.photos) ? item.photos : [];
    const next = photos.filter((p) => p !== path);

    // У опубликованной вещи последнюю фотографию не отдаём: карточка в каталоге
    // осталась бы с подписью «фото готовится» — витрина деградирует молча,
    // и заметит это только покупатель.
    if (rule.backToPending && next.length < MIN_PHOTOS) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Это единственное фото вещи, которая стоит в каталоге. Сначала загрузи другое — карточка без фото никому не покажется.',
        },
        { status: 409 }
      );
    }

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
