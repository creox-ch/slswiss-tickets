# STATE.md — читай меня первым после сбоя

> Точка восстановления проекта. Если сессия/Cowork потеряны — начни отсюда.
> Принцип: **реальность (git/деплой/код на диске) важнее заметок.** Блок «ГДЕ МЫ СЕЙЧАС» сверен с кодом 2026-08-15 (с базой — 2026-08-10); разделы ниже — с кодом 2026-07-20.

---

## Что это за проект

Изначально — тестовый билетный стенд **SoiLüDi (SLS)**: оплата → QR-билет на email → сканер на входе. Стек: **Next.js 15 (app router) + React 19 + Supabase + Resend + Payrexx**.

С июля 2026 у репо **вторая роль: серверный бэкенд платформы Creox.** Сайты платформы статические (Vercel/GH Pages) и не умеют держать секреты, поэтому все формы четырёх сайтов шлют заявки сюда — в `POST /api/forms` → таблица `submissions` («база аудитории», решение 2026-07-10). Сюда же по решению 2026-07-03 приедет подписка на Payrexx. Держи это в голове: правка в `lib/forms.js` задевает chudina, atlasintegra, creox и frankenplatz разом.

- **Репозиторий:** `creox-ch/slswiss-tickets` (GitHub, **public** — см. «Закрытые решения»)
- **Деплой (прод):** https://slswiss-tickets.vercel.app — Vercel, команда **creox** (план Hobby). Git-интеграция: `git push` в `main` → авто-деплой.
- **ТЗ (источник истины):** [`docs/TZ-tickets-subscription.md`](docs/TZ-tickets-subscription.md) (копия Google-дока).

---

## 🔴 ГДЕ МЫ СЕЙЧАС (на 2026-08-17)

**Работает и задеплоено:** приём заявок со всех сайтов платформы (`POST /api/forms` → `submissions`), отчёты калькуляторов на почту пользователю с глоссарием терминов, подписка с двойным подтверждением, брендовые страницы подтверждения и отписки, продажа билетов форума (`/api/forum/create` → Payrexx → вебхук → письмо с QR → сканер `/scan`), пакеты бренд-маркета (`/api/market`), автоответы «Оказии», дневная сводка подписок по cron.

Payrexx на платном плане и **в боевом режиме** (тест выключен 2026-08-07). Почтовые ящики `main@`/`info@` подняты в Google Workspace 2026-07-20 — прежние блокеры сняты.

### ⏰ Срочное

**Живая оплата в боевом режиме ни разу не проходила целиком.** В таблице `tickets` единственная строка `paid` — от 2026-07-30, ещё из тестового режима. Скорее всего просто никто не покупал (трафика на сайт нет), но вся цепочка после оплаты — вебхук → `paid` → письмо с QR → чек-ин — в боевом режиме не отрабатывала. Проверяется одной реальной покупкой с возвратом; оплату проводит Иванна.

**После 17.08 эта покупка проверяет сразу три вещи:** боевой Payrexx, Next 15 и resend 6. В письме смотреть, пришёл ли QR картинкой и приложен ли `ticket-qr.png`.

Состояние таблицы на 17.08 (до первого прогона чистки): 15 `pending` (все старше суток, 12 — старше 30 дней, ни у одной нет `payrexx_tx_id`), 7 `checked_in`, 2 `failed`, 1 `paid`. Ночью чистка пометит 15 как `failed` и удалит из них 12.

### Сделано 2026-08-17

- **Next 14.2.35 → 15.5.23, React 18 → 19.** Ветка 14.x перестала получать патчи: за ней числился **21 advisory уровня high**, все закрытые в 15.5.21+. Апгрейд оказался дешевле, чем выглядел: async request APIs (`cookies`/`headers`/`params`/`searchParams` в страницах) у нас не используются нигде — `searchParams` встречается только как `new URL(req.url).searchParams` внутри route handlers, а это не менялось; страниц всего четыре, legacy-API React (`defaultProps`, `propTypes`, string refs) нет. Правок в коде приложения не потребовалось **ни одной** — только версии в `package.json`.
- **`npm audit` теперь чист: 0 уязвимостей.** После апгрейда осталась одна транзитивная — `sharp` 0.34.5 (четыре CVE, унаследованные из libvips): Next 15 тянет его как **optional**-зависимость для оптимизации картинок, которой мы не пользуемся вовсе. Закрыто `overrides` на `^0.35.3`. `postcss` оставлен в `overrides` намеренно — next склонен пинить конкретную версию.
- **resend 4.8 → 6.20 (PR #26)** — с правкой, без которой мажор ломает письма тихо: в 6 поля вложения переехали на camelCase (`contentId` вместо `content_id`), и SDK на старое имя не ругается, а **выбрасывает** его. Письмо ушло бы, вложение перестало быть inline, и об этом не сказали бы ни тесты (письма в них не отправляются), ни логи. Правка в двух местах `lib/ticket.js`; `replyTo` уже был в новом формате. Закреплено `tests/unit/email-attachment-schema.spec.js` — тест читает исходник и краснеет на `content_id`/`content_type`/`reply_to`. Разбор мажоров: v5 сделала `@react-email/render` опциональным (мы шлём html), v6 — только это переименование. Записан `engines: node >=20` (требование resend 6).
- **Прод проверен после всех мержей** (curl): `/` и `/thanks` → 200, `/api/checkin` с чужим ключом → 401 `auth`, `/api/cron/cleanup-pending` без секрета → **401** (а не 503 — значит `CRON_SECRET` в проде задан и чистка ночью отработает).
- ⚠ **Живой оплатой после апгрейдов не проверяли.** Сборка, 221 тест и деплой зелёные, но платёжный контур прогонит только реальная покупка — та самая, что и так висит в «Срочном». Теперь она проверяет разом три вещи: боевой Payrexx, Next 15 и resend 6. В письме смотреть: пришёл ли QR картинкой и приложен ли файл `ticket-qr.png`.

- **Чистка брошенных корзин** — `GET /api/cron/cleanup-pending` (Vercel Cron, 03:30). Каждое «Купить» создаёт `pending` ДО оплаты; человек закрыл вкладку — строка осталась навсегда. Два шага, намеренно разной необратимости: `pending` старше суток → `failed` (строка ОСТАЁТСЯ, `failed → paid` разрешён, поздняя оплата билет всё равно выдаст), и удаление через 30 дней — только тех, по кому Payrexx не сказал ни слова (`payrexx_tx_id is null`, `paid_at is null`). Почему не удалять сразу: вебхук, не найдя строки по `reference_id`, пишет warn и отвечает 200 — деньги взяты, билета нет, следа нет. Пороги в `lib/pending-cleanup.js` (env `PENDING_ABANDON_HOURS`/`PENDING_PURGE_DAYS`), закрыты `tests/unit/pending-cleanup.spec.js` — включая сверку со схемой БД, чтобы новый статус нельзя было завести молча, и инвариант «оплаченное не трогаем». Роут закрыт `CRON_SECRET`, ветки 401 покрыты `tests/integration/cron.route.spec.js` (заодно и для сводки подписок — она не была покрыта).
  ⚠ Vercel Hobby: **2 cron-задания на аккаунт, раз в сутки**. Обе заняты (сводка + чистка) — третье потребует Pro.
- **CI-гейт безопасности** — workflow «Безопасность»: `npm audit` + gitleaks, плюс `.github/dependabot.yml` (npm и версии actions, еженедельно, минорные одним PR).
  - gitleaks ставится бинарником из релиза (v8.30.1), НЕ официальным action: тот требует лицензионный ключ для организаций. Скан всей истории (`fetch-depth: 0`), вывод `--redact`. **Прогон по 80 коммитам: утечек нет.**
  - Гейт по зависимостям — `npm run audit:gate` (`scripts/audit-gate.mjs` + `lib/audit-gate.js`), а не голый `npm audit --audit-level=high`: в репо есть известная неустранимая уязвимость, и такой гейт горел бы всегда, а вечно красный гейт перестают читать. Принятое перечислено в `.audit-allowlist.json` с причиной и **сроком**; падаем на новом пакете, на истёкшем сроке и на росте числа advisory в уже принятом.
  - Попутно закрыто: `nanoid` (`npm audit fix`), `postcss` 8.4.31 → 8.5.26 через `overrides` (next 14 пинит уязвимую; 4 advisory, сборка проверена).
- **Тестовая строка `test-forum-pilot@example.com` в `submissions` — её там нет** (проверено тремя запросами: по `example.com`, по `%test%`, по `%pilot%` во всех полях). Пункт снят. В таблице 39 строк, все настоящие.

### Сделано 2026-08-15

- **Вебхук: атомарный переход в `paid` и запрет воскрешения `refunded`** (PR #14, в `main`, CI зелёный). Две дырки из враждебного ревью платёжного контура: (1) `update` шёл без условия на статус — два перекрывающихся вебхука (ретрай после нашего 500, ручной re-send) выдавали два `qr_token` и два письма, рабочим оставался последний; (2) поздний `confirmed` по возвращённому заказу возвращал билет в `paid` с новым QR, и чек-ин это не ловил. Таблица переходов вынесена в `lib/ticket-status.js` (внутри роута её не протестировать), закрыта `tests/unit/ticket-status.spec.js` — включая сверку со списком статусов из `supabase-schema.sql`, чтобы новый статус нельзя было завести молча.

**Осталось из того же ревью** (по убыванию важности):

1. **Нет следа отправки письма.** Признак идемпотентности — `status`, а колонки `email_sent_at` в схеме нет. Если инвокация умирает между `paid` и Resend (таймаут, деплой, обрыв), ретрай видит `paid` и выходит: письма не будет никогда, ручки переотправки в репо нет — только руками в SQL после жалобы.
2. **Вторая оплата неотличима от ретрая** — `payrexx_tx_id` не запрашивается в `select`, `confirmed` с другим id транзакции получит молчаливый 200. ⚠ Предпосылку «Payrexx пускает вторую оплату по оплаченному Gateway» никто не проверял — сначала в кабинет, потом чинить.
3. **Защита в глубину:** сумма и валюта транзакции не сверяются с заказом (сейчас неэксплуатируемо — цена серверная во всех трёх роутах), `verified.referenceId` не сверяется с payload, текст внутренней ошибки БД уходит анонимному клиенту в 4 роутах, create-роуты без rate-limit.

Чистыми признаны: HMAC от сырого тела, `timingSafeEqual` с проверкой длины, fail-closed без ключа, `ALLOW_UNSIGNED_WEBHOOKS` нигде не дефолт (история проверена `git log --diff-filter=A`), серверная цена, 128-битный `qr_token`, `failed` не затирает `paid`, RLS без policy.

### Сделано 2026-08-10

- **Письма догнали продажи** (PR #11). Письмо ранней регистрации утверждало «продажи пока не открыты» — после открытия продаж это отговаривало самого готового человека. CTA писем ведут на `/tickets`, семь адресов переведены на чистые. Закреплено `tests/unit/email-ticket-path.spec.js`.
- **Страницы подписки в брендовом виде** (PR #12): подтверждение и отписка вместо голого текста — иллюстрация, состояния (успех / уже подтверждено / битая ссылка), подвал с контактами. Публично проверяется на `/newsletter/confirm?token=bogus-check`.
- Ранняя регистрация на сайте форума **спрятана** — серверная ветка `form_key='registration'` и письмо оставлены рабочими на случай возврата.

### 🚧 Что не сделано

- **🧊 Часть 2 ТЗ — подписка SLS 19 CHF/мес: проект ЗАМОРОЖЕН** (решение Иванны 2026-08-17). Не начинать и не предлагать. Провайдер, когда разморозится, — Payrexx (решение 2026-07-03), не Stripe.
- **Фаза C билетов:** отчёт по заказам (`v_forum_orders` — кто что купил, сколько ланчей по дням для кейтеринга) и уведомление при заполнении категории (лимиты мягкие: VIP 30 / Premium 45 / Standard 225).
- **Early Bird** выключить (`FORUM_EARLY_BIRD=0`), когда объявят всех спикеров; тогда же обновить захардкоженные цены в `tickets.html` и `site/tickets-buy.js` сайта форума.

### 2026-07-13…17 — приём заявок с форм платформы (`/api/forms`)

- `POST /api/forms` → `public.submissions` + письмо-уведомление. CORS (формы на чужих доменах), service_role, ошибка письма не валит запись заявки.
- Анти-бот тремя дешёвыми слоями: жёсткий Origin-чек (CORS не спасает от curl), honeypot, time-trap (`MIN_FILL_MS`).
- **GDPR/revDSG:** без `consent` заявка не сохраняется (400). Колонка `submissions.consent`, `created_at` = момент согласия.
- Подключены и проверены end-to-end: chudina (`team`), creox (`brief`), форум frankenplatz (`calc-pension`). Origins — в `DEFAULT_ORIGINS` (`lib/forms.js`).
- 🐛 Фикс `bf94cb7`: `FORMS_ALLOWED_ORIGINS` из одних пустышек (`,,`) давала пустой белый список → **все заявки в 403**. Теперь пустой после фильтрации список → откат на `DEFAULT_ORIGINS`. Ронял CI с 15.07.
- Скилл `.claude/skills/add-form-origin` — подключение формы нового сайта (origins + тесты + env-ловушка).
- ✅ Тестовой строки `test-forum-pilot@example.com` в `submissions` нет (проверено 2026-08-17).

### 2026-07-12 — security

Удалён dev-бэкдор `app/api/dev/issue` (выпускал `paid`-билет без оплаты) и диагностический GET из `payrexx/create`, отдававший куски секретов (`2f3bc98`). Осталось убрать `DEV_ISSUE_TOKEN` из env Vercel — руками.

### 2026-07-03 — ревью проекта + фиксы:
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

### Что дальше (не начато)

1. 🧊 ~~Часть 2 ТЗ — подписка 19 CHF/мес~~ — **заморожено 2026-08-17**, см. выше.
2. **Отчёт калькулятора на почту юзеру** — по флагу `send_report`, письмо генерит сервер из `payload` (клиент не диктует текст, иначе спам-релей). Ждёт отправителя.
3. Захват e-mail на остальные 4 калькулятора форума (budget, rent-vs-buy, taxes, shares) — каждому свой `form_key`.
4. Развести получателя писем по `source` (сейчас всё на `assistant@creox.ch`).
5. Вид NocoDB/Baserow поверх `submissions` — чтобы не выдавать коллегам полный доступ к Supabase.
6. ✅ Чистка `pending`-билетов — сделано 2026-08-17 (`/api/cron/cleanup-pending`).
7. ✅ CI-гейт безопасности — сделано 2026-08-17 (workflow «Безопасность» + Dependabot).
8. ✅ **Апгрейд Next 14.2.35 → 15.5.23 — сделано 2026-08-17** (см. ниже). `.audit-allowlist.json` снова пуст, и это правильное состояние файла.

**Чек-лист перед боевым событием с билетами:**
1. ✅ Код dev-бэкдора удалён 2026-07-12. ⬜ Убрать `DEV_ISSUE_TOKEN` из env Vercel (руками).
2. ✅ `PAYREXX_WEBHOOK_SIGNING_KEY` задан (2026-06-29). Убедиться, что `ALLOW_UNSIGNED_WEBHOOKS` не выставлен.
3. ⬜ Задать `CHECKIN_STAFF_KEY` и раздать персоналу на входе.
4. ⬜ Задать реальную цену `TICKET_PRICE_RAPPEN`.
5. ✅ `package-lock.json` закоммичен (`7abea21`), CI на `npm ci` с кэшем.
6. ⬜ Платный план Payrexx (см. «Срочное»).

---

## Реальная структура файлов (сверено с диском 2026-07-20)

```
slswiss-tickets/
  STATE.md                        ← этот файл
  README.md                       обзор стенда
  DEPLOY.md                       пошаговый деплой + тест без Payrexx
  CLAUDE.md                       гайд для AI-агента
  package.json                    deps: next 15 + react 19, @supabase/supabase-js, resend, qrcode, @zxing/browser
                                  overrides: postcss, sharp (см. «Сделано 2026-08-17»)
  next.config.js
  .env.example                    все переменные с пояснениями
  .gitignore                      node_modules, .next, .env, .env.local, .vercel
  package-lock.json               закоммичен (7abea21) — воспроизводимые сборки, CI на npm ci
  .claude/skills/add-form-origin/ скилл: подключить форму нового сайта к /api/forms
  supabase-schema.sql             таблицы tickets + submissions (база аудитории) + RLS
  docs/
    TZ-tickets-subscription.md    ТЗ (источник истины, копия Google-дока)
  lib/
    payrexx.js                    HMAC-подписи, createGateway, getTransaction, verifyWebhookSignature
    supabase.js                   ЛЕНИВЫЙ service_role клиент (Proxy) — экспорт supabaseAdmin
    ticket.js                     ЛЕНИВЫЙ Resend, buildQrDataUrl, sendTicketEmail, escapeHtml
    forms.js                      чистые хелперы форм: DEFAULT_ORIGINS, allowedOrigins,
                                  normalizeSubmission, renderNotificationHtml, MIN_FILL_MS
  playwright.config.js            тесты: unit + e2e (webServer: next dev)
  .github/workflows/test.yml      CI: build + Playwright на push/PR в main
  tests/
    unit/payrexx.spec.js          подпись вебхука (fail-closed), unflattenTransaction
    unit/ticket.spec.js           escapeHtml
    unit/forms.spec.js            origins (в т.ч. env из пустышек), normalizeSubmission, письмо
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
      forms/route.js              POST: заявки с форм платформы → submissions + письмо;
                                  OPTIONS (CORS preflight); 403 на чужой origin, 400 без consent
```
> `app/api/dev/issue` (dev-выпуск без оплаты) удалён 2026-07-12 (security). Тест сканера — реальной оплатой Payrexx.

**Устаревшие имена / расхождения ТЗ ↔ код** (в ТЗ одно, в коде другое — верно второе):
- ТЗ `/api/tickets/webhook` → **факт** `app/api/payrexx/webhook/route.js`
- ТЗ `/api/tickets/validate` → **факт** `app/api/checkin/route.js`
- ТЗ `/scanner` (с паролем, html5-qrcode) → **факт** `/scan` (`app/scan/page.jsx`, **@zxing/browser**, пока без пароля)
- ТЗ таблица `tickets` с полями `event/ticket_type/used/used_at` → **факт** `supabase-schema.sql`: поля `reference_id/event_name/status(pending|paid|checked_in|failed|refunded)/qr_token/payrexx_tx_id/paid_at/checked_in_at` (одно событие, один тип билета)
- ТЗ часть 2 (подписка `subscriptions`, `/api/subscribe` + вебхук) — **не реализована** в этом репо. Решение 2026-07-03: на **Payrexx**, не Stripe (раздел ТЗ переписан).
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

**Тест сканера (после удаления dev/issue):** реальной оплатой Payrexx (сумма мелкая, `TICKET_PRICE_RAPPEN`).
1. На проде «Купить билет» → оплата Payrexx → письмо с QR.
2. Открыть `/scan` → камера или «Ввести код вручную» → `qr_token`.
3. Результаты: первый скан → ✅ Вход; повтор → ⚠️ Уже входил; случайный код → ❌ Невалиден.

**Health-checks (curl/fetch на проде):**
- `POST /api/checkin {token:"x"}` → `200 {"result":"invalid","message":"билет не найден"}` = Supabase подключён, таблица есть.
- `GET /api/dev/issue` → `404` = бэкдор удалён (маршрута больше нет).

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
| `DEV_ISSUE_TOKEN` | ~~dev-выпуск билета~~ | 🗑 код удалён 2026-07-12 → убрать из env Vercel |
| `RESEND_API_KEY` | отправка письма с QR | ✅ задано (2026-06-29) |
| `PAYREXX_API_SECRET` | Payrexx API secret | ✅ задано (2026-06-29) |
| `PAYREXX_INSTANCE` | поддомен Payrexx (часть до `.payrexx.com`) | ✅ задано |
| `PAYREXX_WEBHOOK_SIGNING_KEY` | подпись вебхука; без него вебхук ОТКЛОНЯЕТСЯ (fail-closed) | ✅ задано (2026-06-29, e2e-оплата прошла) |
| `ALLOW_UNSIGNED_WEBHOOKS` | =1 временно разрешает вебхук без подписи (только настройка) | ⬜ не задавать без нужды |
| `TICKET_PRICE_RAPPEN` | цена билета в раппенах (default 100 = 1.00 CHF) | ⬜ опционально |
| `CHECKIN_STAFF_KEY` | ключ персонала для чек-ина; пусто = без ключа | ⬜ задать перед событием |
| `FORMS_ALLOWED_ORIGINS` | origins форм через запятую; **целиком заменяет** `DEFAULT_ORIGINS` — задав её, не забудь дописывать туда каждый новый сайт | ⬜ не задана (работает дефолт) |
| `FORMS_NOTIFY_EMAIL` | куда слать уведомления о заявках; по умолчанию `assistant@creox.ch` (заглушка) | ⬜ задать, когда заведут ящики |
| `CRON_SECRET` | закрывает ОБА cron-роута (сводка подписок и чистка корзин); без него они отключены (503) | ✅ задано (2026-08-07) |
| `PENDING_ABANDON_HOURS` | через сколько часов `pending` → `failed` (дефолт 24) | ⬜ не задана (работает дефолт) |
| `PENDING_PURGE_DAYS` | через сколько дней брошенная корзина удаляется (дефолт 30, минимум 7) | ⬜ не задана (работает дефолт) |

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
- **dev/issue** — был временный тест-эндпоинт без Payrexx (выпускал `paid`-билет по токену в URL). **Удалён 2026-07-12** (security): убраны `app/api/dev` и GET-диагностика из `payrexx/create`. Осталось убрать `DEV_ISSUE_TOKEN` из env Vercel.
- **Один endpoint `/api/forms` на все сайты платформы**, не по эндпоинту на сайт — источник различаем полями `source`/`form_key`/`source_url`. Единая таблица `submissions`: раздельные хранилища ломают сегментацию аудитории (решение 2026-07-10).
- **Заявка без `consent` не сохраняется** (400) — GDPR/revDSG. `created_at` служит меткой момента согласия.
- **Жёсткий Origin-чек в дополнение к CORS** — CORS ограничивает браузер, но не curl/скрипт.
- **Письмо-уведомление не валит заявку** — как с билетами: Resend упал, запись всё равно в БД.
- **Пустой белый список origins недопустим** — откатываемся на `DEFAULT_ORIGINS`, иначе кривая env кладёт приём заявок со всех сайтов разом (`bf94cb7`).

---

## История STATE.md

- **2026-07-20** — сверка с кодом после двух недель работы «мимо STATE». Зафиксировано: у репо появилась вторая роль — бэкенд форм платформы (`/api/forms` + `submissions` + `lib/forms.js` + скилл `add-form-origin`), подключены 4 сайта; удалён dev-бэкдор (12.07); env-таблица дополнена `FORMS_*`; чек-лист перед продом актуализирован. Внешние решения: Resend **Pro** оплачен (лимит доменов снят), домен `frankenplatz.ch` куплен, задача на почтовые ящики передана админу Google Workspace. Висит срочное: платный план Payrexx (~24.07).
- **2026-07-03** — ревью проекта + спринт фиксов: гонка сканеров, сбой БД ≠ «не найден», вебхук 500 на нашей ошибке, цена server-side, fail-closed подпись, ключ персонала, `/thanks`, экранирование письма, лимит `/api/qr`, Playwright-тесты + CI, branch protection на `main` (оба репо). Env-таблица актуализирована (Resend/Payrexx заданы 2026-06-29).
- **2026-06-24** — создан. Сверено с кодом и деплоем. Зафиксировано: стенд задеплоен и работает (билет+сканер через dev/issue); оплата Payrexx блокирована активацией PSP (422); env-статус; расхождения ТЗ↔код; ограничения среды (push только из PowerShell, bash-mount показывает устаревшие копии). ТЗ перенесено в `docs/`.
