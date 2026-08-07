import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { Resend } from 'resend';
import { supabaseAdmin } from '../../../lib/supabase';
import {
  normalizeSubmission,
  renderNotificationHtml,
  renderNotificationText,
  renderReportHtml,
  renderReportText,
  renderRegistrationHtml,
  renderRegistrationText,
  renderSpeakerHtml,
  renderSpeakerText,
  renderOkaziyaHtml,
  renderOkaziyaText,
  renderConfirmHtml,
  renderConfirmText,
  confirmLink,
  unsubscribeUrl,
  unsubscribeHeaders,
  allowedOrigins as resolveOrigins,
  notifyEmailFor,
  notifyCcFor,
  parseAttribution,
  notifyFromFor,
  shouldNotifyImmediately,
  MIN_FILL_MS,
} from '../../../lib/forms';

export const runtime = 'nodejs';

/**
 * POST /api/forms — приём заявок с форм платформенных сайтов (chudina / atlasintegra / форум).
 * Пишет строку в public.submissions (база аудитории) и шлёт письмо-уведомление.
 *
 * Формы живут на ДРУГИХ доменах → нужен CORS (preflight OPTIONS + заголовки).
 * Доступ к БД — через service_role (supabaseAdmin), anon-ключ в статике не используем.
 * Ошибка письма НЕ валит запись заявки (ловим и логируем) — как в sendTicketEmail.
 */

/** Белый список origins (дефолт + переопределение через env) — см. lib/forms. */
function allowedOrigins() {
  return resolveOrigins(process.env.FORMS_ALLOWED_ORIGINS);
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

    // Анти-бот 1: жёсткий Origin — POST принимаем только с наших доменов.
    // (CORS блокирует браузер, но не прямой curl/скрипт — отсекаем тут.)
    if (!origin || !allowedOrigins().includes(origin)) {
      return json({ ok: false, error: 'forbidden origin' }, 403);
    }

    const body = await req.json().catch(() => ({}));

    let sub;
    try {
      sub = normalizeSubmission(body);
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 400);
    }

    // Анти-бот 2: honeypot — скрытое поле заполнено → бот. Отвечаем «ок», но не пишем.
    if (sub.hp) return json({ ok: true, skipped: true });

    // Анти-бот 3: time-trap — форму «заполнили» быстрее человека → бот.
    if (sub.elapsed_ms != null && sub.elapsed_ms < MIN_FILL_MS) {
      return json({ ok: true, skipped: true });
    }

    // GDPR / revDSG: без согласия на обработку данных заявку не сохраняем.
    if (!sub.consent) {
      return json(
        { ok: false, error: 'Нужно согласие на обработку данных.' },
        400
      );
    }

    // служебные поля (hp/elapsed/send_report/newsletter_optin) в БД не пишем
    const { hp, elapsed_ms, send_report, newsletter_optin, ...record } = sub;

    // Откуда пришёл человек: utm-метки и страница входа — из адреса, который
    // форма и так прислала. Отдельной колонкой, не в payload: payload целиком
    // уходит в письмо заявителю, метки кампаний ему там не нужны.
    const attrib = parseAttribution(sub.source_url);
    if (attrib) record.attrib = attrib;

    // Подписка на рассылку — double opt-in: пишем со status='pending' и
    // одноразовым токеном в payload; подписчиком строка станет только после
    // перехода по ссылке из письма (GET /api/forms/confirm). Разовые письма
    // (отчёт/регистрация/спикер) подтверждения НЕ требуют — их шлём сразу.
    // Double opt-in — ТОЛЬКО у форума (у него настоящая рассылка, брендированная
    // Frankenplatz, со ссылкой на frankenplatz.ch). Подписки с других сайтов
    // (creox и т.п.) просто записываем как контакт, без письма-подтверждения:
    // иначе бренд письма (Frankenplatz) ≠ домен подписки (creox.ch) → спам и путаница.
    let confirmToken = null;
    if (sub.form_key === 'newsletter' && sub.email && sub.source === 'forum') {
      confirmToken = randomUUID();
      record.status = 'pending';
      record.payload = { ...record.payload, confirm_token: confirmToken };
    }

    const { data, error } = await supabaseAdmin
      .from('submissions')
      .insert(record)
      .select('id')
      .single();
    if (error) throw new Error(`supabase insert: ${error.message}`);

    // Письмо-уведомление — не критично для записи заявки.
    if (process.env.RESEND_API_KEY) {
      // Подписки на рассылку поштучно не шлём — они идут дневной сводкой
      // (/api/cron/newsletter-digest), иначе ящик забивается.
      if (shouldNotifyImmediately(sub)) {
        try {
          await resend().emails.send({
            // «От кого» — по бренду источника: заявка форума приходит от
            // Frankenplatz, а не от SoiLüDi/slswiss.ch.
            from: notifyFromFor(
              sub.source,
              process.env.FORMS_REPORT_FROM,
              process.env.TICKET_FROM_EMAIL
            ),
            // Адрес зависит от сайта-источника (FORMS_NOTIFY_MAP),
            // иначе заявки форума падали бы в ящик chudina и наоборот.
            to: notifyEmailFor(
              sub.source,
              process.env.FORMS_NOTIFY_MAP,
              process.env.FORMS_NOTIFY_EMAIL
            ),
            // СКРЫТАЯ копия платформенному ассистенту (assistant@creox.ch по
            // умолчанию). Именно bcc: Reply-To ведёт на заявителя, и видимый cc
            // при «ответить всем» показал бы ему служебный адрес.
            bcc: notifyCcFor(process.env.FORMS_NOTIFY_BCC ?? process.env.FORMS_NOTIFY_CC),
            replyTo: sub.email || undefined,
            subject: `Заявка · ${sub.role || sub.form_key || sub.source}`,
            html: renderNotificationHtml(sub),
            // без text-части Resend генерит её из HTML и слепляет подписи
            // со значениями («Emailanna@example.ch Проценты банку11'200»)
            text: renderNotificationText(sub),
          });
        } catch (mailErr) {
          console.error('[forms] notify email failed', mailErr);
        }
      }

      // Отчёт САМОМУ отправителю — только если форма явно попросила (калькуляторы
      // форума). Содержимое собирает сервер из payload, клиент текст не задаёт.
      // Ошибка письма не валит заявку — она уже сохранена.
      // Подтверждение ранней регистрации — человек должен получить письмо,
      // а не только надпись на экране.
      if (sub.form_key === 'registration' && sub.email) {
        try {
          await resend().emails.send({
            from: process.env.FORMS_REPORT_FROM || 'Frankenplatz <info@frankenplatz.ch>',
            to: sub.email,
            subject: 'Ты в списке ранней регистрации · Frankenplatz 2026',
            html: renderRegistrationHtml(sub),
            text: renderRegistrationText(sub),
          });
        } catch (regErr) {
          console.error('[forms] registration email failed', regErr);
        }
      }

      // Подтверждение спикеру — он ценный лид, нельзя оставлять без ответа.
      if (sub.form_key === 'speaker' && sub.email) {
        try {
          await resend().emails.send({
            from: process.env.FORMS_REPORT_FROM || 'Frankenplatz <info@frankenplatz.ch>',
            to: sub.email,
            // Ответы спикера ведём в ящик форума info@ (его читает оргкоманда),
            // с копией платформенному админу assistant@creox.ch. Оба адреса в
            // Reply-To → при «Ответить» письмо уходит на оба.
            replyTo: ['info@frankenplatz.ch', 'assistant@creox.ch'],
            subject: 'Анкета спикера получена · Frankenplatz 2026',
            html: renderSpeakerHtml(sub),
            text: renderSpeakerText(sub),
          });
        } catch (spErr) {
          console.error('[forms] speaker email failed', spErr);
        }
      }

      // Автоответ отправителю с доски «Оказия» (объявление / заявка) — человек
      // должен получить подтверждение, а не только надпись на экране. Ответы
      // ведём в ящик форума info@ (Reply-To), доска пока в ручном режиме.
      if (
        (sub.form_key === 'okaziya-request' || sub.form_key === 'okaziya-listing') &&
        sub.email
      ) {
        try {
          await resend().emails.send({
            from: process.env.FORMS_REPORT_FROM || 'Frankenplatz <info@frankenplatz.ch>',
            to: sub.email,
            replyTo: 'info@frankenplatz.ch',
            subject:
              sub.form_key === 'okaziya-listing'
                ? 'Объявление получено · Оказия · Frankenplatz'
                : 'Заявка получена · Оказия · Frankenplatz',
            html: renderOkaziyaHtml(sub),
            text: renderOkaziyaText(sub),
          });
        } catch (okzErr) {
          console.error('[forms] okaziya email failed', okzErr);
        }
      }

      if (sub.send_report && sub.email) {
        try {
          await resend().emails.send({
            from: process.env.FORMS_REPORT_FROM || 'Frankenplatz <info@frankenplatz.ch>',
            to: sub.email,
            subject: `Твой расчёт · ${sub.role || sub.form_key || 'Frankenplatz'}`,
            html: renderReportHtml(sub),
            text: renderReportText(sub),
          });
        } catch (reportErr) {
          console.error('[forms] report email failed', reportErr);
        }
      }

      // Double opt-in: подписчику уходит письмо с ссылкой-подтверждением.
      // Без перехода по ней рассылку не шлём (строка остаётся 'pending').
      if (confirmToken) {
        try {
          // Ссылку ведём на домен подписки (frankenplatz.ch), а не на *.vercel.app:
          // бренд + совпадение с доменом отправителя = меньше спама. Прокси —
          // rewrite /newsletter/confirm в vercel.json сайта.
          const confirmUrl = confirmLink(
            sub.source_url,
            process.env.PUBLIC_BASE_URL,
            confirmToken,
            allowedOrigins()
          );
          // List-Unsubscribe (one-click): кнопка «Отписаться» в почтовике +
          // меньше жалоб на спам. Тот же токен, что и подтверждение.
          const unsubUrl = unsubscribeUrl(
            sub.source_url,
            process.env.PUBLIC_BASE_URL,
            confirmToken,
            allowedOrigins()
          );
          await resend().emails.send({
            from: process.env.FORMS_REPORT_FROM || 'Frankenplatz <info@frankenplatz.ch>',
            to: sub.email,
            subject: 'Подтверди подписку · Frankenplatz',
            html: renderConfirmHtml(sub, confirmUrl),
            text: renderConfirmText(sub, confirmUrl),
            headers: unsubscribeHeaders(unsubUrl),
          });
        } catch (confErr) {
          console.error('[forms] confirm email failed', confErr);
        }
      }

      /* Отдельное согласие на рассылку из калькулятора (галочка в форме).
         Заводим ВТОРУЮ строку с form_key='newsletter' — так подписка живёт по
         общим правилам: свой double opt-in, свой статус, своя отписка. Держать
         согласие флагом внутри строки-лида нельзя: отписка и сводка ищут
         именно строки newsletter.
         Ошибка здесь не валит заявку — расчёт человек уже получил. */
      if (newsletter_optin && sub.email && sub.source === 'forum' && sub.form_key !== 'newsletter') {
        try {
          // Дедуп: повторное согласие не плодит строки и вторые письма.
          const { data: existing } = await supabaseAdmin
            .from('submissions')
            .select('id,status')
            .eq('form_key', 'newsletter')
            .eq('email', sub.email)
            .in('status', ['pending', 'confirmed'])
            .limit(1);

          if (existing && existing.length) {
            console.log('[forms] newsletter optin: уже есть подписка, пропускаем');
          } else {
            const token = randomUUID();
            const subRow = {
              source: sub.source,
              event: sub.event,
              form_key: 'newsletter',
              kind: 'lead',
              role: 'Подписка из калькулятора',
              source_url: sub.source_url,
              email: sub.email,
              name: sub.name,
              consent: true,
              status: 'pending',
              payload: { confirm_token: token, 'Откуда подписка': sub.form_key || 'калькулятор' },
              ...(attrib ? { attrib } : {}),
            };
            const { error: subErr } = await supabaseAdmin.from('submissions').insert(subRow);
            if (subErr) throw new Error(`supabase insert(newsletter): ${subErr.message}`);

            const confirmUrl = confirmLink(
              sub.source_url,
              process.env.PUBLIC_BASE_URL,
              token,
              allowedOrigins()
            );
            const unsubUrl = unsubscribeUrl(
              sub.source_url,
              process.env.PUBLIC_BASE_URL,
              token,
              allowedOrigins()
            );
            await resend().emails.send({
              from: process.env.FORMS_REPORT_FROM || 'Frankenplatz <info@frankenplatz.ch>',
              to: sub.email,
              subject: 'Подтверди подписку · Frankenplatz',
              html: renderConfirmHtml(subRow, confirmUrl),
              text: renderConfirmText(subRow, confirmUrl),
              headers: unsubscribeHeaders(unsubUrl),
            });
          }
        } catch (optinErr) {
          console.error('[forms] newsletter optin failed', optinErr);
        }
      }
    }

    return json({ ok: true, id: data.id });
  } catch (e) {
    console.error('[forms] error', e);
    return json({ ok: false, error: String(e.message || e) }, 500);
  }
}
