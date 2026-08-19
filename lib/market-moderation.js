/**
 * Модерация вещей: что может сделать организатор и при каких условиях.
 *
 * Шаг 5 ТЗ docs/TZ-market-cabinet.md. Отдельно от market-items намеренно:
 * там действия продавца («сохранить», «отправить», «снять»), здесь — решения
 * модератора, и путать их права нельзя.
 *
 * Чистый модуль: ни сети, ни env.
 */
import { canTransition, canPublish, parsePriceToRappen, MIN_PRICE_RAPPEN, MAX_PRICE_RAPPEN, formatPrice } from './market-items';

/**
 * Решения модератора и статусы, к которым они ведут.
 *
 * approve_online — в каталог, но не на офлайн-маркет: так проходят мидл-бренды
 *                  («онлайн можно всегда, на маркет по отбору»)
 * approve_market — в каталог и на маркет; вещь получит QR-этикетку
 * reject         — не берём (AGB 3.6). Причину требуем: продавцу нужно понять,
 *                  что поправить, а «отказано без объяснений» — не про людей
 * price          — проставить рекомендованную цену, ничего не меняя в статусе
 * edit           — правка полей вещи, статус не меняется
 */
const MODERATION = {
  approve_online: 'approved_online',
  approve_market: 'approved_market',
  reject: 'rejected',
  price: null,
  // По пакету «Под ключ» продаём мы: вещь заводит модератор, описание пишет он
  // же — и поправить свою опечатку должен сам, а не просить продавца, который
  // по условиям пакета не делает ничего. Описания и по остальным пакетам на нас
  // (ТЗ §2, шаг 02), поэтому правка не ограничена одним пакетом.
  edit: null,
};

/** Действия модератора списком — для интерфейса и тестов. */
export const MODERATION_ACTIONS = Object.keys(MODERATION);

/**
 * Разбор решения модератора.
 * @returns {{known: boolean, target: string|null}}
 */
export function resolveModeration(action) {
  const key = action === undefined || action === null ? '' : String(action);
  if (!(key in MODERATION)) return { known: false, target: null };
  return { known: true, target: MODERATION[key] };
}

/**
 * Можно ли применить решение к вещи в этом статусе.
 *
 * Отдельно от canApply продавца: модератор трогает только то, что ему прислали
 * или что уже в каталоге. Черновик чужой вещи он не одобряет — продавец мог не
 * закончить и не хотел показывать её никому.
 */
export function canModerate(currentStatus, target) {
  // Черновик модератору недоступен целиком — включая рекомендованную цену:
  // вещь ещё не прислана, и вмешиваться в неё рано.
  if (currentStatus === 'draft') return false;
  // Проданное не трогаем совсем: на его цене считалась комиссия.
  if (currentStatus === 'sold') return false;
  if (!target) return true; // рекомендованная цена, статус не меняем
  if (target === currentStatus) return true;
  return canTransition(currentStatus, target);
}

/**
 * Проверка решения перед записью.
 *
 * @param {object} input {action, note, recommendedPrice}
 * @param {object} item строка вещи из базы (нужна для проверки готовности)
 * @returns {{ok: boolean, errors: string[], patch: object|null}}
 */
export function validateModeration(input, item) {
  const src = input && typeof input === 'object' ? input : {};
  const { known, target } = resolveModeration(src.action);
  const errors = [];
  const patch = {};

  if (!known) return { ok: false, errors: ['Неизвестное решение.'], patch: null };

  const note = src.note === undefined || src.note === null ? null : String(src.note).trim();

  if (src.action === 'reject') {
    if (!note) {
      errors.push('Напиши причину отказа — продавцу нужно понять, что поправить.');
    } else {
      patch.moderation_note = note.slice(0, 1000);
    }
  } else if (note) {
    // Комментарий можно оставить и при одобрении: «взяли, но фото переснимите».
    patch.moderation_note = note.slice(0, 1000);
  }

  if (src.recommendedPrice !== undefined && src.recommendedPrice !== null && src.recommendedPrice !== '') {
    const price = parsePriceToRappen(src.recommendedPrice);
    if (price === null) {
      errors.push('Рекомендованная цена должна быть числом.');
    } else if (price < MIN_PRICE_RAPPEN || price > MAX_PRICE_RAPPEN) {
      errors.push(
        `Рекомендованная цена вне разумного диапазона (${formatPrice(MIN_PRICE_RAPPEN)}–${formatPrice(MAX_PRICE_RAPPEN)}).`
      );
    } else {
      patch.recommended_price_rappen = price;
    }
  } else if (src.action === 'price') {
    errors.push('Укажи рекомендованную цену.');
  }

  // Одобрять можно только то, что реально готово к показу: у вещи должны быть
  // фото и описание. Модератор видит карточку, но подстраховка нужна — иначе
  // в каталог уедет пустая позиция.
  if (target === 'approved_online' || target === 'approved_market') {
    const ready = canPublish(item);
    if (!ready.ok) errors.push(...ready.errors);
  }

  if (errors.length) return { ok: false, errors, patch: null };

  if (target) patch.status = target;
  if (target === 'approved_online' || target === 'approved_market') {
    patch.published_at = new Date().toISOString();
  }

  return { ok: true, errors: [], patch };
}

/** Человеческое название решения — для письма продавцу и журнала. */
export function describeModeration(action) {
  return (
    {
      approve_online: 'в каталоге',
      approve_market: 'в каталоге и на маркете',
      reject: 'не приняли',
      price: 'рекомендованная цена обновлена',
    }[String(action)] || null
  );
}
