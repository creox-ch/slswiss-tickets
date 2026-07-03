import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '../../../../lib/supabase';
import { getTransaction, verifyWebhookSignature, unflattenTransaction } from '../../../../lib/payrexx';
import { sendTicketEmail } from '../../../../lib/ticket';

export const runtime = 'nodejs';

/**
 * POST /api/payrexx/webhook
 *
 * Payrexx шлёт сюда транзакцию. Делаем:
 * 1) читаем СЫРОЕ тело (нужно для проверки подписи)
 * 2) проверяем X-Webhook-Signature
 * 3) парсим transaction (JSON или form-urlencoded — поддерживаем оба)
 * 4) НЕ доверяем статусу из payload: дёргаем Payrexx API и сверяем 'confirmed'
 * 5) находим билет по reference_id, помечаем paid, генерим qr_token, шлём email
 *
 * Ответы:
 * - 200 — обработано или осознанно проигнорировано (нет ретраев)
 * - 401 — невалидная подпись
 * - 500 — НАША ошибка (БД/Payrexx API недоступны): Payrexx повторит доставку,
 *   оплаченное событие не потеряется молча. Повтор безопасен: обработка
 *   идемпотентна (paid/checked_in второй раз не трогаем).
 */
export async function POST(req) {
  const raw = await req.text();
  const signature = req.headers.get('x-webhook-signature');

  if (!verifyWebhookSignature(raw, signature)) {
    console.warn('[webhook] bad signature');
    return NextResponse.json({ ok: false, error: 'bad signature' }, { status: 401 });
  }

  // Payrexx может прислать JSON или form-data (transaction[...]=...)
  let tx;
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const parsed = JSON.parse(raw);
      tx = parsed.transaction || parsed;
    } else {
      const usp = new URLSearchParams(raw);
      tx = unflattenTransaction(usp);
    }
  } catch (e) {
    console.error('[webhook] parse error', e);
    return NextResponse.json({ ok: true, note: 'unparseable, ignored' });
  }

  const referenceId = tx?.referenceId;
  const txId = tx?.id;
  if (!referenceId || !txId) {
    return NextResponse.json({ ok: true, note: 'no reference/id, ignored' });
  }

  try {
    // независимая верификация статуса
    const verified = await getTransaction(txId);
    const status = verified?.status; // 'confirmed' | 'waiting' | 'declined' | ...

    if (status === 'confirmed') {
      // maybeSingle: «строки нет» — это data=null БЕЗ ошибки; error — реальный сбой БД.
      // С .single() сбой БД был бы неотличим от «билета нет» и событие терялось бы с 200.
      const { data: existing, error: selErr } = await supabaseAdmin
        .from('tickets')
        .select('id, status, qr_token, buyer_email, buyer_name, event_name')
        .eq('reference_id', referenceId)
        .maybeSingle();
      if (selErr) throw new Error(`supabase select: ${selErr.message}`);

      if (!existing) {
        console.warn('[webhook] confirmed but no ticket row', referenceId);
        return NextResponse.json({ ok: true });
      }
      if (existing.status === 'paid' || existing.status === 'checked_in') {
        return NextResponse.json({ ok: true, note: 'already processed' });
      }

      const qrToken = crypto.randomBytes(16).toString('hex');
      const email = verified?.contact?.email || existing.buyer_email;
      const name =
        existing.buyer_name ||
        [verified?.contact?.firstname, verified?.contact?.lastname].filter(Boolean).join(' ') ||
        null;

      const { error: updErr } = await supabaseAdmin
        .from('tickets')
        .update({
          status: 'paid',
          payrexx_tx_id: txId,
          qr_token: qrToken,
          buyer_email: email,
          buyer_name: name,
          paid_at: new Date().toISOString(),
        })
        .eq('reference_id', referenceId);
      if (updErr) throw new Error(`supabase update: ${updErr.message}`);

      // email НЕ должен валить вебхук — ловим отдельно
      if (email) {
        try {
          await sendTicketEmail({ to: email, name, eventName: existing.event_name, qrToken });
        } catch (mailErr) {
          console.error('[webhook] email failed (ticket still valid)', mailErr);
        }
      } else {
        console.warn('[webhook] no email on tx, ticket created but not sent', referenceId);
      }
    } else if (status === 'declined' || status === 'error' || status === 'cancelled') {
      const { error } = await supabaseAdmin
        .from('tickets')
        .update({ status: 'failed', payrexx_tx_id: txId })
        .eq('reference_id', referenceId)
        .eq('status', 'pending');
      if (error) throw new Error(`supabase update failed-status: ${error.message}`);
    } else if (status === 'refunded') {
      const { error } = await supabaseAdmin
        .from('tickets')
        .update({ status: 'refunded' })
        .eq('reference_id', referenceId);
      if (error) throw new Error(`supabase update refunded: ${error.message}`);
    }
    // прочие статусы (waiting и т.п.) — просто 200

    return NextResponse.json({ ok: true, status });
  } catch (e) {
    console.error('[webhook] processing error', e);
    // 500 → Payrexx повторит доставку (ограниченное число раз).
    // Обработка идемпотентна, повтор безопасен; так оплата не теряется молча.
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
