import { test, expect } from '@playwright/test';
import { renderMarketQueueHtml, renderMarketQueueText } from '../../lib/forms';
import { adminEmails } from '../../lib/market-auth';

/**
 * Служебное письмо модератору: вещь встала в очередь на проверку.
 *
 * До 20.08 очередь молчала: продавец отправлял вещь и ждал, а мы узнавали об
 * этом, только если случайно открывали /market/admin. Первый живой продавец
 * так и остался бы без ответа, а витрина — без вещи.
 */

const sub = {
  itemLabel: 'FM-2026-0007 — Max Mara · Пальто, шерсть-кашемир',
  sellerEmail: 'seller@example.ch',
  reason: 'new',
  queueUrl: 'https://example.test/market/admin',
};

test.describe('письмо об очереди', () => {
  test('называет вещь, продавца и ведёт в очередь', () => {
    const html = renderMarketQueueHtml(sub);
    expect(html).toContain('FM-2026-0007');
    expect(html).toContain('seller@example.ch');
    expect(html).toContain('https://example.test/market/admin');
  });

  test('различает первую проверку и возврат после правки', () => {
    // Разница не косметическая: во втором случае вещь уже ушла из каталога и
    // висит невидимой — это срочнее, чем новый черновик.
    const first = renderMarketQueueText({ ...sub, reason: 'new' });
    const again = renderMarketQueueText({ ...sub, reason: 'edited' });
    expect(first).toContain('первая проверка');
    expect(first).toContain('Продавец отправил вещь на проверку');
    expect(again).toContain('правка опубликованной вещи');
    expect(again).toContain('ушла из каталога');
    expect(first).not.toBe(again);
  });

  test('письмо служебное — не выглядит письмом продавцу', () => {
    const html = renderMarketQueueHtml(sub);
    const text = renderMarketQueueText(sub);
    expect(html).toContain('Продавцу оно не уходит');
    // «Открыть кабинет» — кнопка письма продавцу; здесь нужна очередь.
    expect(html).not.toContain('Открыть кабинет<');
    expect(text).toContain('Служебное письмо модератора');
  });

  test('подписано маркетом, а не форумом', () => {
    // Общая обёртка зашивала «форум о деньгах · 24–25 октября» — чужая тема и
    // чужая дата для письма про вещь на маркете 27 сентября (см. #45).
    const html = renderMarketQueueHtml(sub);
    expect(html).toContain('FASHION REBORN');
    expect(html).not.toContain('24–25 октября');
  });

  test('пустые поля не рисуют «undefined»', () => {
    const html = renderMarketQueueHtml({ reason: 'new' });
    const text = renderMarketQueueText({ reason: 'new' });
    expect(html).not.toContain('undefined');
    expect(text).not.toContain('undefined');
    expect(text).toContain('Вещь: —');
  });

  test('адресаты письма — те же, кому открыт /market/admin', () => {
    // Один список модераторов на доступ и на уведомления: разойдись они, и
    // письма уходили бы человеку, который очередь открыть не может.
    expect(adminEmails('a@creox.ch, B@Creox.ch')).toEqual(['a@creox.ch', 'b@creox.ch']);
    expect(adminEmails('')).toEqual(['assistant@creox.ch']);
  });
});
