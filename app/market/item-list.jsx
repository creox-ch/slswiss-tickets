'use client';

import { useState } from 'react';
import { CONDITIONS, formatItemNo, formatPrice } from '../../lib/market-items';

/** Как называть статус продавцу: он не должен угадывать, что значит approved_online. */
const STATUS_LABEL = {
  draft: { text: 'Черновик', tone: 'muted' },
  pending: { text: 'На проверке', tone: 'wait' },
  approved_online: { text: 'В каталоге', tone: 'ok' },
  approved_market: { text: 'В каталоге и на маркете', tone: 'ok' },
  rejected: { text: 'Не приняли', tone: 'bad' },
  reserved: { text: 'Забронирована', tone: 'wait' },
  sold: { text: 'Продана', tone: 'ok' },
  withdrawn: { text: 'Снята', tone: 'muted' },
  returned: { text: 'Возвращена', tone: 'muted' },
};

export default function ItemList({ items }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  async function act(id, action) {
    if (busyId) return;
    setBusyId(id);
    setError('');
    try {
      const res =
        action === 'delete'
          ? await fetch(`/api/market/items/${id}`, { method: 'DELETE' })
          : await fetch(`/api/market/items/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action }),
            });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        window.location.reload();
        return;
      }
      setError((data.errors && data.errors.join(' ')) || data.error || 'Не получилось.');
    } catch {
      setError('Сеть недоступна. Попробуй ещё раз.');
    }
    setBusyId(null);
  }

  if (!items.length) {
    return (
      <p style={S.empty}>
        Пока ни одной вещи. Заведи первую — фото можно добавить позже, черновик подождёт.
      </p>
    );
  }

  return (
    <div style={S.wrap}>
      {error && <p style={S.error}>{error}</p>}
      {items.map((item) => {
        const label = STATUS_LABEL[item.status] || { text: item.status, tone: 'muted' };
        const busy = busyId === item.id;
        return (
          <article key={item.id} style={S.card}>
            <div style={S.head}>
              <div>
                <p style={S.brand}>{item.brand}</p>
                <h3 style={S.title}>{item.title}</h3>
              </div>
              <span style={{ ...S.badge, ...TONE[label.tone] }}>{label.text}</span>
            </div>

            <p style={S.meta}>
              {formatItemNo(item.item_no)} · {CONDITIONS[item.condition] || item.condition}
              {item.size ? ` · размер ${item.size}` : ''} · <b>{formatPrice(item.price_rappen)}</b>
            </p>

            {item.status === 'rejected' && item.moderation_note && (
              <p style={S.note}>Причина: {item.moderation_note}</p>
            )}
            {(!item.photos || item.photos.length === 0) && item.status === 'draft' && (
              <p style={S.note}>Нет фото — без него вещь не уйдёт на проверку.</p>
            )}

            <div style={S.actions}>
              <a href={`/market/items/${item.id}/edit`} style={S.link}>
                Изменить
              </a>
              {item.status === 'draft' && (
                <>
                  <button type="button" style={S.small} disabled={busy} onClick={() => act(item.id, 'submit')}>
                    Отправить на проверку
                  </button>
                  <button type="button" style={S.small} disabled={busy} onClick={() => act(item.id, 'delete')}>
                    Удалить
                  </button>
                </>
              )}
              {item.status === 'rejected' && (
                <button type="button" style={S.small} disabled={busy} onClick={() => act(item.id, 'draft')}>
                  Вернуть в черновики
                </button>
              )}
              {['pending', 'approved_online', 'approved_market'].includes(item.status) && (
                <button type="button" style={S.small} disabled={busy} onClick={() => act(item.id, 'withdraw')}>
                  Снять с продажи
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

const TONE = {
  ok: { background: 'rgba(134,224,176,.14)', border: '1px solid rgba(134,224,176,.4)', color: '#B8F0CE' },
  wait: { background: 'rgba(230,180,80,.12)', border: '1px solid rgba(230,180,80,.4)', color: '#F5D9A0' },
  bad: { background: 'rgba(255,120,120,.1)', border: '1px solid rgba(255,120,120,.35)', color: '#FF9B9B' },
  muted: { background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)', color: '#C3B7D4' },
};

const S = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 14 },
  card: {
    background: 'rgba(255,255,255,.04)',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 16,
    padding: '18px 20px',
  },
  head: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  brand: { margin: 0, fontSize: 12.5, letterSpacing: '.08em', textTransform: 'uppercase', color: '#B98BFF' },
  title: { margin: '4px 0 0', fontSize: 17, lineHeight: 1.3 },
  badge: { flex: '0 0 auto', padding: '6px 12px', borderRadius: 999, fontSize: 12.5, whiteSpace: 'nowrap' },
  meta: { margin: '10px 0 0', fontSize: 13.5, color: '#C3B7D4' },
  note: { margin: '8px 0 0', fontSize: 13, color: '#F5D9A0' },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' },
  link: { fontSize: 13.5, color: '#B98BFF' },
  small: {
    padding: '7px 14px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,.2)',
    background: 'transparent',
    color: '#F3EEF9',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  empty: { margin: 0, fontSize: 15, lineHeight: 1.6, color: '#C3B7D4' },
  error: {
    margin: 0,
    padding: '12px 16px',
    borderRadius: 12,
    background: 'rgba(255,120,120,.1)',
    border: '1px solid rgba(255,120,120,.35)',
    color: '#FF9B9B',
    fontSize: 14,
  },
};
