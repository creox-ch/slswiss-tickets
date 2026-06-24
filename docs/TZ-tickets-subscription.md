# ТЗ: Система билетов с QR + Подписка SLS

> **Источник истины.** Это копия Google-документа «ТЕСТ: Билеты QR + Подписка SLS — полное ТЗ для Иванны (среда)», перенесённая в репозиторий, чтобы спецификация и код физически не расходились.
>
> Оригинал: https://docs.google.com/document/d/1_F3obGTQTvBQg-Ma-fwb1EOp7V0oGzFzz_PJ-efzcgQ/edit
> Подготовлено: 20 июня 2026. К встрече в среду (24.06.2026).
> Связанные задачи: задача 2 — https://claude.ai/share/d89b6dc0-6616-4f4a-b267-129f8a931c97 · задача 3 — https://docs.google.com/document/d/1f5X1wXVIkvR8yYX4USO8QgCeGIgWPpT2de8wbP8nBtg/edit
> Контекст-чат: https://claude.ai/share/75550238-5e27-4644-864f-2737bb79d139

> ⚠️ **Расхождение ТЗ ↔ код (см. STATE.md):** реализованный стенд — это подмножество ТЗ (одно событие, оплата Payrexx) с другими путями endpoint'ов. Маппинг имён — в STATE.md.

---

## Обзор: что тестируем

Три сценария в одном прототипе, на одном стеке:

1. **CASHFLOW** — несколько типов билетов, QR одноразовый, скан на входе
2. **FRANKENPLATZ** — несколько типов билетов, QR одноразовый, скан на входе
3. **SLS** — месячная подписка (recurring), без QR, управление в Supabase

---

## Часть 1 — События: CashFlow и Frankenplatz

**Параметры (одинаковые для обоих событий):**
- Типов билетов: несколько (минимум Standard / VIP — точные названия и цены уточнить)
- QR: одноразовый. Скан = погашен. Повторный скан того же QR не пройдёт.
- Оплата: Payrexx (Paylink — no-code ссылка на оплату, без сайта)
- Письмо с билетом: Resend
- База: Supabase (Frankfurt)
- Сканер на входе: веб-страница на телефоне, без приложения

**Логика потока:**
Покупатель выбирает тип билета → Payrexx Paylink (отдельная ссылка на тип) → оплата (TWINT / карта / PostFinance Pay / Apple Pay / Google Pay) → Payrexx шлёт webhook на наш endpoint (Next.js на Vercel) → endpoint проверяет подпись webhook → генерирует UUID (токен билета) → пишет в Supabase `tickets` (id, email, event, ticket_type, status=valid, used=false, created_at, payrexx_transaction_id) → генерирует QR из UUID (qrcode) → Resend отправляет письмо (QR + событие + дата + тип) → покупатель приходит → контролёр открывает страницу-сканер на телефоне → сканирует QR → Supabase отвечает: ✅ VALID (впускаем, used=true, used_at) / ⛔ УЖЕ ИСПОЛЬЗОВАН / ❌ НЕ НАЙДЕН.

**Таблица Supabase `tickets` (по ТЗ):**

| Поле | Тип | Описание |
|---|---|---|
| id | UUID (PK) | токен билета = то, что в QR |
| email | text | email покупателя |
| event | text | 'cashflow' \| 'frankenplatz' |
| ticket_type | text | 'standard' \| 'vip' (и др.) |
| status | text | 'valid' \| 'cancelled' |
| used | boolean | default false |
| used_at | timestamptz | когда погашен (null если нет) |
| created_at | timestamptz | default now() |
| payrexx_transaction_id | text | для сверки с Payrexx |

**Компоненты (по ТЗ):**
- **A. Webhook-endpoint** `/api/tickets/webhook` — POST: проверить подпись Payrexx (HMAC) → статус `confirmed` → UUID → запись в Supabase → QR (qrcode) → письмо Resend → 200 OK.
- **Б. Письмо (Resend)** — от tickets@creox.ch (или events@); QR (PNG inline), событие, дата, тип; без суммы/персданных; тема «Ваш билет — [Событие]».
- **В. Страница-сканер** `/scanner` — по паролю (env), html5-qrcode, POST `/api/tickets/validate`: not found → NOT_FOUND, used → ALREADY_USED + время, valid → атомарно used=true → VALID. Большой цветной экран (зелёный/красный/серый).
- **Г. Payrexx Paylink** (no-code) — отдельный Paylink на каждый тип; webhook URL в настройках; метаданные event + ticket_type; email обязателен.

**Безопасность:**
1. Webhook ОБЯЗАТЕЛЬНО проверяет подпись Payrexx (HMAC-SHA256).
2. В QR — ТОЛЬКО UUID, без персданных/сумм/имён.
3. Гашение атомарно: `UPDATE tickets SET used=true, used_at=now() WHERE id=$1 AND used=false RETURNING *`. Пустой returning = уже погашен.
4. Сканер закрыт паролем, не индексируется.
5. Supabase RLS: сканер читает только нужные поля, без email/платёжных данных.

---

## Часть 2 — Подписка SLS (месячная, 19 CHF) — НЕ реализовано

**Параметры:**
- Продукт: месячная подписка на сообщество SLS Swiss; 19 CHF/мес.
- Оплата: **Stripe Billing** (recurring; TWINT не поддерживает recurring → только карта / Apple Pay / Google Pay).
- База: Supabase (тот же проект). Email: Resend.

**Поток:** «Подписаться» → Stripe Checkout (hosted) → карта/ApplePay/GooglePay → Stripe списывает ежемесячно → webhook → запись/обновление Supabase `subscriptions` (user_id, email, status=active, current_period_end, stripe_subscription_id) → Resend welcome/продление → отмена/неудача → статус cancelled/past_due → доступ к закрытому контенту по статусу в Supabase.

**Таблица Supabase `subscriptions` (по ТЗ):**

| Поле | Тип | Описание |
|---|---|---|
| id | UUID (PK) | internal id |
| email | text | email подписчика |
| stripe_customer_id | text | Stripe customer ID |
| stripe_subscription_id | text | Stripe subscription ID |
| status | text | active \| cancelled \| past_due |
| current_period_end | timestamptz | когда истекает период |
| created_at | timestamptz | дата первой подписки |
| cancelled_at | timestamptz | дата отмены (null если активна) |

**Компоненты:** Stripe Product+Price (19 CHF/month recurring; карты+ApplePay+GooglePay, без TWINT) · `/api/subscribe` (Stripe Checkout Session, mode=subscription) · `/api/stripe/webhook` (checkout.session.completed, invoice.payment_succeeded, customer.subscription.deleted, invoice.payment_failed; verify через `stripe.webhooks.constructEvent`) · middleware доступа по статусу · (опц.) Stripe Billing Portal через `/api/portal`.

---

## Стек — итог (по ТЗ)

| Компонент | Инструмент | Статус |
|---|---|---|
| Билеты: оплата | Payrexx Paylink | есть аккаунт |
| Подписка: оплата | Stripe Billing | есть аккаунт |
| Webhook + логика | Next.js API routes | в стеке |
| База данных | Supabase (Frankfurt) | 3 проекта есть |
| QR-генерация | npm: qrcode | установить |
| Сканер | npm: html5-qrcode | установить |
| Email | Resend | в стеке |
| Деплой | Vercel | Pro аккаунт |

---

## Параллельная задача: диагностика отклонений оплат

Швейцарцы с местными картами и TWINT доходят до оплаты, но платёж отклоняется. **До встречи:** Payrexx → Transactions → фильтр failed/declined → период последнего события → выписать коды отклонений (decline reason) → принести на встречу.

Вероятные причины: 1) лимиты TWINT (банк режет по лимиту), 2) 3-D Secure (клиент не подтвердил вовремя), 3) антифрод Payrexx (фильтр на одинаковые суммы). Быстрые меры: на экране «платёж не прошёл» предлагать другой метод; проверить антифрод-фильтр; подпись у TWINT «проверьте лимит в приложении банка».

---

## Открытые вопросы (уточнить на встрече)

1. Точные названия и цены типов билетов для CashFlow и Frankenplatz.
2. Домен для деплоя прототипа (поддомен или временный Vercel URL?).
3. Email отправителя билетов (tickets@? events@?).
4. Нужна ли страница-dashboard со списком билетов для организатора?
5. SLS: что именно за paywall (Telegram-инвайт? раздел сайта?).
