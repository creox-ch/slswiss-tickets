'use client';

import { useState } from 'react';
import {
  MAX_PHOTO_BYTES,
  TARGET_LONG_SIDE,
  TARGET_QUALITY,
  ALLOWED_MIME,
  PICKER_ACCEPT,
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
  // Сколько файлов из пачки уже прошло. На телефоне по мобильной сети каждое
  // фото идёт секундами, и без счётчика экран выглядит зависшим.
  const [progress, setProgress] = useState(null);

  /**
   * Загрузка пачки.
   *
   * Каждый файл идёт своей попыткой и **не прерывает остальные**. Раньше первый
   * же сбой ломал всю пачку: 20.08 на айфоне из пяти выбранных фото доехало
   * два — остальные даже не пробовались. Телефон отдаёт файлы капризно (снимок
   * из iCloud может быть не скачан на устройство, Safari экономит память на
   * больших картинках), и это надо переживать, а не сдаваться на первом.
   */
  async function onPick(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // чтобы тот же файл можно было выбрать снова после ошибки
    if (!files.length) return;

    setError('');
    setBusy(true);
    let current = photos;
    const failed = [];
    let limitHit = false;

    for (let i = 0; i < files.length; i++) {
      if (current.length >= MAX_PHOTOS) {
        limitHit = true;
        break;
      }
      setProgress(files.length > 1 ? { done: i, total: files.length } : null);

      const result = await uploadOne(files[i], itemId);
      if (result.ok) {
        current = result.photos;
        setPhotos(current);
      } else {
        failed.push({ name: files[i].name || 'фото', reason: result.error });
      }

      // Короткая пауза между файлами. Движку нужен свободный такт, чтобы
      // отпустить память предыдущего снимка: на айфоне (и в Chrome, который там
      // тоже WebKit, только с более жёстким лимитом на вкладку) третий-четвёртый
      // кадр подряд иначе не декодируется.
      if (i < files.length - 1) await wait(120);
    }

    setProgress(null);
    setBusy(false);

    // Говорим отдельно про каждую судьбу: сколько дошло и что именно не вышло.
    // Общее «не получилось» после частичной загрузки заставляет грузить заново
    // всё, включая уже лежащее.
    if (limitHit) {
      setError(`Больше ${MAX_PHOTOS} фото на вещь не нужно — остальные не добавила.`);
    } else if (failed.length) {
      const names = failed.map((f) => f.name).join(', ');
      const uploaded = files.length - failed.length;
      const head = uploaded ? `Загрузила ${uploaded} из ${files.length}. ` : '';
      setError(`${head}Не вышло: ${names}. ${failed[0].reason}`);
    }
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
            {busy
              ? progress
                ? `Загружаю ${progress.done + 1} из ${progress.total}…`
                : 'Загружаю…'
              : '+ Добавить фото'}
            <input
              type="file"
              accept={PICKER_ACCEPT}
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
        // Про кадрирование говорим заранее: в каталожной сетке карточки держат
        // единый квадрат, и вертикальное фото там обрежется по бокам. В самой
        // карточке вещи фото показывается целиком.
        <p style={S.hint}>
          В списке каталога фото кадрируется в квадрат — держи вещь по центру. Когда покупатель
          откроет карточку, он увидит снимок целиком.
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

/** Пауза между попытками: фото из iCloud успевает догрузиться на устройство. */
const RETRY_DELAYS = [400, 1500];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Один файл: подготовить и отправить, с повтором на «капризных» ошибках.
 *
 * Повторяем только то, что повторять осмысленно: не прочитался файл (типичное
 * для снимков, лежащих в iCloud и не скачанных на телефон) и обрыв сети.
 * Отказ сервера — «слишком тяжёлое», «не тот формат», «уже пять фото» —
 * повтором не лечится, и долбить им сервер незачем.
 */
async function uploadOne(file, itemId) {
  for (let attempt = 0; ; attempt++) {
    let prepared;
    try {
      prepared = await shrink(file);
    } catch (err) {
      if (isTransient(err) && attempt < RETRY_DELAYS.length) {
        await wait(RETRY_DELAYS[attempt]);
        continue;
      }
      return { ok: false, error: prepareErrorText(err) };
    }

    try {
      const form = new FormData();
      form.append('file', prepared, prepared.name);
      const res = await fetch(`/api/market/items/${itemId}/photos`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) return { ok: true, photos: data.photos };
      return { ok: false, error: data.error || 'Сервер не принял фото.' };
    } catch (err) {
      // Сюда попадает только обрыв связи: ответы с ошибкой разобраны выше.
      if (attempt < RETRY_DELAYS.length) {
        await wait(RETRY_DELAYS[attempt]);
        continue;
      }
      return { ok: false, error: 'Связь оборвалась — попробуй ещё раз.' };
    }
  }
}

/** Ошибки, которые проходят сами: файл ещё не на устройстве, память занята. */
function isTransient(err) {
  const name = err && err.name ? String(err.name) : '';
  return name === 'NotReadableError' || name === 'SecurityError' || name === 'AbortError';
}

function prepareErrorText(err) {
  if (isTransient(err)) {
    // Самая частая причина на телефоне — снимок хранится в облаке, а не на
    // устройстве: iCloud с «Оптимизацией хранилища» или Google Фото с
    // освобождённым местом. Браузер такой файл прочитать не может, пока его не
    // скачают. Пишем без названий сервисов: человек не обязан знать, где у него
    // включена синхронизация, ему нужно действие.
    return 'Файл не читается — похоже, фото хранится в облаке, а не на телефоне. Открой его в галерее, дождись полной загрузки и попробуй снова.';
  }
  return 'Не получилось подготовить фото. Попробуй другое.';
}

/**
 * Сжатие через canvas: ужимаем до длинной стороны TARGET_LONG_SIDE и пишем JPEG.
 *
 * Отдаём файл как есть только если он и так годится — и по размеру, и по типу.
 * Проверка типа важна для айфона: HEIC небольшого размера иначе ушёл бы на
 * сервер нетронутым, а там принимаются только JPEG, PNG и WebP.
 */
async function shrink(file) {
  const source = await decode(file);
  const width = source.width;
  const height = source.height;
  const longSide = Math.max(width, height);
  const typeOk = ALLOWED_MIME.includes(file.type);

  if (typeOk && longSide <= TARGET_LONG_SIDE && file.size <= MAX_PHOTO_BYTES) {
    release(source);
    return file;
  }

  const scale = Math.min(1, TARGET_LONG_SIDE / longSide);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  release(source);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', TARGET_QUALITY)
  );
  // Освобождаем сразу: Safari на телефоне держит холсты до сборки мусора, и на
  // третьем-четвёртом снимке подряд памяти уже не хватает.
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('canvas.toBlob вернул пусто');

  const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
}

/**
 * Декодирование картинки: сначала быстрый путь, потом запасной.
 *
 * `createImageBitmap` на телефоне отказывает чаще, чем кажется — на HEIC и на
 * снимках в 12 мегапикселей. Обычный `<img>` в тех же случаях справляется:
 * он декодирует лениво и умеет всё, что умеет показать сам браузер.
 */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // молча уходим на запасной путь — причина видна по итогу
    }
  }
  return decodeViaImg(file);
}

function decodeViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      img._objectUrl = url;
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const err = new Error('img.onerror');
      err.name = 'NotReadableError';
      reject(err);
    };
    img.src = url;
  });
}

/** Отпустить то, что держит декодер: ImageBitmap закрывается, objectURL — отзывается. */
function release(source) {
  if (source && typeof source.close === 'function') source.close();
  if (source && source._objectUrl) URL.revokeObjectURL(source._objectUrl);
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
    // contain, а не cover: превью показывает загруженное целиком. С cover
    // вертикальное фото обрезалось по бокам, и человек решал, что испортился
    // сам файл, — хотя режется только показ.
    objectFit: 'contain',
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
