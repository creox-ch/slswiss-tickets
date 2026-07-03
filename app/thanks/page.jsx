/**
 * Страница после успешной оплаты (successRedirectUrl из Payrexx Gateway).
 * Билет создаёт вебхук, он может отстать от редиректа на пару секунд —
 * поэтому обещаем письмо «в течение пары минут», а не мгновенно.
 */
export const metadata = { title: 'Спасибо — SoiLüDi' };

export default function ThanksPage() {
  return (
    <main style={{ maxWidth: 420, margin: '40px auto', padding: 20, fontFamily: 'system-ui', textAlign: 'center' }}>
      <div style={{ fontSize: 56 }}>✅</div>
      <h1 style={{ color: '#d52b1e' }}>Спасибо, оплата прошла!</h1>
      <p style={{ color: '#333', fontSize: 17 }}>
        Билет с QR-кодом придёт на твой email в течение пары минут.
      </p>
      <p style={{ color: '#666', fontSize: 14 }}>
        Не пришло? Проверь папку «Спам» — письмо от SoiLüDi (noreply@slswiss.ch).
      </p>
    </main>
  );
}
