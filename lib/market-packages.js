/**
 * Каталог пакетов бренд-маркета Frankenplatz (FASHION REBORN) + расчёт заказа.
 *
 * Параллельно билетам форума (lib/forum-tickets), но это ДРУГОЙ продукт: не билет
 * на вход (QR не нужен), а участие в маркете. Цены server-authoritative — клиент
 * шлёт только ВЫБОР пакета, сумму считает сервер. Всё в рапенах (1 CHF = 100),
 * без НДС. Комиссия 12% берётся ОТДЕЛЬНО с реальных продаж, не при оплате пакета.
 *
 * Чистый модуль без сети и env — легко тестировать.
 */

/** Событие для строк маркета в таблице tickets (отличаем от билетов форума). */
export const MARKET_EVENT_SLUG = 'frankenplatz-market-2026';

/**
 * Пакеты (рапены). «Маркет» имеет Early Bird: первым N покупателям — ebPrice.
 * «Первые N» считает вызывающий роут по числу уже оплаченных «market»-строк.
 */
const PACKAGES = {
  online: {
    label: 'Онлайн · Витрина в каталоге',
    price: 8900, // 89 CHF
  },
  market: {
    label: 'Маркет · основной',
    price: 15900, // 159 CHF
    ebPrice: 10900, // первым 20 — 109 CHF
    ebLimit: 20,
  },
  turnkey: {
    label: 'Под ключ',
    price: 24900, // 249 CHF
  },
};

/** Все ключи пакетов. */
export const PACKAGE_KEYS = Object.keys(PACKAGES);

/** Пакет по ключу (для витрины/лимитов) или null. */
export function getPackage(pkg) {
  return PACKAGES[pkg] || null;
}

/** Известен ли пакет. */
export function isValidPackage(pkg) {
  return !!PACKAGES[pkg];
}

/** Есть ли у пакета Early Bird и каков его лимит «первых N» (0 — нет EB). */
export function ebLimitFor(pkg) {
  const p = PACKAGES[pkg];
  return p && p.ebPrice ? p.ebLimit : 0;
}

/**
 * Цена пакета в рапенах. earlyBird=true применяет ebPrice ТОЛЬКО если он есть у
 * пакета (у online/turnkey EB нет — флаг игнорируется). Кидает при неизвестном пакете.
 */
export function packagePriceRappen(pkg, earlyBird) {
  const p = PACKAGES[pkg];
  if (!p) throw new Error('unknown package');
  return earlyBird && p.ebPrice ? p.ebPrice : p.price;
}

/** Человекочитаемое описание заказа — для Payrexx purpose, письма и payload. */
export function describePackage(pkg, earlyBird) {
  const p = PACKAGES[pkg];
  const label = p ? p.label : pkg;
  return earlyBird && p && p.ebPrice ? `${label} · Early Bird` : label;
}
