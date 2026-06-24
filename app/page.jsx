'use client';

import { useState } from 'react';

/**
 * Минимальная страница покупки билета.
 * Собирает email/имя, дёргает /api/payrexx/create, редиректит на Payrexx.
 */
export default function BuyPage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function buy() {
    setErr(''); setLoading(true);
    try {
      const res = await fetch('/api/payrexx/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventName: 'Тестовое событие', email, name, amount: 1 }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'ошибка создания');
      window.location.href = j.payUrl; // на Payrexx
    } catch (e) {
      setErr(String(e.message || e));
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '40px auto', padding: 20, fontFamily: 'system-ui' }}>
      <h1 style={{ color: '#d52b1e' }}>SoiLüDi · Билет (тест)</h1>
      <p style={{ color: '#666' }}>Тестовая оплата 0.01 CHF. После оплаты придёт письмо с QR.</p>

      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя"
        style={inp} />
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email"
        style={inp} />

      <button onClick={buy} disabled={loading || !email} style={{
        width: '100%', padding: 14, marginTop: 8, borderRadius: 8, border: 'none',
        background: loading ? '#999' : '#d52b1e', color: '#fff', fontSize: 16, cursor: 'pointer',
      }}>
        {loading ? 'Создаём оплату…' : 'Купить билет'}
      </button>

      {err && <p style={{ color: '#d52b1e', marginTop: 12 }}>{err}</p>}
    </main>
  );
}

const inp = {
  width: '100%', padding: 12, marginTop: 10, borderRadius: 8,
  border: '1px solid #ccc', fontSize: 16, boxSizing: 'border-box',
};
