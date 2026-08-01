# pgTAP — тесты модели доступа (RLS)

Тесты в БД, проверяющие инвариант безопасности платформы: `tickets` и
`submissions` закрыты RLS без единой policy для публичных ролей — доступ идёт
только через `service_role` (server-side, API-роуты). Ловят регрессию, если
кто-то случайно откроет таблицу или функцию для `anon`/`authenticated`.

## Что покрыто (`rls_access.sql`, 10 проверок)

- RLS включён на `tickets` и `submissions`;
- у обеих таблиц **0** RLS-policy (deny-all для anon/authenticated);
- поведенчески от лица `anon`: чтение обеих таблиц пусто, INSERT отбивается
  RLS (SQLSTATE `42501`);
- функция `assign_forum_ticket_no` не имеет `EXECUTE` у `anon` и `authenticated`.

Проверено вживую 2026-08-01: 10 passed, 0 failed (прогон в транзакции с
`ROLLBACK`, боевые данные не тронуты).

## Как запускать

Всё внутри `BEGIN/ROLLBACK` — данные не меняются. Нужна строка подключения к БД
проекта (`DATABASE_URL`, роль-владелец/`service_role`); брать в Supabase →
Project Settings → Database → Connection string. Секрет вводит владелец, в репо
его нет.

```bash
# вариант 1: pg_prove (красивый TAP-вывод, подходит для CI)
pg_prove -d "$DATABASE_URL" tests/pgtap/rls_access.sql

# вариант 2: чистый psql
psql "$DATABASE_URL" -f tests/pgtap/rls_access.sql
```

Или вставить файл в **Supabase SQL Editor** и нажать Run — TAP-строки видно
построчно (`ok 1 …`, `ok 2 …`).

## Почему это НЕ в основном CI (`.github/workflows/test.yml`)

Основной CI — Node/Playwright, БД в нём нет. Автоматизация pgTAP требует
отдельного решения, и у него есть реальная загвоздка: `supabase-schema.sql`
неполон для запуска «с нуля» (в нём `submissions.profile_id references
public.profiles(id)`, а таблицы `profiles` в файле нет). Поэтому поднять чистый
Postgres в CI и залить только этот файл — не выйдет без полного дампа схемы.

Варианты, если захотим автоматизировать (по возрастанию цены):
1. **Оставить как есть** — запускать вручную/через ассистента на значимых
   изменениях схемы. Дёшево, покрытие уже есть.
2. **CI-джоба против Postgres-сервиса** — сначала завести полный дамп схемы
   платформы (не только этот файл), затем `pg_prove`.
3. **Supabase branch** в CI — изолированная копия БД на прогон (нужен план с
   ветками).

Решение отложено: суть (репроизводимые тесты RLS) уже есть, автоматизация —
отдельный шаг.

## Открытый вопрос — гранты TRUNCATE

У `anon`/`authenticated` остаются дефолтные Supabase-гранты на таблицы, включая
`TRUNCATE`. Для `SELECT/INSERT/UPDATE/DELETE` это неопасно — их режет RLS. Но
`TRUNCATE` **RLS не фильтрует**. Практически он недостижим через PostgREST (API
не отдаёт TRUNCATE), поэтому риск низкий, но грант шире необходимого.

Опциональное усиление (defense-in-depth) — снять лишние гранты и добавить
2 теста, что их нет:

```sql
revoke truncate on public.tickets, public.submissions from anon, authenticated;
```

Не применяли: это изменение прав на боевой БД, требует явного согласия владельца.
