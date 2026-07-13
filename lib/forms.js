import { escapeHtml } from './ticket';

/**
 * Чистые хелперы для приёма заявок с форм платформенных сайтов
 * (chudina / atlasintegra / форум ...). Без сети и env — легко тестировать.
 *
 * Формы живут на РАЗНЫХ сайтах, поэтому источник трекаем явно:
 *   source     — платформа ('chudina' | 'atlasintegra' | 'forum' | ...)
 *   form_key   — какая форма ('team' | 'contact' | 'partnership' | ...)
 *   source_url — URL страницы, откуда отправлено
 */

const MAX_FIELD = 2000; // на одно текстовое поле
const MAX_PAYLOAD_JSON = 20000; // на весь payload (после JSON.stringify)

/** Обрезанная-до-лимита строка или null (пустое → null). */
function str(v, max = MAX_FIELD) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/** Оставляем только объект-план (без вложенных функций и пр.). */
function plainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/**
 * Нормализует тело запроса формы в структуру строки таблицы submissions.
 * Кидает Error при отсутствии обязательного source или слишком большом payload —
 * route ловит и отвечает 400.
 *
 * Контакт можно прислать как top-level поля или внутри body.contact.
 * Поля формы — в body.payload или body.fields.
 */
export function normalizeSubmission(body) {
  const b = plainObject(body);
  const contact = plainObject(b.contact);

  const source = str(b.source, 60);
  if (!source) throw new Error('source is required');

  const payload = plainObject(b.payload ?? b.fields);
  const payloadJson = JSON.stringify(payload);
  if (payloadJson.length > MAX_PAYLOAD_JSON) {
    throw new Error('payload too large');
  }

  const tests = b.tests != null ? plainObject(b.tests) : null;

  return {
    source: source.toLowerCase(),
    form_key: str(b.form_key ?? b.formKey, 60),
    source_url: str(b.source_url ?? b.sourceUrl, 500),
    kind: str(b.kind, 40) || 'application',
    role: str(b.role, 200),
    name: str(b.name ?? contact.name),
    email: normalizeEmail(b.email ?? contact.email),
    telegram: str(b.telegram ?? contact.telegram, 200),
    phone: str(b.phone ?? contact.phone, 60),
    payload,
    tests,
    // honeypot: если бот заполнил скрытое поле — отсекаем на уровне route
    hp: str(b.hp ?? b.website, 200),
  };
}

/** Мягкая нормализация email (нижний регистр, обрезка). Без строгой валидации. */
export function normalizeEmail(v) {
  const s = str(v, 200);
  if (!s) return null;
  return s.toLowerCase();
}

/** Строка «ключ: значение» для письма (экранированная). */
function row(label, value) {
  if (value == null || value === '') return '';
  return `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${escapeHtml(
    label
  )}</td><td style="padding:4px 0;color:#1a1a1a"><b>${escapeHtml(
    String(value)
  )}</b></td></tr>`;
}

/**
 * HTML письма-уведомления о новой заявке.
 * Всё, что пришло от пользователя, экранируется (escapeHtml).
 */
export function renderNotificationHtml(sub) {
  const s = plainObject(sub);
  const payload = plainObject(s.payload);
  const payloadRows = Object.keys(payload)
    .map((k) => row(k, payload[k]))
    .join('');

  let testsBlock = '';
  const t = s.tests;
  if (t && typeof t === 'object') {
    testsBlock =
      `<h3 style="margin:20px 0 6px;color:#d52b1e">Результаты тестов</h3>` +
      `<pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;color:#333;background:#f6f6f6;padding:10px;border-radius:8px">${escapeHtml(
        JSON.stringify(t, null, 2)
      )}</pre>`;
  }

  return `
    <div style="font-family:'Plus Jakarta Sans',Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
      <h2 style="color:#d52b1e;margin:0 0 4px">Новая заявка · ${escapeHtml(
        s.role || s.form_key || s.source || ''
      )}</h2>
      <p style="margin:0 0 16px;color:#888;font-size:13px">
        Источник: ${escapeHtml(s.source || '—')}${s.form_key ? ' / ' + escapeHtml(s.form_key) : ''}
        ${s.source_url ? `· <a href="${escapeHtml(s.source_url)}">${escapeHtml(s.source_url)}</a>` : ''}
      </p>
      <table style="border-collapse:collapse;font-size:14px">
        ${row('Имя', s.name)}
        ${row('Email', s.email)}
        ${row('Telegram', s.telegram)}
        ${row('Телефон', s.phone)}
        ${payloadRows}
      </table>
      ${testsBlock}
    </div>
  `;
}
