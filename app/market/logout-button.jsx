'use client';

import { useState } from 'react';

/** Выход из кабинета: удаляем cookie и перезагружаем страницу. */
export default function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/market/auth/logout', { method: 'POST' });
    } catch {
      /* даже если запрос не прошёл — перезагрузка покажет актуальное состояние */
    }
    window.location.href = '/market';
  }

  return (
    <button type="button" onClick={logout} disabled={busy} style={style}>
      {busy ? 'Выхожу…' : 'Выйти'}
    </button>
  );
}

const style = {
  flex: '0 0 auto',
  padding: '9px 16px',
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,.2)',
  background: 'transparent',
  color: '#C3B7D4',
  fontSize: 13.5,
  fontFamily: 'inherit',
  cursor: 'pointer',
};
