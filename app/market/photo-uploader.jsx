'use client';

import { useState } from 'react';
import {
  MAX_PHOTO_BYTES,
  TARGET_LONG_SIDE,
  TARGET_QUALITY,
  ALLOWED_MIME,
  photoPublicUrl,
} from '../../lib/market-photos';
import { MAX_PHOTOS } from '../../lib/market-items';

/**
 * Загрузка фото вещи.
 *
 * Картинку сжимаем в браузере перед отправкой: снимок с телефона весит 3–8 МБ,
 * а в каталоге показывается максимум в ~800px. Без сжатия несколько продавцов
 * с айфонами съедят бесплатный Storage за вечер, а загрузка по мобильной сети
 * будет мучительной.
 */
export default function PhotoUploader({ itemId, initialPhotos = [], supabaseUrl }) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onPick(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // чтобы тот же файл можно было выбрать снова после ошибки
    if (!files.length) return;

    setError('');
    setBusy(true);
    let current = photos;

    for (const file of files) {
      if (current.length >= MAX_PHOTOS) {
        setError(`Больше ${MAX_PHOTOS} фото на вещь не нужно.`);
        break;
      }
      try {
        const prepared = await shrink(file);
        const form = new FormData();
        form.append('file', prepared, prepared.name);
        const res = await fetch(`/api/market/items/${itemId}/photos`, {
          method: 'POST',
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          current = data.photos;
          setPhotos(current);
        } else {
          setError(data.error || 'Не получилось загрузить фото.');
          break;
        }
      } catch (err) {
        setError('Не удалось подготовить файл. Попробуй другое фото.');
        break;
      }
    }
    setBusy(false);
  }

  async function remove(path) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/market/items/${itemId}/photos`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) setPhotos(data.photos);
      else setError(data.error || 'Не получилось удалить фото.');
    } catch {
      setError('Сеть недоступна.');
    }
    setBusy(false);
  }

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <span style={S.label}>
          Фото · {photos.length} из {MAX_PHOTOS}
        </span>
        {photos.length < MAX_PHOTOS && (
          <label style={S.add}>
            {busy ? 'Загружаю…' : '+ Добавить фото'}
            <input
              type="file"
              accept={ALLOWED_MIME.join(',')}
              multiple
              onChange={onPick}
              disabled={busy}
              style={{ display: 'none' }}
            />
          </label>
        )}
      </div>

      {photos.length === 0 && (
        <p style={S.hint}>
          Хотя бы одно фото обязательно: без него вещь не уйдёт на проверку. Снимай при дневном
          свете, добавь кадр бирки и всех дефектов — честное фото продаёт лучше приукрашенного.
        </p>
      )}

      {photos.length > 0 && (
        <div style={S.grid}>
          {photos.map((path) => (
            <figure key={path} style={S.thumb}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoPublicUrl(supabaseUrl, path)} alt="" style={S.img} />
              <button type="button" style={S.remove} disabled={busy} onClick={() => remove(path)}>
                Удалить
              </button>
            </figure>
          ))}
        </div>
      )}

      {error && <p style={S.error}>{error}</p>}
    </div>
  );
}

/**
 * Сжатие через canvas: ужимаем до длинной стороны TARGET_LONG_SIDE и пишем JPEG.
 * Файлы меньше лимита и без лишних пикселей отдаём как есть — незачем
 * перекодировать то, что и так в порядке.
 */
async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const longSide = Math.max(bitmap.width, bitmap.height);
  if (longSide <= TARGET_LONG_SIDE && file.size <= MAX_PHOTO_BYTES) {
    bitmap.close?.();
    return file;
  }

  const scale = Math.min(1, TARGET_LONG_SIDE / longSide);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', TARGET_QUALITY)
  );
  if (!blob) throw new Error('canvas.toBlob вернул пусто');

  const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
}

const S = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  label: { fontSize: 13.5, color: '#C3B7D4' },
  add: { fontSize: 14, color: '#F5C969', cursor: 'pointer' },
  hint: { margin: 0, fontSize: 12.5, lineHeight: 1.55, color: '#7A6C93' },
  grid: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  thumb: { margin: 0, width: 120, display: 'flex', flexDirection: 'column', gap: 6 },
  img: {
    width: 120,
    height: 150,
    objectFit: 'cover',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,.14)',
    background: 'rgba(255,255,255,.04)',
  },
  remove: {
    padding: '5px 10px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,.2)',
    background: 'transparent',
    color: '#C3B7D4',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  error: {
    margin: 0,
    padding: '10px 14px',
    borderRadius: 12,
    background: 'rgba(255,120,120,.1)',
    border: '1px solid rgba(255,120,120,.35)',
    color: '#FF9B9B',
    fontSize: 13.5,
  },
};
