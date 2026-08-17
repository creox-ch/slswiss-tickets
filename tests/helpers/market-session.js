/**
 * Сессия кабинета маркета для тестов.
 *
 * Секрет фиксирован в playwright.config.js, поэтому cookie можно подписать
 * прямо здесь и ходить по роутам от лица продавца или модератора. Без этого
 * тесты видели только ветку «не авторизован» — а оба бага с фото жили дальше,
 * на стыке формы и роута, и их пришлось ловить руками на проде.
 */
import { signSession, SESSION_COOKIE } from '../../lib/market-auth';

/** Тот же секрет, что уходит в dev-сервер тестов. */
export const TEST_SECRET = process.env.MARKET_SESSION_SECRET || 'test-market-session-secret';

/** Адрес модератора из тестового MARKET_ADMIN_EMAILS. */
export const TEST_MODERATOR = 'moderator@test.local';

/** Заголовок Cookie с валидной сессией указанного адреса. */
export function sessionHeaders(email) {
  return { cookie: `${SESSION_COOKIE}=${signSession(email, TEST_SECRET)}` };
}

/** Заголовок Cookie с сессией модератора. */
export function moderatorHeaders() {
  return sessionHeaders(TEST_MODERATOR);
}

/**
 * Cookie для page-контекста (Playwright ждёт объект, а не строку).
 * baseURL передаём, чтобы cookie привязалась к тому же origin, что и страница.
 */
export function sessionCookie(email, url = 'http://localhost:3000') {
  const { hostname } = new URL(url);
  return {
    name: SESSION_COOKIE,
    value: signSession(email, TEST_SECRET),
    domain: hostname,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  };
}
