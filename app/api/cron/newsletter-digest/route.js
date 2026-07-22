import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '../../../../lib/supabase';
import {
  renderDigestHtml,
  notifyEmailFor,
  DIGEST_WINDOW_HOURS,
} from '../../../../lib/forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/newsletter-digest — дневная сводка новых подписчиков.
 *
 * Поштучные письма о подписке отключены (ящик забивался), вместо них раз
 * в сутки приходит список. Запускается Vercel Cron (см. vercel.json).
 *
 * ВАЖНО: роут отдаёт персональные данные (e-mail подписчиков), поэтому
 * закрыт секретом. Vercel Cron сам шлёт заголовок
 * `Authorization: Bearer $CRON_SECRET`. Без совпадения — 401.
 * Если CRON_SECRET не задан, роут отключён (а не открыт всем).
 */
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET не задан — сводка отключена' },
      { status: 503 }
    );
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, error: 'база не подключена' }, { status: 503 });
  }

  try {
    const since = new Date(Date.now() - DIGEST_WINDOW_HOURS * 3600 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('submissions')
      .select('created_at, email, source, event, source_url')
      .eq('form_key', 'newsletter')
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`supabase select: ${error.message}`);

    const rows = data || [];
    // Нет новых — молчим. Пустое письмо каждый день никому не нужно.
    if (!rows.length) {
      return NextResponse.json({ ok: true, count: 0, sent: false });
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ ok: true, count: rows.length, sent: false });
    }

    // Группируем по сайту-источнику: каждому свой ящик.
    const bySource = {};
    for (const r of rows) {
      const key = (r.source || 'unknown').toLowerCase();
      (bySource[key] = bySource[key] || []).push(r);
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const sent = [];

    for (const [source, list] of Object.entries(bySource)) {
      const to = notifyEmailFor(
        source,
        process.env.FORMS_NOTIFY_MAP,
        process.env.FORMS_NOTIFY_EMAIL
      );
      try {
        await resend.emails.send({
          from: process.env.TICKET_FROM_EMAIL || 'SoiLüDi <noreply@slswiss.ch>',
          to,
          subject: `Подписки за сутки · ${source} · ${list.length}`,
          html: renderDigestHtml(source, list, DIGEST_WINDOW_HOURS),
        });
        sent.push({ source, to, count: list.length });
      } catch (mailErr) {
        console.error('[digest] email failed', source, mailErr);
      }
    }

    return NextResponse.json({ ok: true, count: rows.length, sent });
  } catch (e) {
    console.error('[digest] error', e);
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
