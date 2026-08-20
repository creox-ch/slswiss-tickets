/**
 * Фиксация сделки и комиссия.
 *
 * Комиссия 12% берётся не с платежа: чужих денег мы не принимаем (решение
 * 17.08), покупатель платит продавцу напрямую. Единственное основание для счёта
 * — отметка о продаже в кабинете (AGB 5.5, 5.6). Значит эта отметка и есть
 * учётный документ, и относиться к ней надо соответственно: цена проверяется,
 * дата фиксируется, задним числом продавец её не правит (SELLER_EDIT в
 * lib/market-items.js запирает поля проданной вещи).
 *
 * Чистый модуль: ни сети, ни БД.
 */

import { MIN_PRICE_RAPPEN, MAX_PRICE_RAPPEN, formatPrice } from './market-items';

/** Ставка комиссии в процентах. Обещана на brand-market.html и в AGB 5.7. */
export const COMMISSION_PERCENT = 12;

/** Где состоялась сделка. Влияет только на отчётность, не на ставку. */
export const SALE_CHANNELS = {
  market: 'На маркете',
  online: 'По каталогу',
};

/** Кто отметил сделку: сам продавец или мы за него (пакет «Под ключ»). */
export const SALE_ACTORS = ['seller', 'admin'];

/**
 * Комиссия с одной сделки, в рапенах.
 *
 * Округляем к ближайшему рапену: считать доли рапена в счёте бессмысленно,
 * а систематическое округление вниз — это подарок в нашу пользу или в пользу
 * продавца, смотря куда. Math.round честнее обеих крайностей.
 */
export function commissionRappen(salePriceRappen) {
  const price = Number(salePriceRappen);
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.round((price * COMMISSION_PERCENT) / 100);
}

/**
 * Разбор цены продажи из формы.
 *
 * Продавец вправе продать дешевле витрины — на маркете торгуются, и это
 * нормально. Дороже тоже бывает: страница обещает аукцион на горячие позиции.
 * Поэтому верхнюю границу не привязываем к цене каталога, а берём общую
 * границу цен: то, что выше, — почти наверняка лишний ноль.
 *
 * @returns {{ok: true, value: number} | {ok: false, error: string}}
 */
export function parseSalePrice(input, { catalogPriceRappen } = {}) {
  const raw = String(input ?? '').trim().replace(/['\s]/g, '').replace(',', '.');
  if (!raw) {
    // Пустое поле — не ошибка ввода, а согласие с ценой каталога.
    const fallback = Number(catalogPriceRappen);
    if (Number.isFinite(fallback) && fallback > 0) return { ok: true, value: Math.round(fallback) };
    return { ok: false, error: 'Укажи, за сколько продана вещь.' };
  }

  const chf = Number(raw);
  if (!Number.isFinite(chf)) return { ok: false, error: 'Цена продажи — числом, например 350.' };

  const rappen = Math.round(chf * 100);
  if (rappen < MIN_PRICE_RAPPEN) {
    return { ok: false, error: `Цена продажи не может быть меньше ${formatPrice(MIN_PRICE_RAPPEN)}.` };
  }
  if (rappen > MAX_PRICE_RAPPEN) {
    return { ok: false, error: 'Проверь цену продажи — похоже на лишний ноль.' };
  }
  return { ok: true, value: rappen };
}

/** Канал сделки из формы; по умолчанию — маркет. */
export function parseSaleChannel(input) {
  const key = String(input ?? '').trim() || 'market';
  return key in SALE_CHANNELS ? { ok: true, value: key } : { ok: false, error: 'Выбери, где продана вещь.' };
}

/**
 * Полный разбор отметки о продаже. Одна функция на оба входа — кабинет продавца
 * и «Под ключ» у модератора, — чтобы правила фиксации не разошлись между ними.
 */
export function buildSale(body, { catalogPriceRappen, actor = 'seller', now = new Date() } = {}) {
  const price = parseSalePrice(body && body.salePrice, { catalogPriceRappen });
  if (!price.ok) return { ok: false, error: price.error };

  const channel = parseSaleChannel(body && body.saleChannel);
  if (!channel.ok) return { ok: false, error: channel.error };

  return {
    ok: true,
    value: {
      sold_price_rappen: price.value,
      sale_channel: channel.value,
      commission_rappen: commissionRappen(price.value),
      sold_by: SALE_ACTORS.includes(actor) ? actor : 'seller',
      sold_at: new Date(now).toISOString(),
    },
  };
}

/**
 * Сводка по списку проданных вещей — то, из чего выставляется счёт.
 *
 * Считаем по строкам, а не одним умножением от суммы: комиссия каждой сделки
 * округляется отдельно, и сумма округлений не равна округлению суммы. Счёт
 * должен сходиться построчно, иначе продавец пересчитает и не сойдётся.
 */
export function summarizeSales(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let gross = 0;
  let commission = 0;
  for (const row of list) {
    const price = Number(row && row.sold_price_rappen) || 0;
    gross += price;
    commission +=
      Number.isFinite(Number(row && row.commission_rappen)) && row.commission_rappen != null
        ? Number(row.commission_rappen)
        : commissionRappen(price);
  }
  return { count: list.length, gross, commission, net: gross - commission };
}
