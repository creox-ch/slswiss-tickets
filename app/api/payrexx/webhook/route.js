import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '../../../../lib/supabase';
import { getTransaction, verifyWebhookSignature } from '../../../../lib/payrexx';
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
 * Всегда отвечаем 200 на корректно обработанные/проигнорированные события,
 * чтобы Payrexx не зацикливал ретраи. 4xx — только при невалидной подписи.
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
      // идемпотентность: если уже paid/checked_in — ничего не делаем
      const { data: existing } = await supabaseAdmin
        .from('tickets')
        .select('id, status, qr_token, buyer_email, buyer_name, event_name')
        .eq('reference_id', referenceId)
        .single();

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
      await supabaseAdmin
        .from('tickets')
        .update({ status: 'failed', payrexx_tx_id: txId })
        .eq('reference_id', referenceId)
        .eq('status', 'pending');
    } else if (status === 'refunded') {
      await supabaseAdmin
        .from('tickets')
        .update({ status: 'refunded' })
        .eq('reference_id', referenceId);
    }
    // прочие статусы (waiting и т.п.) — просто 200

    return NextResponse.json({ ok: true, status });
  } catch (e) {
    console.error('[webhook] processing error', e);
    // 200, чтобы не словить бесконечные ретраи на нашей ошибке БД;
    // событие можно будет переиграть вручную через Payrexx Logs.
    return NextResponse.json({ ok: true, error: String(e.message || e) });
  }
}

/** form-data вида transaction[id]=..&transaction[contact][email]=.. → объект */
function unflattenTransaction(usp) {
  const out = {};
  for (const [key, value] of usp.entries()) {
    const m = key.match(/^transaction\[(.+)\]$/);
    if (!m) continue;
    const path = m[1].split('][');
    let cur = out;
    path.forEach((p, i) => {
      if (i === path.length - 1) cur[p] = value;
      else cur = cur[p] || (cur[p] = {});
    });
  }
  return out;
}
