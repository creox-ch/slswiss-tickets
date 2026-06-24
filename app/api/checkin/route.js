import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';

export const runtime = 'nodejs';

/**
 * POST /api/checkin  body: { token }
 * Сканер вызывает это. Логика:
 *  - нет билета по токену      → invalid
 *  - status=paid              → отмечаем checked_in, ok (первый вход)
 *  - status=checked_in        → already (повторный скан — показываем когда вошёл)
 *  - status=pending/failed... → not_paid
 */
export async function POST(req) {
  try {
    const { token } = await req.json().catch(() => ({}));
    if (!token) return NextResponse.json({ result: 'invalid', message: 'нет токена' });

    const { data: t } = await supabaseAdmin
      .from('tickets')
      .select('id, status, buyer_name, buyer_email, event_name, checked_in_at')
      .eq('qr_token', token)
      .single();

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

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('tickets')
      .update({ status: 'checked_in', checked_in_at: now })
      .eq('id', t.id)
      .eq('status', 'paid'); // защита от гонки двойного скана
    if (error) throw new Error(error.message);

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
