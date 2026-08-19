import { escapeHtml } from './ticket';
import { glossaryFor } from './glossary';

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
  'https://atlasintegra.vercel.app',
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
    // событие/кампания (slug, напр. 'frankenplatz-2026-10') — позволяет отличить
    // спикеров и участников КОНКРЕТНОГО форума от прочих людей в базе и от
    // будущих повторов. Заявки вне событий (chudina/creox) остаются без него.
    event: str(b.event, 80)?.toLowerCase() ?? null,
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
    // ОТДЕЛЬНОЕ согласие на рассылку (галочка в форме калькулятора).
    // Адрес человек оставляет ради отчёта — это не согласие на новости,
    // поэтому спрашиваем явно. Route по этому флагу заводит подписку с
    // двойным подтверждением. В БД поле не пишется.
    newsletter_optin: b.newsletter_optin === true || b.newsletter_optin === 'true',
  };
}

/** Метки кампаний, которые разбираем из адреса страницы. */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

/**
 * Атрибуция лида из `source_url`: откуда человек пришёл и на какой странице
 * оставил заявку. Разбираем на сервере, а не на фронте: метки уже лежат в
 * адресе страницы, который каждая форма и так присылает, — значит новых полей
 * собирать не нужно и это работает сразу для всех форм платформы.
 *
 * `landing` — только путь, без query: в query бывают чужие идентификаторы,
 * и хранить их в базе лида незачем.
 *
 * @param {string} sourceUrl адрес страницы, с которой отправлена форма
 * @returns {object|null} { utm_source?, ..., landing? } либо null, если пусто
 */
export function parseAttribution(sourceUrl) {
  const raw = str(sourceUrl, 2000);
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null; // кривой адрес — не повод ронять заявку
  }
  const out = {};
  for (const k of UTM_KEYS) {
    const v = str(url.searchParams.get(k), 200);
    if (v) out[k] = v;
  }
  const path = str(url.pathname, 300);
  if (path && path !== '/') out.landing = path;
  return Object.keys(out).length ? out : null;
}

/** Дефолтный ящик, если ничего не настроено. main@creox.ch — главный контакт платформы. */
export const DEFAULT_NOTIFY_EMAIL = 'main@creox.ch';

/** Дефолтная скрытая копия уведомления — платформенному ассистенту. */
export const DEFAULT_NOTIFY_CC = 'assistant@creox.ch';

/**
 * СКРЫТАЯ копия уведомления (BCC), а не CC — решение Иванны 2026-08-07.
 * У уведомления Reply-To стоит на заявителя: с видимым CC ответ «всем» из
 * ящика форума раскрыл бы служебный адрес постороннему человеку.
 *
 * Env: FORMS_NOTIFY_BCC (приоритет) или прежняя FORMS_NOTIFY_CC — имя оставлено
 * ради совместимости с уже заданной переменной в Vercel.
 * Не задано → дефолт assistant@creox.ch; пустая строка → без копии.
 */
export function notifyCcFor(ccEnv) {
  if (ccEnv === undefined || ccEnv === null) return DEFAULT_NOTIFY_CC;
  return str(ccEnv, 200) || undefined;
}

/**
 * Разбирает карту «сайт=ящик» из env FORMS_NOTIFY_MAP.
 * Формат: 'forum=info@frankenplatz.ch,chudina=main@chudina.me'
 * Кривые куски молча пропускаем — уведомления важнее строгости.
 */
export function parseNotifyMap(envValue) {
  const env = str(envValue, 2000);
  const out = {};
  if (!env) return out;
  for (const pair of env.split(',')) {
    const i = pair.indexOf('=');
    if (i < 1) continue;
    const k = pair.slice(0, i).trim().toLowerCase();
    const v = pair.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

/**
 * Куда слать уведомление о заявке — зависит от сайта-источника,
 * чтобы заявки форума не падали в ящик chudina и наоборот.
 * Приоритет: карта по source → общий FORMS_NOTIFY_EMAIL → дефолт.
 */
export function notifyEmailFor(source, mapEnv, fallbackEnv) {
  const key = str(source, 60)?.toLowerCase();
  const mapped = key ? parseNotifyMap(mapEnv)[key] : null;
  return mapped || str(fallbackEnv, 200) || DEFAULT_NOTIFY_EMAIL;
}

/**
 * «От кого» служебных писем (уведомление оргам / дневная сводка) — по бренду
 * сайта-источника. Иначе заявка ФОРУМА приходила бы от SoiLüDi/slswiss.ch.
 * Пока брендируем только forum → Frankenplatz; остальные сайты — общий дефолт.
 */
export function notifyFromFor(source, forumFromEnv, defaultFromEnv) {
  const key = str(source, 60)?.toLowerCase();
  if (key === 'forum') {
    return str(forumFromEnv, 200) || 'Frankenplatz <info@frankenplatz.ch>';
  }
  return str(defaultFromEnv, 200) || 'SoiLüDi <noreply@slswiss.ch>';
}

/**
 * Подписки на рассылку не шлём поштучно — они идут дневной сводкой
 * (роут /api/cron/newsletter-digest), иначе ящик забивается.
 */
export function shouldNotifyImmediately(sub) {
  return plainObject(sub).form_key !== 'newsletter';
}

/**
 * Письмо-подтверждение ранней регистрации на форум.
 *
 * Честно проговариваем статус: запись в списке — это НЕ билет, место
 * закрепляет только покупка. Раньше здесь стояло «продажи пока не открыты»
 * — верно, пока билетов не было. Продажи открылись, и письмо стало
 * отговаривать самого готового человека: он оставил контакты и получал
 * ответ «купить пока нельзя». Теперь ведём его на билеты.
 * Содержимое собирает сервер из сохранённых полей.
 */
export function renderRegistrationHtml(sub) {
  const s = plainObject(sub);
  const hi = s.name ? `${escapeHtml(String(s.name))}, привет!` : 'Привет!';
  const event = s.event || 'frankenplatz-2026-10';
  const ctaHref = escapeHtml(withUtm(`${FORUM_URL}/tickets`, 'registration', event, 'cta'));
  const calcHref = escapeHtml(withUtm(`${FORUM_URL}/calculators`, 'registration', event, 'calculators'));
  return emailShell({
    title: 'Frankenplatz — Ранняя регистрация',
    heading: 'Ты в списке ранней регистрации',
    lead: `${hi} Мы записали тебя и будем писать первым(ой) — о программе, спикерах и всём, что меняется. <b>Место это пока не держит</b>: закрепляет его только билет, а их количество ограничено залом.`,
    blocks: reportRowsDesigned(s.payload),
    cta: {
      href: ctaHref,
      label: 'Посмотреть билеты',
      lead: 'Билеты уже продаются. Ранняя цена действует, пока есть места в этой категории.',
    },
    footerNoteHtml: 'Это письмо — по заявке, оставленной на frankenplatz.ch.',
    footerLinkHtml:
      `<a href="${calcHref}" style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:12px;color:#B98BFF;text-decoration:underline;display:inline-block;margin-top:8px">Калькуляторы форума — бесплатно, без регистрации</a>`,
  });
}

/**
 * Plain-text версия письма ранней регистрации.
 * Наличие text-части рядом с HTML — заметный анти-спам сигнал (письма
 * без текстовой альтернативы почтовики скорят выше как подозрительные).
 */
export function renderRegistrationText(sub) {
  const s = plainObject(sub);
  const rows = textRows(s.payload);
  const hi = s.name ? `${String(s.name)}, привет!` : 'Привет!';
  return [
    'FRANKENPLATZ · 24–25 октября 2026 · Baden',
    '',
    'Ты в списке ранней регистрации',
    '',
    `${hi} Мы записали тебя и будем писать первым(ой) — о программе, спикерах и всём, что меняется. Место это пока не держит: закрепляет его только билет, а их количество ограничено залом.`,
    ...(rows ? ['', rows] : []),
    '',
    `Билеты уже продаются, ранняя цена действует, пока есть места в категории: ${withUtm(
      `${FORUM_URL}/tickets`,
      'registration',
      s.event || 'frankenplatz-2026-10',
      'cta'
    )}`,
    '',
    `Калькуляторы форума — бесплатно и без регистрации: ${withUtm(
      `${FORUM_URL}/calculators`,
      'registration',
      s.event || 'frankenplatz-2026-10',
      'calculators'
    )}`,
    '',
    '—',
    'Это письмо — по заявке, оставленной на frankenplatz.ch',
  ].join('\n');
}

/**
 * Письмо-подтверждение спикеру: анкета получена.
 *
 * Обещание срока («в течение недели») — осознанное: спикер должен знать,
 * когда ждать ответа, иначе уходит к другим площадкам. Если срок поменяется,
 * править здесь — текст в одном месте.
 */
export function renderSpeakerHtml(sub) {
  const s = plainObject(sub);
  const hi = s.name ? `${escapeHtml(String(s.name))}, спасибо!` : 'Спасибо!';
  const event = s.event || 'frankenplatz-2026-10';
  const speakersHref = escapeHtml(withUtm(`${FORUM_URL}/speakers`, 'speaker', event, 'footer'));
  const rowsCard = reportRowsDesigned(s.payload);
  const submitted = rowsCard
    ? `
  <tr><td class="fp-pad" style="padding:16px 34px 0">
    <p style="margin:0;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:13px;color:#9A8BB3">Что ушло в заявке:</p>
  </td></tr>${rowsCard}`
    : '';
  const replyNote = `
  <tr><td class="fp-pad" style="padding:18px 34px 6px">
    <p style="margin:0;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#C3B7D4">Если нужно что-то дополнить или поправить — просто ответь на это письмо.</p>
  </td></tr>`;
  return emailShell({
    title: 'Frankenplatz — Анкета спикера',
    heading: 'Анкета спикера получена',
    lead: `${hi} Мы получили твою заявку и обязательно её посмотрим. <b>Ответим в течение недели</b> — независимо от решения, без ответа не оставим.`,
    blocks: submitted + replyNote,
    footerNoteHtml: `Это письмо — по анкете спикера, отправленной на <a href="${speakersHref}" style="color:#7A6C93">frankenplatz.ch</a>.`,
  });
}

/** Plain-text версия письма спикеру (text-часть рядом с HTML — анти-спам). */
export function renderSpeakerText(sub) {
  const s = plainObject(sub);
  const rows = textRows(s.payload);
  const hi = s.name ? `${String(s.name)}, спасибо!` : 'Спасибо!';
  return [
    'FRANKENPLATZ · 24–25 октября 2026 · Baden',
    '',
    'Анкета спикера получена',
    '',
    `${hi} Мы получили твою заявку и обязательно её посмотрим. Ответим в течение недели — независимо от решения, без ответа не оставим.`,
    ...(rows ? ['', 'Что ушло в заявке:', rows] : []),
    '',
    'Если нужно что-то дополнить или поправить — просто ответь на это письмо.',
    '',
    '—',
    'Это письмо — по анкете спикера, отправленной на frankenplatz.ch/speakers',
  ].join('\n');
}

/**
 * Письмо-автоответ отправителю с доски «Оказия» (form_key
 * 'okaziya-request' — заявка на объявление, 'okaziya-listing' — новое
 * объявление). Доска пока работает в ручном режиме (нет бэкенда матчинга),
 * поэтому честно проговариваем: свяжет команда, а не автоматика. Содержимое
 * собирает сервер из сохранённого payload — клиент текст не задаёт.
 */
export function renderOkaziyaHtml(sub) {
  const s = plainObject(sub);
  const isListing = s.form_key === 'okaziya-listing';
  const hi = s.name ? `${escapeHtml(String(s.name))}, спасибо!` : 'Спасибо!';
  const heading = isListing ? 'Объявление получено' : 'Заявка получена';
  const lead = isListing
    ? `${hi} Мы получили твоё объявление на доске «Оказия». Доска пока работает в ручном режиме: команда Frankenplatz свяжет тебя с теми, кому по пути. <b>Ответим в течение пары дней.</b>`
    : `${hi} Мы получили твою заявку на доске «Оказия». Команда Frankenplatz подберёт того, кто везёт, и свяжет вас напрямую. <b>Ответим в течение пары дней.</b>`;
  const rows = reportRowsDesigned(s.payload);
  const submitted = rows
    ? `
  <tr><td class="fp-pad" style="padding:16px 34px 0">
    <p style="margin:0;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:13px;color:#9A8BB3">Что ушло в заявке:</p>
  </td></tr>${rows}`
    : '';
  const replyNote = `
  <tr><td class="fp-pad" style="padding:18px 34px 6px">
    <p style="margin:0;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#C3B7D4">Нужно что-то дополнить или поправить — просто ответь на это письмо.</p>
  </td></tr>`;
  return emailShell({
    title: 'Frankenplatz — Оказия',
    heading,
    lead,
    blocks: submitted + replyNote,
    footerNoteHtml:
      'Это письмо — по заявке на доске «Оказия» (frankenplatz.ch).',
  });
}

/** Plain-text версия письма «Оказии» (text-часть рядом с HTML — анти-спам). */
export function renderOkaziyaText(sub) {
  const s = plainObject(sub);
  const isListing = s.form_key === 'okaziya-listing';
  const rows = textRows(s.payload);
  const hi = s.name ? `${String(s.name)}, спасибо!` : 'Спасибо!';
  const what = isListing ? 'объявление' : 'заявку';
  return [
    'FRANKENPLATZ · Оказия',
    '',
    isListing ? 'Объявление получено' : 'Заявка получена',
    '',
    `${hi} Мы получили твою ${what} на доске «Оказия». Команда Frankenplatz свяжет тебя напрямую. Ответим в течение пары дней.`,
    ...(rows ? ['', 'Что ушло в заявке:', rows] : []),
    '',
    'Нужно что-то дополнить или поправить — просто ответь на это письмо.',
    '',
    '—',
    'Это письмо — по заявке на доске «Оказия» (frankenplatz.ch)',
  ].join('\n');
}

/** За какой период собирается дневная сводка подписок, часов. */
export const DIGEST_WINDOW_HOURS = 24;

/**
 * HTML дневной сводки новых подписчиков. Всё пользовательское экранируется.
 * Отдельная чистая функция — чтобы тестировать без сети и env.
 */
export function renderDigestHtml(source, rows, hours = DIGEST_WINDOW_HOURS) {
  const list = Array.isArray(rows) ? rows : [];
  const items = list
    .map((r) => {
      const when = r && r.created_at ? String(r.created_at).slice(0, 16).replace('T', ' ') : '—';
      const ev = r && r.event ? ` · ${escapeHtml(String(r.event))}` : '';
      return (
        `<tr><td style="padding:5px 14px 5px 0;color:#666;white-space:nowrap">${escapeHtml(when)}</td>` +
        `<td style="padding:5px 0;color:#1a1a1a"><b>${escapeHtml(String((r && r.email) || '—'))}</b>` +
        `<span style="color:#888;font-size:12px">${ev}</span></td></tr>`
      );
    })
    .join('');

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
      <h2 style="margin:0 0 4px;font-size:20px">Новые подписчики: ${list.length}</h2>
      <p style="margin:0 0 16px;color:#888;font-size:13px">
        Сайт: ${escapeHtml(String(source || '—'))} · за последние ${Number(hours)} ч
      </p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">${items}</table>
      <p style="margin:18px 0 0;font-size:12px;color:#999">
        Поштучные письма о подписке отключены — это сводка раз в сутки.
        Полный список всегда в базе (представление v_people).
      </p>
    </div>
  `;
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

/**
 * Строки «ключ: значение» для plain-text письма (одна на строку).
 * Экранирование НЕ нужно — это текстовая часть, а не HTML.
 */
function textRows(payload) {
  const p = plainObject(payload);
  return Object.keys(p)
    .filter((k) => p[k] != null && p[k] !== '')
    .map((k) => `${k}: ${p[k]}`)
    .join('\n');
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
/**
 * Добавляет UTM-метки к ссылке на наш сайт — чтобы в GA4 видеть переходы из писем.
 * medium всегда `email` (единый канал), source = тип письма, campaign = событие,
 * content — деталь (напр. какой калькулятор). Значения кодируются (encodeURIComponent).
 * Для HTML-атрибута href результат дополнительно прогнать через escapeHtml (амперсанды).
 */
export function withUtm(url, source, campaign, content) {
  const u = String(url || '');
  const parts = [
    `utm_source=${encodeURIComponent(source || 'email')}`,
    'utm_medium=email',
    `utm_campaign=${encodeURIComponent(campaign || 'frankenplatz-2026-10')}`,
  ];
  if (content) parts.push(`utm_content=${encodeURIComponent(content)}`);
  return u + (u.includes('?') ? '&' : '?') + parts.join('&');
}

/** Золотая «пилюля»-кнопка дизайнера (bulletproof для почтовиков). */
function goldButton(href, label) {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr>` +
    `<td bgcolor="#F5C969" style="border-radius:40px;background:#F5C969;background:linear-gradient(180deg,#F7D488 0%,#E6B450 100%)">` +
    `<a href="${href}" style="display:inline-block;padding:15px 34px;font-family:'Manrope',Arial,Helvetica,sans-serif;font-weight:800;font-size:15px;color:#2A1A05;text-decoration:none;border-radius:40px">${label}</a>` +
    `</td></tr></table>`
  );
}

/**
 * Единая премиум-обёртка письма Frankenplatz (тёмная тема дизайнера): шапка,
 * eyebrow, заголовок, лид, произвольные блоки, опц. CTA-кнопка, футер.
 * Все 4 письма (отчёт/подтверждение/регистрация/спикер) строятся через неё.
 * Значения, приходящие от пользователя, экранируются В ВЫЗЫВАЮЩЕЙ функции.
 */
/**
 * Бренды писем. Форум и бренд-маркет — два разных события с разными датами.
 * До 19.08 человек, написавший про пальто, получал письмо с шапкой «форум о
 * деньгах в Швейцарии · 24–25 октября»: чужая тема и чужая дата в письме,
 * которое должно подтверждать интерес к вещи на маркете 27 сентября.
 */
const EMAIL_BRANDS = {
  forum: {
    wordmark: 'Frankenplatz',
    when: '24–25 октября · Baden',
    eyebrow: 'Frankenplatz · форум о деньгах в Швейцарии',
  },
  market: {
    wordmark: 'FASHION REBORN',
    when: '27 сентября · Baden',
    eyebrow: 'Бренд-маркет Frankenplatz',
  },
};

function emailShell({ title, heading, lead = '', blocks = '', cta = null, footerNoteHtml = '', footerLinkHtml = '', brand = 'forum' }) {
  const B = EMAIL_BRANDS[brand] || EMAIL_BRANDS.forum;
  const ctaRow = cta
    ? `  <tr><td class="fp-pad" align="center" style="padding:24px 34px 30px">
    ${cta.lead ? `<p style="margin:0 0 18px;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#C3B7D4">${cta.lead}</p>` : ''}
    ${goldButton(cta.href, cta.label)}
  </td></tr>`
    : '';
  return `<!doctype html>
<html lang="ru" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${title}</title>
<style>
  body{margin:0;padding:0;background:#0d0715;}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;display:block;}
  a{color:#B98BFF;}
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800&family=Manrope:wght@400;500;700;800&display=swap');
  @media only screen and (max-width:620px){
    .fp-wrap{width:100%!important;}
    .fp-pad{padding-left:20px!important;padding-right:20px!important;}
    .fp-hero-num{font-size:44px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#0d0715;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0d0715;background:radial-gradient(1200px 500px at 20% -10%, rgba(155,110,255,.18), transparent 60%), radial-gradient(1000px 600px at 90% 20%, rgba(230,180,80,.10), transparent 55%), #0d0715;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="fp-wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#140A1F;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,.08);">

  <tr><td class="fp-pad" style="padding:22px 34px;border-bottom:1px solid rgba(255,255,255,.08)">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" style="font-family:'Unbounded','Manrope',Arial,Helvetica,sans-serif;font-weight:800;font-size:18px;letter-spacing:-.02em;color:#F3EEF9">${B.wordmark}</td>
      <td align="right" style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-weight:700;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#E6B450">${B.when}</td>
    </tr></table>
  </td></tr>

  <tr><td class="fp-pad" style="padding:38px 34px 6px">
    <div style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-weight:700;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#E6B450;margin:0 0 16px">${B.eyebrow}</div>
    <h1 style="margin:0;font-family:'Unbounded','Manrope',Arial,Helvetica,sans-serif;font-weight:800;font-size:30px;line-height:1.18;letter-spacing:-.02em;color:#FFFFFF">${heading}</h1>
    ${lead ? `<p style="margin:16px 0 0;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#C3B7D4">${lead}</p>` : ''}
  </td></tr>
${blocks}
${ctaRow}
  <tr><td class="fp-pad" style="padding:24px 34px 28px;border-top:1px solid rgba(255,255,255,.08);background:#100818">
    <div style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:12px;color:#7A6C93;line-height:1.5">${footerNoteHtml}</div>
    ${footerLinkHtml}
  </td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

/**
 * Строки payload в стиле дизайнера (одна стеклянная карточка, ряды с
 * разделителем). payload — произвольные пары «подпись → значение», поэтому
 * рендерим их единообразно (шаблон-«обёртка» дизайнера один на все калькуляторы).
 */
function reportRowsDesigned(payload) {
  const p = plainObject(payload);
  const keys = Object.keys(p).filter((k) => p[k] != null && p[k] !== '');
  if (!keys.length) return '';
  const rows = keys
    .map((k, i) => {
      const bb = i === keys.length - 1 ? '' : 'border-bottom:1px solid rgba(255,255,255,.06);';
      return (
        `<tr>` +
        `<td align="left" style="padding:14px 0;${bb}font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:14px;color:#C3B7D4">${escapeHtml(
          k
        )}</td>` +
        `<td align="right" style="padding:14px 0;${bb}font-family:'Unbounded','Manrope',Arial,Helvetica,sans-serif;font-weight:800;font-size:16px;color:#F3EEF9">${escapeHtml(
          String(p[k])
        )}</td>` +
        `</tr>`
      );
    })
    .join('');
  return `
  <tr><td class="fp-pad" style="padding:20px 34px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:16px">
      <tr><td style="padding:6px 22px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
      </td></tr>
    </table>
  </td></tr>`;
}

/**
 * Ссылка на форму подписки в футере сайта.
 * Якорь ставится ПОСЛЕ параметров: в `site/#subscribe?utm=…` всё, что после
 * решётки, — это фрагмент, поэтому и метки не дошли бы до аналитики, и
 * браузер искал бы элемент с id «subscribe?utm_source=…» вместо формы.
 */
function subscribeLink(event) {
  return `${withUtm(`${FORUM_URL}/`, 'calc-report', event, 'report-subscribe')}#subscribe`;
}

/**
 * Блок «что означают понятия» для письма-отчёта. Термины подбирает
 * lib/glossary по конкретному расчёту — весь словарь не выгружаем.
 * Пусто → блока в письме нет вовсе.
 */
function glossaryBlockDesigned(items) {
  if (!items || !items.length) return '';
  const rows = items
    .map(
      (t, i) =>
        `<tr><td style="padding:${i ? '14px' : '2px'} 0 0">` +
        `<div style="font-family:'Unbounded','Manrope',Arial,Helvetica,sans-serif;font-weight:800;font-size:14px;color:#F3EEF9">${escapeHtml(
          t.title
        )}</div>` +
        `<div style="margin-top:4px;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.55;color:#C3B7D4">${escapeHtml(
          t.def
        )}</div>` +
        `</td></tr>`
    )
    .join('');
  return `
  <tr><td class="fp-pad" style="padding:26px 34px 0">
    <div style="font-family:'Unbounded','Manrope',Arial,Helvetica,sans-serif;font-weight:800;font-size:17px;color:#FFFFFF">Что означают понятия из расчёта</div>
    <div style="margin-top:6px;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:13px;color:#9A8BB3">Только те, которые встретились именно в твоём случае.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:16px">
      <tr><td style="padding:16px 20px 18px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
      </td></tr>
    </table>
  </td></tr>`;
}

/**
 * HTML письма-ОТЧЁТА калькулятора (уходит САМОМУ отправителю по send_report).
 *
 * Премиум-шаблон дизайнера Frankenplatz (единая «обёртка» для всех 5
 * калькуляторов): тёмная тема, шапка, заголовок с градиентом, дисклеймер, CTA,
 * футер. Результаты подставляет СЕРВЕР из сохранённого payload (клиент текст не
 * задаёт — иначе эндпоинт стал бы спам-релеем). Ссылка отписки — mailto на
 * читаемый ящик info@ (у отчётов нет per-row токена, как у подписки).
 */
export function renderReportHtml(sub) {
  const s = plainObject(sub);
  const what = escapeHtml(s.role || s.form_key || 'расчёт');
  const event = s.event || 'frankenplatz-2026-10';
  /* Отчёт приходит самому прогретому человеку: он только что считал свои
     деньги. Раньше кнопка вела на главную — «Забронировать место», когда
     бронировать было нечего. Продажи открыты, поэтому ведём на билеты. */
  const ctaHref = escapeHtml(withUtm(`${FORUM_URL}/tickets`, 'calc-report', event, s.form_key || 'report'));
  const heading =
    `Твой расчёт — <span style="background:linear-gradient(90deg,#B98BFF 0%,#F5C969 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#F5C969">${what}</span>`;
  const disclaimer = `
  <tr><td class="fp-pad" style="padding:22px 34px 6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:16px 18px;border-left:3px solid #E6B450;background:rgba(255,255,255,.035);border-radius:0 12px 12px 0">
        <span style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#9A8BB3"><b style="color:#C3B7D4">Это не индивидуальная финансовая консультация.</b> Расчёт упрощён для наглядности: порядок величин верный, но реальный случай зависит от твоих точных данных.</span>
      </td>
    </tr></table>
  </td></tr>`;
  /* Предложение подписки — только тем, кто НЕ отметил галочку в форме.
     Момент удачный: человек открыл письмо, значит расчёт пригодился, ценность
     уже доказана. Ссылка ведёт на форму подписки в футере сайта (double
     opt-in), а не подписывает по клику: клик из письма подписью не считаем. */
  const subscribeOffer = s.newsletter_optin
    ? ''
    : `
  <tr><td class="fp-pad" style="padding:22px 34px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(185,139,255,.08);border:1px solid rgba(185,139,255,.25);border-radius:16px">
      <tr><td style="padding:18px 20px">
        <div style="font-family:'Unbounded','Manrope',Arial,Helvetica,sans-serif;font-weight:800;font-size:15px;color:#F3EEF9">Программа и спикеры — раньше всех</div>
        <div style="margin-top:6px;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.55;color:#C3B7D4">Это отдельная подписка: расчёт мы прислали и без неё. Новости форума — программа, спикеры, старт продаж. Отписка одним кликом в любом письме.<br><a href="${escapeHtml(
          subscribeLink(event)
        )}" style="color:#B98BFF;font-weight:700;text-decoration:underline;display:inline-block;margin-top:8px">Подписаться на новости форума</a></div>
      </td></tr>
    </table>
  </td></tr>`;
  return emailShell({
    title: `Frankenplatz — ${what}`,
    heading,
    lead: 'Расчёт с сайта форума готов. Вот он целиком — чтобы не держать в голове:',
    blocks:
      reportRowsDesigned(s.payload) +
      glossaryBlockDesigned(glossaryFor(s)) +
      subscribeOffer +
      disclaimer,
    cta: {
      href: ctaHref,
      label: 'Посмотреть билеты',
      lead: 'Полные разборы с экспертами — на форуме <span style="color:#B98BFF;font-weight:700">Frankenplatz</span>,<br>24–25 октября 2026.',
    },
    footerNoteHtml:
      'Это письмо — по e-mail, оставленному в калькуляторе на сайте форума.',
    footerLinkHtml:
      `<a href="${escapeHtml(
        withUtm(`${FORUM_URL}/calculators`, 'calc-report', event, 'all-calculators')
      )}" style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:12px;color:#B98BFF;text-decoration:underline;display:inline-block;margin-top:8px">Все калькуляторы Frankenplatz</a>` +
      `<a href="mailto:info@frankenplatz.ch?subject=Unsubscribe" style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:12px;color:#7A6C93;text-decoration:underline;display:inline-block;margin-top:8px;margin-left:14px">Отписаться</a>`,
  });
}

/** Plain-text версия письма-отчёта калькулятора (text-часть рядом с HTML — анти-спам). */
export function renderReportText(sub) {
  const s = plainObject(sub);
  const rows = textRows(s.payload);
  const what = s.role || s.form_key || 'расчёт';
  const terms = glossaryFor(s);
  const glossary = terms.length
    ? [
        '',
        'ЧТО ОЗНАЧАЮТ ПОНЯТИЯ ИЗ РАСЧЁТА',
        'Только те, которые встретились именно в твоём случае.',
        '',
        ...terms.map((t) => `${t.title} — ${t.def}`),
      ]
    : [];
  return [
    'FRANKENPLATZ · Форум о деньгах в Швейцарии',
    '',
    `Твой расчёт — ${what}`,
    '',
    'Расчёт с сайта форума готов. Вот он целиком — чтобы не держать в голове:',
    ...(rows ? ['', rows] : []),
    ...glossary,
    ...(s.newsletter_optin
      ? []
      : [
          '',
          'ПРОГРАММА И СПИКЕРЫ — РАНЬШЕ ВСЕХ',
          'Это отдельная подписка: расчёт мы прислали и без неё. Отписка одним кликом в любом письме.',
          subscribeLink(s.event || 'frankenplatz-2026-10'),
        ]),
    '',
    'Это не индивидуальная финансовая консультация. Расчёт упрощён для наглядности: порядок величин верный, но реальный случай зависит от твоих точных данных.',
    '',
    `Полные разборы с экспертами — на форуме Frankenplatz, 24–25 октября 2026. Билеты: ${withUtm(
      `${FORUM_URL}/tickets`,
      'calc-report',
      s.event || 'frankenplatz-2026-10',
      s.form_key || 'report'
    )}`,
    '',
    `Все калькуляторы: ${withUtm(
      `${FORUM_URL}/calculators`,
      'calc-report',
      s.event || 'frankenplatz-2026-10',
      'all-calculators'
    )}`,
    '',
    '—',
    'Это письмо — по e-mail, оставленному в калькуляторе на сайте форума.',
  ].join('\n');
}

/**
 * HTML письма-БИЛЕТА форума (после оплаты) — отдельный полный шаблон дизайнера
 * (богаче общей emailShell): hero с именем, крупный QR в белой карточке,
 * таблица заказа (Билет · Дата · Место · Оплачено · Заказ №), кнопка календаря,
 * блок ссылок, «что дальше», условия возврата, футер.
 *
 * `sub` = { name, description, amount(рапены), code(«FP-2026-0417»), dateTime, icsUrl }.
 * Все значения от пользователя (name, description) экранируются здесь.
 * qrUrl — картинка QR (строит sendForumTicketEmail из lib/ticket): наш /api/qr,
 * НЕ внешний генератор — сканер на входе читает именно нашу ссылку.
 */
export function renderForumTicketHtml(sub, qrUrl) {
  const s = plainObject(sub);
  const name = s.name ? escapeHtml(String(s.name)) : '';
  const chf = (Number(s.amount) / 100).toFixed(2);
  const code = escapeHtml(String(s.code || '—'));
  const ticketLine = escapeHtml(String(s.description || 'Билет на форум'));
  const dateTime = escapeHtml(String(s.dateTime || '24–25 октября, 09:30 — 18:00'));
  const qr = escapeHtml(String(qrUrl || ''));
  const ics = escapeHtml(String(s.icsUrl || 'https://frankenplatz.ch'));
  const F = "'Manrope',Arial,Helvetica,sans-serif";
  const U = "'Unbounded','Manrope',Arial,Helvetica,sans-serif";
  const gradientName = `<span style="color:#F5C969;background:linear-gradient(90deg,#B98BFF,#F5C969);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">${name} 🎫</span>`;
  const heading = name ? `Билет у тебя, ${gradientName}` : `Билет у тебя 🎫`;

  // Одна строка таблицы «label → value».
  const row = (label, value, valueStyle = '') =>
    `<tr><td class="fp-row-l" width="34%" align="left" valign="middle" style="padding:16px 20px;font-family:${F};font-size:13px;color:#9A8BB3">${label}</td>` +
    `<td class="fp-row-v" align="right" valign="middle" style="padding:16px 20px 16px 0;font-family:${F};font-weight:800;font-size:15px;line-height:1.45;color:#F3EEF9;${valueStyle}">${value}</td></tr>`;
  const rowDivider =
    `<tr><td colspan="2" style="padding:0 20px"><div style="height:1px;background:rgba(255,255,255,.10);line-height:1px;font-size:0">&nbsp;</div></td></tr>`;

  // Ссылка в блоке «Всё по билету».
  const linkRow = (href, title, sub2, last = false) =>
    `<tr><td style="padding:0"><a href="${href}" style="display:block;padding:15px 20px;text-decoration:none;${
      last ? '' : 'border-bottom:1px solid rgba(255,255,255,.10);'
    }"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="left" valign="middle" style="font-family:${F};font-size:15px;line-height:1.4;color:#F3EEF9;font-weight:700">${title}<br><span style="font-weight:500;font-size:12.5px;color:#9A8BB3">${sub2}</span></td>` +
    `<td align="right" valign="middle" width="24" style="font-family:${F};font-weight:800;font-size:17px;color:#F5C969">→</td>` +
    `</tr></table></a></td></tr>`;

  // Пункт «Что дальше».
  const step = (text) =>
    `<tr><td valign="top" style="font-family:${F};font-weight:800;font-size:16px;line-height:1.6;color:#F5C969;padding:0 12px 9px 0">→</td>` +
    `<td valign="top" style="font-family:${F};font-size:15px;line-height:1.6;color:#C3B7D4;padding:0 0 9px">${text}</td></tr>`;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>Frankenplatz 2026 — твой билет</title>
<style>
  body{margin:0;padding:0;background:#0d0715;}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
  a{color:#B98BFF;}
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800&family=Manrope:wght@400;500;700;800&display=swap');
  @media only screen and (max-width:480px){
    .fp-wrap{width:100%!important;}
    .fp-pad{padding-left:20px!important;padding-right:20px!important;}
    .fp-row-l{display:block!important;width:100%!important;padding:16px 20px 2px 20px!important;text-align:left!important;}
    .fp-row-v{display:block!important;width:100%!important;padding:0 20px 16px 20px!important;text-align:left!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#0d0715;">
<span style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Форум о личных финансах в Швейцарии. 24–25 октября, Baden. Твой QR-билет внутри.</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0d0715;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="fp-wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#140A1F;border-radius:18px;overflow:hidden;">

<tr><td class="fp-pad" style="padding:22px 30px;border-bottom:1px solid rgba(255,255,255,.10)"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="left" style="font-family:${U};font-weight:800;font-size:19px;letter-spacing:.01em;color:#FFFFFF">Frankenplatz.ch</td><td align="right" style="font-family:${F};font-weight:700;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#E6B450">24–25.10.2026 · Baden</td></tr></table></td></tr>

<tr><td class="fp-pad" style="padding:44px 30px 38px;background:radial-gradient(120% 95% at 0% 0%, rgba(155,110,255,.15), transparent 55%),radial-gradient(120% 95% at 100% 100%, rgba(230,180,80,.10), transparent 55%),#140A1F"><div style="font-family:${F};font-weight:700;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#E6B450;margin:0 0 14px"><span style="display:inline-block;width:22px;height:2px;background:#E6B450;vertical-align:middle;margin-right:10px"></span>FRANKENPLATZ · ФОРУМ О ДЕНЬГАХ В ШВЕЙЦАРИИ</div><h1 style="margin:0;font-family:${U};font-weight:800;font-size:31px;line-height:1.16;letter-spacing:-.02em;color:#FFFFFF">${heading}</h1><p style="margin:18px 0 0;font-family:${F};font-size:16px;line-height:1.6;color:#C3B7D4">Оплата прошла. Покажи этот QR на входе — его отсканируют. Билет также лежит вложением в письме.</p></td></tr>

<tr><td class="fp-pad" style="padding:14px 30px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);border-top:1px solid rgba(255,255,255,.16);border-radius:18px"><tr><td align="center" style="padding:26px 28px 22px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:16px;padding:14px"><img src="${qr}" width="200" height="200" alt="QR-код билета" style="display:block;width:200px;height:200px;border-radius:6px"></td></tr></table><div style="font-family:${F};font-weight:700;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#9A8BB3;margin-top:16px">Код билета</div><div style="font-family:${U};font-weight:800;font-size:20px;letter-spacing:.04em;color:#F3EEF9;margin-top:6px">${code}</div></td></tr></table></td></tr>

<tr><td class="fp-pad" style="padding:12px 30px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.10);border-top:1px solid rgba(255,255,255,.16);border-radius:16px">${row(
    'Билет',
    ticketLine
  )}${rowDivider}${row('Дата и время', dateTime)}${rowDivider}${row(
    'Место',
    'Baden 🇨🇭 · 15 мин от Zürich HB'
  )}${rowDivider}${row(
    'Оплачено',
    `${chf} CHF`,
    "font-family:'Unbounded','Manrope',Arial,Helvetica,sans-serif;font-size:21px;letter-spacing:-.02em;color:#86E0B0"
  )}${rowDivider}${row('Заказ', `№ ${code}`)}</table></td></tr>

<tr><td class="fp-pad" style="padding:16px 30px" align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr><td bgcolor="#F5C969" style="border-radius:40px;background:linear-gradient(180deg,#F7D488,#E6B450);"><a href="${ics}" style="display:inline-block;padding:14px 32px;font-family:${F};font-weight:800;font-size:15px;letter-spacing:.005em;color:#2A1A05;text-decoration:none;border-radius:40px">Добавить в календарь</a></td></tr></table></td></tr>

<tr><td class="fp-pad" style="padding:16px 30px 8px"><div style="font-family:${F};font-weight:700;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#E6B450;margin:0 0 12px">Всё по билету</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.10);border-radius:16px">${linkRow(
    'https://maps.google.com/?q=Trafo+Baden+Brown-Boveri-Platz+1',
    'Локация и как добраться',
    'Baden 🇨🇭 · 15 мин от Zürich HB'
  )}${linkRow(
    'https://frankenplatz.ch/#program',
    'Программа форума',
    'Кто выступает и в каком порядке'
  )}${linkRow(
    'https://frankenplatz.ch/calculators',
    'Калькуляторы',
    'Бесплатно, без регистрации'
  )}${linkRow(
    'https://frankenplatz.ch/legal#agb',
    'AGB — условия участия',
    'Правила, возврат, перенос билета',
    true
  )}</table></td></tr>

<tr><td class="fp-pad" style="padding:8px 30px"><h2 style="margin:0 0 12px;font-family:${U};font-weight:800;font-size:22px;line-height:1.2;letter-spacing:-.02em;color:#FFFFFF">Что дальше</h2><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 14px">${step(
    'За два дня до форума пришлём программу, схему зала и расписание по времени.'
  )}${step('Приходи за 20 минут до начала — регистрация и кофе.')}${step(
    'Ничего распечатывать не нужно: QR с экрана телефона работает.'
  )}</table></td></tr>

<tr><td class="fp-pad" style="padding:14px 30px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:20px 24px;border-left:3px solid #F5C969;background:rgba(255,255,255,.045);border-radius:0 14px 14px 0"><div style="font-family:${U};font-weight:600;font-size:18px;line-height:1.4;color:#F3EEF9">«Планы изменились? Ответь на это письмо — переоформим билет на другого человека или вернём деньги до 10 октября»</div><div style="font-family:${F};font-weight:700;font-size:13px;color:#E6B450;margin-top:12px">— Без бюрократии, мы на «ты»</div></td></tr></table></td></tr>

<tr><td class="fp-pad" style="padding:32px 30px;border-top:1px solid rgba(255,255,255,.10);background:radial-gradient(120% 100% at 0% 0%, rgba(155,110,255,.12), transparent 55%),radial-gradient(120% 100% at 100% 100%, rgba(230,180,80,.10), transparent 55%),#100818"><div style="font-family:${U};font-weight:800;font-size:16px;letter-spacing:.01em;color:#FFFFFF;margin-bottom:10px">Frankenplatz.ch</div><div style="font-family:${F};font-size:13px;line-height:1.55;color:#C3B7D4;margin-bottom:6px">Это письмо про твой заказ на форуме Frankenplatz.</div><div style="font-family:${F};font-size:12px;color:#9A8BB3;margin-bottom:14px">24–25.10.2026 · Baden 🇨🇭 · 15 мин от Zürich HB · сохрани письмо: QR внутри нужен на входе</div><div style="font-family:${F};font-size:12px;color:#9A8BB3;line-height:1.5;margin-bottom:12px">Вопросы — просто ответь на это письмо.</div><a href="mailto:info@frankenplatz.ch" style="font-family:${F};font-size:12px;color:#9A8BB3;text-decoration:underline">Написать нам</a><div style="font-family:${F};font-size:12px;color:#7A6C93;line-height:1.6;margin-top:8px"><a href="https://frankenplatz.ch/legal#impressum" style="color:#7A6C93;text-decoration:underline">Impressum</a> · <a href="https://frankenplatz.ch/legal#agb" style="color:#7A6C93;text-decoration:underline">AGB</a> · <a href="https://frankenplatz.ch/legal#datenschutz" style="color:#7A6C93;text-decoration:underline">Datenschutz</a></div></td></tr>

</table>
</td></tr></table>
</body>
</html>`;
}

/** Plain-text версия письма-билета (text-часть рядом с HTML — анти-спам). */
export function renderForumTicketText(sub) {
  const s = plainObject(sub);
  const hi = s.name ? `${String(s.name)}, ` : '';
  const chf = (Number(s.amount) / 100).toFixed(2);
  const code = s.code || '—';
  const dateTime = s.dateTime || '24–25 октября, 09:30 — 18:00';
  return [
    'FRANKENPLATZ · 24–25 октября 2026 · Baden',
    '',
    'Твой билет',
    '',
    `${hi}оплата прошла. Покажи QR из этого письма на входе — его отсканируют.`,
    '',
    `Билет: ${s.description || 'Билет на форум'}`,
    `Дата и время: ${dateTime}`,
    'Место: Baden — 15 мин от Zürich HB',
    `Оплачено: ${chf} CHF`,
    `Код билета: ${code}`,
    `Заказ: № ${code}`,
    '',
    'Что дальше:',
    '— За два дня до форума пришлём программу и расписание.',
    '— Приходи за 20 минут до начала: регистрация и кофе.',
    '— Печатать ничего не нужно: QR с экрана телефона работает.',
    '',
    'Планы изменились? Ответь на это письмо — переоформим билет на другого человека или вернём деньги до 10 октября.',
    '',
    '—',
    'Вопросы — просто ответь на это письмо или пиши info@frankenplatz.ch',
  ].join('\n');
}

/**
 * HTML письма-ПОДТВЕРЖДЕНИЯ пакета бренд-маркета (после оплаты). Не билет (QR нет) —
 * подтверждение участия: что куплено, сумма, что дальше (ссылка на кабинет — письмом).
 *
 * Даты открытия кабинета в письме НЕТ намеренно: обещанное «10 августа» протухло
 * и продолжало уходить покупателям.
 *
 * Если передан cabinetUrl (шаг 2 ТЗ кабинета) — письмо ведёт в кабинет сразу,
 * кнопкой: доступ выдаётся в момент оплаты, а не «отдельным письмом когда-нибудь».
 * Ссылка ведёт на страницу входа с подставленным адресом, а не на одноразовый
 * токен: письмо об оплате человек открывает и через неделю, а токен живёт полчаса.
 *
 * Общая премиум-обёртка emailShell. sub = {name, description, amount, cabinetUrl?}.
 */
export function renderMarketConfirmHtml(sub) {
  const s = plainObject(sub);
  const name = s.name ? escapeHtml(String(s.name)) : '';
  const chf = (Number(s.amount) / 100).toFixed(2);
  const cabinetUrl = s.cabinetUrl ? String(s.cabinetUrl) : null;
  const rows = reportRowsDesigned({
    'Пакет': s.description || 'Пакет маркета',
    'Оплачено': `${chf} CHF`,
  });
  const nextText = cabinetUrl
    ? '<b style="color:#F3EEF9">Что дальше.</b> Заходи в кабинет — там загрузишь фото и цены, а мы соберём каталог. Пароль не нужен: на почту придёт ссылка для входа. Офлайн-маркет — 27 сентября в Baden.'
    : '<b style="color:#F3EEF9">Что дальше.</b> Ссылку на личный кабинет пришлём <b style="color:#F5C969">отдельным письмом</b>. Там загрузишь фото и цены, а мы соберём каталог. Офлайн-маркет — 27 сентября в Baden.';
  const next = `
  <tr><td class="fp-pad" style="padding:20px 34px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:16px 18px;border-left:3px solid #E6B450;background:rgba(255,255,255,.035);border-radius:0 12px 12px 0">
        <span style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#C3B7D4">${nextText}</span>
      </td>
    </tr></table>
  </td></tr>`;
  return emailShell({
    brand: 'market',
    title: 'Пакет оплачен — бренд-маркет Frankenplatz',
    heading: `Ты в деле${name ? ', ' + name : ''} 🛍️`,
    lead: 'Оплата пакета получена. Спасибо! Ниже — детали заказа.',
    blocks: rows + next,
    cta: cabinetUrl ? { href: cabinetUrl, label: 'Открыть кабинет продавца' } : null,
    footerNoteHtml:
      'Это письмо — по оплате участия в бренд-маркете на frankenplatz.ch. Вопросы — <a href="mailto:info@frankenplatz.ch" style="color:#7A6C93">info@frankenplatz.ch</a>.',
  });
}

/** Plain-text версия письма-подтверждения пакета (анти-спам). */
export function renderMarketConfirmText(sub) {
  const s = plainObject(sub);
  const hi = s.name ? `${String(s.name)}, ` : '';
  const chf = (Number(s.amount) / 100).toFixed(2);
  return [
    'FRANKENPLATZ MARKET · FASHION REBORN',
    '',
    'Пакет оплачен',
    '',
    `${hi}оплата пакета получена. Спасибо!`,
    '',
    `Пакет: ${s.description || 'Пакет маркета'}`,
    `Оплачено: ${chf} CHF`,
    '',
    ...(s.cabinetUrl
      ? [
          'Что дальше: заходи в кабинет продавца — там загрузишь фото и цены.',
          String(s.cabinetUrl),
          'Пароль не нужен: на почту придёт ссылка для входа.',
        ]
      : ['Что дальше: ссылку на личный кабинет пришлём отдельным письмом.', 'Там загрузишь фото и цены.']),
    'Офлайн-маркет — 27 сентября в Baden.',
    '',
    '—',
    'Вопросы — просто ответь на это письмо или пиши info@frankenplatz.ch',
  ].join('\n');
}

/**
 * HTML письма со ссылкой для входа в кабинет продавца (шаг 2 ТЗ кабинета).
 *
 * Ссылка одноразовая и живёт полчаса — об этом говорим прямо, иначе человек
 * вернётся к письму назавтра и решит, что кабинет сломан. Второй абзац —
 * на случай, если письмо пришло не тому: попросить ссылку может кто угодно,
 * знающий адрес, и получатель должен понимать, что делать.
 *
 * sub = {url, minutes}
 */
export function renderMarketLoginHtml(sub) {
  const s = plainObject(sub);
  const url = String(s.url || '');
  const minutes = Number(s.minutes) || 30;
  const note = `
  <tr><td class="fp-pad" style="padding:18px 34px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:16px 18px;border-left:3px solid #E6B450;background:rgba(255,255,255,.035);border-radius:0 12px 12px 0">
        <span style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#C3B7D4">Ссылка одноразовая и действует <b style="color:#F5C969">${minutes} минут</b>. Если не успеешь — просто запроси новую на той же странице.<br><br>Если ты не запрашивал вход, ничего делать не нужно: без перехода по ссылке в кабинет никто не попадёт.</span>
      </td>
    </tr></table>
  </td></tr>`;
  return emailShell({
    brand: 'market',
    title: 'Вход в кабинет продавца — бренд-маркет Frankenplatz',
    heading: 'Вход в кабинет 🔑',
    lead: 'Нажми кнопку — и попадёшь в свой кабинет продавца. Пароль не нужен.',
    cta: { href: url, label: 'Войти в кабинет' },
    blocks: note,
    footerNoteHtml:
      'Это письмо — по входу в кабинет продавца бренд-маркета на frankenplatz.ch. Вопросы — <a href="mailto:info@frankenplatz.ch" style="color:#7A6C93">info@frankenplatz.ch</a>.',
  });
}

/** Plain-text версия письма со ссылкой входа (анти-спам). */
export function renderMarketLoginText(sub) {
  const s = plainObject(sub);
  const minutes = Number(s.minutes) || 30;
  return [
    'FRANKENPLATZ MARKET · КАБИНЕТ ПРОДАВЦА',
    '',
    'Вход в кабинет',
    '',
    'Открой ссылку — и попадёшь в свой кабинет. Пароль не нужен.',
    '',
    String(s.url || ''),
    '',
    `Ссылка одноразовая и действует ${minutes} минут. Не успел — запроси новую на той же странице.`,
    'Если ты не запрашивал вход, ничего делать не нужно.',
    '',
    '—',
    'Вопросы — просто ответь на это письмо или пиши info@frankenplatz.ch',
  ].join('\n');
}

/** Заголовок и суть решения модератора — общее для HTML и текста. */
function decisionCopy(action) {
  return (
    {
      approve_online: {
        heading: 'Вещь в каталоге ✅',
        lead: 'Проверили и опубликовали — вещь уже видна покупателям в онлайн-каталоге.',
        line: 'Вещь опубликована в онлайн-каталоге.',
      },
      approve_market: {
        heading: 'Вещь в каталоге и на маркете ✅',
        lead: 'Проверили и опубликовали. Вещь поедет на офлайн-маркет — привези её или отправь нам.',
        line: 'Вещь опубликована и допущена на офлайн-маркет 27 сентября.',
      },
      reject: {
        heading: 'Вещь не приняли',
        lead: 'Посмотрели карточку и пока не берём. Причина ниже — если поправишь, присылай снова.',
        line: 'Вещь не приняли.',
      },
    }[String(action)] || {
      heading: 'Обновление по вещи',
      lead: 'Мы обновили данные по твоей вещи.',
      line: 'Данные по вещи обновлены.',
    }
  );
}

/**
 * HTML письма о решении модератора (шаг 5 ТЗ кабинета).
 *
 * Продавец должен узнать решение сам, а не обнаружить его, зайдя в кабинет
 * через неделю. При отказе причина обязательна — иначе письмо бесполезно.
 *
 * sub = {name, action, itemLabel, note, recommendedPrice, cabinetUrl}
 */
export function renderMarketDecisionHtml(sub) {
  const s = plainObject(sub);
  const copy = decisionCopy(s.action);
  const name = s.name ? escapeHtml(String(s.name)) : '';
  const rows = reportRowsDesigned({
    Вещь: s.itemLabel || '—',
    Решение: copy.line,
    ...(s.recommendedPrice ? { 'Рекомендуем цену': s.recommendedPrice } : {}),
  });
  const noteBlock = s.note
    ? `
  <tr><td class="fp-pad" style="padding:18px 34px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:16px 18px;border-left:3px solid #E6B450;background:rgba(255,255,255,.035);border-radius:0 12px 12px 0">
        <span style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#C3B7D4"><b style="color:#F3EEF9">От нас:</b> ${escapeHtml(String(s.note))}</span>
      </td>
    </tr></table>
  </td></tr>`
    : '';

  return emailShell({
    brand: 'market',
    title: 'Решение по вещи — бренд-маркет Frankenplatz',
    heading: `${copy.heading}${name ? ', ' + name : ''}`,
    lead: copy.lead,
    blocks: rows + noteBlock,
    cta: s.cabinetUrl ? { href: String(s.cabinetUrl), label: 'Открыть кабинет' } : null,
    footerNoteHtml:
      'Это письмо — по вещи в бренд-маркете на frankenplatz.ch. Вопросы — <a href="mailto:info@frankenplatz.ch" style="color:#7A6C93">info@frankenplatz.ch</a>.',
  });
}

/** Plain-text версия письма о решении (анти-спам). */
export function renderMarketDecisionText(sub) {
  const s = plainObject(sub);
  const copy = decisionCopy(s.action);
  const hi = s.name ? `${String(s.name)}, ` : '';
  return [
    'FRANKENPLATZ MARKET · FASHION REBORN',
    '',
    copy.heading.replace(/[✅]/g, '').trim(),
    '',
    `${hi}${copy.lead}`,
    '',
    `Вещь: ${s.itemLabel || '—'}`,
    `Решение: ${copy.line}`,
    ...(s.recommendedPrice ? [`Рекомендуем цену: ${s.recommendedPrice}`] : []),
    ...(s.note ? ['', `От нас: ${String(s.note)}`] : []),
    ...(s.cabinetUrl ? ['', `Кабинет: ${String(s.cabinetUrl)}`] : []),
    '',
    '—',
    'Вопросы — просто ответь на это письмо или пиши info@frankenplatz.ch',
  ].join('\n');
}

/**
 * Письмо double opt-in — подтверждение подписки на рассылку.
 *
 * Регулярные письма (в отличие от отчёта/подтверждения заявки — это разовые,
 * транзакционные) требуют подтверждения владения адресом: защищает и подписчика
 * (чужой e-mail не подпишут), и репутацию домена (нет жалоб «я не подписывался»).
 * Одноразовую ссылку confirmUrl собирает роут; текст письма — сервер.
 *
 * Пока рассылка есть только у форума, поэтому шапка брендирована Frankenplatz;
 * при появлении рассылки на другом сайте — вывести бренд из source.
 */
export function renderConfirmHtml(sub, confirmUrl) {
  const s = plainObject(sub);
  const hi = s.name ? `${escapeHtml(String(s.name))}, привет!` : 'Привет!';
  const url = escapeHtml(String(confirmUrl || ''));
  const button = `
  <tr><td class="fp-pad" align="center" style="padding:8px 34px 4px">${goldButton(url, 'Подтвердить подписку')}</td></tr>`;
  const fallback = `
  <tr><td class="fp-pad" style="padding:16px 34px 4px">
    <p style="margin:0;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#9A8BB3">Если кнопка не открывается — скопируй ссылку в браузер:<br><a href="${url}" style="color:#B98BFF;word-break:break-all">${url}</a></p>
  </td></tr>`;
  return emailShell({
    title: 'Frankenplatz — Подтверди подписку',
    heading: 'Подтверди подписку',
    lead: `${hi} Остался один шаг. Нажми кнопку ниже — и мы включим тебя в рассылку форума. Так мы убеждаемся, что адрес действительно твой.`,
    blocks: button + fallback,
    footerNoteHtml:
      'Если ты не подписывался(ась) на рассылку — просто проигнорируй это письмо, без подтверждения мы ничего не пришлём.',
  });
}

/** Plain-text версия письма-подтверждения подписки. */
export function renderConfirmText(sub, confirmUrl) {
  const s = plainObject(sub);
  const hi = s.name ? `${String(s.name)}, привет!` : 'Привет!';
  return [
    'FRANKENPLATZ · Форум о деньгах в Швейцарии',
    '',
    'Подтверди подписку',
    '',
    `${hi} Остался один шаг. Открой ссылку ниже — и мы включим тебя в рассылку форума. Так мы убеждаемся, что адрес действительно твой:`,
    '',
    String(confirmUrl || ''),
    '',
    'Если ты не подписывался(ась) на рассылку — просто проигнорируй это письмо, без подтверждения мы ничего не пришлём.',
  ].join('\n');
}

/**
 * Страница относится к сайту форума?
 *
 * Двойное подтверждение сейчас только у форума, но функция страниц общая для
 * платформы. Разделы /tickets, /calculators, /legal есть ТОЛЬКО на
 * frankenplatz.ch — на chudina.me или creox.ch такие ссылки вели бы в 404.
 */
function isForumSite(site) {
  try {
    return /(^|\.)frankenplatz\.ch$/i.test(new URL(String(site)).hostname);
  } catch {
    return false;
  }
}

/**
 * Оболочка страниц подписки (подтверждение и отписка).
 *
 * Человек попадает сюда из письма — это первая страница нашего бренда, которую
 * он видит после согласия. Раньше здесь был голый тёмный экран с одной кнопкой;
 * теперь — иллюстрация, короткий текст и футер с контактами, как на нормальных
 * страницах подтверждения.
 *
 * Шрифты СИСТЕМНЫЕ, без Google Fonts: подключение внешнего шрифта передаёт IP
 * посетителя третьей стороне без согласия — для швейцарской и европейской
 * аудитории это лишний юридический риск ради начертания. И страница грузится
 * мгновенно.
 *
 * @param {object} o
 * @param {string} o.title    заголовок вкладки
 * @param {string} o.heading  крупный заголовок
 * @param {string} o.body     абзац под заголовком
 * @param {string} [o.hero]   имя файла иллюстрации в site/img/ (пусто — без картинки)
 * @param {string} [o.action] готовый HTML основного действия (кнопка/форма)
 * @param {string} o.site     сайт, с которого пришёл человек
 */
function subscriptionPageShell(o) {
  const site = escapeHtml(String(o.site || FORUM_URL).replace(/\/+$/, ''));
  const isForum = isForumSite(site);
  const F = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,Helvetica,sans-serif";
  const hero = o.hero
    ? `<img src="${FORUM_URL}/site/img/${escapeHtml(o.hero)}" alt="" width="1120" height="700"
         style="display:block;width:100%;height:auto;border-radius:18px 18px 0 0">`
    : '';
  /* Ссылки на разделы показываем только на сайте форума: на других площадках
     платформы страниц /tickets и /calculators нет — вели бы в 404. */
  const nav = isForum
    ? `<p style="margin:18px 0 0;font-size:13.5px;line-height:2;color:#9A8BB3">
         <a href="${site}/#program" style="color:#B98BFF;text-decoration:none">Программа</a>
         <span style="opacity:.4"> · </span>
         <a href="${site}/calculators" style="color:#B98BFF;text-decoration:none">Калькуляторы</a>
         <span style="opacity:.4"> · </span>
         <a href="${site}/trips" style="color:#B98BFF;text-decoration:none">Другие форумы</a>
       </p>`
    : '';
  const legal = isForum
    ? `<a href="${site}/legal#impressum" style="color:#7A6C93;text-decoration:underline">Impressum</a>
       <span style="opacity:.4"> · </span>
       <a href="${site}/legal#datenschutz" style="color:#7A6C93;text-decoration:underline">Datenschutz</a>`
    : '';

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(o.title)} · Frankenplatz</title></head>
<body style="margin:0;background:#0D0715;color:#F3EEF9;font-family:${F};-webkit-font-smoothing:antialiased">
<div style="max-width:560px;margin:0 auto;padding:32px 20px 40px">

  <a href="${site}" style="display:block;text-align:center;margin-bottom:22px;text-decoration:none;
     font-weight:800;font-size:15px;letter-spacing:.02em;color:#F3EEF9">Frankenplatz<span style="color:#E6B450">.ch</span></a>

  <div style="background:#140A1F;border:1px solid rgba(255,255,255,.10);border-radius:20px;overflow:hidden">
    ${hero}
    <div style="padding:28px 26px 30px;text-align:center">
      <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#E6B450">
        24–25 октября 2026 · Baden</p>
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:800">${escapeHtml(o.heading)}</h1>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#C3B7D4">${escapeHtml(o.body)}</p>
      ${o.action || ''}
      ${nav}
    </div>
  </div>

  <div style="margin-top:26px;text-align:center;font-size:12.5px;line-height:1.7;color:#7A6C93">
    <p style="margin:0 0 6px">Frankenplatz — форум о деньгах в Швейцарии</p>
    <p style="margin:0 0 6px">
      <a href="mailto:info@frankenplatz.ch" style="color:#B98BFF;text-decoration:none">info@frankenplatz.ch</a>
      <span style="opacity:.4"> · </span>
      <a href="https://www.instagram.com/frankenplatz.ch/" style="color:#B98BFF;text-decoration:none">Instagram</a>
    </p>
    <p style="margin:0">${legal}</p>
  </div>

</div></body></html>`;
}

/** Кнопка основного действия — общий вид для обеих страниц. */
function pageButton(href, label) {
  return `<a href="${href}" style="display:inline-block;background:linear-gradient(92deg,#E6B450,#F5C969);
    color:#231433;text-decoration:none;font-weight:800;font-size:15px;padding:13px 26px;border-radius:999px">${escapeHtml(
      label
    )}</a>`;
}

/**
 * Самодостаточная HTML-страница-результат перехода по ссылке подтверждения.
 * state: 'confirmed' | 'already' | 'invalid' | 'unsubscribed'.
 * noindex — служебная страница.
 */
export function confirmPageHtml(state, site = FORUM_URL) {
  const M = {
    confirmed: {
      t: 'Подписка подтверждена',
      b: 'Готово, ты в списке. Расскажем о программе, спикерах и важных датах — писем без повода не будет.',
      hero: 'cows-invite-w.png',
      cta: ['/tickets', 'Посмотреть билеты'],
    },
    already: {
      t: 'Уже подтверждено',
      b: 'Эта подписка уже активна — ничего делать не нужно.',
      hero: 'cows-invite-w.png',
      cta: ['/tickets', 'Посмотреть билеты'],
    },
    invalid: {
      t: 'Ссылка недействительна',
      b: 'Похоже, ссылка устарела или уже использована. Подписаться заново можно на сайте — форма в подвале любой страницы.',
      cta: ['', 'На сайт форума'],
    },
    unsubscribed: {
      t: 'Подписка отменена',
      b: 'Ты ранее отписался(ась) от рассылки, поэтому эта ссылка подтверждения больше не действует. Если передумаешь — подпишись заново на сайте.',
      cta: ['', 'На сайт форума'],
    },
  };
  const m = M[state] || M.invalid;
  const url = escapeHtml(String(site || FORUM_URL).replace(/\/+$/, ''));
  /* Кнопка на билеты — только для сайта форума: на других площадках платформы
     такой страницы нет. Там остаётся простой возврат на сайт. */
  const cta =
    m.cta[0] && isForumSite(url) ? [url + m.cta[0], m.cta[1]] : [url, 'На сайт форума'];
  return subscriptionPageShell({
    title: m.t,
    heading: m.t,
    body: m.b,
    hero: m.hero,
    site: url,
    action: pageButton(cta[0], cta[1]),
  });
}

/**
 * Ссылка на действие с подпиской (подтверждение/отписка) для письма.
 *
 * Ведём на домен, с которого человек подписался (origin из source_url): домен
 * ссылки совпадает с доменом отправителя письма — это брендово И повышает
 * доставляемость (ссылка на посторонний *.vercel.app читается спам-фильтрами
 * как фишинг). На том домене стоит rewrite-прокси sitePath → apiPath (vercel.json).
 *
 * АНТИ-ФИШИНГ: origin берём ТОЛЬКО если он в белом списке наших сайтов. Иначе
 * source_url (клиентское поле) позволил бы разослать письмо с нашего домена со
 * ссылкой на чужой сайт. Не наш origin или кривой url → безопасный прямой URL API.
 */
function brandedLink(sitePath, apiPath, sourceUrl, apiBase, token, allowedOriginsList) {
  const t = encodeURIComponent(String(token || ''));
  const base = str(apiBase, 300) || 'https://slswiss-tickets.vercel.app';
  const allowed = Array.isArray(allowedOriginsList) ? allowedOriginsList : DEFAULT_ORIGINS;
  let origin = null;
  try {
    if (sourceUrl) {
      const o = new URL(String(sourceUrl)).origin;
      if (allowed.includes(o)) origin = o;
    }
  } catch {
    /* кривой url — уходим в фолбэк */
  }
  return origin ? `${origin}${sitePath}?token=${t}` : `${base}${apiPath}?token=${t}`;
}

export function confirmLink(sourceUrl, apiBase, token, allowedOriginsList) {
  return brandedLink(
    '/newsletter/confirm',
    '/api/forms/confirm',
    sourceUrl,
    apiBase,
    token,
    allowedOriginsList
  );
}

/** Ссылка отписки — та же логика домена, что и confirmLink (rewrite-прокси на сайте). */
export function unsubscribeUrl(sourceUrl, apiBase, token, allowedOriginsList) {
  return brandedLink(
    '/newsletter/unsubscribe',
    '/api/forms/unsubscribe',
    sourceUrl,
    apiBase,
    token,
    allowedOriginsList
  );
}

/**
 * Заголовки List-Unsubscribe (RFC 8058, one-click).
 * `List-Unsubscribe-Post` включает отписку в один клик: почтовик шлёт POST на URL
 * без открытия страницы. Kнопка «Отписаться» рядом с отправителем в Gmail/Outlook
 * снижает жалобы на спам (люди отписываются, а не жмут «Спам») → бережёт репутацию.
 */
export function unsubscribeHeaders(url) {
  return {
    'List-Unsubscribe': `<${String(url || '')}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * Страницы отписки. state:
 *  - 'ask'     — GET-страница с кнопкой (отписка — только POST, чтобы префетч
 *                ссылок почтовиком не отписывал случайно). action относительный —
 *                постится на текущий (проксированный) URL.
 *  - 'done'    — отписали.
 *  - 'invalid' — токен не найден/битый.
 */
export function unsubscribePageHtml(state, opts = {}) {
  const site = escapeHtml(String(opts.site || FORUM_URL).replace(/\/+$/, ''));

  if (state === 'ask') {
    const t = encodeURIComponent(String(opts.token || ''));
    /* Кнопка, а не ссылка: отписка делается POST-ом. Почтовые клиенты
       предзагружают ссылки из писем — по GET человека отписало бы без
       его ведома. Иллюстрации здесь нет: это вопрос, а не поздравление. */
    return subscriptionPageShell({
      title: 'Отписаться от рассылки',
      heading: 'Отписаться от рассылки?',
      body: 'Больше не хочешь получать письма форума? Подтверди отписку — вернуть подписку можно в любой момент на сайте.',
      site,
      action: `<form method="post" action="?token=${t}" style="margin:0">
        <button type="submit" style="background:linear-gradient(92deg,#E6B450,#F5C969);color:#231433;border:0;
          cursor:pointer;font:inherit;font-weight:800;font-size:15px;padding:13px 26px;border-radius:999px">Отписаться</button>
      </form>
      <p style="margin:14px 0 0"><a href="${site}" style="color:#B98BFF;font-size:14px;text-decoration:none">Остаться и вернуться на сайт</a></p>`,
    });
  }

  const M = {
    done: {
      t: 'Подписка отменена',
      b: 'Больше не пришлём писем форума. Если передумаешь — подписаться заново можно на сайте, форма в подвале любой страницы.',
    },
    invalid: {
      t: 'Ссылка недействительна',
      b: 'Похоже, ссылка устарела или уже использована.',
    },
  };
  const m = M[state] || M.invalid;
  return subscriptionPageShell({
    title: m.t,
    heading: m.t,
    body: m.b,
    site,
    action: pageButton(site, 'На сайт форума'),
  });
}

/**
 * HTML письма-уведомления о новой заявке (уходит ОРГАНИЗАТОРАМ, не клиенту).
 *
 * Заявки форума показываем в той же премиум-обёртке, что и письма клиентам
 * (emailShell) — команда читает их каждый день, и голая таблица выглядела
 * как «письмо без шаблона». Прочие сайты платформы (chudina/creox/atlasintegra)
 * шлют уведомления в свои ящики, бренд Frankenplatz им не подходит — там
 * остаётся прежняя нейтральная вёрстка.
 *
 * Всё, что пришло от пользователя, экранируется (escapeHtml).
 */
export function renderNotificationHtml(sub) {
  const s = plainObject(sub);
  return (s.source || '') === 'forum'
    ? renderForumNotificationHtml(s)
    : renderPlainNotificationHtml(s);
}

/** Заявка с сайта форума — премиум-обёртка Frankenplatz. */
function renderForumNotificationHtml(s) {
  const what = escapeHtml(s.role || s.form_key || 'заявка');
  const rows = {
    Имя: s.name,
    'E-mail': s.email,
    Telegram: s.telegram,
    Телефон: s.phone,
    ...plainObject(s.payload),
  };
  const where = [s.form_key, s.source_url]
    .filter(Boolean)
    .map((v, i) =>
      i === 1
        ? `<a href="${escapeHtml(String(v))}" style="color:#B98BFF">${escapeHtml(String(v))}</a>`
        : escapeHtml(String(v))
    )
    .join(' · ');
  const testsBlock =
    s.tests && typeof s.tests === 'object'
      ? `\n  <tr><td class="fp-pad" style="padding:20px 34px 0">${renderTestsHtml(s.tests)}</td></tr>`
      : '';

  return emailShell({
    title: `Frankenplatz — заявка · ${what}`,
    heading: `Новая заявка — <span style="background:linear-gradient(90deg,#B98BFF 0%,#F5C969 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#F5C969">${what}</span>`,
    lead: where || '',
    blocks: reportRowsDesigned(rows) + testsBlock,
    footerNoteHtml:
      'Служебное письмо: кто-то отправил форму на сайте форума. Reply-To ведёт на отправителя — можно отвечать прямо из этого письма.',
  });
}

/** Заявка с прочих сайтов платформы — прежняя нейтральная вёрстка. */
function renderPlainNotificationHtml(sub) {
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

/**
 * Plain-text часть письма-уведомления.
 *
 * Без неё Resend генерит текст из HTML сам и слепляет подписи со значениями
 * («Emailanna@example.ch Проценты банку11'200») — так письмо выглядело у
 * получателя в Gmail. Плюс text-часть рядом с HTML снижает спам-оценку.
 */
export function renderNotificationText(sub) {
  const s = plainObject(sub);
  const head = `НОВАЯ ЗАЯВКА · ${(s.role || s.form_key || s.source || '').toUpperCase()}`;
  const where = `Источник: ${s.source || '—'}${s.form_key ? ' / ' + s.form_key : ''}${
    s.source_url ? '\n' + s.source_url : ''
  }`;
  const contacts = textRows({
    Имя: s.name,
    'E-mail': s.email,
    Telegram: s.telegram,
    Телефон: s.phone,
  });
  const details = textRows(s.payload);
  return [head, where, contacts, details]
    .filter((part) => part && part.trim())
    .join('\n\n');
}

/**
 * Автоответ покупателю по заявке из каталога бренд-маркета (form_key='market-item').
 *
 * Раньше человек не получал ничего: заявка уезжала нам в почту и в базу, а он
 * видел только надпись на экране. Для покупателя это выглядит как «отправил в
 * пустоту» — особенно когда вещь недешёвая, а платить предстоит незнакомому
 * человеку при встрече.
 *
 * Про бронь пишем осторожно. Кнопка в каталоге называется «Забронировать», но
 * механики брони пока нет: вещь не резервируется, срок не идёт, лист ожидания
 * не работает (это этап 2 ТЗ). Письмо поэтому обещает ровно то, что происходит:
 * мы передаём продавцу и возвращаемся с ответом.
 */
export function renderMarketInterestHtml(sub) {
  const s = plainObject(sub);
  const p = s.payload && typeof s.payload === 'object' ? s.payload : {};
  const kind = String(p['Тип обращения'] || '').toLowerCase();
  const hi = s.name ? `${escapeHtml(String(s.name))}, спасибо!` : 'Спасибо!';

  const what = kind.includes('цен')
    ? 'твоё предложение по цене'
    : kind.includes('вопрос')
      ? 'твой вопрос продавцу'
      : 'твою заявку на вещь';
  const heading = kind.includes('цен')
    ? 'Предложение передадим продавцу'
    : kind.includes('вопрос')
      ? 'Вопрос передадим продавцу'
      : 'Заявка у нас';

  const item = [p['Бренд'], p['Вещь']].filter(Boolean).join(' · ');
  const lead =
    `${hi} Мы получили ${what}${item ? ` — <b>${escapeHtml(item)}</b>` : ''}. ` +
    'Передаём продавцу и вернёмся с ответом на этот адрес.';

  const rows = reportRowsDesigned(p);
  const submitted = rows
    ? `
  <tr><td class="fp-pad" style="padding:16px 34px 0">
    <p style="margin:0;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:13px;color:#9A8BB3">Что ушло в заявке:</p>
  </td></tr>${rows}`
    : '';

  /* Три вещи, которые покупатель должен знать до встречи: вещь пока не
     закреплена, деньги идут мимо нас, и где всё это происходит. */
  const how = `
  <tr><td class="fp-pad" style="padding:18px 34px 6px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td style="padding:16px 18px;border-left:3px solid #E6B450;background:rgba(255,255,255,.035);border-radius:0 12px 12px 0">
        <span style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#C3B7D4">
          Вещь остаётся в каталоге, пока продавец не подтвердит — мы напишем, как только он ответит.<br>
          Расчёт — напрямую с продавцом, наличными или переводом: мы платежей не принимаем.<br>
          Посмотреть и померить можно на маркете <b>27 сентября в Бадене</b>.
        </span>
      </td>
    </tr></table>
  </td></tr>`;

  const replyNote = `
  <tr><td class="fp-pad" style="padding:14px 34px 6px">
    <p style="margin:0;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#C3B7D4">Что-то дополнить или передумала — просто ответь на это письмо.</p>
  </td></tr>`;

  return emailShell({
    brand: 'market',
    title: 'Заявка по вещи — бренд-маркет Frankenplatz',
    heading,
    lead,
    blocks: submitted + how + replyNote,
    footerNoteHtml:
      'Это письмо — по заявке из каталога бренд-маркета на frankenplatz.ch. Вопросы — <a href="mailto:info@frankenplatz.ch" style="color:#7A6C93">info@frankenplatz.ch</a>.',
  });
}

/** Текстовая версия того же письма (рядом с HTML — анти-спам). */
export function renderMarketInterestText(sub) {
  const s = plainObject(sub);
  const p = s.payload && typeof s.payload === 'object' ? s.payload : {};
  const item = [p['Бренд'], p['Вещь']].filter(Boolean).join(' · ');
  const lines = [
    s.name ? `${s.name}, спасибо!` : 'Спасибо!',
    item ? `Мы получили твою заявку — ${item}.` : 'Мы получили твою заявку.',
    'Передаём продавцу и вернёмся с ответом на этот адрес.',
    '',
    'Вещь остаётся в каталоге, пока продавец не подтвердит.',
    'Расчёт — напрямую с продавцом: мы платежей не принимаем.',
    'Посмотреть и померить можно на маркете 27 сентября в Бадене.',
    '',
  ];
  Object.keys(p).forEach((k) => {
    if (p[k]) lines.push(`${k}: ${p[k]}`);
  });
  lines.push('', 'Что-то дополнить — ответь на это письмо.');
  return lines.join('\n');
}

/**
 * Письмо продавцу: по его вещи пришёл покупатель.
 *
 * Смысл письма — свести их напрямую. Мы не посредник в сделке (AGB 2.1) и не
 * принимаем платежи: наша роль заканчивается тем, что продавец получает контакт
 * и знает, что делать дальше. До 19.08 заявка покупателя приезжала только нам,
 * а кабинет при этом обещал продавцу «видишь спрос здесь» — не видел.
 *
 * Контакт покупателя внутри письма даём кликабельным: продавец отвечает из
 * почты в один клик, без переписывания адреса руками.
 */
export function renderMarketLeadHtml(sub) {
  const s = plainObject(sub);
  const p = s.payload && typeof s.payload === 'object' ? s.payload : {};
  const kind = String(p['Тип обращения'] || '').toLowerCase();

  const item = [p['Бренд'], p['Вещь']].filter(Boolean).join(' · ');
  const heading = kind.includes('цен')
    ? 'Предлагают цену за твою вещь'
    : kind.includes('вопрос')
      ? 'Вопрос по твоей вещи'
      : 'По твоей вещи есть покупатель';

  const buyer = escapeHtml(String(s.name || 'Покупатель'));
  const mail = escapeHtml(String(s.email || ''));
  const lead =
    `${item ? `<b>${escapeHtml(item)}</b>` : 'По твоей вещи'}${p['Код вещи'] ? ` (${escapeHtml(String(p['Код вещи']))})` : ''}. ` +
    `Написал\u0430 ${buyer}${mail ? ` — <a href="mailto:${mail}" style="color:#B98BFF">${mail}</a>` : ''}.`;

  const rows = reportRowsDesigned(p);
  const details = rows
    ? `
  <tr><td class="fp-pad" style="padding:16px 34px 0">
    <p style="margin:0;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:13px;color:#9A8BB3">Что написали в заявке:</p>
  </td></tr>${rows}`
    : '';

  /* Три шага, после которых продавцу не надо ничего у нас спрашивать. Третий —
     не формальность: комиссия считается по отметке в кабинете, а не по нашему
     знанию о сделке (AGB 5.5–5.6). */
  const what = `
  <tr><td class="fp-pad" style="padding:18px 34px 6px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td style="padding:16px 18px;border-left:3px solid #E6B450;background:rgba(255,255,255,.035);border-radius:0 12px 12px 0">
        <span style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#C3B7D4">
          <b>Ответь напрямую</b> — просто ответь на это письмо, оно уйдёт покупателю.<br>
          <b>Договоритесь о встрече</b>: маркет 27 сентября в Бадене или как вам удобно.<br>
          <b>Продал\u0430 — отметь в кабинете.</b> Комиссия 12% считается по отметке, счёт придёт после маркета.
        </span>
      </td>
    </tr></table>
  </td></tr>`;

  const money = `
  <tr><td class="fp-pad" style="padding:14px 34px 6px">
    <p style="margin:0;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#C3B7D4">Деньги покупатель отдаёт тебе напрямую — наличными или переводом. Мы платежей не принимаем и в расчёт не вмешиваемся.</p>
  </td></tr>`;

  return emailShell({
    brand: 'market',
    title: 'Покупатель по твоей вещи — бренд-маркет Frankenplatz',
    heading,
    lead,
    blocks: details + what + money,
    cta: s.cabinetUrl ? { href: s.cabinetUrl, label: 'Открыть кабинет продавца' } : null,
    footerNoteHtml:
      'Это письмо — по заявке из каталога бренд-маркета на frankenplatz.ch. Вопросы к нам — <a href="mailto:info@frankenplatz.ch" style="color:#7A6C93">info@frankenplatz.ch</a>.',
  });
}

/** Текстовая версия письма продавцу (рядом с HTML — анти-спам). */
export function renderMarketLeadText(sub) {
  const s = plainObject(sub);
  const p = s.payload && typeof s.payload === 'object' ? s.payload : {};
  const item = [p['Бренд'], p['Вещь']].filter(Boolean).join(' · ');
  const lines = [
    item ? `По твоей вещи есть покупатель: ${item}.` : 'По твоей вещи есть покупатель.',
    s.name || s.email ? `Написал\u0430: ${[s.name, s.email].filter(Boolean).join(' — ')}` : '',
    '',
  ];
  Object.keys(p).forEach((k) => {
    if (p[k]) lines.push(`${k}: ${p[k]}`);
  });
  lines.push(
    '',
    'Ответь напрямую — ответ на это письмо уйдёт покупателю.',
    'Договоритесь о встрече: маркет 27 сентября в Бадене или как вам удобно.',
    'Продал(а) — отметь в кабинете: комиссия 12% считается по отметке.',
    'Деньги покупатель отдаёт тебе напрямую, мы платежей не принимаем.'
  );
  if (s.cabinetUrl) lines.push('', `Кабинет: ${s.cabinetUrl}`);
  return lines.filter((l) => l !== null).join('\n');
}
