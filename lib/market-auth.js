/**
 * Вход в кабинет продавца: одноразовые ссылки из письма + подписанная сессия.
 *
 * Шаг 2 ТЗ docs/TZ-market-cabinet.md. Паролей нет намеренно: их пришлось бы
 * хранить, восстанавливать и терять, а продавцов десятки. Человек вводит email —
 * получает ссылку — попадает в кабинет; ровно тот же паттерн, что у подтверждения
 * подписки (`/api/forms/confirm`), только с сессией на выходе.
 *
 * Что здесь: генерация и проверка токенов, подпись cookie, список модераторов.
 * Чистый модуль — сеть и БД живут в роутах, env читается лениво внутри функций,
 * чтобы отсутствие секрета не роняло сборку.
 */
import crypto from 'crypto';

/** Имя cookie сессии. */
export const SESSION_COOKIE = 'mk_session';

/** Ссылка из письма живёт полчаса: письмо читают сразу, а лежит оно вечно. */
export const LOGIN_TOKEN_TTL_MS = 30 * 60 * 1000;

/** Сессия — 30 дней: продавец заходит редко, раз в неделю логиниться незачем. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Не чаще одного письма в минуту на адрес — от случайного и намеренного спама. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

/** Email к единому виду: сравнение и уникальный индекс идут по нижнему регистру. */
export function normalizeEmail(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().toLowerCase();
  if (!s || s.length > 200) return null;
  return s;
}

/**
 * Грубая проверка адреса: одна собака, что-то до и после, точка в домене.
 * Строгую валидацию делает сам факт доставки письма — ссылку получит только
 * тот, чей адрес существует.
 */
export function isValidEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** Новый токен для ссылки: 32 байта в hex. */
export function newLoginToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * В БД кладём не токен, а его хэш. Утечка таблицы тогда не даёт войти: из
 * хэша ссылку не собрать. Соль не нужна — токен и так случайный и длинный.
 */
export function hashToken(token) {
  if (!token) return null;
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Сравнение без утечки времени — для секретов сравнивать по `===` нельзя. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Значение сессионной cookie: `base64url(email|expiresAt).подпись`.
 *
 * Полезная часть кодируется, а не пишется как есть: в email бывают точки и
 * плюсы, и наивный разбор по разделителю разваливал бы подпись у половины
 * адресов (первая версия так и делала — поймали тесты).
 *
 * Состояние держим в самой cookie, а не в таблице сессий: тогда каждый запрос
 * страницы — это проверка подписи, а не поход в БД. Отозвать конкретную сессию
 * так нельзя, но для кабинета с десятками продавцов это не та цена.
 */
export function signSession(email, secret, opts = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized || !secret) return null;
  const now = Number(opts.now) || Date.now();
  const ttl = Number(opts.ttlMs) || SESSION_TTL_MS;
  const expiresAt = now + ttl;
  const payload = Buffer.from(`${normalized}|${expiresAt}`, 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', String(secret)).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

/**
 * Проверка cookie. Возвращает email или null — на любую порчу, чужую подпись
 * и истёкший срок. Одна причина отказа наружу: подсказывать нечего.
 */
export function verifySession(value, secret, opts = {}) {
  if (!value || !secret) return null;
  const parts = String(value).split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  const expected = crypto.createHmac('sha256', String(secret)).update(payload).digest('hex');
  if (!safeEqual(signature, expected)) return null;

  // Подпись сошлась — только теперь доверяем содержимому и разбираем его.
  let decoded;
  try {
    decoded = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.lastIndexOf('|');
  if (sep < 1) return null;
  const email = decoded.slice(0, sep);
  const expiresAt = Number(decoded.slice(sep + 1));
  if (!Number.isFinite(expiresAt)) return null;

  const now = Number(opts.now) || Date.now();
  if (expiresAt <= now) return null;

  return normalizeEmail(email);
}

/**
 * Модераторы — адреса из `MARKET_ADMIN_EMAILS` через запятую (решение 17.08:
 * доступ по email, а не по ключу). Пусто → `assistant@creox.ch`, чтобы кабинет
 * не оказался без модератора из-за незаданной переменной.
 */
export function adminEmails(envValue) {
  const raw = String(envValue || '').trim();
  if (!raw) return ['assistant@creox.ch'];
  const list = raw
    .split(',')
    .map((s) => normalizeEmail(s))
    .filter(Boolean);
  return list.length ? list : ['assistant@creox.ch'];
}

/** Модератор ли этот адрес. */
export function isAdminEmail(email, envValue) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return adminEmails(envValue).includes(normalized);
}

/** Атрибуты cookie сессии. secure выключаем только на локальном http. */
export function sessionCookieOptions(opts = {}) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.secure !== false,
    path: '/',
    maxAge: Math.floor((Number(opts.ttlMs) || SESSION_TTL_MS) / 1000),
  };
}
