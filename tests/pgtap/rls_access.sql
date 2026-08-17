-- ============================================================
-- pgTAP: модель доступа RLS для tickets / submissions
--
-- Инвариант платформы (см. supabase-schema.sql):
--   RLS включён, НИ одной policy для anon/authenticated → строки недоступны
--   никому, кроме service_role (он обходит RLS). Весь доступ — server-side
--   через API-роуты с service_role. Приватная функция assign_forum_ticket_no
--   закрыта от публичных ролей.
--
-- Эти тесты ловят регрессию: если кто-то случайно добавит permissive policy
-- для anon, включит доступ или откроет функцию — сборка станет красной.
--
-- ЗАПУСК (любой способ; всё внутри BEGIN/ROLLBACK — боевые данные не меняются):
--   pg_prove:  pg_prove -d "$DATABASE_URL" tests/pgtap/rls_access.sql
--   psql:      psql "$DATABASE_URL" -f tests/pgtap/rls_access.sql
--   Supabase SQL Editor: вставить и Run (TAP-строки видно построчно)
--
-- $DATABASE_URL — строка подключения к БД проекта (service-роль/овнер).
-- Прогон читает данные от лица anon и делает пробную запись, которую RLS
-- отбивает; ROLLBACK в конце гарантирует, что ничего не осталось.
-- ============================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

-- 1-2: RLS включён на обеих таблицах
select ok(
  (select relrowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tickets'),
  'tickets: RLS включён');
select ok(
  (select relrowsecurity from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'submissions'),
  'submissions: RLS включён');

-- 3-4: ноль policy → deny-all для anon/authenticated (доступ только у service_role)
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'tickets'),
  0, 'tickets: нет ни одной RLS-policy (deny-all)');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'submissions'),
  0, 'submissions: нет ни одной RLS-policy (deny-all)');

-- 5-8: поведенчески от лица anon — чтение пусто, запись отбивается RLS (SQLSTATE 42501)
set local role anon;
select is_empty('select 1 from public.tickets',
  'anon НЕ читает tickets');
select is_empty('select 1 from public.submissions',
  'anon НЕ читает submissions');
select throws_ok(
  $$insert into public.tickets(reference_id) values ('pgtap-probe')$$,
  '42501', null, 'anon НЕ пишет в tickets (RLS)');
select throws_ok(
  $$insert into public.submissions(source, consent) values ('pgtap', true)$$,
  '42501', null, 'anon НЕ пишет в submissions (RLS)');
reset role;

-- 9-10: приватная функция закрыта от публичных ролей (её зовёт только сервер)
select function_privs_are(
  'public', 'assign_forum_ticket_no', array['text'],
  'anon', array[]::text[],
  'assign_forum_ticket_no: нет EXECUTE у anon');
select function_privs_are(
  'public', 'assign_forum_ticket_no', array['text'],
  'authenticated', array[]::text[],
  'assign_forum_ticket_no: нет EXECUTE у authenticated');

-- 11-12: TRUNCATE снят у публичных ролей (RLS его НЕ фильтрует; см. supabase-schema.sql)
select ok(
  not has_table_privilege('anon', 'public.tickets', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.submissions', 'TRUNCATE'),
  'anon: нет TRUNCATE на tickets/submissions');
select ok(
  not has_table_privilege('authenticated', 'public.tickets', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.submissions', 'TRUNCATE'),
  'authenticated: нет TRUNCATE на tickets/submissions');

-- ------------------------------------------------------------
-- 13-18: тот же инвариант для таблиц кабинета маркета
-- (supabase-market-cabinet.sql). Здесь он важнее, чем у tickets: в
-- market_items лежат чужие вещи и цены, а в market_sellers — контакты
-- продавцов. Публичный каталог отдаёт отдельный роут, а не PostgREST.
-- ------------------------------------------------------------
select ok(
  (select bool_and(relrowsecurity) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('market_sellers', 'market_events', 'market_items')),
  'market_*: RLS включён на всех трёх таблицах');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('market_sellers', 'market_events', 'market_items')),
  0, 'market_*: нет ни одной RLS-policy (deny-all)');

set local role anon;
select is_empty('select 1 from public.market_sellers',
  'anon НЕ читает market_sellers (контакты продавцов)');
select is_empty('select 1 from public.market_items',
  'anon НЕ читает market_items (чужие вещи и цены)');
select throws_ok(
  $$insert into public.market_sellers(email) values ('pgtap@probe.test')$$,
  '42501', null, 'anon НЕ пишет в market_sellers (RLS)');
reset role;

select ok(
  not has_table_privilege('anon', 'public.market_items', 'TRUNCATE')
  and not has_table_privilege('anon', 'public.market_sellers', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.market_items', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.market_sellers', 'TRUNCATE'),
  'market_*: нет TRUNCATE у публичных ролей');

select * from finish();

rollback;
