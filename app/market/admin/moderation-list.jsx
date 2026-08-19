'use client';

import { useState } from 'react';
import { CONDITIONS, CATEGORIES, formatItemNo, formatPrice } from '../../../lib/market-items';
import { photoPublicUrl } from '../../../lib/market-photos';

/**
 * Очередь модерации: карточка вещи целиком, чтобы решение принималось по тому,
 * что увидит покупатель, а не по названию в списке.
 *
 * Отказ требует причины — поле раскрывается по кнопке и без текста не
 * отправляется. Продавцу уходит письмо с этой причиной, и «нам не подошло»
 * там будет выглядеть издевательством.
 */
export default function ModerationList({ items, status = 'pending', supabaseUrl }) {
  const [rows, setRows] = useState(items);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState(null); // id вещи, у которой открыт отказ
  const [note, setNote] = useState('');
  const [price, setPrice] = useState({});
  const [saved, setSaved] = useState(null); // id вещи, у которой только что сохранили цену

  async function act(id, action, extra = {}) {
    if (busyId) return;
    const before = rows.find((r) => r.id === id);
    setBusyId(id);
    setError('');
    setSaved(null);
    try {
      const res = await fetch(`/api/market/admin/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        const next = data.item || null;
        // Из очереди вещь убираем, только если статус действительно сменился, —
        // и только на вкладке, которая отбирает по статусу. «Сохранить цену»
        // статус не трогает: раньше карточка всё равно исчезала, и вещь молча
        // выпадала из виду непроверенной.
        const left = next && before ? next.status !== before.status : true;
        if (left && status !== 'all') {
          setRows((prev) => prev.filter((r) => r.id !== id));
        } else if (next) {
          setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)));
          if (!left) setSaved(id);
        }
        setRejecting(null);
        setNote('');
      } else {
        setError((data.errors && data.errors.join(' ')) || data.error || 'Не получилось.');
      }
    } catch {
      setError('Сеть недоступна.');
    }
    setBusyId(null);
  }

  if (!rows.length) {
    return <p style={S.empty}>Очередь пуста — все вещи разобраны.</p>;
  }

  return (
    <div style={S.wrap}>
      {error && <p style={S.error}>{error}</p>}

      {rows.map((item) => {
        const photos = Array.isArray(item.photos) ? item.photos : [];
        const busy = busyId === item.id;
        return (
          <article key={item.id} style={S.card}>
            <div style={S.head}>
              <div>
                <p style={S.brand}>{item.brand}</p>
                <h3 style={S.title}>{item.title}</h3>
                <p style={S.meta}>
                  {formatItemNo(item.item_no)} · {CATEGORIES[item.category] || item.category} ·{' '}
                  {CONDITIONS[item.condition] || item.condition}
                  {item.size ? ` · ${item.size}` : ''} · <b>{formatPrice(item.price_rappen)}</b>
                  {item.has_docs ? ' · ✓ документы' : ''}
                </p>
                {item.seller && (
                  <p style={S.seller}>
                    {item.seller.name || item.seller.email}
                    {item.seller.package ? ` · пакет «${item.seller.package}»` : ''}
                  </p>
                )}
              </div>
            </div>

            {photos.length > 0 && (
              <div style={S.photos}>
                {photos.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p} src={photoPublicUrl(supabaseUrl, p)} alt="" style={S.photo} />
                ))}
              </div>
            )}

            {item.description_ru && <p style={S.desc}>{item.description_ru}</p>}

            <div style={S.priceRow}>
              <label style={S.label}>
                Рекомендуем цену, CHF
                <input
                  style={S.input}
                  inputMode="decimal"
                  placeholder={
                    item.recommended_price_rappen
                      ? String(item.recommended_price_rappen / 100)
                      : 'например 450'
                  }
                  value={price[item.id] || ''}
                  onChange={(e) => setPrice((p) => ({ ...p, [item.id]: e.target.value }))}
                />
              </label>
              <button
                type="button"
                style={S.small}
                disabled={busy}
                onClick={() => act(item.id, 'price', { recommendedPrice: price[item.id] })}
              >
                Сохранить цену
              </button>
              {saved === item.id && <span style={S.saved}>Цена сохранена</span>}
              <span style={S.hint}>
                От неё зависит гарантия возврата взноса: цена выше рекомендованной её снимает.
              </span>
            </div>

            {rejecting === item.id ? (
              <div style={S.rejectBox}>
                <label style={S.label}>
                  Причина отказа — уйдёт продавцу письмом
                  <textarea
                    style={{ ...S.input, minHeight: 80 }}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Например: масс-маркет, на этот маркет не берём. Люкс и премиум примем с радостью."
                  />
                </label>
                <div style={S.actions}>
                  <button
                    type="button"
                    style={S.danger}
                    disabled={busy || !note.trim()}
                    onClick={() => act(item.id, 'reject', { note })}
                  >
                    Отправить отказ
                  </button>
                  <button
                    type="button"
                    style={S.small}
                    onClick={() => {
                      setRejecting(null);
                      setNote('');
                    }}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div style={S.actions}>
                <button
                  type="button"
                  style={S.gold}
                  disabled={busy}
                  onClick={() => act(item.id, 'approve_market', { recommendedPrice: price[item.id] })}
                >
                  В каталог и на маркет
                </button>
                <button
                  type="button"
                  style={S.ghost}
                  disabled={busy}
                  onClick={() => act(item.id, 'approve_online', { recommendedPrice: price[item.id] })}
                >
                  Только в каталог
                </button>
                <button
                  type="button"
                  style={S.small}
                  disabled={busy}
                  onClick={() => {
                    // Чистим текст на открытии: причина от предыдущей вещи
                    // уходила продавцу этой — и он видел её сразу в почте.
                    setNote('');
                    setRejecting(item.id);
                  }}
                >
                  Не берём
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

const S = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 16 },
  card: {
    background: 'rgba(255,255,255,.04)',
    border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 16,
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  head: { display: 'flex', justifyContent: 'space-between', gap: 12 },
  brand: { margin: 0, fontSize: 12.5, letterSpacing: '.08em', textTransform: 'uppercase', color: '#B98BFF' },
  title: { margin: '4px 0 0', fontSize: 18 },
  meta: { margin: '8px 0 0', fontSize: 13.5, color: '#C3B7D4' },
  seller: { margin: '4px 0 0', fontSize: 13, color: '#7A6C93' },
  photos: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  photo: {
    width: 108,
    height: 135,
    objectFit: 'cover',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,.14)',
  },
  desc: { margin: 0, fontSize: 14.5, lineHeight: 1.6, color: '#E6DEF2' },
  priceRow: { display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: '#C3B7D4', flex: '1 1 200px' },
  input: {
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,.2)',
    background: 'rgba(255,255,255,.06)',
    color: '#fff',
    fontSize: 15,
    fontFamily: 'inherit',
  },
  rejectBox: { display: 'flex', flexDirection: 'column', gap: 10 },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  gold: {
    padding: '11px 18px',
    border: 'none',
    borderRadius: 999,
    fontWeight: 800,
    fontSize: 14,
    color: '#2A1A05',
    background: 'linear-gradient(100deg,#E6B450,#F5C969 60%,#D9A9FF 130%)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  ghost: {
    padding: '10px 16px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,.2)',
    background: 'transparent',
    color: '#F3EEF9',
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  small: {
    padding: '9px 14px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,.16)',
    background: 'transparent',
    color: '#C3B7D4',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  danger: {
    padding: '10px 16px',
    borderRadius: 999,
    border: '1px solid rgba(255,120,120,.4)',
    background: 'rgba(255,120,120,.12)',
    color: '#FF9B9B',
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  hint: { fontSize: 12, lineHeight: 1.5, color: '#7A6C93', flex: '1 1 220px' },
  // Раньше подтверждением служило исчезновение карточки. Теперь она остаётся,
  // и без явного слова непонятно, сохранилось ли.
  saved: { fontSize: 12, color: '#7BC49A', whiteSpace: 'nowrap' },
  empty: { margin: 0, fontSize: 15, color: '#C3B7D4' },
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
