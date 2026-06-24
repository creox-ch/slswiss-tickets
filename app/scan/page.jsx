'use client';

import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';

/**
 * Сканер билетов. Открывает камеру, читает QR, дёргает /api/checkin.
 * QR содержит ссылку .../scan?t=TOKEN — выдёргиваем t и проверяем.
 * Работает и при ручном вводе токена (если камеры нет).
 */
export default function ScanPage() {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [last, setLast] = useState(null);     // {result, message, name, event}
  const [busy, setBusy] = useState(false);
  const lastTokenRef = useRef('');

  async function checkToken(token) {
    if (!token || busy) return;
    // антидребезг: не дёргать один и тот же токен подряд
    if (token === lastTokenRef.current && last) return;
    lastTokenRef.current = token;
    setBusy(true);
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      setLast(await res.json());
    } catch {
      setLast({ result: 'error', message: 'сеть недоступна' });
    } finally {
      setBusy(false);
      // через 2.5с разрешаем повторный скан того же
      setTimeout(() => { lastTokenRef.current = ''; }, 2500);
    }
  }

  function extractToken(text) {
    try {
      const u = new URL(text);
      return u.searchParams.get('t') || text;
    } catch {
      return text; // не URL — считаем голым токеном
    }
  }

  async function start() {
    setScanning(true);
    const reader = new BrowserQRCodeReader();
    try {
      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result) => {
          if (result) checkToken(extractToken(result.getText()));
        }
      );
    } catch (e) {
      setLast({ result: 'error', message: 'камера недоступна: ' + e.message });
      setScanning(false);
    }
  }

  function stop() {
    controlsRef.current?.stop();
    setScanning(false);
  }

  useEffect(() => () => controlsRef.current?.stop(), []);

  const palette = {
    ok: '#1b873f', already: '#b78103', not_paid: '#d52b1e',
    invalid: '#d52b1e', error: '#d52b1e',
  };

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 20, fontFamily: 'system-ui' }}>
      <h1 style={{ color: '#d52b1e' }}>Сканер билетов</h1>

      <div style={{ position: 'relative', background: '#000', borderRadius: 12, overflow: 'hidden' }}>
        <video ref={videoRef} style={{ width: '100%', display: scanning ? 'block' : 'none' }} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {!scanning
          ? <button onClick={start} style={btn}>📷 Включить камеру</button>
          : <button onClick={stop} style={{ ...btn, background: '#555' }}>Стоп</button>}
      </div>

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', color: '#666' }}>Ввести код вручную</summary>
        <ManualEntry onSubmit={checkToken} disabled={busy} />
      </details>

      {last && (
        <div style={{
          marginTop: 20, padding: 18, borderRadius: 12, color: '#fff',
          background: palette[last.result] || '#555', textAlign: 'center',
        }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {last.result === 'ok' && '✅ Вход'}
            {last.result === 'already' && '⚠️ Уже входил'}
            {last.result === 'not_paid' && '⛔ Не оплачен'}
            {last.result === 'invalid' && '❌ Невалиден'}
            {last.result === 'error' && '⚠️ Ошибка'}
          </div>
          {last.name && <div style={{ marginTop: 6 }}>{last.name}</div>}
          {last.event && <div style={{ opacity: .85 }}>{last.event}</div>}
          <div style={{ marginTop: 6, fontSize: 13, opacity: .85 }}>{last.message}</div>
        </div>
      )}
    </main>
  );
}

function ManualEntry({ onSubmit, disabled }) {
  const [v, setV] = useState('');
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <input
        value={v} onChange={(e) => setV(e.target.value)}
        placeholder="qr_token"
        style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
      />
      <button onClick={() => onSubmit(v.trim())} disabled={disabled} style={btn}>Проверить</button>
    </div>
  );
}

const btn = {
  flex: 1, padding: '12px 16px', borderRadius: 8, border: 'none',
  background: '#d52b1e', color: '#fff', fontSize: 16, cursor: 'pointer',
};
