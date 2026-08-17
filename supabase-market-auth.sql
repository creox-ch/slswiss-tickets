-- ============================================================
-- Вход в кабинет продавца: одноразовые ссылки из письма.
-- Шаг 2 ТЗ docs/TZ-market-cabinet.md. Запусти в Supabase SQL Editor.
--
-- Сессии в БД НЕ храним — cookie подписана HMAC (lib/market-auth.js), так
-- каждый запрос страницы обходится без похода в базу. Здесь только токены
-- из писем: их нужно уметь погасить после первого использования.
-- ============================================================

create table if not exists public.market_auth_tokens (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  -- Храним sha256 токена, а не сам токен: утечка таблицы тогда не даёт войти.
  token_hash  text unique not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- Поиск при переходе по ссылке идёт по хэшу.
create index if not exists market_auth_tokens_hash_idx on public.market_auth_tokens (token_hash);
-- Поиск последнего письма на адрес — для защиты от спама «пришлите ещё раз».
create index if not exists market_auth_tokens_email_idx
  on public.market_auth_tokens (lower(email), created_at desc);

-- RLS как везде: включена, policy для anon нет, доступ только у service_role.
alter table public.market_auth_tokens enable row level security;
revoke truncate on public.market_auth_tokens from anon, authenticated;

-- Протухшие и погашенные токены чистит cron брошенных корзин
-- (app/api/cron/cleanup-pending) — отдельного расписания под это нет:
-- на Vercel Hobby всего два cron-задания, и оба заняты.
