'use client';

import { useState } from 'react';
import { CONDITIONS, formatItemNo, formatPrice, statusLabel } from '../../lib/market-items';
import { COMMISSION_PERCENT, SALE_CHANNELS } from '../../lib/market-commission';

/**
 * Как называть статус продавцу: он не должен угадывать, что значит
 * approved_online. Текст берём из общего словаря — он же уходит в ошибки
 * роутов, и расходиться этим двум местам нельзя. Здесь остаётся только цвет.
 */
const STATUS_TONE = {
  draft: 'muted',
  pending: 'wait',
  approved_online: 'ok',
  approved_market: 'ok',
  rejected: 'bad',
  reserved: 'wait',
  sold: 'ok',
  withdrawn: 'muted',
  returned: 'muted',
};

export default function ItemList({ items }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  // Какая вещь сейчас отмечается проданной. Форму показываем вместо кнопки:
  // цена сделки — основание для счёта, и подтвердить её надо осознанно, а не
  // одним кликом мимо.
  const [saleFor, setSaleFor] = useState(null);

  async function act(id, action, extra) {
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
              body: JSON.stringify({ action, ...(extra || {}) }),
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
        const label = { text: statusLabel(item.status), tone: STATUS_TONE[item.status] || 'muted' };
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

            {item.status === 'sold' && item.sold_price_rappen != null && (
              <p style={S.sale}>
                Продана за <b>{formatPrice(item.sold_price_rappen)}</b>
                {item.sale_channel ? ` · ${SALE_CHANNELS[item.sale_channel] || item.sale_channel}` : ''}
                {item.commission_rappen != null
                  ? ` · комиссия ${formatPrice(item.commission_rappen)}`
                  : ''}
              </p>
            )}
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
              {['approved_online', 'approved_market', 'reserved'].includes(item.status) &&
                saleFor !== item.id && (
                  <button
                    type="button"
                    style={S.small}
                    disabled={busy}
                    onClick={() => setSaleFor(item.id)}
                  >
                    Продана
                  </button>
                )}
              {['pending', 'approved_online', 'approved_market'].includes(item.status) && (
                <button type="button" style={S.small} disabled={busy} onClick={() => act(item.id, 'withdraw')}>
                  Снять с продажи
                </button>
              )}
            </div>

            {saleFor === item.id && (
              <SaleForm
                item={item}
                busy={busy}
                onCancel={() => setSaleFor(null)}
                onConfirm={(sale) => act(item.id, 'sold', sale)}
              />
            )}
          </article>
        );
      })}
    </div>
  );
}

/**
 * Форма отметки о продаже.
 *
 * Цена подставлена из каталога — чаще всего вещь уходит по ней, и лишний ввод
 * не нужен. Но поле открыто: на маркете торгуются, а на горячие позиции бывает
 * аукцион. Комиссию показываем сразу, до подтверждения: продавец должен видеть
 * сумму счёта в тот момент, когда её основание создаёт, а не через неделю.
 *
 * Отметка необратима — статус `sold` конечный, — поэтому кнопка называет
 * действие целиком, а не «ОК».
 */
function SaleForm({ item, busy, onCancel, onConfirm }) {
  const [price, setPrice] = useState(String((item.price_rappen || 0) / 100));
  const [channel, setChannel] = useState('market');

  const rappen = Math.round(Number(String(price).replace(',', '.')) * 100);
  const valid = Number.isFinite(rappen) && rappen > 0;
  const commission = valid ? Math.round((rappen * COMMISSION_PERCENT) / 100) : null;

  return (
    <div style={S.saleBox}>
      <p style={S.saleHint}>
        Отметка о продаже — основание для счёта на комиссию. Изменить её потом нельзя.
      </p>
      <div style={S.saleRow}>
        <label style={S.saleLabel}>
          Цена продажи, CHF
          <input
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={S.saleInput}
          />
        </label>
        <label style={S.saleLabel}>
          Где продана
          <select value={channel} onChange={(e) => setChannel(e.target.value)} style={S.saleInput}>
            {Object.entries(SALE_CHANNELS).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p style={S.saleTotal}>
        {valid ? (
          <>
            Комиссия {COMMISSION_PERCENT}%: <b>{formatPrice(commission)}</b> — выставим счётом
            после маркета.
          </>
        ) : (
          'Укажи цену продажи числом.'
        )}
      </p>
      <div style={S.actions}>
        <button
          type="button"
          style={S.small}
          disabled={busy || !valid}
          onClick={() => onConfirm({ salePrice: price, saleChannel: channel })}
        >
          Подтвердить продажу
        </button>
        <button type="button" style={S.small} disabled={busy} onClick={onCancel}>
          Отмена
        </button>
      </div>
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
  sale: { margin: '8px 0 0', fontSize: 13.5, color: '#86E0B0' },
  saleBox: {
    marginTop: 14,
    padding: '14px 16px',
    borderRadius: 12,
    border: '1px solid rgba(230,180,80,.35)',
    background: 'rgba(230,180,80,.08)',
  },
  saleHint: { margin: 0, fontSize: 12.5, lineHeight: 1.5, color: '#F5D9A0' },
  saleRow: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 },
  saleLabel: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: '#C3B7D4' },
  saleInput: {
    padding: '9px 12px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,.2)',
    background: 'rgba(0,0,0,.25)',
    color: '#F3EEF9',
    fontSize: 15,
    fontFamily: 'inherit',
    minWidth: 160,
  },
  saleTotal: { margin: '12px 0 0', fontSize: 13.5, color: '#F3EEF9' },
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
