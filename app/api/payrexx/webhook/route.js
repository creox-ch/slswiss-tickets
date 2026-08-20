import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '../../../../lib/supabase';
import { getTransaction, verifyWebhookSignature, unflattenTransaction } from '../../../../lib/payrexx';
import { sendTicketEmail, sendForumTicketEmail, sendMarketConfirmationEmail } from '../../../../lib/ticket';
import { canConfirmToPaid, CONFIRMABLE_STATUSES } from '../../../../lib/ticket-status';
import {
  compareAmounts,
  transactionAmount,
  transactionCurrency,
  describeMismatch,
} from '../../../../lib/payment-check';
import { FORUM_EVENT_SLUG } from '../../../../lib/forum-tickets';
import { MARKET_EVENT_SLUG } from '../../../../lib/market-packages';

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
        .select(
          'id, status, qr_token, buyer_email, buyer_name, event_name, event_slug, payload, amount, currency'
        )
        .eq('reference_id', referenceId)
        .maybeSingle();
      if (selErr) throw new Error(`supabase select: ${selErr.message}`);

      if (!existing) {
        console.warn('[webhook] confirmed but no ticket row', referenceId);
        return NextResponse.json({ ok: true });
      }
      // Ранний выход: уже обработано (paid/checked_in) или возвращено (refunded).
      // Настоящая защита — условие в самом update ниже; здесь просто не делаем
      // лишнюю работу.
      if (!canConfirmToPaid(existing.status)) {
        return NextResponse.json({ ok: true, note: `already ${existing.status}` });
      }

      // Сверка денег с ценой заказа. Раньше вебхук не смотрел, сколько реально
      // пришло: скидка, выданная на стороне Payrexx, оставила бы в базе полную
      // цену, а на счёте — меньше, и расхождение всплыло бы только при ручной
      // сверке выручки. Билет всё равно выдаём — деньги получены, человек ни при
      // чём, — но факт пишем и в лог, и в саму строку заказа.
      const amountCheck = compareAmounts({
        expected: existing.amount,
        paid: transactionAmount(verified),
        expectedCurrency: existing.currency,
        paidCurrency: transactionCurrency(verified),
      });
      if (amountCheck.mismatch) console.warn(describeMismatch(amountCheck, referenceId));

      const qrToken = crypto.randomBytes(16).toString('hex');
      const email = verified?.contact?.email || existing.buyer_email;
      const name =
        existing.buyer_name ||
        [verified?.contact?.firstname, verified?.contact?.lastname].filter(Boolean).join(' ') ||
        null;

      // Захват заказа одним атомарным шагом — как гонка двух сканеров в
      // app/api/checkin/route.js. Payrexx повторяет доставку (наш 500, ручной
      // re-send), и два перекрывающихся вебхука оба проходят проверку выше:
      // каждый сгенерил бы свой qr_token и отправил своё письмо, а в БД остался
      // бы последний — второй QR у покупателя не сработал бы на входе.
      // .in(status) пропустит только одного; .select() возвращает затронутые
      // строки — у проигравшего их 0, и он тихо выходит, не отправляя письма.
      const { data: claimed, error: updErr } = await supabaseAdmin
        .from('tickets')
        .update({
          status: 'paid',
          payrexx_tx_id: txId,
          qr_token: qrToken,
          buyer_email: email,
          buyer_name: name,
          paid_at: new Date().toISOString(),
          // Что реально пришло — рядом с тем, что мы ожидали. Пустое paid_amount
          // означает «в транзакции суммы не было», а не «сошлось».
          paid_amount: amountCheck.unknown ? null : amountCheck.paid,
          amount_mismatch: amountCheck.mismatch,
        })
        .eq('reference_id', referenceId)
        .in('status', CONFIRMABLE_STATUSES)
        .select('id');
      if (updErr) throw new Error(`supabase update: ${updErr.message}`);

      if (!claimed || claimed.length === 0) {
        console.warn('[webhook] concurrent delivery, ticket already claimed', referenceId);
        return NextResponse.json({ ok: true, note: 'already processed (concurrent)' });
      }

      // email НЕ должен валить вебхук — ловим отдельно.
      // Форумный билет (event_slug) → брендированное письмо Frankenplatz с деталями заказа;
      // остальное → билет стенда SoiLüDi.
      if (email) {
        try {
          if (existing.event_slug === FORUM_EVENT_SLUG) {
            const p = existing.payload || {};
            // Человеко-номер FP-2026-NNNN из счётчика. Идемпотентно (ретрай вебхука
            // не «сжигает» новый номер). Ошибку глотаем — билет валиден и без номера.
            let ticketNo = null;
            try {
              const { data: no } = await supabaseAdmin.rpc('assign_forum_ticket_no', {
                p_reference_id: referenceId,
              });
              ticketNo = no;
            } catch (noErr) {
              console.error('[webhook] ticket_no assign failed (ticket still valid)', noErr);
            }
            await sendForumTicketEmail({
              to: email,
              name,
              qrToken,
              description: p.description || existing.event_name,
              amountRappen: existing.amount,
              ticketNo,
              product: p.product,
            });
          } else if (existing.event_slug === MARKET_EVENT_SLUG) {
            // Пакет бренд-маркета: подтверждение оплаты (без QR — это не билет на вход).
            const p = existing.payload || {};
            await sendMarketConfirmationEmail({
              to: email,
              name,
              description: p.description || 'Пакет маркета',
              amountRappen: existing.amount,
            });
          } else {
            await sendTicketEmail({ to: email, name, eventName: existing.event_name, qrToken });
          }
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
