import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '../../../lib/supabase';
import { normalizeSubmission, renderNotificationHtml } from '../../../lib/forms';

export const runtime = 'nodejs';

/**
 * POST /api/forms — приём заявок с форм платформенных сайтов (chudina / atlasintegra / форум).
 * Пишет строку в public.submissions (база аудитории) и шлёт письмо-уведомление.
 *
 * Формы живут на ДРУГИХ доменах → нужен CORS (preflight OPTIONS + заголовки).
 * Доступ к БД — через service_role (supabaseAdmin), anon-ключ в статике не используем.
 * Ошибка письма НЕ валит запись заявки (ловим и логируем) — как в sendTicketEmail.
 */

const DEFAULT_ORIGINS = [
  'https://chudina.me',
  'https://www.chudina.me',
  'https://atlasintegra.ch',
  'https://www.atlasintegra.ch',
  'http://localhost:3000',
];

function allowedOrigins() {
  const env = process.env.FORMS_ALLOWED_ORIGINS;
  if (!env) return DEFAULT_ORIGINS;
  return env
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** CORS-заголовки для конкретного origin (ACAO только если origin в белом списке). */
function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowedOrigins().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export async function OPTIONS(req) {
  const origin = req.headers.get('origin');
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

let _resend = null;
function resend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export async function POST(req) {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);
  const json = (data, status = 200) =>
    NextResponse.json(data, { status, headers: cors });

  try {
    // База не сконфигурирована? Понятное сообщение вместо крипто-ошибки.
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return json(
        { ok: false, error: 'Приём заявок пока недоступен — база не подключена.' },
        503
      );
    }

    const body = await req.json().catch(() => ({}));

    let sub;
    try {
      sub = normalizeSubmission(body);
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 400);
    }

    // honeypot: скрытое поле заполнено → это бот. Отвечаем «ок», но ничего не пишем.
    if (sub.hp) return json({ ok: true, skipped: true });

    const { hp, ...record } = sub; // hp в БД не пишем
    const { data, error } = await supabaseAdmin
      .from('submissions')
      .insert(record)
      .select('id')
      .single();
    if (error) throw new Error(`supabase insert: ${error.message}`);

    // Письмо-уведомление — не критично для записи заявки.
    if (process.env.RESEND_API_KEY) {
      try {
        await resend().emails.send({
          from: process.env.TICKET_FROM_EMAIL || 'SoiLüDi <noreply@slswiss.ch>',
          to: process.env.FORMS_NOTIFY_EMAIL || 'main@chudina.me',
          replyTo: sub.email || undefined,
          subject: `Заявка · ${sub.role || sub.form_key || sub.source}`,
          html: renderNotificationHtml(sub),
        });
      } catch (mailErr) {
        console.error('[forms] notify email failed', mailErr);
      }
    }

    return json({ ok: true, id: data.id });
  } catch (e) {
    console.error('[forms] error', e);
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
}
