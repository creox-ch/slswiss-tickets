import { test, expect } from '@playwright/test';
import {
  SESSION_COOKIE,
  LOGIN_TOKEN_TTL_MS,
  SESSION_TTL_MS,
  normalizeEmail,
  isValidEmail,
  newLoginToken,
  hashToken,
  signSession,
  verifySession,
  adminEmails,
  isAdminEmail,
  sessionCookieOptions,
  sessionEmailFromRequest,
} from '../../lib/market-auth';

const SECRET = 'test-secret-value';

test.describe('email', () => {
  test('нормализуем регистр и пробелы — по этому полю уникальный индекс', () => {
    expect(normalizeEmail('  Anna@Example.CH ')).toBe('anna@example.ch');
    expect(normalizeEmail('')).toBe(null);
    expect(normalizeEmail(null)).toBe(null);
    expect(normalizeEmail('x'.repeat(300))).toBe(null);
  });

  test('грубая проверка адреса', () => {
    expect(isValidEmail('anna@example.ch')).toBe(true);
    expect(isValidEmail('ANNA@EXAMPLE.CH')).toBe(true);
    expect(isValidEmail('anna@example')).toBe(false); // без точки в домене
    expect(isValidEmail('anna example.ch')).toBe(false);
    expect(isValidEmail('@example.ch')).toBe(false);
  });
});

test.describe('токен из письма', () => {
  test('каждый токен новый и длинный', () => {
    const a = newLoginToken();
    const b = newLoginToken();
    expect(a).toHaveLength(64);
    expect(a).not.toBe(b);
  });

  test('в БД уходит хэш, а не сам токен', () => {
    const token = newLoginToken();
    const hash = hashToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(token); // утечка таблицы не даёт войти
    expect(hashToken(token)).toBe(hash); // детерминирован — иначе не найдём строку
    expect(hashToken(newLoginToken())).not.toBe(hash);
    expect(hashToken('')).toBe(null);
  });

  test('ссылка живёт полчаса, сессия — месяц', () => {
    expect(LOGIN_TOKEN_TTL_MS).toBe(30 * 60 * 1000);
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

test.describe('сессионная cookie', () => {
  test('подписали — прочитали', () => {
    const value = signSession('Anna@Example.ch', SECRET);
    expect(verifySession(value, SECRET)).toBe('anna@example.ch');
  });

  test('чужой секрет не проходит', () => {
    const value = signSession('anna@example.ch', SECRET);
    expect(verifySession(value, 'другой-секрет')).toBe(null);
  });

  test('email с точками и плюсом читается верно — из-за них ломалась первая версия', () => {
    const tricky = 'anna.maria+market@sub.example.co.uk';
    expect(verifySession(signSession(tricky, SECRET), SECRET)).toBe(tricky);
  });

  test('подменённый email не проходит — подпись считается по нему же', () => {
    const now = Date.now();
    const value = signSession('anna@example.ch', SECRET, { now });
    const signature = value.split('.')[1];
    const fake = Buffer.from(`admin@creox.ch|${now + SESSION_TTL_MS}`, 'utf8').toString('base64url');
    expect(verifySession(`${fake}.${signature}`, SECRET)).toBe(null);
  });

  test('продлить себе сессию правкой срока нельзя', () => {
    const now = Date.now();
    const value = signSession('anna@example.ch', SECRET, { now });
    const signature = value.split('.')[1];
    const longer = Buffer.from(`anna@example.ch|${now + 10 * SESSION_TTL_MS}`, 'utf8').toString(
      'base64url'
    );
    expect(verifySession(`${longer}.${signature}`, SECRET)).toBe(null);
  });

  test('истёкшая сессия не пускает', () => {
    const now = Date.now();
    const value = signSession('anna@example.ch', SECRET, { now, ttlMs: 1000 });
    expect(verifySession(value, SECRET, { now: now + 500 })).toBe('anna@example.ch');
    expect(verifySession(value, SECRET, { now: now + 2000 })).toBe(null);
  });

  test('мусор вместо cookie не роняет проверку', () => {
    expect(verifySession('', SECRET)).toBe(null);
    expect(verifySession('a.b', SECRET)).toBe(null); // подпись не сойдётся
    expect(verifySession('a.b.c.d', SECRET)).toBe(null);
    expect(verifySession('без-точки-вообще', SECRET)).toBe(null);
    expect(verifySession(null, SECRET)).toBe(null);
  });

  test('без секрета не подписываем и не пускаем', () => {
    expect(signSession('anna@example.ch', '')).toBe(null);
    expect(verifySession('что-угодно', '')).toBe(null);
  });

  test('cookie закрыта от JS и живёт столько же, сколько сессия', () => {
    const opts = sessionCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.secure).toBe(true);
    expect(opts.maxAge).toBe(SESSION_TTL_MS / 1000);
    expect(sessionCookieOptions({ secure: false }).secure).toBe(false); // локальный http
    expect(SESSION_COOKIE).toBe('mk_session');
  });
});

test.describe('сессия из запроса', () => {
  const req = (value) => ({
    cookies: { get: () => (value === undefined ? undefined : { value }) },
  });

  test('валидная cookie → email', () => {
    const value = signSession('anna@example.ch', SECRET);
    expect(sessionEmailFromRequest(req(value), SECRET)).toBe('anna@example.ch');
  });

  test('нет cookie, чужая подпись, кривой объект запроса → null', () => {
    expect(sessionEmailFromRequest(req(undefined), SECRET)).toBe(null);
    expect(sessionEmailFromRequest(req('подделка.deadbeef'), SECRET)).toBe(null);
    expect(sessionEmailFromRequest({}, SECRET)).toBe(null);
    expect(sessionEmailFromRequest(null, SECRET)).toBe(null);
  });
});

test.describe('модераторы', () => {
  test('пустая переменная → ассистент, кабинет не остаётся без модератора', () => {
    expect(adminEmails('')).toEqual(['assistant@creox.ch']);
    expect(adminEmails(undefined)).toEqual(['assistant@creox.ch']);
    expect(adminEmails(' , , ')).toEqual(['assistant@creox.ch']);
  });

  test('список через запятую, регистр и пробелы не важны', () => {
    expect(adminEmails(' Ksenia@Creox.ch , anna@creox.ch ')).toEqual([
      'ksenia@creox.ch',
      'anna@creox.ch',
    ]);
  });

  test('isAdminEmail сравнивает по нормализованному адресу', () => {
    const env = 'ksenia@creox.ch';
    expect(isAdminEmail('KSENIA@creox.ch', env)).toBe(true);
    expect(isAdminEmail('anna@creox.ch', env)).toBe(false);
    expect(isAdminEmail('', env)).toBe(false);
    expect(isAdminEmail('assistant@creox.ch', '')).toBe(true); // дефолт
  });
});
