import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { verifyWebhookSignature, unflattenTransaction } from '../../lib/payrexx';

const KEY = 'test-signing-key';
const sign = (raw, key = KEY) => crypto.createHmac('sha256', key).update(raw).digest('hex');

test.describe('verifyWebhookSignature', () => {
  test.beforeEach(() => {
    process.env.PAYREXX_WEBHOOK_SIGNING_KEY = KEY;
    delete process.env.ALLOW_UNSIGNED_WEBHOOKS;
  });

  test('валидная lowercase-hex подпись принимается', () => {
    const raw = '{"transaction":{"id":7}}';
    expect(verifyWebhookSignature(raw, sign(raw))).toBe(true);
  });

  test('uppercase hex тоже принимается (нормализуем регистр)', () => {
    const raw = 'transaction[id]=7';
    expect(verifyWebhookSignature(raw, sign(raw).toUpperCase())).toBe(true);
  });

  test('подпись чужим ключом отклоняется', () => {
    const raw = '{"a":1}';
    expect(verifyWebhookSignature(raw, sign(raw, 'wrong-key'))).toBe(false);
  });

  test('подпись от другого тела отклоняется', () => {
    expect(verifyWebhookSignature('{"a":2}', sign('{"a":1}'))).toBe(false);
  });

  test('отсутствие заголовка подписи отклоняется', () => {
    expect(verifyWebhookSignature('{"a":1}', null)).toBe(false);
  });

  test('FAIL-CLOSED: без signing key вебхук отклоняется', () => {
    delete process.env.PAYREXX_WEBHOOK_SIGNING_KEY;
    expect(verifyWebhookSignature('{"a":1}', 'whatever')).toBe(false);
  });

  test('ALLOW_UNSIGNED_WEBHOOKS=1 явно разрешает (только настройка)', () => {
    delete process.env.PAYREXX_WEBHOOK_SIGNING_KEY;
    process.env.ALLOW_UNSIGNED_WEBHOOKS = '1';
    expect(verifyWebhookSignature('{"a":1}', null)).toBe(true);
  });
});

test.describe('unflattenTransaction', () => {
  test('разворачивает form-urlencoded с вложенными ключами', () => {
    const usp = new URLSearchParams(
      'transaction[id]=42&transaction[referenceId]=slsw-abc&transaction[contact][email]=a%40b.ch&transaction[contact][firstname]=Ivan'
    );
    expect(unflattenTransaction(usp)).toEqual({
      id: '42',
      referenceId: 'slsw-abc',
      contact: { email: 'a@b.ch', firstname: 'Ivan' },
    });
  });

  test('игнорирует ключи вне transaction[...]', () => {
    const usp = new URLSearchParams('foo=1&transaction[id]=5');
    expect(unflattenTransaction(usp)).toEqual({ id: '5' });
  });

  test('пустое тело → пустой объект', () => {
    expect(unflattenTransaction(new URLSearchParams(''))).toEqual({});
  });
});
