import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { unsubscribePageHtml } from '../../../../lib/forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/forms/unsubscribe?token=… — отписка от рассылки.
 *
 * Токен = payload.confirm_token строки подписки (form_key='newsletter').
 *
 * POST — отписывает сразу. Так работает one-click из почтовика (RFC 8058,
 *        заголовки List-Unsubscribe + List-Unsubscribe-Post), и так же постит
 *        кнопка на GET-странице.
 * GET  — НЕ отписывает на загрузке (почтовики префетчат ссылки → были бы
 *        случайные отписки), а показывает страницу с кнопкой, которая делает POST.
 *
 * Переход из письма/почтовика, не cross-origin fetch → CORS не нужен.
 */
function page(html, status = 200) {
  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function originOf(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return undefined;
  }
}

function tokenOf(req) {
  return new URL(req.url).searchParams.get('token');
}

async function findRow(token) {
  return supabaseAdmin
    .from('submissions')
    .select('id, status, source_url, payload')
    .eq('form_key', 'newsletter')
    .eq('payload->>confirm_token', token)
    .limit(1)
    .maybeSingle();
}

export async function GET(req) {
  const token = tokenOf(req);
  if (!token) return page(unsubscribePageHtml('invalid'), 400);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return page(unsubscribePageHtml('invalid'), 503);
  }
  try {
    const { data, error } = await findRow(token);
    if (error) throw new Error(`supabase select: ${error.message}`);
    if (!data) return page(unsubscribePageHtml('invalid'), 400);

    const site = originOf(data.source_url);
    if (data.status === 'unsubscribed') return page(unsubscribePageHtml('done', { site }));
    // Показываем кнопку; сама отписка — POST (см. форму в unsubscribePageHtml).
    return page(unsubscribePageHtml('ask', { token, site }));
  } catch (e) {
    console.error('[unsub] get error', e);
    return page(unsubscribePageHtml('invalid'), 500);
  }
}

export async function POST(req) {
  const token = tokenOf(req);
  if (!token) return page(unsubscribePageHtml('invalid'), 400);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return page(unsubscribePageHtml('invalid'), 503);
  }
  try {
    const { data, error } = await findRow(token);
    if (error) throw new Error(`supabase select: ${error.message}`);
    if (!data) return page(unsubscribePageHtml('invalid'), 400);

    const site = originOf(data.source_url);

    // Идемпотентно: повторная отписка — не ошибка.
    if (data.status !== 'unsubscribed') {
      const payload = { ...(data.payload || {}), unsubscribed_at: new Date().toISOString() };
      const { error: upErr } = await supabaseAdmin
        .from('submissions')
        .update({ status: 'unsubscribed', payload })
        .eq('id', data.id);
      if (upErr) throw new Error(`supabase update: ${upErr.message}`);
    }

    return page(unsubscribePageHtml('done', { site }));
  } catch (e) {
    console.error('[unsub] post error', e);
    return page(unsubscribePageHtml('invalid'), 500);
  }
}
