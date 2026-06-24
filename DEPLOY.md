# Деплой на Vercel — тест без Payrexx

Payrexx API ещё нет (платная подписка), поэтому на этом деплое тестируем
**сканер + QR + письмо** через dev-эндпоинт. Покупка через Payrexx подключится позже.

Папка проекта: `tickets-stand/` (эта папка).

---

## 0. Supabase (один раз)

Supabase → SQL Editor → вставь `supabase-schema.sql` → **Run**.
Возьми `service_role` ключ: Settings → API → `service_role` (секрет!).
URL проекта уже известен: `https://dwcmiommviauwzkhkbki.supabase.co`.

## 1. Деплой через Vercel CLI

В терминале, из этой папки:

```bash
cd "C:\Users\ivann\Documents\Claude\Projects\Ivanna tasks (1)\tickets-stand"
npm i -g vercel          # если ещё не стоит
vercel login             # один раз
vercel --scope creox     # первый деплой → ответь на вопросы (project name: tickets-stand)
```

Первый `vercel` создаст проект и даст превью-URL вида `https://tickets-stand-xxx.vercel.app`.

## 2. Env-переменные в Vercel

Vercel → проект → Settings → Environment Variables. Минимум для теста сканера:

| Переменная | Значение | Зачем |
|---|---|---|
| `SUPABASE_URL` | `https://dwcmiommviauwzkhkbki.supabase.co` | БД |
| `SUPABASE_SERVICE_ROLE_KEY` | *(секрет из Supabase)* | сервер пишет/читает билеты |
| `PUBLIC_BASE_URL` | твой vercel-URL (из шага 1) | ссылка внутри QR |
| `DEV_ISSUE_TOKEN` | любая длинная случайная строка | включает dev-выпуск билета |

Для теста письма (опционально, Resend от формы Kunstwerkstube):

| `RESEND_API_KEY` | *(секрет)* | отправка письма с QR |
| `TICKET_FROM_EMAIL` | `SoiLüDi <noreply@slswiss.ch>` | from (домен должен быть верифицирован в Resend) |

Payrexx (`PAYREXX_*`) — **пока пропусти**. Кнопка «Купить билет» будет давать ошибку,
это ожидаемо до подключения API.

После добавления переменных передеплой:
```bash
vercel --prod --scope creox
```
(или Vercel сам передеплоит при следующем push, если подключишь git).

## 3. Как протестировать без Payrexx

1. Выпусти тестовый билет (подставь свой `DEV_ISSUE_TOKEN` и почту):
   ```
   https://<твой-домен>/api/dev/issue?key=ТВОЙ_ТОКЕН&email=ty@mail.com&name=Тест
   ```
   Ответ вернёт `qr_token` и `scanUrl`. Если задан Resend — придёт письмо с QR.
2. Открой `https://<твой-домен>/scan` на телефоне → «Включить камеру» →
   отсканируй QR из письма (или вбей `qr_token` вручную через «Ввести код вручную»).
3. Проверь сценарии:
   - первый скан → ✅ Вход
   - повторный скан → ⚠️ Уже входил
   - случайный токен → ❌ Невалиден

> Камера в браузере работает только по HTTPS — поэтому и тестируем на Vercel, а не на localhost.

## 4. Когда появится Payrexx API

1. Settings → API → скопируй **API Secret** → env `PAYREXX_API_SECRET`.
2. `PAYREXX_INSTANCE=slswiss` (поддомен `slswiss.payrexx.com`).
3. Webhooks → Add Webhook: URL `https://<домен>/api/payrexx/webhook`,
   событие **Transaction**, content type **JSON** → signing key в `PAYREXX_WEBHOOK_SIGNING_KEY`.
4. Удали `DEV_ISSUE_TOKEN` (и папку `app/api/dev`) — dev-выпуск больше не нужен.

---

## Альтернатива: деплой через GitHub (под прод)

Подходит к вашему workflow (`creox-ch`). Создай репозиторий, запушь папку,
в Vercel → Add New Project → Import из GitHub → задай те же env vars.
Дальше каждый push в `main` = авто-деплой.
