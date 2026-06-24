import crypto from 'crypto';

/**
 * Payrexx API helper.
 *
 * Две вещи, которые важно понять про Payrexx:
 *
 * 1) Для ВЫЗОВОВ API (создать Gateway, прочитать Transaction) подпись считается так:
 *    - берём query-string из POST-полей (или пустую строку для GET),
 *    - HMAC-SHA256(этой строки, API_SECRET),
 *    - base64,
 *    - кладём в поле ApiSignature.
 *
 * 2) Для ВХОДЯЩЕГО вебхука подпись приходит в заголовке X-Webhook-Signature:
 *    HMAC-SHA256(сырое тело запроса, WEBHOOK_SIGNING_KEY), и её мы сверяем сами.
 *    (Ключ вебхука задаётся отдельно при создании вебхука в кабинете Payrexx.)
 *
 * INSTANCE — это поддомен: для slswiss.payrexx.com INSTANCE = "slswiss".
 */

const INSTANCE = process.env.PAYREXX_INSTANCE;       // "slswiss"
const API_SECRET = process.env.PAYREXX_API_SECRET;   // из Payrexx → Settings → API
const WEBHOOK_KEY = process.env.PAYREXX_WEBHOOK_SIGNING_KEY; // signing key вебхука

const BASE = `https://api.payrexx.com/v1.0`;

/** Подпись для исходящих API-вызовов: HMAC-SHA256(querystring) → base64 */
function apiSignature(queryString) {
  return crypto
    .createHmac('sha256', API_SECRET)
    .update(queryString)
    .digest('base64');
}

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
  const query = toQuery(params);
  const body = `${query}&ApiSignature=${encodeURIComponent(apiSignature(query))}`;

  const res = await fetch(`${BASE}/Gateway/?instance=${INSTANCE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
  // GET-подпись считается от пустой строки
  const sig = apiSignature('');
  const url = `${BASE}/Transaction/${txId}/?instance=${INSTANCE}&ApiSignature=${encodeURIComponent(sig)}`;
  const res = await fetch(url, { method: 'GET' });
  const json = await res.json();
  if (json.status !== 'success') {
    throw new Error(`Payrexx getTransaction failed: ${JSON.stringify(json)}`);
  }
  return json.data[0];
}

/**
 * Проверить подпись входящего вебхука.
 * raw — СЫРОЕ тело запроса (string), signature — заголовок X-Webhook-Signature.
 * Возвращает true/false. Если WEBHOOK_KEY не задан — пропускаем (для теста),
 * но в проде ключ должен быть обязателен.
 */
export function verifyWebhookSignature(raw, signature) {
  if (!WEBHOOK_KEY) {
    console.warn('[payrexx] WEBHOOK_SIGNING_KEY не задан — подпись НЕ проверяется. Только для теста!');
    return true;
  }
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_KEY).update(raw).digest('base64');
  // timing-safe сравнение
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
