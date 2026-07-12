import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '../../../../lib/supabase';
import { createGateway } from '../../../../lib/payrexx';

export const runtime = 'nodejs';

/**
 * POST /api/payrexx/create
 * body: { eventName?, email?, name? }
 *
 * Цену определяет ТОЛЬКО сервер (TICKET_PRICE_RAPPEN, default 100 = 1.00 CHF).
 * amount из тела запроса игнорируется: клиент управляет ценой = билет за 0.01 CHF.
 *
 * 1) создаём строку tickets со status=pending и нашим reference_id
 * 2) создаём Payrexx Gateway с этим reference_id
 * 3) возвращаем link для оплаты
 */
export async function POST(req) {
  try {
    // Payrexx ещё не подключён? Возвращаем понятное сообщение вместо крипто-ошибки.
    if (!process.env.PAYREXX_API_SECRET) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Оплата через Payrexx пока недоступна — API не подключён.',
        },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const eventName = body.eventName || 'test';
    const amount = parseInt(process.env.TICKET_PRICE_RAPPEN, 10) || 100; // 1.00 CHF

    const referenceId = `slsw-${crypto.randomUUID()}`;
    const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

    // 1) pending-билет
    const { error: insErr } = await supabaseAdmin.from('tickets').insert({
      reference_id: referenceId,
      event_name: eventName,
      buyer_email: body.email || null,
      buyer_name: body.name || null,
      amount,
      status: 'pending',
    });
    if (insErr) throw new Error(`supabase insert: ${insErr.message}`);

    // 2) Payrexx gateway
    const gateway = await createGateway({
      referenceId,
      amount,
      currency: 'CHF',
      purpose: `SoiLüDi — ${eventName}`,
      successUrl: `${base}/thanks`,
      failedUrl: `${base}/?failed=1`,
      cancelUrl: `${base}/?cancelled=1`,
    });

    return NextResponse.json({ ok: true, referenceId, payUrl: gateway.link, gatewayId: gateway.id });
  } catch (e) {
    console.error('[create] error', e);
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
