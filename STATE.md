# STATE.md — читай меня первым после сбоя

> Точка восстановления проекта. Если сессия/Cowork потеряны — начни отсюда.
> Принцип: **реальность (git/деплой/код на диске) важнее заметок.** Этот файл сверен с кодом 2026-07-03.

---

## Что это за проект

Тестовый билетный стенд **SoiLüDi (SLS)**: оплата → QR-билет на email → сканер на входе. Стек: **Next.js 14 (app router) + Supabase + Resend + Payrexx**.

- **Репозиторий:** `creox-ch/slswiss-tickets` (GitHub, **public** — см. «Закрытые решения»)
- **Деплой (прод):** https://slswiss-tickets.vercel.app — Vercel, команда **creox** (план Hobby). Git-интеграция: `git push` в `main` → авто-деплой.
- **ТЗ (источник истины):** [`docs/TZ-tickets-subscription.md`](docs/TZ-tickets-subscription.md) (копия Google-дока).

---

## 🔴 ГДЕ МЫ СЕЙЧАС (на 2026-07-03)

**Работает и задеплоено:** выпуск билета, QR-токен, письмо с QR (hosted-картинка `/api/qr` + PNG-вложение), сканер `/scan`, проверка входа (`valid → already → not_paid → invalid`). Email+Payrexx-доступ настроены 2026-06-29 (X-API-KEY, hex-подпись вебхука).

**2026-07-03 — ревью проекта + фиксы (этот спринт):**
- 🐛 Гонка двух сканеров: `checkin` теперь проверяет результат `update` (`.select()`), проигравший получает `already`, а не второй «✅ Вход».
- 🐛 Сбой БД больше не выглядит как «билет не найден»: `maybeSingle()` + отдельная обработка `error` в checkin и вебхуке.
- 🐛 Вебхук при НАШЕЙ ошибке (БД/Payrexx API) отвечает **500** → Payrexx ретраит, оплата не теряется молча (обработка идемпотентна). Раньше был 200 — событие пропадало.
- 🔒 Цену определяет только сервер: `TICKET_PRICE_RAPPEN` (default 100), `amount` из тела игнорируется (раньше клиент мог купить билет за 0.01 CHF).
- 🔒 Подпись вебхука **fail-closed**: без `PAYREXX_WEBHOOK_SIGNING_KEY` вебхук отклоняется; временный обход — `ALLOW_UNSIGNED_WEBHOOKS=1`.
- 🔒 Опциональный ключ персонала: если задан `CHECKIN_STAFF_KEY`, `/api/checkin` требует заголовок `X-Staff-Key`; на `/scan` появилось поле «🔑 Ключ сканера» (хранится в localStorage).
- 🔒 `/api/qr` принимает только токеноподобные `t` (8–64 символа `[A-Za-z0-9_-]`); имя/событие экранируются в HTML письма.
- ✨ После оплаты покупатель попадает на `/thanks` («билет придёт на почту»), а не на служебный сканер.
- ✅ Тесты: Playwright (unit: подпись вебхука, парсер form-data, escapeHtml; e2e: сканер и покупка с мокнутым API) + CI GitHub Actions (`.github/workflows/test.yml`: build + tests).
- 🛡️ GitHub: включена branch protection на `main` (оба репо creox-ch): PR + 1 ревью для не-админов; админы пушат напрямую.

**Следующий шаг:** тестовая реальная оплата через Payrexx (PSP в кабинете). Перед боевым событием — чек-лист ниже.

**Чек-лист перед продом:**
1. Удалить `app/api/dev/` и `GET`-диагностику из `app/api/payrexx/create/route.js`; убрать `DEV_ISSUE_TOKEN` из env.
2. Задать `PAYREXX_WEBHOOK_SIGNING_KEY` (и убрать `ALLOW_UNSIGNED_WEBHOOKS`, если ставили).
3. Задать `CHECKIN_STAFF_KEY` и раздать его персоналу на входе.
4. Задать реальную цену `TICKET_PRICE_RAPPEN`.
5. Закоммитить `package-lock.json` (нужен npm локально или через CI) — воспроизводимые сборки.

**Часть 2 ТЗ (подписка SLS через Stripe) — ещё не реализована.**

---

## Реальная структура файлов (сверено с диском 2026-06-24)

```
slswiss-tickets/
  STATE.md                        ← этот файл
  README.md                       обзор стенда
  DEPLOY.md                       пошаговый деплой + тест без Payrexx
  CLAUDE.md                       гайд для AI-агента
  package.json                    deps: next 14, @supabase/supabase-js, resend, qrcode, @zxing/browser
  next.config.js
  .env.example                    все переменные с пояснениями
  .gitignore                      node_modules, .next, .env, .env.local, .vercel
  supabase-schema.sql             таблица tickets + RLS
  docs/
    TZ-tickets-subscription.md    ТЗ (источник истины, копия Google-дока)
  lib/
    payrexx.js                    HMAC-подписи, createGateway, getTransaction, verifyWebhookSignature
    supabase.js                   ЛЕНИВЫЙ service_role клиент (Proxy) — экспорт supabaseAdmin
    ticket.js                     ЛЕНИВЫЙ Resend, buildQrDataUrl, sendTicketEmail
  playwright.config.js            тесты: unit + e2e (webServer: next dev)
  .github/workflows/test.yml      CI: build + Playwright на push/PR в main
  tests/
    unit/payrexx.spec.js          подпись вебхука (fail-closed), unflattenTransaction
    unit/ticket.spec.js           escapeHtml
    e2e/scan.spec.js              сканер: ok/already/invalid + ключ персонала (API мокается)
    e2e/buy.spec.js               покупка: без amount с клиента, 503, /thanks
  app/
    layout.jsx
    page.jsx                      страница покупки (POST /api/payrexx/create → редирект)
    thanks/page.jsx               «спасибо, билет придёт на почту» (successRedirectUrl)
    scan/page.jsx                 сканер (@zxing/browser + ручной ввод + поле ключа персонала)
    api/
      payrexx/create/route.js     POST: pending-билет + Payrexx Gateway (503 если нет PAYREXX_API_SECRET); цена — только TICKET_PRICE_RAPPEN
      payrexx/webhook/route.js    POST: приём вебхука, верификация (fail-closed), QR, email; 500 при нашей ошибке → ретрай Payrexx
      checkin/route.js            POST {token} (+X-Staff-Key) → result: ok|already|not_paid|invalid|auth
      qr/route.js                 GET ?t=TOKEN → PNG с QR (для картинки в письме)
      dev/issue/route.js          DEV: выпуск билета без Payrexx (gate: DEV_ISSUE_TOKEN). УДАЛИТЬ перед продом.
```

**Устаревшие имена / расхождения ТЗ ↔ код** (в ТЗ одно, в коде другое — верно второе):
- ТЗ `/api/tickets/webhook` → **факт** `app/api/payrexx/webhook/route.js`
- ТЗ `/api/tickets/validate` → **факт** `app/api/checkin/route.js`
- ТЗ `/scanner` (с паролем, html5-qrcode) → **факт** `/scan` (`app/scan/page.jsx`, **@zxing/browser**, пока без пароля)
- ТЗ таблица `tickets` с полями `event/ticket_type/used/used_at` → **факт** `supabase-schema.sql`: поля `reference_id/event_name/status(pending|paid|checked_in|failed|refunded)/qr_token/payrexx_tx_id/paid_at/checked_in_at` (одно событие, один тип билета)
- ТЗ часть 2 (Stripe-подписка `subscriptions`, `/api/subscribe`, `/api/stripe/webhook`) — **не реализована** в этом репо.
- Файлов `HANDOFF.md`, `IVANNA-NEXT-SPRINT.md`, `slswiss-architecture.md` тут **нет** — они относятся к другому проекту (основной сайт slswiss.ch), не к этому стенду.

---

## Реальные команды, селекторы, факты (проверены)

**Сборка / запуск (npm scripts из package.json):**
```bash
npm install
npm run dev        # next dev (localhost:3000)
npm run build      # next build
npm run start      # next start
# быстрая проверка синтаксиса серверных файлов:
node --check lib/*.js app/api/**/route.js
```
> Камера сканера работает только по HTTPS → тестировать на проде Vercel, не на localhost.

**Тест сканера без Payrexx (рабочий путь сейчас):**
1. `https://slswiss-tickets.vercel.app/api/dev/issue?key=<DEV_ISSUE_TOKEN>&email=<почта>&name=<имя>` → вернёт `qr_token`.
2. Открыть `/scan` → «Ввести код вручную» → вставить `qr_token` (письма с QR нет, пока не задан `RESEND_API_KEY`).
3. Результаты: первый скан → ✅ Вход; повтор → ⚠️ Уже входил; случайный код → ❌ Невалиден.

**Health-checks (curl/fetch на проде):**
- `POST /api/checkin {token:"x"}` → `200 {"result":"invalid","message":"билет не найден"}` = Supabase подключён, таблица есть.
- `GET /api/dev/issue` (без key) → `401 {"ok":false,"error":"bad key"}` = `DEV_ISSUE_TOKEN` задан.

**Ключевые факты кода:**
- `amount` — в **раппенах** (1.00 CHF = 100). Цену задаёт ТОЛЬКО сервер (`TICKET_PRICE_RAPPEN`, default 100); клиент `amount` не шлёт, сервер его игнорирует.
- QR кодирует `${PUBLIC_BASE_URL}/scan?t=<qr_token>`. Страница `/scan` **не делает авто-checkin** из URL-параметра (только камера/ручной ввод) — покупатель сам себя не отметит.
- Webhook не доверяет payload: после приёма дёргает `GET /Transaction/{id}` и проверяет `status === 'confirmed'`. Подпись — заголовок `X-Webhook-Signature`, HMAC-SHA256 (lowercase hex) сырого тела по `PAYREXX_WEBHOOK_SIGNING_KEY`; **fail-closed** без ключа. Наша ошибка (БД/API) → **500** → Payrexx ретраит; обработка идемпотентна.
- Чек-ин: `update ... eq(status,'paid').select()` — при гонке двух сканеров проигравший получает `already`. Если задан `CHECKIN_STAFF_KEY`, требуется заголовок `X-Staff-Key` (сканер держит его в localStorage).
- `lib/supabase.js`, `lib/ticket.js`, env в `lib/payrexx.js` — **ленивые** (иначе `next build` падает: «Failed to collect page data»; и env можно менять в тестах).
- Payrexx API base: `https://api.payrexx.com/v1.0`, instance передаётся как `?instance=`.
- Тесты: `npm test` (Playwright; e2e мокают API через `page.route` — Supabase/Payrexx не нужны). Локально node нет — валидация через CI.

**Env-переменные (Vercel → проект → Settings → Environment Variables):**

| Переменная | Назначение | Статус |
|---|---|---|
| `SUPABASE_URL` | `https://dwcmiommviauwzkhkbki.supabase.co` | ✅ задано |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role (секрет) | ✅ задано |
| `PUBLIC_BASE_URL` | `https://slswiss-tickets.vercel.app` | ✅ задано |
| `TICKET_FROM_EMAIL` | `SoiLüDi <noreply@slswiss.ch>` | ✅ задано |
| `DEV_ISSUE_TOKEN` | включает dev-выпуск билета | ✅ задано |
| `RESEND_API_KEY` | отправка письма с QR | ✅ задано (2026-06-29) |
| `PAYREXX_API_SECRET` | Payrexx API secret | ✅ задано (2026-06-29) |
| `PAYREXX_INSTANCE` | поддомен Payrexx (часть до `.payrexx.com`) | ✅ задано |
| `PAYREXX_WEBHOOK_SIGNING_KEY` | подпись вебхука; без него вебхук ОТКЛОНЯЕТСЯ (fail-closed) | ✅ задано (2026-06-29, e2e-оплата прошла) |
| `ALLOW_UNSIGNED_WEBHOOKS` | =1 временно разрешает вебхук без подписи (только настройка) | ⬜ не задавать без нужды |
| `TICKET_PRICE_RAPPEN` | цена билета в раппенах (default 100 = 1.00 CHF) | ⬜ опционально |
| `CHECKIN_STAFF_KEY` | ключ персонала для чек-ина; пусто = без ключа | ⬜ задать перед событием |

---

## Как возобновить работу после сбоя (по шагам)

1. Открой этот **STATE.md** и [`docs/TZ-tickets-subscription.md`](docs/TZ-tickets-subscription.md).
2. Проверь, что прод жив: открой https://slswiss-tickets.vercel.app и `POST /api/checkin {token:"x"}` (ждём `result:invalid`).
3. Склонируй/обнови репо: `git clone https://github.com/creox-ch/slswiss-tickets.git` (или `git pull`).
4. Env: скопируй `.env.example` → `.env.local`, заполни. Боевые значения — в Vercel → Settings → Environment Variables.
5. `npm install` → `npm run dev`. Сканер тестируй на проде (HTTPS-камера).
6. Продолжай с раздела «🔴 ГДЕ МЫ СЕЙЧАС» (сейчас — активация PSP в Payrexx).

---

## Чего агент НЕ может из этой среды (ограничения)

- **Нет `gh` CLI.** GitHub-операции — через веб (Claude in Chrome) или PowerShell у Kseniia.
- **`git push`/commit из песочницы не работают.** Mount не даёт удалять/заменять файлы («Operation not permitted» на unlink), застревает `.git/index.lock`. Git-операции делает Kseniia в PowerShell.
- **bash-mount может показывать УСТАРЕВШУЮ/обрезанную копию** недавно отредактированных файлов. **Источник истины — файловые инструменты (Read/Write) и git HEAD/origin/деплой**, не вывод bash `cat`. (24.06 bash показывал 4 файла «обрезанными», хотя на диске и в git они полные.)
- Деплой Vercel-инструмент из Cowork сам не публикует — только git push (авто-деплой) или Vercel CLI.
- Ввод секретов (API-ключи, токены) в формы делает Kseniia сама — агенту нельзя.

---

## Закрытые решения (не пересматривать без причины)

- **Gateway API, не статический Paylink** — Gateway с `referenceId` возвращает его в вебхуке → находим билет. Статический линк такой привязки не несёт.
- **Не доверяем вебхуку слепо** — всегда `GET /Transaction/{id}` + проверка `status==='confirmed'`. (Рекомендация Payrexx.)
- **Ленивая инициализация** Supabase/Resend клиентов — иначе падает `next build`.
- **service_role + RLS без anon-policy** — таблица закрыта от браузера, доступ только через server-side API routes.
- **Письмо не валит оплату** — если Resend упал, билет всё равно `paid`.
- **amount в раппенах**, тестовая сумма 1.00 CHF (100).
- **Репозиторий public** — приватный org-repo на Vercel требует план Pro; команда creox на Hobby. Секретов в репо нет (только публичный URL Supabase; ключи в env).
- **dev/issue** — временный тест-эндпоинт без Payrexx. **Удалить (папку `app/api/dev`) и `DEV_ISSUE_TOKEN` перед продом.**

---

## История STATE.md

- **2026-07-03** — ревью проекта + спринт фиксов: гонка сканеров, сбой БД ≠ «не найден», вебхук 500 на нашей ошибке, цена server-side, fail-closed подпись, ключ персонала, `/thanks`, экранирование письма, лимит `/api/qr`, Playwright-тесты + CI, branch protection на `main` (оба репо). Env-таблица актуализирована (Resend/Payrexx заданы 2026-06-29).
- **2026-06-24** — создан. Сверено с кодом и деплоем. Зафиксировано: стенд задеплоен и работает (билет+сканер через dev/issue); оплата Payrexx блокирована активацией PSP (422); env-статус; расхождения ТЗ↔код; ограничения среды (push только из PowerShell, bash-mount показывает устаревшие копии). ТЗ перенесено в `docs/`.
