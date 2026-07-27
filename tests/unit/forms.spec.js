import { test, expect } from '@playwright/test';
import {
  normalizeSubmission,
  normalizeEmail,
  renderNotificationHtml,
  renderReportHtml,
  renderReportText,
  renderRegistrationHtml,
  renderRegistrationText,
  renderSpeakerHtml,
  renderSpeakerText,
  renderConfirmHtml,
  renderConfirmText,
  confirmPageHtml,
  confirmLink,
  unsubscribeUrl,
  unsubscribeHeaders,
  unsubscribePageHtml,
  withUtm,
  renderTestsHtml,
  renderDigestHtml,
  allowedOrigins,
  notifyEmailFor,
  parseNotifyMap,
  shouldNotifyImmediately,
  DEFAULT_ORIGINS,
  DEFAULT_NOTIFY_EMAIL,
  MIN_FILL_MS,
} from '../../lib/forms';

test.describe('normalizeSubmission', () => {
  test('требует source', () => {
    expect(() => normalizeSubmission({})).toThrow(/source is required/);
    expect(() => normalizeSubmission({ source: '   ' })).toThrow(/source is required/);
  });

  test('нормализует контакт и источник, тянет поля из contact и fields', () => {
    const out = normalizeSubmission({
      source: 'Chudina',
      form_key: 'team',
      source_url: 'https://chudina.me/team.html',
      role: 'IT-практикант',
      contact: { name: '  Аня  ', email: 'Anya@Example.COM', telegram: '@anya' },
      fields: { Занятость: '40%', Стек: 'React' },
    });
    expect(out.source).toBe('chudina'); // lowercase
    expect(out.form_key).toBe('team');
    expect(out.role).toBe('IT-практикант');
    expect(out.name).toBe('Аня'); // trimmed
    expect(out.email).toBe('anya@example.com'); // lowercase
    expect(out.telegram).toBe('@anya');
    expect(out.payload).toEqual({ Занятость: '40%', Стек: 'React' });
    expect(out.kind).toBe('application'); // default
    expect(out.tests).toBeNull();
  });

  test('пустые поля → null, payload по умолчанию {}', () => {
    const out = normalizeSubmission({ source: 'forum', email: '' });
    expect(out.email).toBeNull();
    expect(out.name).toBeNull();
    expect(out.payload).toEqual({});
  });

  test('honeypot прокидывается для отсечки ботов', () => {
    const out = normalizeSubmission({ source: 'chudina', hp: 'i-am-a-bot' });
    expect(out.hp).toBe('i-am-a-bot');
  });

  test('слишком большой payload отвергается', () => {
    const big = { blob: 'x'.repeat(25000) };
    expect(() => normalizeSubmission({ source: 'chudina', payload: big })).toThrow(
      /payload too large/
    );
  });

  test('tests сохраняются как объект', () => {
    const out = normalizeSubmission({
      source: 'chudina',
      tests: { maddi: { total: 80 } },
    });
    expect(out.tests).toEqual({ maddi: { total: 80 } });
  });

  test('consent: true только при явном согласии', () => {
    expect(normalizeSubmission({ source: 'chudina', consent: true }).consent).toBe(true);
    expect(normalizeSubmission({ source: 'chudina', consent: 'true' }).consent).toBe(true);
    expect(normalizeSubmission({ source: 'chudina' }).consent).toBe(false);
    expect(normalizeSubmission({ source: 'chudina', consent: false }).consent).toBe(false);
    expect(normalizeSubmission({ source: 'chudina', consent: 'on' }).consent).toBe(false);
  });

  test('elapsed_ms парсится в число, мусор → null', () => {
    expect(normalizeSubmission({ source: 'chudina', elapsed_ms: 4200 }).elapsed_ms).toBe(4200);
    expect(normalizeSubmission({ source: 'chudina', elapsed_ms: '4200' }).elapsed_ms).toBe(4200);
    expect(normalizeSubmission({ source: 'chudina' }).elapsed_ms).toBeNull();
    expect(normalizeSubmission({ source: 'chudina', elapsed_ms: 'x' }).elapsed_ms).toBeNull();
  });
});

test.describe('маршрутизация уведомлений по сайту', () => {
  const MAP = 'forum=info@frankenplatz.ch, chudina=main@chudina.me';

  test('адрес выбирается по source', () => {
    expect(notifyEmailFor('forum', MAP, 'fallback@x.ch')).toBe('info@frankenplatz.ch');
    expect(notifyEmailFor('chudina', MAP, 'fallback@x.ch')).toBe('main@chudina.me');
    expect(notifyEmailFor('FORUM', MAP, 'fallback@x.ch')).toBe('info@frankenplatz.ch'); // регистр
  });

  test('нет в карте → общий ящик, нет и его → дефолт', () => {
    expect(notifyEmailFor('creox', MAP, 'fallback@x.ch')).toBe('fallback@x.ch');
    expect(notifyEmailFor('creox', MAP, '')).toBe(DEFAULT_NOTIFY_EMAIL);
    expect(notifyEmailFor('forum', '', 'fallback@x.ch')).toBe('fallback@x.ch');
    expect(notifyEmailFor(null, null, null)).toBe(DEFAULT_NOTIFY_EMAIL);
  });

  test('кривая карта не роняет уведомления', () => {
    expect(parseNotifyMap('мусор,=,a=,=b')).toEqual({});
    expect(parseNotifyMap('forum=a@b.ch,,мусор')).toEqual({ forum: 'a@b.ch' });
  });

  test('подписки не шлём поштучно, остальное — шлём', () => {
    expect(shouldNotifyImmediately({ form_key: 'newsletter' })).toBe(false);
    expect(shouldNotifyImmediately({ form_key: 'speaker' })).toBe(true);
    expect(shouldNotifyImmediately({ form_key: 'calc-pension' })).toBe(true);
    expect(shouldNotifyImmediately({})).toBe(true);
  });
});

test.describe('письмо ранней регистрации', () => {
  test('честно говорит, что это не билет, и перечисляет выбор', () => {
    const html = renderRegistrationHtml({
      source: 'forum', form_key: 'registration', name: 'Аня', email: 'a@b.ch',
      payload: { 'Интересует': 'Оба дня', 'Мест': '2' },
    });
    expect(html).toContain('Аня');
    expect(html).toContain('ещё не билет');
    expect(html).toContain('Оба дня');
    expect(html).toContain('frankenplatz.ch');
  });

  test('без имени письмо не ломается', () => {
    const html = renderRegistrationHtml({ form_key: 'registration', email: 'a@b.ch', payload: {} });
    expect(html).toContain('Привет!');
    expect(html).toContain('ранней регистрации');
  });

  test('экранирует пользовательский ввод', () => {
    const html = renderRegistrationHtml({
      name: '<script>alert(1)</script>',
      payload: { '<img onerror=x>': '<b>bad</b>' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img onerror=x>');
    expect(html).toContain('&lt;script&gt;');
  });
});

test.describe('письмо спикеру', () => {
  test('подтверждает получение и обещает срок ответа', () => {
    const html = renderSpeakerHtml({
      form_key: 'speaker', name: 'Пётр', email: 'p@b.ch',
      payload: { 'Тема': 'Пенсия для поздних мигрантов', 'День': 'День 1' },
    });
    expect(html).toContain('Пётр');
    expect(html).toContain('Анкета спикера получена');
    expect(html).toContain('в течение недели');
    expect(html).toContain('Пенсия для поздних мигрантов');
  });

  test('без имени и без payload не ломается', () => {
    const html = renderSpeakerHtml({ form_key: 'speaker', email: 'p@b.ch' });
    expect(html).toContain('Спасибо!');
    expect(html).toContain('в течение недели');
  });

  test('экранирует пользовательский ввод', () => {
    const html = renderSpeakerHtml({
      name: '<script>alert(1)</script>',
      payload: { '<img onerror=x>': '<b>bad</b>' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img onerror=x>');
    expect(html).toContain('&lt;script&gt;');
  });
});

test.describe('заявка на сотрудничество с сайта (site/forum-form.js → /api/forms)', () => {
  // Тело, которое строит forum-form.js из формы #cwForm на collaboration.html:
  // контакт top-level, роль/референсы/оплата/даты — в payload.
  const collab = () => ({
    source: 'forum',
    event: 'frankenplatz-2026-10',
    form_key: 'collaboration',
    kind: 'lead',
    role: 'Заявка на сотрудничество',
    source_url: 'https://frankenplatz.ch/collaboration.html',
    name: 'Марк',
    email: '  Mark@Example.CH ',
    telegram: '@markshoots',
    consent: true,
    website: '',
    elapsed_ms: 15000,
    payload: {
      Кто: 'Фотограф',
      Референсы: 'instagram.com/markshoots',
      'Формат оплаты': 'Фикс + бартер',
      Стоимость: '800 CHF/день',
      Даты: '24 октября; 25 октября',
    },
  });

  test('нормализуется в строку submissions', () => {
    const out = normalizeSubmission(collab());
    expect(out.source).toBe('forum');
    expect(out.form_key).toBe('collaboration');
    expect(out.kind).toBe('lead');
    expect(out.role).toBe('Заявка на сотрудничество');
    expect(out.name).toBe('Марк');
    expect(out.email).toBe('mark@example.ch'); // trim + lowercase
    expect(out.telegram).toBe('@markshoots');
    expect(out.consent).toBe(true);
    expect(out.hp).toBeNull(); // пустой honeypot → не бот
    expect(out.payload['Формат оплаты']).toBe('Фикс + бартер');
    expect(out.payload['Даты']).toContain('24 октября');
  });

  test('без согласия consent=false (route ответит 400)', () => {
    expect(normalizeSubmission({ ...collab(), consent: false }).consent).toBe(false);
  });

  test('бот: honeypot заполнен → hp в sub (route отсечёт)', () => {
    expect(normalizeSubmission({ ...collab(), website: 'http://spam.example' }).hp).toBe(
      'http://spam.example'
    );
  });

  test('уведомление оргам содержит контакт и ответы', () => {
    const html = renderNotificationHtml(normalizeSubmission(collab()));
    expect(html).toContain('mark@example.ch');
    expect(html).toContain('@markshoots');
    expect(html).toContain('Фотограф');
    expect(html).toContain('Формат оплаты');
  });
});

test.describe('анкета спикера с сайта (site/anketa-form.js → /api/forms)', () => {
  // Точное тело, которое строит фронтовый модуль анкеты из ответов квиза:
  // контакт top-level, весь опрос — в payload, form_key='speaker'.
  const anketa = () => ({
    source: 'forum',
    event: 'frankenplatz-2026-10',
    form_key: 'speaker',
    kind: 'application',
    role: 'Анкета спикера',
    source_url: 'https://frankenplatz.ch/anketa.html',
    name: 'Ксения Чудина',
    email: '  Ksenia@Example.CH ',
    phone: '+41 79 000 00 00',
    telegram: '@ksenia',
    consent: true,
    website: '', // honeypot пуст → живой человек
    elapsed_ms: 45000, // длинный квиз — заведомо больше MIN_FILL_MS
    payload: {
      'Сфера основной экспертизы': 'События и комьюнити',
      'Твоя килл-строка': 'MOTO-ZÜRICH — 22 000 гостей, с нуля за полгода',
      'Выбираю': 'Оба дня — с разной темой',
    },
  });

  test('нормализуется в строку submissions', () => {
    const out = normalizeSubmission(anketa());
    expect(out.source).toBe('forum');
    expect(out.event).toBe('frankenplatz-2026-10');
    expect(out.form_key).toBe('speaker'); // тот же путь, что рабочая форма спикера
    expect(out.kind).toBe('application');
    expect(out.role).toBe('Анкета спикера');
    expect(out.name).toBe('Ксения Чудина');
    expect(out.email).toBe('ksenia@example.ch'); // trim + lowercase
    expect(out.phone).toBe('+41 79 000 00 00');
    expect(out.telegram).toBe('@ksenia');
    expect(out.consent).toBe(true);
    expect(out.hp).toBeNull(); // пустой honeypot → не бот
    expect(out.elapsed_ms).toBeGreaterThan(MIN_FILL_MS);
    expect(out.payload['Твоя килл-строка']).toContain('MOTO-ZÜRICH');
    expect(out.send_report).toBe(false); // анкета отчёт себе не просит
  });

  test('без галочки согласия consent=false (route ответит 400)', () => {
    expect(normalizeSubmission({ ...anketa(), consent: false }).consent).toBe(false);
    const { consent, ...noConsent } = anketa();
    expect(normalizeSubmission(noConsent).consent).toBe(false);
  });

  test('бот: honeypot заполнен → hp в sub (route отсечёт)', () => {
    expect(normalizeSubmission({ ...anketa(), website: 'http://spam.example' }).hp).toBe(
      'http://spam.example'
    );
  });

  test('мгновенный сабмит ловится time-trap (route отсечёт)', () => {
    const out = normalizeSubmission({ ...anketa(), elapsed_ms: 300 });
    expect(out.elapsed_ms).toBeLessThan(MIN_FILL_MS);
  });

  test('form_key speaker → шлём уведомление сразу (не в дневную сводку)', () => {
    expect(shouldNotifyImmediately(normalizeSubmission(anketa()))).toBe(true);
  });

  test('спикеру уходит письмо-подтверждение с его данными', () => {
    const html = renderSpeakerHtml(normalizeSubmission(anketa()));
    expect(html).toContain('Ксения Чудина');
    expect(html).toContain('Анкета спикера получена');
    expect(html).toContain('в течение недели');
    expect(html).toContain('MOTO-ZÜRICH — 22 000 гостей, с нуля за полгода');
  });

  test('оргам уходит уведомление с контактом и ответами анкеты', () => {
    const html = renderNotificationHtml(normalizeSubmission(anketa()));
    expect(html).toContain('ksenia@example.ch');
    expect(html).toContain('@ksenia');
    expect(html).toContain('+41 79 000 00 00');
    expect(html).toContain('Сфера основной экспертизы');
    expect(html).toContain('События и комьюнити');
  });
});

test.describe('дневная сводка подписок', () => {
  test('перечисляет подписчиков и экранирует ввод', () => {
    const html = renderDigestHtml('forum', [
      { created_at: '2026-07-22T09:36:00+00:00', email: 'a@b.ch', event: 'frankenplatz-2026-10' },
      { created_at: '2026-07-22T10:00:00+00:00', email: '<script>alert(1)</script>' },
    ]);
    expect(html).toContain('Новые подписчики: 2');
    expect(html).toContain('a@b.ch');
    expect(html).toContain('frankenplatz-2026-10');
    expect(html).toContain('2026-07-22 09:36');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('пустой список не ломает рендер', () => {
    expect(renderDigestHtml('forum', [])).toContain('Новые подписчики: 0');
  });
});

test.describe('event — привязка заявки к конкретному событию', () => {
  test('нормализуется в нижний регистр и обрезается', () => {
    expect(normalizeSubmission({ source: 'forum', event: ' Frankenplatz-2026-10 ' }).event).toBe(
      'frankenplatz-2026-10'
    );
  });

  test('без события → null (заявки вне событий: chudina/creox)', () => {
    expect(normalizeSubmission({ source: 'chudina' }).event).toBeNull();
    expect(normalizeSubmission({ source: 'forum', event: '' }).event).toBeNull();
  });

  test('анкета спикера форума нормализуется целиком', () => {
    const out = normalizeSubmission({
      source: 'forum',
      event: 'frankenplatz-2026-10',
      form_key: 'speaker',
      kind: 'application',
      role: 'Спикер',
      name: 'Анна',
      email: 'A@B.ch',
      consent: true,
      payload: { Тема: 'Пенсия 3a', День: 'День №1' },
    });
    expect(out.event).toBe('frankenplatz-2026-10');
    expect(out.form_key).toBe('speaker');
    expect(out.kind).toBe('application');
    expect(out.role).toBe('Спикер');
    expect(out.email).toBe('a@b.ch');
    expect(out.payload['Тема']).toBe('Пенсия 3a');
  });
});

test.describe('отчёт отправителю (калькуляторы форума)', () => {
  test('send_report: true только при явной просьбе', () => {
    expect(normalizeSubmission({ source: 'forum', send_report: true }).send_report).toBe(true);
    expect(normalizeSubmission({ source: 'forum', send_report: 'true' }).send_report).toBe(true);
    expect(normalizeSubmission({ source: 'forum' }).send_report).toBe(false);
    expect(normalizeSubmission({ source: 'forum', send_report: false }).send_report).toBe(false);
    // прочие сайты платформы не должны случайно включить авто-ответ
    expect(normalizeSubmission({ source: 'chudina' }).send_report).toBe(false);
  });

  test('письмо-отчёт содержит результаты расчёта и ссылку на форум', () => {
    const html = renderReportHtml({
      source: 'forum',
      form_key: 'calc-pension',
      role: 'Пенсия в Швейцарии',
      email: 'a@b.ch',
      payload: { 'Пенсия всего, CHF/мес': "4'506", 'AHV (1-я опора)': "1'368" },
    });
    expect(html).toContain('Пенсия в Швейцарии');
    expect(html).toContain('Пенсия всего, CHF/мес');
    // швейцарский разделитель тысяч — апостроф, escapeHtml превращает его
    // в &#39; (в почтовом клиенте отрисуется обратно как 4'506)
    expect(html).toContain('4&#39;506');
    expect(html).toContain('1&#39;368');
    expect(html).toContain('frankenplatz.ch');
    expect(html).toContain('не индивидуальная финансовая консультация');
  });

  test('экранирует пользовательский ввод (XSS не проходит)', () => {
    const html = renderReportHtml({
      source: 'forum',
      role: '<script>alert(1)</script>',
      payload: { '<img onerror=x>': '<b>bad</b>' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img onerror=x>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('премиум-шаблон дизайнера: единая обёртка, реальные данные (не заглушки)', () => {
    const html = renderReportHtml({
      role: 'Семейный бюджет', form_key: 'calc-budget',
      payload: { 'Доход / мес': "42'900", 'Остаток / мес': "24'136" },
    });
    // обёртка дизайнера
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('linear-gradient(90deg,#B98BFF'); // градиент заголовка
    expect(html).toContain('Забронировать место'); // CTA
    expect(html).toContain('background:#0d0715'); // тёмная тема
    // реальные данные из payload, а НЕ зашитые в макет примеры дизайнера
    expect(html).toContain('Доход / мес');
    expect(html).toContain("24&#39;136");
    // название расчёта в градиентном заголовке
    expect(html).toContain('Семейный бюджет');
    // UTM-метки на CTA (в href амперсанды экранированы как &amp;)
    expect(html).toContain('utm_source=calc-report');
    expect(html).toContain('utm_medium=email');
    expect(html).toContain('utm_content=calc-budget');
  });
});

test.describe('withUtm — метки кликов из писем', () => {
  test('добавляет utm к чистому URL', () => {
    expect(
      withUtm('https://frankenplatz.ch', 'calc-report', 'frankenplatz-2026-10', 'calc-pension')
    ).toBe(
      'https://frankenplatz.ch?utm_source=calc-report&utm_medium=email&utm_campaign=frankenplatz-2026-10&utm_content=calc-pension'
    );
  });

  test('к URL с query добавляет через &', () => {
    expect(withUtm('https://frankenplatz.ch/calculators/?x=1', 'registration', 'ev', 'cta')).toBe(
      'https://frankenplatz.ch/calculators/?x=1&utm_source=registration&utm_medium=email&utm_campaign=ev&utm_content=cta'
    );
  });

  test('content опционален, campaign по умолчанию — событие форума', () => {
    expect(withUtm('https://frankenplatz.ch', 'speaker')).toBe(
      'https://frankenplatz.ch?utm_source=speaker&utm_medium=email&utm_campaign=frankenplatz-2026-10'
    );
  });
});

test.describe('plain-text часть писем (анти-спам: text рядом с html)', () => {
  const noHtml = (s) => {
    // в тексте не должно быть html-тегов и «сырых» сущностей от escapeHtml
    expect(s).not.toContain('<');
    expect(s).not.toContain('>');
    expect(s).not.toContain('&#39;');
    expect(s).not.toContain('&lt;');
  };

  test('регистрация: содержит суть, поля payload и не содержит html', () => {
    const text = renderRegistrationText({
      name: 'Аня', form_key: 'registration',
      payload: { Интересует: 'Оба дня', Мест: '2' },
    });
    expect(text).toContain('Аня, привет!');
    expect(text).toContain('ещё не билет');
    expect(text).toContain('Интересует: Оба дня');
    expect(text).toContain('Мест: 2');
    expect(text).toContain('frankenplatz.ch');
    noHtml(text);
  });

  test('регистрация без имени и без payload не ломается', () => {
    const text = renderRegistrationText({ form_key: 'registration', payload: {} });
    expect(text).toContain('Привет!');
    expect(text).toContain('ранней регистрации');
    noHtml(text);
  });

  test('спикер: подтверждение, срок и ответы анкеты, без html', () => {
    const text = renderSpeakerText({
      name: 'Пётр',
      payload: { Тема: 'Пенсия для поздних мигрантов', День: 'День 1' },
    });
    expect(text).toContain('Пётр, спасибо!');
    expect(text).toContain('Анкета спикера получена');
    expect(text).toContain('в течение недели');
    expect(text).toContain('Тема: Пенсия для поздних мигрантов');
    noHtml(text);
  });

  test('отчёт: результаты расчёта как есть (апостроф не экранируется) + ссылка', () => {
    const text = renderReportText({
      role: 'Пенсия в Швейцарии', form_key: 'calc-pension',
      payload: { 'Пенсия всего, CHF/мес': "4'506", 'AHV (1-я опора)': "1'368" },
    });
    expect(text).toContain('Твой расчёт — Пенсия в Швейцарии');
    // в plain-text апостроф остаётся собой, а не &#39; (как в html)
    expect(text).toContain("Пенсия всего, CHF/мес: 4'506");
    expect(text).toContain('не индивидуальная финансовая консультация');
    expect(text).toContain('https://frankenplatz.ch');
    noHtml(text);
  });

  test('пустые значения payload не попадают в текст', () => {
    const text = renderReportText({ role: 'Расчёт', payload: { A: '1', B: '', C: null } });
    expect(text).toContain('A: 1');
    expect(text).not.toContain('B:');
    expect(text).not.toContain('C:');
  });
});

test.describe('double opt-in подписки (письмо + страница подтверждения)', () => {
  const URL = 'https://slswiss-tickets.vercel.app/api/forms/confirm?token=abc-123';

  test('письмо-подтверждение (html) содержит ссылку и кнопку', () => {
    const html = renderConfirmHtml({ name: 'Аня', email: 'a@b.ch' }, URL);
    expect(html).toContain('Подтверди подписку');
    expect(html).toContain('Подтвердить подписку'); // текст кнопки
    expect(html).toContain(`href="${URL}"`);
    expect(html).toContain('Аня');
  });

  test('письмо-подтверждение экранирует имя (XSS не проходит)', () => {
    const html = renderConfirmHtml({ name: '<script>alert(1)</script>' }, URL);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('письмо-подтверждение (text): ссылка есть, html нет', () => {
    const text = renderConfirmText({ name: 'Аня' }, URL);
    expect(text).toContain('Подтверди подписку');
    expect(text).toContain(URL);
    expect(text).toContain('Аня, привет!');
    expect(text).not.toContain('<');
    expect(text).not.toContain('>');
  });

  test('без имени письмо не ломается', () => {
    expect(renderConfirmHtml({}, URL)).toContain('Привет!');
    expect(renderConfirmText({}, URL)).toContain('Привет!');
  });

  test('страница-результат: разные состояния дают свой заголовок и noindex', () => {
    const ok = confirmPageHtml('confirmed', 'https://frankenplatz.ch');
    expect(ok).toContain('Подписка подтверждена');
    expect(ok).toContain('noindex');
    expect(ok).toContain('href="https://frankenplatz.ch"');

    expect(confirmPageHtml('already')).toContain('Уже подтверждено');
    expect(confirmPageHtml('invalid')).toContain('недействительна');
    // неизвестное состояние → безопасный fallback на invalid
    expect(confirmPageHtml('чтотонетак')).toContain('недействительна');
  });
});

test.describe('confirmLink — домен ссылки подтверждения', () => {
  const T = 'abc-123';
  const API = 'https://slswiss-tickets.vercel.app';

  test('ведёт на домен, с которого подписались (наш → rewrite-прокси)', () => {
    expect(confirmLink('https://frankenplatz.ch/#reg', API, T)).toBe(
      'https://frankenplatz.ch/newsletter/confirm?token=abc-123'
    );
    expect(confirmLink('https://www.frankenplatz.ch/', undefined, T)).toBe(
      'https://www.frankenplatz.ch/newsletter/confirm?token=abc-123'
    );
  });

  test('АНТИ-ФИШИНГ: чужой домен в source_url НЕ используется → фолбэк на API', () => {
    expect(confirmLink('https://evil.example/x', API, T)).toBe(
      'https://slswiss-tickets.vercel.app/api/forms/confirm?token=abc-123'
    );
  });

  test('нет/кривой source_url → прямой URL API', () => {
    expect(confirmLink(null, API, T)).toBe(
      'https://slswiss-tickets.vercel.app/api/forms/confirm?token=abc-123'
    );
    expect(confirmLink('не url', undefined, T)).toBe(
      'https://slswiss-tickets.vercel.app/api/forms/confirm?token=abc-123'
    );
  });

  test('токен экранируется', () => {
    expect(confirmLink('https://frankenplatz.ch/', undefined, 'a b&c')).toBe(
      'https://frankenplatz.ch/newsletter/confirm?token=a%20b%26c'
    );
  });

  test('переданный белый список ограничивает origin', () => {
    // frankenplatz нет в переданном списке → фолбэк, хотя он в дефолтном
    expect(confirmLink('https://frankenplatz.ch/', undefined, T, ['https://chudina.me'])).toBe(
      'https://slswiss-tickets.vercel.app/api/forms/confirm?token=abc-123'
    );
  });
});

test.describe('List-Unsubscribe (отписка)', () => {
  const T = 'abc-123';
  const API = 'https://slswiss-tickets.vercel.app';

  test('unsubscribeUrl: домен подписки + путь отписки (та же анти-фишинг логика)', () => {
    expect(unsubscribeUrl('https://frankenplatz.ch/', API, T)).toBe(
      'https://frankenplatz.ch/newsletter/unsubscribe?token=abc-123'
    );
    // чужой домен → фолбэк на API
    expect(unsubscribeUrl('https://evil.example/', API, T)).toBe(
      'https://slswiss-tickets.vercel.app/api/forms/unsubscribe?token=abc-123'
    );
  });

  test('unsubscribeHeaders: one-click (RFC 8058)', () => {
    const h = unsubscribeHeaders('https://frankenplatz.ch/newsletter/unsubscribe?token=abc-123');
    expect(h['List-Unsubscribe']).toBe(
      '<https://frankenplatz.ch/newsletter/unsubscribe?token=abc-123>'
    );
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  test('страница ask: форма постит с методом POST и относительным action', () => {
    const html = unsubscribePageHtml('ask', { token: 'abc-123', site: 'https://frankenplatz.ch' });
    expect(html).toContain('Отписаться от рассылки?');
    expect(html).toContain('method="post"');
    expect(html).toContain('action="?token=abc-123"');
    expect(html).toContain('noindex');
  });

  test('страница done/invalid', () => {
    expect(unsubscribePageHtml('done', { site: 'https://frankenplatz.ch' })).toContain('Ты отписан(а)');
    expect(unsubscribePageHtml('invalid')).toContain('недействительна');
    expect(unsubscribePageHtml('чтотонетак')).toContain('недействительна'); // fallback
  });

  test('токен в ask-странице экранируется', () => {
    const html = unsubscribePageHtml('ask', { token: 'a"b', site: 'https://frankenplatz.ch' });
    expect(html).not.toContain('action="?token=a"b"');
  });
});

test.describe('normalizeEmail', () => {
  test('нижний регистр и обрезка, пустое → null', () => {
    expect(normalizeEmail('  User@Mail.CH ')).toBe('user@mail.ch');
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

test.describe('renderNotificationHtml', () => {
  test('экранирует пользовательский ввод (XSS не проходит)', () => {
    const html = renderNotificationHtml({
      source: 'chudina',
      role: 'Дизайнер',
      name: '<script>alert(1)</script>',
      payload: {},
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('блок тестов человекочитаем (Мадди + Адизес с русскими шкалами)', () => {
    const html = renderTestsHtml({
      started: '13.07 16:00',
      finished: '13.07 16:08',
      maddi: { total: 78, zone: 'высокая', pct: { C: 80, K: 75, V: 70 }, top: 'Контроль' },
      adizes: { code: 'PaEi', pct: { P: 40, A: 20, E: 25, I: 15 }, top: 'Результат', second: 'Идеи' },
    });
    expect(html).toContain('Жизнестойкость (Мадди)');
    expect(html).toContain('78%');
    expect(html).toContain('высокая');
    expect(html).toContain('Вовлечённость: 80%');
    expect(html).toContain('Сильная сторона: <b>Контроль</b>');
    expect(html).toContain('Адизес PAEI');
    expect(html).toContain('Результат (P): 40%');
    expect(html).toContain('Ведущая роль: <b>Результат</b>');
    expect(html).not.toContain('<pre'); // не JSON-дамп для известной структуры
  });

  test('незнакомая структура тестов → запасной JSON', () => {
    const html = renderTestsHtml({ custom: { foo: 'bar' } });
    expect(html).toContain('<pre');
    expect(html).toContain('foo');
  });

  test('рендерит поля payload и блок тестов', () => {
    const html = renderNotificationHtml({
      source: 'chudina',
      form_key: 'team',
      role: 'IT-практикант',
      email: 'a@b.ch',
      payload: { Стек: 'React' },
      tests: { adizes: { code: 'PaeI' } },
    });
    expect(html).toContain('a@b.ch');
    expect(html).toContain('Стек');
    expect(html).toContain('React');
    expect(html).toContain('Результаты тестов');
    expect(html).toContain('PaeI');
  });
});

test.describe('allowedOrigins', () => {
  test('без env — дефолтные сайты платформы (включая creox)', () => {
    const list = allowedOrigins(undefined);
    expect(list).toEqual(DEFAULT_ORIGINS);
    expect(list).toContain('https://creox.ch');
    expect(list).toContain('https://www.creox.ch');
    expect(list).toContain('https://creox.vercel.app');
    expect(list).toContain('https://chudina.me');
    expect(list).toContain('https://frankenplatz.vercel.app'); // форум шлёт заявки сюда
    expect(list).toContain('https://frankenplatz.ch');
    // Atlas Integra: корень редиректит на www, но форма живёт и на vercel.app
    expect(list).toContain('https://atlasintegra.ch');
    expect(list).toContain('https://www.atlasintegra.ch');
    expect(list).toContain('https://atlasintegra.vercel.app');
  });

  test('env переопределяет список целиком, пробелы обрезаются', () => {
    const list = allowedOrigins(' https://creox.ch , https://a.ch ');
    expect(list).toEqual(['https://creox.ch', 'https://a.ch']);
    expect(list).not.toContain('https://chudina.me'); // env заменяет дефолт, не дополняет
  });

  test('пустая env → дефолт (пустой список закрыл бы приём заявок)', () => {
    expect(allowedOrigins('')).toEqual(DEFAULT_ORIGINS);
    expect(allowedOrigins('   ')).toEqual(DEFAULT_ORIGINS);
    expect(allowedOrigins(',,')).toEqual(DEFAULT_ORIGINS);
  });
});

test.describe('заявка с лендинга creox', () => {
  const brief = () => ({
    source: 'creox',
    form_key: 'brief',
    source_url: 'https://creox.ch/',
    kind: 'lead',
    role: 'Festival',
    name: 'Hans Muster',
    email: 'Hans@Example.CH',
    consent: true,
    hp: '',
    elapsed_ms: 9000,
    payload: { company: 'Muster AG', event_type: 'Festival', message: 'Wir planen ein Festival.', lang: 'de' },
  });

  test('нормализуется в строку submissions', () => {
    const out = normalizeSubmission(brief());
    expect(out.source).toBe('creox');
    expect(out.form_key).toBe('brief');
    expect(out.kind).toBe('lead');
    expect(out.name).toBe('Hans Muster');
    expect(out.email).toBe('hans@example.ch');
    expect(out.consent).toBe(true);
    expect(out.hp).toBeNull(); // пустой honeypot → null, заявка не бот
    expect(out.payload.company).toBe('Muster AG');
    expect(out.payload.message).toBe('Wir planen ein Festival.');
  });

  test('бот заполнил honeypot → hp попадает в sub (route отсечёт)', () => {
    const out = normalizeSubmission({ ...brief(), hp: 'http://spam.example' });
    expect(out.hp).toBe('http://spam.example');
  });

  test('без галочки согласия consent=false (route ответит 400)', () => {
    expect(normalizeSubmission({ ...brief(), consent: false }).consent).toBe(false);
    const { consent, ...noConsent } = brief();
    expect(normalizeSubmission(noConsent).consent).toBe(false);
  });
});

test.describe('заявка в правление Atlas Integra', () => {
  const application = () => ({
    source: 'atlasintegra',
    form_key: 'vorstand',
    source_url: 'https://www.atlasintegra.ch/apply.html',
    kind: 'application',
    role: 'Правление (Vorstand)',
    name: 'Мария Иванова',
    email: '  Maria@Example.CH ',
    phone: '+41 79 123 45 67',
    consent: true,
    hp: '',
    elapsed_ms: 12000,
    payload: {
      Отчество: 'Петровна',
      'Почему хочешь вступить': 'Прошла интеграцию, хочу помогать другим.',
      'Чем можешь быть полезен': 'Опыт HR, связи в кантоне Цюрих.',
      'Опыт и идеи': 'Могу вести языковой клуб.',
    },
  });

  test('нормализуется в строку submissions', () => {
    const out = normalizeSubmission(application());
    expect(out.source).toBe('atlasintegra');
    expect(out.form_key).toBe('vorstand');
    expect(out.kind).toBe('application');
    expect(out.role).toBe('Правление (Vorstand)');
    expect(out.name).toBe('Мария Иванова');
    expect(out.email).toBe('maria@example.ch'); // trim + lowercase
    expect(out.phone).toBe('+41 79 123 45 67');
    expect(out.consent).toBe(true);
    expect(out.hp).toBeNull(); // пустой honeypot → не бот
    expect(out.payload['Почему хочешь вступить']).toContain('помогать другим');
    expect(out.payload.Отчество).toBe('Петровна');
    // форма правления не шлёт отчёт заявителю (это только у калькуляторов форума)
    expect(out.send_report).toBe(false);
  });

  test('бот заполнил honeypot → hp попадает в sub (route отсечёт)', () => {
    const out = normalizeSubmission({ ...application(), hp: 'http://spam.example' });
    expect(out.hp).toBe('http://spam.example');
  });

  test('мгновенный сабмит ловится time-trap (route отсечёт)', () => {
    const out = normalizeSubmission({ ...application(), elapsed_ms: 300 });
    expect(out.elapsed_ms).toBe(300);
    expect(out.elapsed_ms).toBeLessThan(MIN_FILL_MS);
  });

  test('без галочки согласия consent=false (route ответит 400)', () => {
    expect(normalizeSubmission({ ...application(), consent: false }).consent).toBe(false);
    const { consent, ...noConsent } = application();
    expect(normalizeSubmission(noConsent).consent).toBe(false);
  });

  test('письмо-уведомление содержит контакт и ответы кандидата', () => {
    const html = renderNotificationHtml(normalizeSubmission(application()));
    expect(html).toContain('Мария Иванова');
    expect(html).toContain('maria@example.ch');
    expect(html).toContain('Правление (Vorstand)');
    expect(html).toContain('Чем можешь быть полезен');
    expect(html).toContain('Опыт HR');
  });
});
