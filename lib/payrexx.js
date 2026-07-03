import crypto from 'crypto';

/**
 * Payrexx API helper.
 *
 * Две вещи, которые важно понять про Payrexx:
 *
 * 1) Для ВЫЗОВОВ API (создать Gateway, прочитать Transaction) авторизация —
 *    заголовком X-API-KEY: <API_SECRET> (это "API Key" из Payrexx → API & Plugins).
 *    instance остаётся в query. ApiSignature (старая HMAC-схема) при этом НЕ нужен.
 *
 * 2) Для ВХОДЯЩЕГО вебхука подпись приходит в заголовке X-Webhook-Signature:
 *    SHA-256 HMAC от СЫРОГО тела запроса, ключ — signing key (UTF-8), формат —
 *    lowercase hex (НЕ base64). Сверяем сами.
 *    (Signing key задаётся в разделе Webhooks кабинета Payrexx.)
 *
 * INSTANCE — это поддомен: для slswiss.payrexx.com INSTANCE = "slswiss".
 *
 * env читаем ЛЕНИВО (внутри функций), как и остальные клиенты проекта:
 * значения можно менять в тестах, а сборка не требует переменных.
 * .trim() — защита от невидимого пробела/переноса строки, прилипшего при
 * вставке ключа в переменные окружения (частая причина "The API secret is not correct").
 */

const env = (name) => (process.env[name] || '').trim();

const BASE = `https://api.payrexx.com/v1.0`;

/** form-urlencoded из плоского объекта, в порядке ключей */
function toQuery(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) usp.append(k, String(v));
  }
  return usp.toString();
}

/**
 * Создать Gateway (= намерение оплаты с привязкой к нашему заказу).
 * Возвращает { id, link } — link ведём пользователя оплачивать.
 */
export async function createGateway({ referenceId, amount, currency = 'CHF', purpose, successUrl, failedUrl, cancelUrl }) {
  const params = {
    amount,                 // в наименьшей единице (раппены): 0.01 CHF = 1
    currency,
    referenceId,            // ВЕРНЁТСЯ в вебхуке — связь с нашим билетом
    purpose: purpose || 'SoiLüDi ticket',
    successRedirectUrl: successUrl,
    failedRedirectUrl: failedUrl,
    cancelRedirectUrl: cancelUrl,
  };
  const body = toQuery(params);

  const res = await fetch(`${BASE}/Gateway/?instance=${env('PAYREXX_INSTANCE')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-API-KEY': env('PAYREXX_API_SECRET'),
    },
    body,
  });
  const json = await res.json();
  if (json.status !== 'success') {
    throw new Error(`Payrexx createGateway failed: ${JSON.stringify(json)}`);
  }
  const data = json.data[0];
  return { id: data.id, link: data.link, raw: data };
}

/**
 * Прочитать транзакцию по id — независимая верификация статуса.
 * Не доверяем вебхуку слепо: дёргаем API и сверяем status === 'confirmed'.
 */
export async function getTransaction(txId) {
  const url = `${BASE}/Transaction/${txId}/?instance=${env('PAYREXX_INSTANCE')}`;
  const res = await fetch(url, { method: 'GET', headers: { 'X-API-KEY': env('PAYREXX_API_SECRET') } });
  const json = await res.json();
  if (json.status !== 'success') {
    throw new Error(`Payrexx getTransaction failed: ${JSON.stringify(json)}`);
  }
  return json.data[0];
}

/**
 * Проверить подпись входящего вебхука.
 * raw — СЫРОЕ тело запроса (string), signature — заголовок X-Webhook-Signature.
 *
 * FAIL-CLOSED: если PAYREXX_WEBHOOK_SIGNING_KEY не задан, вебхук ОТКЛОНЯЕТСЯ.
 * Репозиторий публичный — URL вебхука известен любому, без подписи его можно
 * подделать. Единственное исключение — явный флаг ALLOW_UNSIGNED_WEBHOOKS=1
 * (только на время настройки, убрать после включения signing key).
 */
export function verifyWebhookSignature(raw, signature) {
  const key = env('PAYREXX_WEBHOOK_SIGNING_KEY');
  if (!key) {
    if (env('ALLOW_UNSIGNED_WEBHOOKS') === '1') {
      console.warn('[payrexx] ALLOW_UNSIGNED_WEBHOOKS=1 — подпись НЕ проверяется. Только для настройки!');
      return true;
    }
    console.warn('[payrexx] PAYREXX_WEBHOOK_SIGNING_KEY не задан — вебхук отклонён (fail-closed).');
    return false;
  }
  if (!signature) return false;
  // Payrexx: lowercase hex SHA-256 HMAC от сырого тела
  const expected = crypto.createHmac('sha256', key).update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature).trim().toLowerCase());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * form-data вида transaction[id]=..&transaction[contact][email]=.. → объект.
 * Payrexx может слать вебхук как JSON или как form-urlencoded — это парсер второго случая.
 */
export function unflattenTransaction(usp) {
  const out = {};
  for (const [key, value] of usp.entries()) {
    const m = key.match(/^transaction\[(.+)\]$/);
    if (!m) continue;
    const path = m[1].split('][');
    let cur = out;
    path.forEach((p, i) => {
      if (i === path.length - 1) cur[p] = value;
      else cur = cur[p] || (cur[p] = {});
    });
  }
  return out;
}
