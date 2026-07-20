import { test, expect } from '@playwright/test';
import {
  normalizeSubmission,
  normalizeEmail,
  renderNotificationHtml,
  renderReportHtml,
  renderTestsHtml,
  allowedOrigins,
  DEFAULT_ORIGINS,
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
