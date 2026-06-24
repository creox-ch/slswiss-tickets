import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '../../../../lib/supabase';
import { sendTicketEmail } from '../../../../lib/ticket';

export const runtime = 'nodejs';

/**
 * DEV-ONLY: выпустить оплаченный билет БЕЗ Payrexx.
 * Нужен пока нет Payrexx API — чтобы протестировать QR / письмо / сканер.
 *
 * Защита: работает только если задан DEV_ISSUE_TOKEN и он совпадает с ?key=.
 * Если DEV_ISSUE_TOKEN не задан — эндпоинт выключен (404-подобный ответ).
 *
 * Пример:
 *   GET  /api/dev/issue?key=СЕКРЕТ&email=test@mail.com&name=Иван
 *   → создаёт ticket status=paid + qr_token, шлёт письмо с QR (если Resend настроен),
 *     возвращает { qr_token, scanUrl } чтобы сразу проверить сканером.
 *
 * УДАЛИ эту папку (app/api/dev) перед продом, либо просто убери DEV_ISSUE_TOKEN.
 */
async function handle(req) {
  const DEV_TOKEN = process.env.DEV_ISSUE_TOKEN;
  if (!DEV_TOKEN) {
    return NextResponse.json({ ok: false, error: 'dev endpoint disabled (нет DEV_ISSUE_TOKEN)' }, { status: 404 });
  }

  const url = new URL(req.url);
  let params = Object.fromEntries(url.searchParams.entries());
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    params = { ...params, ...body };
  }

  if (params.key !== DEV_TOKEN) {
    return NextResponse.json({ ok: false, error: 'bad key' }, { status: 401 });
  }

  try {
    const referenceId = `dev-${crypto.randomUUID()}`;
    const qrToken = crypto.randomBytes(16).toString('hex');
    const eventName = params.eventName || 'Тестовое событие (dev)';
    const email = params.email || null;
    const name = params.name || null;

    const { error: insErr } = await supabaseAdmin.from('tickets').insert({
      reference_id: referenceId,
      event_name: eventName,
      buyer_email: email,
      buyer_name: name,
      amount: 0,
      status: 'paid',
      qr_token: qrToken,
      paid_at: new Date().toISOString(),
    });
    if (insErr) throw new Error(`supabase insert: ${insErr.message}`);

    let emailSent = false;
    let emailError = null;
    if (email) {
      try {
        await sendTicketEmail({ to: email, name, eventName, qrToken });
        emailSent = true;
      } catch (e) {
        emailError = String(e.message || e);
      }
    }

    const base = process.env.PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
    return NextResponse.json({
      ok: true,
      qr_token: qrToken,
      scanUrl: `${base}/scan?t=${qrToken}`,
      referenceId,
      emailSent,
      emailError,
    });
  } catch (e) {
    console.error('[dev/issue] error', e);
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

export async function GET(req) { return handle(req); }
export async function POST(req) { return handle(req); }
