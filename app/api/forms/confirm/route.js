import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { confirmPageHtml } from '../../../../lib/forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/forms/confirm?token=… — подтверждение подписки на рассылку (double opt-in).
 *
 * Ссылку человек получает письмом сразу после подписки в футере
 * (form_key='newsletter'). До перехода строка лежит со status='pending' и
 * одноразовым токеном в payload.confirm_token; переход переводит её в
 * 'confirmed' (только confirmed считается подписчиком — см. дневную сводку).
 *
 * Это переход из письма (обычная навигация браузера), а не cross-origin fetch,
 * поэтому CORS не нужен. Отдаём HTML-страницу (не JSON): человек видит результат.
 */
function page(html, status = 200) {
  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

/** Origin сайта-источника — чтобы кнопка «На сайт» вела на нужный домен. */
function originOf(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return undefined;
  }
}

export async function GET(req) {
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return page(confirmPageHtml('invalid'), 400);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // База не подключена — не притворяемся, что подтвердили.
    return page(confirmPageHtml('invalid'), 503);
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('submissions')
      .select('id, status, source_url, payload')
      .eq('form_key', 'newsletter')
      .eq('payload->>confirm_token', token)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`supabase select: ${error.message}`);

    if (!data) return page(confirmPageHtml('invalid'), 400);

    const site = originOf(data.source_url);

    // Повторный клик по той же ссылке — не ошибка, подписка уже активна.
    if (data.status === 'confirmed') {
      return page(confirmPageHtml('already', site));
    }

    const payload = { ...(data.payload || {}), confirmed_at: new Date().toISOString() };
    const { error: upErr } = await supabaseAdmin
      .from('submissions')
      .update({ status: 'confirmed', payload })
      .eq('id', data.id);
    if (upErr) throw new Error(`supabase update: ${upErr.message}`);

    return page(confirmPageHtml('confirmed', site));
  } catch (e) {
    console.error('[confirm] error', e);
    return page(confirmPageHtml('invalid'), 500);
  }
}
