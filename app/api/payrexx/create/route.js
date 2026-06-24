import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '../../../../lib/supabase';
import { createGateway } from '../../../../lib/payrexx';

export const runtime = 'nodejs';

/**
 * POST /api/payrexx/create
 * body: { eventName?, email?, name?, amount? }  amount в раппенах (default 1 = 0.01 CHF)
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
            'Оплата через Payrexx пока недоступна — API не подключён. Для теста выпусти билет через /api/dev/issue.',
        },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const eventName = body.eventName || 'test';
    const amount = Number.isInteger(body.amount) ? body.amount : 1; // 0.01 CHF

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
      successUrl: `${base}/scan?paid=1`,
      failedUrl: `${base}/?failed=1`,
      cancelUrl: `${base}/?cancelled=1`,
    });

    return NextResponse.json({ ok: true, referenceId, payUrl: gateway.link, gatewayId: gateway.id });
  } catch (e) {
    console.error('[create] error', e);
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
