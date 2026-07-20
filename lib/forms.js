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

/** Сайты платформы, которым разрешено слать заявки (CORS + жёсткий Origin-чек). */
export const DEFAULT_ORIGINS = [
  'https://chudina.me',
  'https://www.chudina.me',
  'https://atlasintegra.ch',
  'https://www.atlasintegra.ch',
  'https://creox.ch',
  'https://www.creox.ch',
  'https://creox.vercel.app',
  'https://frankenplatz.ch',
  'https://www.frankenplatz.ch',
  'https://frankenplatz.vercel.app',
  'http://localhost:3000',
];

/**
 * Белый список origins: env FORMS_ALLOWED_ORIGINS (через запятую) целиком
 * заменяет дефолт — добавляя новый сайт, не забыть про env, если она задана.
 */
export function allowedOrigins(envValue) {
  const env = str(envValue, 2000);
  if (!env) return DEFAULT_ORIGINS;
  const list = env
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // env из одних пустышек (',,') дал бы пустой список → закрыл бы приём
  // всех заявок (403). Откатываемся на дефолт, как при отсутствии env.
  return list.length ? list : DEFAULT_ORIGINS;
}

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
    // time-trap: сколько мс человек заполнял форму (мгновенный сабмит = бот)
    elapsed_ms: Number.isFinite(Number(b.elapsed_ms)) ? Number(b.elapsed_ms) : null,
    // согласие на обработку перс. данных (GDPR / revDSG) — отмечено галочкой в форме
    consent: b.consent === true || b.consent === 'true',
    // просьба прислать отчёт САМОМУ отправителю (калькуляторы форума).
    // Опционально: у остальных сайтов платформы поведение не меняется.
    // В БД не пишется — route отбрасывает перед insert.
    send_report: b.send_report === true || b.send_report === 'true',
  };
}

/** Минимальное «человеческое» время заполнения формы, мс. Быстрее — считаем ботом. */
export const MIN_FILL_MS = 2500;

/** Мягкая нормализация email (нижний регистр, обрезка). Без строгой валидации. */
export function normalizeEmail(v) {
  const s = str(v, 200);
  if (!s) return null;
  return s.toLowerCase();
}

/** Число как строка или «—», если не число. */
function num(v) {
  return Number.isFinite(Number(v)) ? String(Number(v)) : '—';
}

/**
 * Человекочитаемый блок результатов психотестов для письма.
 * Знает структуру team.html (Мадди + Адизес PAEI); незнакомую структуру
 * показывает запасным JSON, чтобы ничего не потерять.
 */
export function renderTestsHtml(tests) {
  const t = plainObject(tests);
  const blocks = [`<h3 style="margin:20px 0 8px;color:#d52b1e">Результаты тестов</h3>`];

  if (t.started || t.finished) {
    blocks.push(
      `<p style="margin:0 0 10px;color:#888;font-size:13px">Начало: ${escapeHtml(
        String(t.started || '—')
      )} · Завершение: ${escapeHtml(String(t.finished || '—'))}</p>`
    );
  }

  const m = plainObject(t.maddi);
  if (Object.keys(m).length) {
    const p = plainObject(m.pct);
    blocks.push(
      `<div style="margin:0 0 14px;font-size:14px;line-height:1.5">` +
        `<b>Тест 01 · Жизнестойкость (Мадди)</b><br>` +
        `Общий уровень: <b>${num(m.total)}%</b>${m.zone ? ' (' + escapeHtml(String(m.zone)) + ')' : ''}<br>` +
        `Вовлечённость: ${num(p.C)}% · Контроль: ${num(p.K)}% · Принятие вызова: ${num(p.V)}%` +
        (m.top ? `<br>Сильная сторона: <b>${escapeHtml(String(m.top))}</b>` : '') +
        `</div>`
    );
  }

  const a = plainObject(t.adizes);
  if (Object.keys(a).length) {
    const p = plainObject(a.pct);
    blocks.push(
      `<div style="margin:0 0 14px;font-size:14px;line-height:1.5">` +
        `<b>Тест 02 · Роль в команде (Адизес PAEI)</b><br>` +
        (a.code ? `Код: <b>${escapeHtml(String(a.code))}</b><br>` : '') +
        `Результат (P): ${num(p.P)}% · Порядок (A): ${num(p.A)}% · Идеи (E): ${num(p.E)}% · Люди (I): ${num(p.I)}%` +
        (a.top ? `<br>Ведущая роль: <b>${escapeHtml(String(a.top))}</b>` : '') +
        (a.second ? ` · поддержка: <b>${escapeHtml(String(a.second))}</b>` : '') +
        `</div>`
    );
  }

  // Незнакомая структура (другие формы) — запасной JSON, чтобы данные не потерялись.
  if (!Object.keys(m).length && !Object.keys(a).length) {
    blocks.push(
      `<pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px;color:#333;background:#f6f6f6;padding:10px;border-radius:8px">${escapeHtml(
        JSON.stringify(t, null, 2)
      )}</pre>`
    );
  }
  return blocks.join('');
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

/** Сайт форума — ссылка в письме-отчёте. */
export const FORUM_URL = 'https://frankenplatz.ch';

/**
 * HTML письма-ОТЧЁТА, которое уходит САМОМУ отправителю (калькуляторы форума).
 *
 * Важно: текст письма собирается на сервере из уже сохранённых полей
 * (payload с результатами расчёта). Клиент не может задать содержимое —
 * иначе эндпоинт превратился бы в спам-релей с произвольным текстом.
 */
export function renderReportHtml(sub) {
  const s = plainObject(sub);
  const payload = plainObject(s.payload);
  const rows = Object.keys(payload)
    .map((k) => row(k, payload[k]))
    .join('');
  const what = s.role || s.form_key || 'расчёт';

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#B8860B">
        Frankenplatz · Форум о деньгах в Швейцарии
      </p>
      <h2 style="margin:0 0 12px;font-size:22px;color:#231433">Твой расчёт — ${escapeHtml(what)}</h2>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.5;color:#444">
        Ты сделал(а) расчёт на сайте форума и попросил(а) прислать результат. Вот он:
      </p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">${rows}</table>
      <p style="margin:20px 0 0;font-size:12.5px;line-height:1.5;color:#777">
        <b>Это не индивидуальная финансовая консультация.</b> Расчёт упрощён для наглядности:
        порядок величин верный, но реальный случай зависит от твоих точных данных.
      </p>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.5">
        Полные разборы с экспертами — на форуме
        <a href="${escapeHtml(FORUM_URL)}" style="color:#7B3FE4;font-weight:bold">Frankenplatz</a>,
        24–25 октября 2026.
      </p>
      <p style="margin:16px 0 0;font-size:11.5px;color:#999">
        Ты получил(а) это письмо, потому что оставил(а) свой e-mail в калькуляторе на сайте форума.
      </p>
    </div>
  `;
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

  const testsBlock =
    s.tests && typeof s.tests === 'object' ? renderTestsHtml(s.tests) : '';

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
