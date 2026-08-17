'use client';

import { useState } from 'react';

/**
 * Форма «пришлите ссылку для входа». Ответ роута одинаковый для всех адресов,
 * поэтому и здесь показываем один и тот же текст: по экрану нельзя понять,
 * зарегистрирован адрес или нет.
 */
export default function LoginForm({ initialEmail = '' }) {
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  const [message, setMessage] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (state === 'sending') return;
    setState('sending');
    setMessage('');
    try {
      const res = await fetch('/api/market/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setState('sent');
        setMessage(data.message || 'Письмо со ссылкой отправлено.');
      } else {
        setState('error');
        setMessage(data.error || 'Не получилось. Попробуй ещё раз.');
      }
    } catch {
      setState('error');
      setMessage('Сеть недоступна. Попробуй ещё раз чуть позже.');
    }
  }

  if (state === 'sent') {
    return (
      <div style={S.card}>
        <p style={{ ...S.text, marginTop: 0 }}>📬 {message}</p>
        <p style={S.hint}>
          Ссылка одноразовая и действует 30 минут. Не пришло за пару минут — проверь «Спам»
          или запроси ещё раз.
        </p>
        <button type="button" style={S.ghost} onClick={() => setState('idle')}>
          Ввести другой адрес
        </button>
      </div>
    );
  }

  return (
    <form style={S.card} onSubmit={submit}>
      <label htmlFor="mk-email" style={S.label}>
        E-mail, на который оформлен пакет
      </label>
      <input
        id="mk-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="anna@example.ch"
        style={S.input}
      />
      <button type="submit" style={S.gold} disabled={state === 'sending'}>
        {state === 'sending' ? 'Отправляю…' : 'Прислать ссылку для входа'}
      </button>
      <p style={S.hint}>Пароль не нужен: пришлём ссылку, по ней и войдёшь.</p>
      {state === 'error' && <p style={S.error}>{message}</p>}
    </form>
  );
}

const S = {
  card: {
    background: 'rgba(255,255,255,.04)',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 18,
    padding: '26px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  label: { fontSize: 13.5, color: '#C3B7D4' },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '13px 15px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,.2)',
    background: 'rgba(255,255,255,.06)',
    color: '#fff',
    fontSize: 16,
    fontFamily: 'inherit',
  },
  gold: {
    padding: '14px 20px',
    border: 'none',
    borderRadius: 999,
    fontWeight: 800,
    fontSize: 15,
    color: '#2A1A05',
    background: 'linear-gradient(100deg,#E6B450,#F5C969 60%,#D9A9FF 130%)',
    cursor: 'pointer',
  },
  ghost: {
    padding: '11px 18px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,.2)',
    background: 'transparent',
    color: '#F3EEF9',
    fontSize: 14,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  text: { fontSize: 15.5, lineHeight: 1.6, color: '#F3EEF9' },
  hint: { margin: 0, fontSize: 12.5, lineHeight: 1.55, color: '#7A6C93' },
  error: { margin: 0, fontSize: 13.5, color: '#FF9B9B' },
};
