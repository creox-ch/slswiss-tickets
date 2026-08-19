'use client';

import { useState } from 'react';
import { CATEGORIES, CONDITIONS, SEXES, sellerEditRule, statusLabel } from '../../lib/market-items';

/**
 * Форма вещи — общая для создания, правки и заведения за продавца.
 *
 * Две кнопки вместо одной: «сохранить» откладывает вещь недозаполненной,
 * «отправить» проверяет строго. Вещь заводят не за один присест — с одной
 * кнопкой человек либо теряет начатое, либо выдумывает описание, лишь бы
 * пройти проверку.
 *
 * mode='admin' — пакет «Под ключ»: коробку разбирает и заводит модератор,
 * поэтому сверху добавляется адрес продавца, а вещь сразу уходит в очередь
 * на проверку. Поля те же самые: две почти одинаковые формы разъезжаются
 * через месяц, и продавец с модератором начинают видеть разные вещи.
 */
export default function ItemForm({ item = null, mode = 'seller' }) {
  const editing = !!item;
  const forSeller = mode === 'admin';
  // Что можно с вещью в её нынешнем статусе. Модератора это не касается: он
  // правит на месте, вещь никуда не уходит.
  const rule = sellerEditRule(item?.status || 'draft');
  const returnsToQueue = editing && !forSeller && rule.backToPending;
  const locked = editing && !forSeller && !rule.allowed;
  const [values, setValues] = useState(() => ({
    sellerEmail: '',
    sellerName: '',
    brand: item?.brand || '',
    title: item?.title || '',
    category: item?.category || 'clothes',
    sex: item?.sex || 'f',
    condition: item?.condition || 'ideal',
    size: item?.size || '',
    material: item?.material || '',
    color: item?.color || '',
    price: item?.price_rappen ? String(item.price_rappen / 100) : '',
    originalPrice: item?.original_price_rappen ? String(item.original_price_rappen / 100) : '',
    description: item?.description_ru || '',
    hasDocs: !!item?.has_docs,
  }));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  async function save(action) {
    if (busy) return;
    setBusy(true);
    setErrors([]);
    try {
      // Четыре сочетания: продавец заводит / правит, модератор заводит / правит.
      // У модератора правка идёт своим роутом и действием 'edit' — вещь при этом
      // остаётся в том же статусе, на повторную проверку к себе же не уходит.
      const url = forSeller
        ? editing
          ? `/api/market/admin/items/${item.id}`
          : '/api/market/admin/items'
        : editing
          ? `/api/market/items/${item.id}`
          : '/api/market/items';
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, action: forSeller && editing ? 'edit' : action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        // Заведённая за продавца вещь сразу попадает в очередь — там же
        // модератор добавит ей фотографии.
        if (forSeller) {
          window.location.href = '/market/admin';
          return;
        }
        // Новую вещь уводим на её же экран правки: там загрузка фото, без
        // которого вещь всё равно не уйдёт на проверку. В кабинет отправлять
        // бессмысленно — человек тут же вернётся сюда за фото.
        window.location.href = editing ? '/market' : `/market/items/${data.item.id}/edit`;
        return;
      }
      setErrors(data.errors || [data.error || 'Не получилось сохранить.']);
    } catch {
      setErrors(['Сеть недоступна. Попробуй ещё раз чуть позже.']);
    }
    setBusy(false);
  }

  return (
    <form style={S.form} onSubmit={(e) => e.preventDefault()}>
      {locked && (
        // Раньше форма молчала, предлагала «Отправить на проверку» и отвечала
        // отказом уже после нажатия. Честнее сказать заранее.
        <p style={S.locked}>
          Вещь сейчас «{statusLabel(item.status)}» — поля закрыты. {rule.reason}
        </p>
      )}
      {returnsToQueue && (
        <p style={S.warn}>
          Вещь стоит в каталоге. Любая правка вернёт её на проверку, и до нашего одобрения она с
          витрины пропадёт — обычно это быстро, но знать об этом стоит заранее.
        </p>
      )}

      {forSeller && !editing && (
        <Row>
          <Field
            label="E-mail продавца"
            hint="Тот, на который оформлен пакет. Опечатка заведёт вещь новому человеку — проверь по списку оплативших"
          >
            <input
              style={S.input}
              type="email"
              value={values.sellerEmail}
              onChange={set('sellerEmail')}
              placeholder="anna@example.ch"
              required
            />
          </Field>
          <Field label="Имя продавца" hint="Необязательно — если продавца ещё нет в системе">
            <input style={S.input} value={values.sellerName} onChange={set('sellerName')} />
          </Field>
        </Row>
      )}

      <Field label="Бренд" hint="Как на бирке: Max Mara, Gucci, Sandro">
        <input style={S.input} value={values.brand} onChange={set('brand')} required />
      </Field>

      <Field label="Что за вещь" hint="Пальто, сумка Neverfull, лоферы — коротко и понятно">
        <input style={S.input} value={values.title} onChange={set('title')} required />
      </Field>

      <Row>
        <Field label="Категория">
          <select style={S.input} value={values.category} onChange={set('category')}>
            {Object.entries(CATEGORIES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Кому">
          <select style={S.input} value={values.sex} onChange={set('sex')}>
            {Object.entries(SEXES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </Row>

      <Row>
        <Field label="Состояние">
          <select style={S.input} value={values.condition} onChange={set('condition')}>
            {Object.entries(CONDITIONS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Размер" hint="38, M, 39.5 — как указано на вещи">
          <input style={S.input} value={values.size} onChange={set('size')} />
        </Field>
      </Row>

      <Row>
        <Field label="Материал" hint="Шерсть, кожа, кашемир">
          <input style={S.input} value={values.material} onChange={set('material')} />
        </Field>
        <Field label="Цвет">
          <input style={S.input} value={values.color} onChange={set('color')} />
        </Field>
      </Row>

      <Row>
        <Field label="Твоя цена, CHF" hint="Столько получишь при продаже">
          <input
            style={S.input}
            inputMode="decimal"
            value={values.price}
            onChange={set('price')}
            placeholder="590"
            required
          />
        </Field>
        <Field label="Цена в бутике, CHF" hint="Необязательно — покажем как скидку">
          <input
            style={S.input}
            inputMode="decimal"
            value={values.originalPrice}
            onChange={set('originalPrice')}
            placeholder="1290"
          />
        </Field>
      </Row>

      <Field
        label="Описание"
        hint="Состояние, дефекты, как носилась. Честное описание продаёт лучше приукрашенного"
      >
        <textarea style={{ ...S.input, minHeight: 110 }} value={values.description} onChange={set('description')} />
      </Field>

      <label style={S.check}>
        <input type="checkbox" checked={values.hasDocs} onChange={set('hasDocs')} />
        <span>
          Есть чек, сертификат, коробка или карточка подлинности
          <small style={S.small}>
            Это условие гарантии: если вещь не продастся за два маркета, взнос вернём — но только
            при документах и цене не выше рекомендованной.
          </small>
        </span>
      </label>

      {errors.length > 0 && (
        <ul style={S.errors}>
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      <div style={S.actions}>
        {forSeller ? (
          <button type="button" style={S.gold} disabled={busy} onClick={() => save('save')}>
            {busy ? 'Сохраняю…' : editing ? 'Сохранить правку' : 'Завести вещь и добавить фото'}
          </button>
        ) : locked ? null : returnsToQueue ? (
          // У вещи в каталоге «черновика» уже нет: правка так и так уводит её
          // на проверку. Две кнопки здесь врали бы обе.
          <button type="button" style={S.gold} disabled={busy} onClick={() => save('save')}>
            {busy ? 'Сохраняю…' : 'Сохранить и отправить на проверку'}
          </button>
        ) : editing ? (
          <>
            <button type="button" style={S.gold} disabled={busy} onClick={() => save('submit')}>
              {busy ? 'Сохраняю…' : 'Отправить на проверку'}
            </button>
            <button type="button" style={S.ghost} disabled={busy} onClick={() => save('save')}>
              Сохранить черновик
            </button>
          </>
        ) : (
          // На новой вещи «отправить» кнопки нет намеренно: фото добавляются на
          // следующем экране, а без фото проверка всё равно вернёт ошибку —
          // предлагать заведомо неработающее действие нечестно.
          <button type="button" style={S.gold} disabled={busy} onClick={() => save('save')}>
            {busy ? 'Сохраняю…' : 'Сохранить и добавить фото'}
          </button>
        )}
      </div>
      <p style={S.hint}>
        {forSeller
          ? editing
            ? 'Правка не меняет статус вещи: если она в каталоге, там и останется — уже с новыми полями.'
            : 'Вещь встанет в очередь на проверку. Фотографии добавишь там же, в карточке — без них одобрить её нельзя.'
          : editing
            ? 'Фото добавляются выше — минимум одно, иначе вещь не уйдёт на проверку.'
            : 'Сохрани черновик — на следующем экране появится загрузка фото. Без фото вещь на проверку не уйдёт.'}
      </p>
    </form>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={S.field}>
      <span style={S.label}>{label}</span>
      {children}
      {hint && <small style={S.small}>{hint}</small>}
    </label>
  );
}

function Row({ children }) {
  return <div style={S.row}>{children}</div>;
}

const S = {
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  row: { display: 'flex', gap: 14, flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 200px' },
  label: { fontSize: 13.5, color: '#C3B7D4' },
  // display:block обязателен: <small> инлайновый, и подсказка про гарантию
  // возврата шла впритык к подписи чекбокса — «…подлинностиЭто условие».
  small: { display: 'block', marginTop: 4, fontSize: 12, lineHeight: 1.5, color: '#7A6C93' },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,.2)',
    background: 'rgba(255,255,255,.06)',
    color: '#fff',
    fontSize: 16,
    fontFamily: 'inherit',
  },
  check: { display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: '#E6DEF2' },
  actions: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 },
  gold: {
    padding: '14px 22px',
    border: 'none',
    borderRadius: 999,
    fontWeight: 800,
    fontSize: 15,
    color: '#2A1A05',
    background: 'linear-gradient(100deg,#E6B450,#F5C969 60%,#D9A9FF 130%)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  ghost: {
    padding: '13px 20px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,.2)',
    background: 'transparent',
    color: '#F3EEF9',
    fontSize: 14.5,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  errors: {
    margin: 0,
    padding: '12px 16px 12px 32px',
    borderRadius: 12,
    background: 'rgba(255,120,120,.1)',
    border: '1px solid rgba(255,120,120,.35)',
    color: '#FF9B9B',
    fontSize: 14,
    lineHeight: 1.6,
  },
  hint: { margin: 0, fontSize: 12.5, lineHeight: 1.55, color: '#7A6C93' },
  warn: {
    margin: 0,
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid rgba(245,201,105,.35)',
    background: 'rgba(245,201,105,.08)',
    fontSize: 13.5,
    lineHeight: 1.55,
    color: '#F0DDB4',
  },
  locked: {
    margin: 0,
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid rgba(255,138,128,.35)',
    background: 'rgba(255,138,128,.08)',
    fontSize: 13.5,
    lineHeight: 1.55,
    color: '#F2C8C3',
  },
};
