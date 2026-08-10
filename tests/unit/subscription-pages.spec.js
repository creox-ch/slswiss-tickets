/**
 * Страницы подписки — то, что человек видит после клика в письме.
 *
 * Состояния, метод отписки и экранирование токена уже покрыты в forms.spec.js.
 * Здесь — только то, что добавила новая вёрстка: иллюстрация, контакты в
 * подвале и правила, по которым мы показываем (или не показываем) ссылки.
 */
import { test, expect } from '@playwright/test';
import { confirmPageHtml, unsubscribePageHtml } from '../../lib/forms.js';

const SITE = 'https://frankenplatz.ch';

test.describe('страницы подписки — оформление', () => {
  test('подтверждено: иллюстрация, контакты, дорога дальше', () => {
    const html = confirmPageHtml('confirmed', SITE);
    expect(html).toContain('site/img/'); // иллюстрация
    expect(html).toContain('info@frankenplatz.ch');
    expect(html).toContain('instagram.com/frankenplatz.ch');
    expect(html).toContain(`${SITE}/tickets`);
  });

  test('на ошибочных состояниях не зовём покупать билет', () => {
    // «Ссылка недействительна» + золотая кнопка «Посмотреть билеты» читалась бы
    // как подмена: человек шёл подтверждать подписку, а ему продают.
    expect(confirmPageHtml('invalid', SITE)).not.toContain('Посмотреть билеты');
    expect(confirmPageHtml('unsubscribed', SITE)).not.toContain('Посмотреть билеты');
  });

  test('чужой сайт: не показываем ссылки на разделы форума', () => {
    // Двойное подтверждение сейчас только у форума, но функция общая:
    // на другой площадке /tickets и /calculators не существуют.
    const html = confirmPageHtml('confirmed', 'https://chudina.me');
    expect(html).toContain('https://chudina.me');
    expect(html).not.toContain('https://chudina.me/calculators');
    expect(html).not.toContain('https://chudina.me/tickets');
  });

  test('хвостовой слэш в адресе не даёт двойного', () => {
    expect(confirmPageHtml('confirmed', 'https://frankenplatz.ch/')).not.toContain('frankenplatz.ch//');
  });

  test('страница отписки — тот же подвал с контактами', () => {
    expect(unsubscribePageHtml('done', { site: SITE })).toContain('info@frankenplatz.ch');
    expect(unsubscribePageHtml('ask', { token: 'abc', site: SITE })).toContain('Остаться и вернуться на сайт');
  });
});
