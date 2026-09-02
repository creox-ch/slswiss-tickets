import { test, expect } from '@playwright/test';
import {
  packagePriceRappen,
  describePackage,
  isValidPackage,
  ebLimitFor,
  getPackage,
  packageRank,
  bestPackage,
  PACKAGE_KEYS,
  MARKET_EVENT_SLUG,
} from '../../lib/market-packages';
import { renderMarketConfirmHtml, renderMarketConfirmText } from '../../lib/forms';

test.describe('каталог пакетов маркета — цены', () => {
  test('обычные цены пакетов (рапены)', () => {
    expect(packagePriceRappen('online', false)).toBe(8900); // 89 CHF
    expect(packagePriceRappen('market', false)).toBe(15900); // 159 CHF
    expect(packagePriceRappen('turnkey', false)).toBe(24900); // 249 CHF
  });

  test('Early Bird только у «Маркет» — 109 CHF для первых N', () => {
    expect(packagePriceRappen('market', true)).toBe(10900); // 109 CHF
    // у online/turnkey EB нет — флаг игнорируется
    expect(packagePriceRappen('online', true)).toBe(8900);
    expect(packagePriceRappen('turnkey', true)).toBe(24900);
  });

  test('доплата за старший пакет догоняет кабинет', () => {
    // Продавец купил «Онлайн», через неделю доплатил за «Маркет». Пока пакет
    // существующей строки не обновлялся, кабинет навсегда оставался на «Онлайн»
    // — человек не видел того, за что заплатил.
    expect(bestPackage('online', 'market')).toBe('market');
    expect(bestPackage('market', 'turnkey')).toBe('turnkey');
  });

  test('покупка младшего пакета ничего не отнимает', () => {
    // Реальный случай 20.08: тестовая покупка «Онлайн» поверх «Маркета».
    // Берём старший, а не последний по времени.
    expect(bestPackage('market', 'online')).toBe('market');
    expect(bestPackage('turnkey', 'online')).toBe('turnkey');
  });

  test('пустой и неизвестный пакет слабее любого настоящего', () => {
    expect(bestPackage(null, 'online')).toBe('online');
    expect(bestPackage('online', null)).toBe('online');
    expect(bestPackage('online', 'нечто')).toBe('online');
    expect(bestPackage(null, null)).toBe(null);
    expect(packageRank('нечто')).toBe(0);
  });

  test('старшинство совпадает с ценой пакета', () => {
    // Если появится четвёртый пакет, эти два порядка не должны разъехаться
    // молча: дороже — значит включает предыдущий.
    const byRank = [...PACKAGE_KEYS].sort((a, b) => packageRank(a) - packageRank(b));
    const byPrice = [...PACKAGE_KEYS].sort(
      (a, b) => packagePriceRappen(a, false) - packagePriceRappen(b, false)
    );
    expect(byRank).toEqual(byPrice);
    expect(byRank.every((k) => packageRank(k) > 0)).toBe(true);
  });

  test('ebLimitFor: только «Маркет» имеет лимит 20', () => {
    expect(ebLimitFor('market')).toBe(20);
    expect(ebLimitFor('online')).toBe(0);
    expect(ebLimitFor('turnkey')).toBe(0);
  });

  test('неизвестный пакет → бросает (роут ответит 400)', () => {
    expect(() => packagePriceRappen('gold')).toThrow(/unknown package/);
  });
});

test.describe('каталог пакетов маркета — метаданные', () => {
  test('isValidPackage: только реальные пакеты', () => {
    expect(isValidPackage('online')).toBe(true);
    expect(isValidPackage('market')).toBe(true);
    expect(isValidPackage('turnkey')).toBe(true);
    expect(isValidPackage('gold')).toBe(false);
    expect(isValidPackage('')).toBe(false);
  });

  test('describePackage — человекочитаемо, EB отражается', () => {
    expect(describePackage('online', false)).toContain('Онлайн');
    expect(describePackage('market', false)).toContain('Маркет');
    expect(describePackage('market', true)).toContain('Early Bird');
    // у online EB нет → флаг не добавляет метку
    expect(describePackage('online', true)).not.toContain('Early Bird');
  });

  test('пакеты и slug на месте', () => {
    expect(PACKAGE_KEYS).toEqual(['online', 'market', 'turnkey']);
    expect(getPackage('market').ebPrice).toBe(10900);
    expect(MARKET_EVENT_SLUG).toBe('frankenplatz-market-2026');
  });
});

test.describe('письмо-подтверждение пакета', () => {
  const sub = { name: 'Аня', description: 'Маркет · основной · Early Bird', amount: 10900 };

  test('HTML: бренд, пакет, сумма, «что дальше», без QR', () => {
    const html = renderMarketConfirmHtml(sub);
    expect(html).toContain('Frankenplatz');
    expect(html).toContain('Ты в деле');
    expect(html).toContain('Маркет · основной · Early Bird');
    expect(html).toContain('109.00 CHF'); // 10900 рапенов
    expect(html).toContain('личный кабинет'); // что дальше — ссылку пришлём письмом
    expect(html).not.toContain('QR'); // это не билет на вход
  });

  // Письмо обещало «кабинет откроется 10 августа»; дата прошла, а письмо продолжало
  // уходить покупателям. Дату открытия не называем, пока она не решена.
  test('в письме нет протухшего обещания даты кабинета', () => {
    const html = renderMarketConfirmHtml(sub);
    const text = renderMarketConfirmText(sub);
    for (const stale of ['10 августа', '10.08']) {
      expect(html).not.toContain(stale);
      expect(text).not.toContain(stale);
    }
  });

  // Шаг 2 кабинета: доступ выдаётся в момент оплаты, а не «отдельным письмом».
  // Ссылка ведёт на страницу входа с подставленным адресом — письмо об оплате
  // открывают и через неделю, а одноразовый токен живёт полчаса.
  test('со ссылкой на кабинет письмо зовёт войти, без неё — обещает письмо', () => {
    const withCabinet = { ...sub, cabinetUrl: 'https://example.test/market?email=a%40b.ch' };
    const html = renderMarketConfirmHtml(withCabinet);
    expect(html).toContain('https://example.test/market?email=a%40b.ch');
    expect(html).toContain('Открыть кабинет продавца');
    expect(html).not.toContain('отдельным письмом');

    const text = renderMarketConfirmText(withCabinet);
    expect(text).toContain('https://example.test/market?email=a%40b.ch');
    expect(text).toContain('Пароль не нужен');

    // Без ссылки поведение прежнее — письмо не обещает того, чего нет.
    expect(renderMarketConfirmHtml(sub)).toContain('отдельным письмом');
  });

  test('HTML экранирует имя (XSS не проходит)', () => {
    const html = renderMarketConfirmHtml({ name: '<script>x</script>', description: 'Онлайн', amount: 8900 });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('text-версия рядом с HTML', () => {
    const text = renderMarketConfirmText(sub);
    expect(text).toContain('Пакет оплачен');
    expect(text).toContain('Маркет · основной · Early Bird');
    expect(text).toContain('109.00 CHF');
    expect(text).toContain('личный кабинет');
  });
});
