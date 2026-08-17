import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import {
  abandonHours,
  purgeDays,
  cutoffIso,
  ABANDONABLE_STATUSES,
  PURGEABLE_STATUSES,
} from '../../../../lib/pending-cleanup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/cleanup-pending — брошенные корзины.
 *
 * Шаг 1: `pending` старше суток → `failed`. Строка остаётся, поздняя оплата
 *        всё ещё выдаст билет (`failed` в CONFIRMABLE_STATUSES).
 * Шаг 2: строки старше 30 дней, по которым Payrexx не сказал ни слова, —
 *        удаляем: e-mail человека, ничего не купившего, хранить незачем.
 *
 * Логика порогов и почему шага два — в lib/pending-cleanup.js.
 *
 * Закрыт `CRON_SECRET` (как /api/cron/newsletter-digest): роут меняет и удаляет
 * строки в боевой таблице, дёргать его снаружи нельзя. Без секрета — 503,
 * то есть отключён, а не открыт всем. Запускается Vercel Cron (vercel.json).
 */
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET не задан — чистка отключена' },
      { status: 503 }
    );
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, error: 'база не подключена' }, { status: 503 });
  }

  const hours = abandonHours(process.env.PENDING_ABANDON_HOURS);
  const days = purgeDays(process.env.PENDING_PURGE_DAYS);
  const now = new Date();

  try {
    // Шаг 1. Отметить брошенные. `.in(status)` + `.lt(created_at)` — то же
    // условие-фильтр, что защищает вебхук: параллельная оплата в этот момент
    // либо ещё pending (и мы её пометим, а вебхук потом переведёт в paid),
    // либо уже paid (и наш фильтр её не видит).
    const { data: abandoned, error: abandonErr } = await supabaseAdmin
      .from('tickets')
      .update({ status: 'failed' })
      .in('status', ABANDONABLE_STATUSES)
      .lt('created_at', cutoffIso(now, { hours }))
      .select('id');
    if (abandonErr) throw new Error(`supabase abandon: ${abandonErr.message}`);

    // Шаг 2. Удалить давно брошенные — только те, о которых Payrexx молчал.
    // `payrexx_tx_id`/`paid_at` не null означает, что платёжка что-то сообщала
    // по этому заказу: такую строку не трогаем, это след платёжной активности.
    const { data: purged, error: purgeErr } = await supabaseAdmin
      .from('tickets')
      .delete()
      .in('status', PURGEABLE_STATUSES)
      .lt('created_at', cutoffIso(now, { days }))
      .is('payrexx_tx_id', null)
      .is('paid_at', null)
      .select('id');
    if (purgeErr) throw new Error(`supabase purge: ${purgeErr.message}`);

    const result = {
      ok: true,
      abandoned: abandoned?.length || 0,
      purged: purged?.length || 0,
      // Пороги в ответе — чтобы по одному запросу было видно, доехали ли env
      // до прода (Vercel применяет переменные только новым деплоем).
      abandonHours: hours,
      purgeDays: days,
    };
    console.log('[cleanup-pending]', JSON.stringify(result));
    return NextResponse.json(result);
  } catch (e) {
    console.error('[cleanup-pending] error', e);
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
