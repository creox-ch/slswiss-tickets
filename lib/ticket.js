import QRCode from 'qrcode';
import { Resend } from 'resend';

// Ленивый Resend — создаётся при первом вызове (в рантайме), не при сборке.
let _resend = null;
function resend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const FROM = process.env.TICKET_FROM_EMAIL || 'SoiLüDi <noreply@slswiss.ch>';
const SCAN_BASE = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

/** Сгенерить QR как data-URL PNG. Внутри — ссылка на сканер с токеном. */
export async function buildQrDataUrl(qrToken) {
  // Кодируем не голый токен, а проверочную ссылку — удобно сканировать любым телефоном.
  const payload = `${SCAN_BASE}/scan?t=${encodeURIComponent(qrToken)}`;
  return QRCode.toDataURL(payload, { width: 320, margin: 1 });
}

/** Отправить билет на email. Ошибка письма НЕ должна валить оплату — ловим выше. */
export async function sendTicketEmail({ to, name, eventName, qrToken }) {
  const dataUrl = await buildQrDataUrl(qrToken);
  // Resend принимает inline-картинку через cid-вложение
  const base64 = dataUrl.split(',')[1];

  return resend().emails.send({
    from: FROM,
    to,
    subject: `Твой билет — ${eventName}`,
    html: `
      <div style="font-family:'Plus Jakarta Sans',Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
        <h2 style="color:#d52b1e">SoiLüDi · Свои люди</h2>
        <p>Привет${name ? ', ' + name : ''}! Спасибо, оплата прошла.</p>
        <p>Это твой билет на <b>${eventName}</b>. Покажи QR на входе — его отсканируют.</p>
        <div style="text-align:center;margin:24px 0">
          <img src="cid:ticketqr" alt="QR билета" style="width:240px;height:240px"/>
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
