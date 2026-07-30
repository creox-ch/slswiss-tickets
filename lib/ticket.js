import QRCode from 'qrcode';
import { Resend } from 'resend';
import { renderForumTicketHtml, renderForumTicketText } from './forms';
import { formatTicketNo, ticketDateTimeLabel, icsDayParam } from './forum-tickets';

// Ленивый Resend — создаётся при первом вызове (в рантайме), не при сборке.
let _resend = null;
function resend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const FROM = process.env.TICKET_FROM_EMAIL || 'SoiLüDi <noreply@slswiss.ch>';
// прод-URL по умолчанию: письмо со ссылкой/картинкой не должно вести на localhost
const SCAN_BASE = process.env.PUBLIC_BASE_URL || 'https://slswiss-tickets.vercel.app';

/** Сгенерить QR как data-URL PNG. Внутри — ссылка на сканер с токеном. */
export async function buildQrDataUrl(qrToken) {
  // Кодируем не голый токен, а проверочную ссылку — удобно сканировать любым телефоном.
  const payload = `${SCAN_BASE}/scan?t=${encodeURIComponent(qrToken)}`;
  return QRCode.toDataURL(payload, { width: 320, margin: 1 });
}

/** name/eventName приходят из формы покупателя — экранируем перед вставкой в HTML. */
export function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Отправить билет на email. Ошибка письма НЕ должна валить оплату — ловим выше. */
export async function sendTicketEmail({ to, name, eventName, qrToken }) {
  const dataUrl = await buildQrDataUrl(qrToken);
  // вложение-PNG как запасной вариант, если клиент блокирует внешние картинки
  const base64 = dataUrl.split(',')[1];
  // основной QR — картинкой по URL (надёжнее cid: открывается во всех почтовиках)
  const qrUrl = `${SCAN_BASE}/api/qr?t=${encodeURIComponent(qrToken)}`;
  const safeName = name ? escapeHtml(name) : '';
  const safeEvent = escapeHtml(eventName);

  return resend().emails.send({
    from: FROM,
    to,
    subject: `Твой билет — ${eventName}`,
    html: `
      <div style="font-family:'Plus Jakarta Sans',Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
        <h2 style="color:#d52b1e">SoiLüDi · Свои люди</h2>
        <p>Привет${safeName ? ', ' + safeName : ''}! Спасибо, оплата прошла.</p>
        <p>Это твой билет на <b>${safeEvent}</b>. Покажи QR на входе — его отсканируют.</p>
        <div style="text-align:center;margin:24px 0">
          <img src="${qrUrl}" alt="QR билета" width="240" height="240" style="width:240px;height:240px"/>
        </div>
        <p style="font-size:13px;color:#666">Код билета: ${qrToken}</p>
        <p style="font-size:12px;color:#999">Если QR не отображается — открой письмо в браузере.</p>
      </div>
    `,
    attachments: [
      {
        filename: 'ticket-qr.png',
        content: base64,
        content_id: 'ticketqr',
      },
    ],
  });
}

/**
 * Письмо-билет форума Frankenplatz (после оплаты). Единый премиум-шаблон
 * (renderForumTicketHtml из lib/forms — тот же, что у писем калькуляторов),
 * плюс QR + вложение. Отдельно от SoiLüDi: свой отправитель. Сканер/чек-ин общие.
 */
export async function sendForumTicketEmail({
  to,
  name,
  qrToken,
  description,
  amountRappen,
  ticketNo,
  product,
}) {
  const dataUrl = await buildQrDataUrl(qrToken);
  const base64 = dataUrl.split(',')[1];
  const qrUrl = `${SCAN_BASE}/api/qr?t=${encodeURIComponent(qrToken)}`;
  // Отправитель — info@ (как все письма форума): письмо-билет прямо зовёт
  // «ответь на это письмо» (возврат/перенос), значит адрес должен принимать ответы.
  const from = process.env.FORUM_TICKET_FROM || 'Frankenplatz <info@frankenplatz.ch>';
  // Человеко-код FP-2026-NNNN из счётчика; если номера нет — запасной короткий из токена.
  const code = formatTicketNo(ticketNo) || `FP-2026-${String(qrToken || '').slice(0, 6).toUpperCase()}`;
  const icsUrl = `${SCAN_BASE}/api/forum/ics?d=${icsDayParam(product)}`;
  const sub = {
    name,
    description,
    amount: amountRappen,
    code,
    dateTime: ticketDateTimeLabel(product),
    icsUrl,
  };

  return resend().emails.send({
    from,
    to,
    replyTo: process.env.FORUM_REPLY_TO || 'info@frankenplatz.ch',
    subject: 'Твой билет · Frankenplatz 2026',
    html: renderForumTicketHtml(sub, qrUrl),
    text: renderForumTicketText(sub),
    attachments: [
      {
        filename: 'frankenplatz-ticket.png',
        content: base64,
        content_id: 'ticketqr',
      },
    ],
  });
}
