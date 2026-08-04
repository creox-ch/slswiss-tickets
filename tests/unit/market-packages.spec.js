import { test, expect } from '@playwright/test';
import {
  packagePriceRappen,
  describePackage,
  isValidPackage,
  ebLimitFor,
  getPackage,
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

  test('HTML: бренд, пакет, сумма, «что дальше 10 августа», без QR', () => {
    const html = renderMarketConfirmHtml(sub);
    expect(html).toContain('Frankenplatz');
    expect(html).toContain('Ты в деле');
    expect(html).toContain('Маркет · основной · Early Bird');
    expect(html).toContain('109.00 CHF'); // 10900 рапенов
    expect(html).toContain('10 августа'); // кабинет откроется
    expect(html).not.toContain('QR'); // это не билет на вход
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
    expect(text).toContain('10 августа');
  });
});
