# CLAUDE.md — гайд для AI-агента (репо slswiss-tickets)

> **Сначала прочитай [`STATE.md`](STATE.md)** — там актуальное состояние, текущий блокер и факты, сверенные с кодом. Затем ТЗ — [`docs/TZ-tickets-subscription.md`](docs/TZ-tickets-subscription.md).

## Что это
Билетный стенд SoiLüDi: Next.js 14 (app router) + Supabase + Resend + Payrexx. Прод: https://slswiss-tickets.vercel.app (Vercel team `creox`). Репо `creox-ch/slswiss-tickets` (public). `git push` в `main` → авто-деплой.

## Правила работы
- **Реальность важнее заметок.** При расхождении доков и кода — прав код. Проверяй файлы через Read, не доверяй памяти.
- **bash-mount может показывать устаревшие/обрезанные копии** недавно изменённых файлов. Источник истины — Read/Write и git HEAD/origin/деплой. Не делай выводов о «поломке» по выводу bash `cat`/`wc`.
- **Git-операции (commit/push) — НЕ из песочницы** (mount не даёт unlink, застревает `.git/index.lock`). Коммитит/пушит Kseniia в PowerShell. Давай ей точные команды.
- **Секреты (API-ключи/токены) в формы вводит пользователь**, не агент.
- Перед коммитом: `node --check` серверных файлов; показать git diff/stat; один внятный коммит.

## Карта кода (реальные пути)
- Покупка: `app/page.jsx` → `POST app/api/payrexx/create/route.js` (503 если нет `PAYREXX_API_SECRET`; цена — только серверная `TICKET_PRICE_RAPPEN`) → успех ведёт на `app/thanks/page.jsx`.
- Вебхук: `app/api/payrexx/webhook/route.js` (fail-closed подпись + `GET /Transaction` + `status==='confirmed'`; наша ошибка → 500 → ретрай Payrexx).
- Чек-ин: `app/api/checkin/route.js` (`{token}` + опц. `X-Staff-Key` → `ok|already|not_paid|invalid|auth`).
- Сканер: `app/scan/page.jsx` (@zxing/browser + ручной ввод + поле ключа персонала).
- QR для письма: `app/api/qr/route.js` (`?t=TOKEN` → PNG).
- DEV-выпуск без Payrexx: `app/api/dev/issue/route.js` (gate `DEV_ISSUE_TOKEN`; удалить перед продом).
- Клиенты: `lib/supabase.js` (ленивый Proxy, `supabaseAdmin`), `lib/ticket.js` (ленивый Resend, `sendTicketEmail`, `escapeHtml`), `lib/payrexx.js` (подписи/gateway/transaction/`unflattenTransaction`; env лениво).
- Схема БД: `supabase-schema.sql` (таблица `tickets`).
- Тесты: `tests/unit` + `tests/e2e` (Playwright, `npm test`; e2e мокают API — внешние сервисы не нужны). CI: `.github/workflows/test.yml`.

## Закрытые решения
Gateway (не Paylink) · независимая верификация вебхука · ленивая инициализация клиентов · service_role+RLS без anon · письмо не валит оплату · amount в раппенах (100=1.00 CHF) · репо public (Hobby не деплоит приватный org-repo) · dev/issue временный.

## Текущий спринт
См. «🔴 ГДЕ МЫ СЕЙЧАС» в STATE.md. Кратко: стенд работает end-to-end (оплата Payrexx проверена вживую 2026-06-29). Часть 2 ТЗ (подписка SLS 19 CHF/мес) не реализована; решение 2026-07-03 — делать её на **Payrexx** (единый провайдер платформы), не на Stripe. ⚠ Payrexx trial до ~2026-07-24.
