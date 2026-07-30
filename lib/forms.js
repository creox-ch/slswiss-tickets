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
  };
}

/** Дефолтный ящик, если ничего не настроено (исторический). */
export const DEFAULT_NOTIFY_EMAIL = 'assistant@creox.ch';

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
 * Честно проговариваем статус: это НЕ купленный билет. Цены и схема
 * билетов ещё не готовы, поэтому обещаем только «напишем первыми».
 * Содержимое собирает сервер из сохранённых полей.
 */
export function renderRegistrationHtml(sub) {
  const s = plainObject(sub);
  const hi = s.name ? `${escapeHtml(String(s.name))}, привет!` : 'Привет!';
  const event = s.event || 'frankenplatz-2026-10';
  const ctaHref = escapeHtml(withUtm(`${FORUM_URL}/calculators/`, 'registration', event, 'cta'));
  return emailShell({
    title: 'Frankenplatz — Ранняя регистрация',
    heading: 'Ты в списке ранней регистрации',
    lead: `${hi} Мы записали тебя. <b>Это ещё не билет</b> — продажи пока не открыты. Как только появятся цены и схема билетов, ты узнаешь об этом первым(ой), до публичного анонса.`,
    blocks: reportRowsDesigned(s.payload),
    cta: {
      href: ctaHref,
      label: 'Посчитать в калькуляторах',
      lead: 'Пока можно посчитать свои деньги — бесплатно и без регистрации.',
    },
    footerNoteHtml: 'Ты получил(а) это письмо, потому что оставил(а) заявку на frankenplatz.ch.',
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
    `${hi} Мы записали тебя. Это ещё не билет — продажи пока не открыты. Как только появятся цены и схема билетов, ты узнаешь об этом первым(ой), до публичного анонса.`,
    ...(rows ? ['', rows] : []),
    '',
    `Пока можно посчитать свои деньги в калькуляторах форума — бесплатно и без регистрации: ${withUtm(
      `${FORUM_URL}/calculators/`,
      'registration',
      s.event || 'frankenplatz-2026-10',
      'cta'
    )}`,
    '',
    '—',
    'Ты получил(а) это письмо, потому что оставил(а) заявку на frankenplatz.ch',
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
  const speakersHref = escapeHtml(withUtm(`${FORUM_URL}/speakers.html`, 'speaker', event, 'footer'));
  const rowsCard = reportRowsDesigned(s.payload);
  const submitted = rowsCard
    ? `
  <tr><td class="fp-pad" style="padding:16px 34px 0">
    <p style="margin:0;font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:13px;color:#9A8BB3">Что ты отправил(а):</p>
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
    footerNoteHtml: `Ты получил(а) это письмо, потому что оставил(а) анкету спикера на <a href="${speakersHref}" style="color:#7A6C93">frankenplatz.ch</a>.`,
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
    ...(rows ? ['', 'Что ты отправил(а):', rows] : []),
    '',
    'Если нужно что-то дополнить или поправить — просто ответь на это письмо.',
    '',
    '—',
    'Ты получил(а) это письмо, потому что оставил(а) анкету спикера на frankenplatz.ch/speakers.html',
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
function emailShell({ title, heading, lead = '', blocks = '', cta = null, footerNoteHtml = '', footerLinkHtml = '' }) {
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
      <td align="left" style="font-family:'Unbounded','Manrope',Arial,Helvetica,sans-serif;font-weight:800;font-size:18px;letter-spacing:-.02em;color:#F3EEF9">Frankenplatz</td>
      <td align="right" style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-weight:700;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#E6B450">24–25 октября · Zürich</td>
    </tr></table>
  </td></tr>

  <tr><td class="fp-pad" style="padding:38px 34px 6px">
    <div style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-weight:700;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#E6B450;margin:0 0 16px">Frankenplatz · форум о деньгах в Швейцарии</div>
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
  const ctaHref = escapeHtml(withUtm(FORUM_URL, 'calc-report', event, s.form_key || 'report'));
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
  return emailShell({
    title: `Frankenplatz — ${what}`,
    heading,
    lead: 'Ты сделал(а) расчёт на сайте форума и попросил(а) прислать результат. Вот он:',
    blocks: reportRowsDesigned(s.payload) + disclaimer,
    cta: {
      href: ctaHref,
      label: 'Забронировать место',
      lead: 'Полные разборы с экспертами — на форуме <span style="color:#B98BFF;font-weight:700">Frankenplatz</span>,<br>24–25 октября 2026.',
    },
    footerNoteHtml:
      'Ты получил(а) это письмо, потому что оставил(а) свой e-mail в калькуляторе на сайте форума.',
    footerLinkHtml: `<a href="mailto:info@frankenplatz.ch?subject=Unsubscribe" style="font-family:'Manrope',Arial,Helvetica,sans-serif;font-size:12px;color:#7A6C93;text-decoration:underline;display:inline-block;margin-top:8px">Отписаться</a>`,
  });
}

/** Plain-text версия письма-отчёта калькулятора (text-часть рядом с HTML — анти-спам). */
export function renderReportText(sub) {
  const s = plainObject(sub);
  const rows = textRows(s.payload);
  const what = s.role || s.form_key || 'расчёт';
  return [
    'FRANKENPLATZ · Форум о деньгах в Швейцарии',
    '',
    `Твой расчёт — ${what}`,
    '',
    'Ты сделал(а) расчёт на сайте форума и попросил(а) прислать результат. Вот он:',
    ...(rows ? ['', rows] : []),
    '',
    'Это не индивидуальная финансовая консультация. Расчёт упрощён для наглядности: порядок величин верный, но реальный случай зависит от твоих точных данных.',
    '',
    `Полные разборы с экспертами — на форуме Frankenplatz, 24–25 октября 2026: ${withUtm(
      FORUM_URL,
      'calc-report',
      s.event || 'frankenplatz-2026-10',
      s.form_key || 'report'
    )}`,
    '',
    '—',
    'Ты получил(а) это письмо, потому что оставил(а) свой e-mail в калькуляторе на сайте форума.',
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
    'https://frankenplatz.ch/index.html#program',
    'Программа форума',
    'Кто выступает и в каком порядке'
  )}${linkRow(
    'https://frankenplatz.ch/calculators/index.html',
    'Калькуляторы',
    'Бесплатно, без регистрации'
  )}${linkRow(
    'https://frankenplatz.ch/legal.html#agb',
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

<tr><td class="fp-pad" style="padding:32px 30px;border-top:1px solid rgba(255,255,255,.10);background:radial-gradient(120% 100% at 0% 0%, rgba(155,110,255,.12), transparent 55%),radial-gradient(120% 100% at 100% 100%, rgba(230,180,80,.10), transparent 55%),#100818"><div style="font-family:${U};font-weight:800;font-size:16px;letter-spacing:.01em;color:#FFFFFF;margin-bottom:10px">Frankenplatz.ch</div><div style="font-family:${F};font-size:13px;line-height:1.55;color:#C3B7D4;margin-bottom:6px">Это письмо про твой заказ на форуме Frankenplatz.</div><div style="font-family:${F};font-size:12px;color:#9A8BB3;margin-bottom:14px">24–25.10.2026 · Baden 🇨🇭 · 15 мин от Zürich HB · сохрани письмо: QR внутри нужен на входе</div><div style="font-family:${F};font-size:12px;color:#9A8BB3;line-height:1.5;margin-bottom:12px">Вопросы — просто ответь на это письмо.</div><a href="mailto:info@frankenplatz.ch" style="font-family:${F};font-size:12px;color:#9A8BB3;text-decoration:underline">Написать нам</a><div style="font-family:${F};font-size:12px;color:#7A6C93;line-height:1.6;margin-top:8px"><a href="https://frankenplatz.ch/legal.html#impressum" style="color:#7A6C93;text-decoration:underline">Impressum</a> · <a href="https://frankenplatz.ch/legal.html#agb" style="color:#7A6C93;text-decoration:underline">AGB</a> · <a href="https://frankenplatz.ch/legal.html#datenschutz" style="color:#7A6C93;text-decoration:underline">Datenschutz</a></div></td></tr>

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
 * Самодостаточная HTML-страница-результат перехода по ссылке подтверждения.
 * state: 'confirmed' | 'already' | 'invalid'. Нейтральный стиль (дизайнер
 * причешет вместе с письмами); noindex — служебная страница.
 */
export function confirmPageHtml(state, site = FORUM_URL) {
  const M = {
    confirmed: {
      t: 'Подписка подтверждена',
      b: 'Спасибо! Теперь ты в рассылке форума. Писем без повода не будет.',
    },
    already: {
      t: 'Уже подтверждено',
      b: 'Эта подписка уже активна — ничего делать не нужно.',
    },
    invalid: {
      t: 'Ссылка недействительна',
      b: 'Похоже, ссылка устарела или уже использована. Попробуй подписаться заново на сайте.',
    },
    unsubscribed: {
      t: 'Подписка отменена',
      b: 'Ты ранее отписался(ась) от рассылки, поэтому эта ссылка подтверждения больше не действует. Если передумаешь — подпишись заново на сайте.',
    },
  };
  const m = M[state] || M.invalid;
  const url = escapeHtml(String(site || FORUM_URL));
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(m.t)} · Frankenplatz</title></head>
<body style="margin:0;background:#150E22;color:#EFE9F7;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:520px;margin:12vh auto;padding:0 24px;text-align:center">
  <p style="margin:0 0 10px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#B98BFF">Frankenplatz</p>
  <h1 style="margin:0 0 14px;font-size:26px">${escapeHtml(m.t)}</h1>
  <p style="margin:0 0 26px;font-size:15px;line-height:1.55;color:#C9BEDD">${escapeHtml(m.b)}</p>
  <a href="${url}" style="display:inline-block;background:#7B3FE4;color:#fff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:10px">На сайт форума</a>
</div></body></html>`;
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
  const site = escapeHtml(String(opts.site || FORUM_URL));
  const shell = (title, bodyInner) => `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Frankenplatz</title></head>
<body style="margin:0;background:#150E22;color:#EFE9F7;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:520px;margin:12vh auto;padding:0 24px;text-align:center">
  <p style="margin:0 0 10px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#B98BFF">Frankenplatz</p>
  ${bodyInner}
</div></body></html>`;

  if (state === 'ask') {
    const t = encodeURIComponent(String(opts.token || ''));
    return shell(
      'Отписаться от рассылки',
      `<h1 style="margin:0 0 14px;font-size:26px">Отписаться от рассылки?</h1>
  <p style="margin:0 0 26px;font-size:15px;line-height:1.55;color:#C9BEDD">Больше не хочешь получать письма форума? Подтверди отписку.</p>
  <form method="post" action="?token=${t}" style="margin:0 0 18px">
    <button type="submit" style="display:inline-block;background:#7B3FE4;color:#fff;border:0;cursor:pointer;font-weight:bold;font-size:15px;padding:12px 24px;border-radius:10px">Отписаться</button>
  </form>
  <p style="margin:0"><a href="${site}" style="color:#B98BFF;font-size:14px">Остаться и вернуться на сайт</a></p>`
    );
  }

  const M = {
    done: {
      t: 'Ты отписан(а)',
      b: 'Больше не пришлём писем форума. Если передумаешь — можно подписаться заново на сайте.',
    },
    invalid: {
      t: 'Ссылка недействительна',
      b: 'Похоже, ссылка устарела или уже использована.',
    },
  };
  const m = M[state] || M.invalid;
  return shell(
    m.t,
    `<h1 style="margin:0 0 14px;font-size:26px">${escapeHtml(m.t)}</h1>
  <p style="margin:0 0 26px;font-size:15px;line-height:1.55;color:#C9BEDD">${escapeHtml(m.b)}</p>
  <a href="${site}" style="display:inline-block;background:#7B3FE4;color:#fff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:10px">На сайт форума</a>`
  );
}

/**
 * HTML письма-уведомления о новой заявке.
 * Всё, что пришло от пользователя, экранируется (escapeHtml).
 */

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
