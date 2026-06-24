# SoiLüDi — тестовый билетный стенд (Payrexx + QR)

Self-contained стенд: оплата через Payrexx → webhook → генерация QR → письмо через Resend → сканер на входе.
Стек тот же, что у формы Kunstwerkstube: **Next.js + Supabase + Resend + Vercel**.

## Что внутри

```
app/
  page.jsx                      страница покупки (создаёт gateway, редиректит на Payrexx)
  scan/page.jsx                 сканер билетов (камера телефона, ZXing)
  api/payrexx/create/route.js   POST: pending-билет + Payrexx Gateway
  api/payrexx/webhook/route.js  POST: приём вебхука, верификация, QR, email
  api/checkin/route.js          POST: валидация QR на входе
lib/
  payrexx.js                    API-клиент + подписи (исходящая + вебхук)
  supabase.js                   service_role клиент (только сервер)
  ticket.js                     генерация QR + письмо
supabase-schema.sql             таблица tickets + RLS
```

## Поток

```
Покупка → /api/payrexx/create
            ├─ INSERT tickets (status=pending, reference_id)
            └─ Payrexx Gateway(referenceId) → редирект на оплату
Оплата на Payrexx
Payrexx → /api/payrexx/webhook
            ├─ проверка X-Webhook-Signature
            ├─ GET Transaction (НЕ доверяем payload) → status=confirmed?
            ├─ UPDATE tickets paid + qr_token
            └─ Resend: письмо с QR (ошибка письма НЕ валит билет)
Вход → /scan сканирует QR → /api/checkin
            ├─ paid       → checked_in (✅)
            ├─ checked_in → already (⚠️ уже входил)
            └─ иначе      → not_paid / invalid
```

## Настройка (≈20 мин)

### 1. Supabase
Открой SQL Editor → вставь `supabase-schema.sql` → Run.
Возьми `SUPABASE_SERVICE_ROLE_KEY` в Settings → API (это **секрет**, только сервер).

### 2. Payrexx API
Payrexx → Settings → API → скопируй **API Secret** → в `PAYREXX_API_SECRET`.
`PAYREXX_INSTANCE=slswiss` (поддомен из slswiss.payrexx.com).

### 3. Webhook в Payrexx
После деплоя на Vercel:
Payrexx → Webhooks → Add Webhook
- URL: `https://<твой-домен>/api/payrexx/webhook`
- Тип события: **Transaction**
- Content type: **JSON** (form-data тоже поддержан, но JSON чище)
- Скопируй signing key → в `PAYREXX_WEBHOOK_SIGNING_KEY`

### 4. Resend
`RESEND_API_KEY` уже есть от формы Kunstwerkstube — можно тот же аккаунт.
Домен `slswiss.ch` должен быть верифицирован в Resend (иначе письма не уйдут).

### 5. Локально
```bash
cp .env.example .env.local   # заполни значения
npm install
npm run dev
```
Открой http://localhost:3000 — купи тестовый билет (0.01 CHF).
Вебхук локально не долетит (нужен публичный URL) — прокинь через `ngrok http 3000`
и временно поставь ngrok-URL в webhook Payrexx, либо тестируй вебхук уже на Vercel.

### 6. Деплой на Vercel
```bash
vercel
```
Залей все переменные из `.env.example` в Vercel → Settings → Environment Variables.
`PUBLIC_BASE_URL` = твой прод-домен (например `https://tickets.slswiss.ch`).

## Важные решения (зачем так)

- **Не доверяем вебхуку слепо.** После приёма дёргаем `GET /Transaction/{id}` и проверяем
  `status === 'confirmed'`. Payrexx сам это рекомендует как best practice. Так подделка
  вебхука не выпустит билет, даже если кто-то узнает URL.
- **Подпись вебхука** (`X-Webhook-Signature`) проверяется timing-safe сравнением.
  Если ключ не задан — пропускаем с warn (только для локального теста).
- **service_role + RLS без anon-policy.** Таблица закрыта от браузера полностью,
  весь доступ только через server-side API routes. Тот же паттерн, что в форме Kunstwerkstube.
- **Письмо не валит оплату.** Если Resend упал — билет всё равно `paid`, лог пишется,
  можно переслать вручную. (Принцип из form-mvp: email failures don't fail submissions.)
- **Идемпотентность.** Повторный вебхук на уже `paid`/`checked_in` билет ничего не ломает.
  Повторный скан показывает «уже входил» с временем входа.
- **Gateway API, не статический Paylink.** Статический Paylink (`/pay?tid=...`) не несёт
  привязку к заказу — вебхук от него не скажет, какой билет оплачен. Gateway с `referenceId`
  возвращает этот reference в вебхуке → находим билет. Статический линк оставь для совсем
  быстрой ручной проверки оплаты, но для стенда используй create-route.

## Что это НЕ покрывает (осознанно, для теста)

- Несколько типов билетов / цен — сейчас один `eventName` + amount в коде покупки.
- Возвраты/отмены обрабатываются по статусу, но без UI.
- Лимит количества билетов на событие.
- Антифрод сверх верификации статуса.
- Перевод писем (только русский шаблон).
