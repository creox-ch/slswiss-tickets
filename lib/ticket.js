import QRCode from 'qrcode';
import { Resend } from 'resend';
import {
  renderForumTicketHtml,
  renderForumTicketText,
  renderMarketConfirmHtml,
  renderMarketConfirmText,
  renderMarketLoginHtml,
  renderMarketLoginText,
  renderMarketDecisionHtml,
  renderMarketDecisionText,
  renderMarketQueueHtml,
  renderMarketQueueText,
} from './forms';
import { adminEmails } from './market-auth';
import { formatTicketNo, ticketDateTimeLabel, icsDayParam } from './forum-tickets';
import { formatItemNo, formatPrice } from './market-items';

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
        // camelCase — требование resend 6. Прежний snake_case `content_id` SDK
        // молча выбрасывает: письмо уходит, вложение перестаёт быть inline,
        // и никакая ошибка об этом не скажет. Закреплено тестом.
        contentId: 'ticketqr',
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
        contentId: 'ticketqr', // см. пояснение в sendTicketEmail
      },
    ],
  });
}

/**
 * Письмо-подтверждение пакета бренд-маркета (после оплаты). Не билет — QR/вложения
 * нет. Отправитель info@ (как все письма форума), reply работает. Отдельно от билета.
 */
export async function sendMarketConfirmationEmail({ to, name, description, amountRappen }) {
  const from = process.env.FORUM_TICKET_FROM || 'Frankenplatz <info@frankenplatz.ch>';
  // Ведём в кабинет прямо из письма об оплате: доступ выдаётся в момент покупки.
  // Адрес подставляем в форму входа, чтобы человеку осталось нажать одну кнопку.
  const base = process.env.PUBLIC_BASE_URL || SCAN_BASE;
  const cabinetUrl = to ? `${base}/market?email=${encodeURIComponent(to)}` : `${base}/market`;
  const sub = { name, description, amount: amountRappen, cabinetUrl };
  return resend().emails.send({
    from,
    to,
    replyTo: process.env.FORUM_REPLY_TO || 'info@frankenplatz.ch',
    subject: 'Пакет оплачен · FASHION REBORN',
    html: renderMarketConfirmHtml(sub),
    text: renderMarketConfirmText(sub),
  });
}

/**
 * Письмо со ссылкой для входа в кабинет продавца.
 *
 * Заголовок нарочно узнаваемый: человек только что нажал «прислать ссылку» и
 * ищет письмо глазами в списке. Ошибку отправки роут глотает — иначе по тексту
 * ответа можно было бы отличить «адрес есть в базе» от «адреса нет».
 */
/**
 * Письмо продавцу о решении модератора по вещи.
 *
 * Тема разная по смыслу решения: «вещь в каталоге» и «вещь не приняли» человек
 * должен различать в списке писем, не открывая.
 */
export async function sendMarketDecisionEmail({
  to,
  name,
  action,
  itemNo,
  brand,
  title,
  note,
  recommendedPriceRappen,
}) {
  const from = process.env.FORUM_TICKET_FROM || 'Frankenplatz <info@frankenplatz.ch>';
  const base = process.env.PUBLIC_BASE_URL || SCAN_BASE;
  const label = [formatItemNo(itemNo), [brand, title].filter(Boolean).join(' · ')]
    .filter(Boolean)
    .join(' — ');
  const sub = {
    name,
    action,
    itemLabel: label,
    note,
    recommendedPrice: recommendedPriceRappen ? formatPrice(recommendedPriceRappen) : null,
    cabinetUrl: `${base}/market`,
  };
  const subject =
    action === 'reject'
      ? 'Вещь не приняли · FASHION REBORN'
      : 'Вещь опубликована · FASHION REBORN';

  return resend().emails.send({
    from,
    to,
    replyTo: process.env.FORUM_REPLY_TO || 'info@frankenplatz.ch',
    subject,
    html: renderMarketDecisionHtml(sub),
    text: renderMarketDecisionText(sub),
  });
}

/**
 * Служебное письмо модератору: вещь встала в очередь на проверку.
 *
 * Адресаты — те же, кому открыт `/market/admin` (MARKET_ADMIN_EMAILS), чтобы
 * список модераторов был один и не расходился. Продавцу это письмо не уходит:
 * ему о решении пишет sendMarketDecisionEmail.
 *
 * Reply-To ставим на продавца: чаще всего ответ модератора — это вопрос по вещи
 * («пришли фото бирки»), и его некуда писать, если отвечать самим себе.
 */
export async function sendMarketQueueEmail({ itemNo, brand, title, sellerEmail, reason }) {
  const from = process.env.FORUM_TICKET_FROM || 'Frankenplatz <info@frankenplatz.ch>';
  const base = process.env.PUBLIC_BASE_URL || SCAN_BASE;
  const label = [formatItemNo(itemNo), [brand, title].filter(Boolean).join(' · ')]
    .filter(Boolean)
    .join(' — ');
  const sub = {
    itemLabel: label,
    sellerEmail,
    reason,
    queueUrl: `${base}/market/admin`,
  };
  return resend().emails.send({
    from,
    to: adminEmails(process.env.MARKET_ADMIN_EMAILS),
    replyTo: sellerEmail || process.env.FORUM_REPLY_TO || 'info@frankenplatz.ch',
    subject: 'Вещь на проверку · FASHION REBORN',
    html: renderMarketQueueHtml(sub),
    text: renderMarketQueueText(sub),
  });
}

export async function sendMarketLoginEmail({ to, url, minutes }) {
  const from = process.env.FORUM_TICKET_FROM || 'Frankenplatz <info@frankenplatz.ch>';
  const sub = { url, minutes };
  return resend().emails.send({
    from,
    to,
    replyTo: process.env.FORUM_REPLY_TO || 'info@frankenplatz.ch',
    subject: 'Вход в кабинет продавца · FASHION REBORN',
    html: renderMarketLoginHtml(sub),
    text: renderMarketLoginText(sub),
  });
}
