import { test, expect } from '@playwright/test';
import {
  normalizeSubmission,
  normalizeEmail,
  renderNotificationHtml,
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

  test('elapsed_ms парсится в число, мусор → null', () => {
    expect(normalizeSubmission({ source: 'chudina', elapsed_ms: 4200 }).elapsed_ms).toBe(4200);
    expect(normalizeSubmission({ source: 'chudina', elapsed_ms: '4200' }).elapsed_ms).toBe(4200);
    expect(normalizeSubmission({ source: 'chudina' }).elapsed_ms).toBeNull();
    expect(normalizeSubmission({ source: 'chudina', elapsed_ms: 'x' }).elapsed_ms).toBeNull();
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
