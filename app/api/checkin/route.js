import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '../../../lib/supabase';

export const runtime = 'nodejs';

/**
 * POST /api/checkin  body: { token }, заголовок X-Staff-Key (если включён ключ).
 * Сканер вызывает это. Логика:
 *  - CHECKIN_STAFF_KEY задан и не совпал → auth (иначе токен из QR может
 *    «сжечь» кто угодно, включая самого покупателя заранее)
 *  - нет билета по токену      → invalid
 *  - status=paid              → отмечаем checked_in, ok (первый вход)
 *  - status=checked_in        → already (повторный скан — показываем когда вошёл)
 *  - status=pending/failed... → not_paid
 */
export async function POST(req) {
  try {
    const staffKey = (process.env.CHECKIN_STAFF_KEY || '').trim();
    if (staffKey && !keysEqual(req.headers.get('x-staff-key'), staffKey)) {
      return NextResponse.json(
        { result: 'auth', message: 'нужен ключ сканера (поле под камерой)' },
        { status: 401 }
      );
    }

    const { token } = await req.json().catch(() => ({}));
    if (!token) return NextResponse.json({ result: 'invalid', message: 'нет токена' });

    // maybeSingle: «нет строки» — это data=null без ошибки; error — сбой БД.
    // С .single() падение Supabase выглядело бы как «билет не найден» на входе.
    const { data: t, error: selErr } = await supabaseAdmin
      .from('tickets')
      .select('id, status, buyer_name, buyer_email, event_name, checked_in_at')
      .eq('qr_token', token)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);

    if (!t) return NextResponse.json({ result: 'invalid', message: 'билет не найден' });

    if (t.status === 'checked_in') {
      return NextResponse.json({
        result: 'already',
        message: 'уже входил',
        name: t.buyer_name,
        event: t.event_name,
        checkedInAt: t.checked_in_at,
      });
    }
    if (t.status !== 'paid') {
      return NextResponse.json({ result: 'not_paid', message: `статус: ${t.status}` });
    }

    // Гонка двух сканеров: оба прочитали status=paid и оба делают update.
    // .eq('status','paid') пропустит только одного; .select() возвращает
    // затронутые строки — у проигравшего их 0, и он получает already.
    const now = new Date().toISOString();
    const { data: updated, error } = await supabaseAdmin
      .from('tickets')
      .update({ status: 'checked_in', checked_in_at: now })
      .eq('id', t.id)
      .eq('status', 'paid')
      .select('id');
    if (error) throw new Error(error.message);

    if (!updated || updated.length === 0) {
      return NextResponse.json({
        result: 'already',
        message: 'уже входил (одновременный скан)',
        name: t.buyer_name,
        event: t.event_name,
      });
    }

    return NextResponse.json({
      result: 'ok',
      message: 'добро пожаловать',
      name: t.buyer_name,
      event: t.event_name,
    });
  } catch (e) {
    console.error('[checkin] error', e);
    return NextResponse.json({ result: 'error', message: String(e.message || e) }, { status: 500 });
  }
}

/** Сравнение ключей без утечки длины/префикса по таймингу. */
function keysEqual(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
