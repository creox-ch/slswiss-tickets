-- ============================================================
-- SoiLüDi — тестовый стенд билетов (Payrexx + QR)
-- Запусти в Supabase SQL Editor
-- ============================================================

create table if not exists public.tickets (
  id              uuid primary key default gen_random_uuid(),
  reference_id    text unique not null,          -- наш ID, его шлём в Payrexx referenceId
  event_name      text not null default 'test',
  buyer_email     text,
  buyer_name      text,
  amount          integer,                        -- в раппенах (0.01 CHF = 1)
  currency        text default 'CHF',
  -- статусы: pending → paid → checked_in (+ failed/refunded)
  status          text not null default 'pending'
                    check (status in ('pending','paid','checked_in','failed','refunded')),
  payrexx_tx_id   bigint,                          -- id транзакции Payrexx (из вебхука)
  qr_token        text unique,                     -- секрет внутри QR, по нему сканер находит билет
  paid_at         timestamptz,
  checked_in_at   timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists tickets_reference_idx on public.tickets (reference_id);
create index if not exists tickets_qr_idx on public.tickets (qr_token);

-- RLS: ВКЛючаем, но НИ одной policy для anon.
-- Весь доступ идёт через service_role (server-side, API routes) — он обходит RLS.
-- Так браузер не может читать/писать таблицу напрямую.
alter table public.tickets enable row level security;

-- Намеренно НЕ создаём policy для anon/authenticated.
-- Если позже захочешь читать с клиента — добавь точечную SELECT policy.

-- ============================================================
-- База аудитории — входящие заявки/лиды с форм платформенных сайтов
-- (chudina / atlasintegra / форум ...). Приходят от НЕзарегистрированных людей,
-- поэтому отдельно от profiles (та привязана к auth.users).
-- Пишет сюда только сервер (service_role) через POST /api/forms.
-- ============================================================
create table if not exists public.submissions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  source      text not null,                 -- платформа-источник: 'chudina' | 'atlasintegra' | 'forum' | ...
  form_key    text,                          -- какая форма: 'team' | 'contact' | 'partnership' | ...
  source_url  text,                          -- URL страницы, откуда отправлено
  kind        text not null default 'application',
  role        text,                          -- вакансия / тема заявки
  name        text,
  email       text,
  telegram    text,
  phone       text,
  payload     jsonb not null default '{}'::jsonb,   -- все поля формы
  tests       jsonb,                         -- результаты психотестов (team, практики)
  profile_id  uuid references public.profiles(id) on delete set null, -- опц. связь с участником
  status      text not null default 'new'
                check (status in ('new','in_progress','done','spam','archived'))
);

create index if not exists submissions_created_idx on public.submissions (created_at desc);
create index if not exists submissions_source_idx  on public.submissions (source);
create index if not exists submissions_email_idx   on public.submissions (lower(email));
create index if not exists submissions_profile_idx on public.submissions (profile_id);

-- RLS on; доступ только через service_role (как tickets). anon-policy НЕ создаём.
alter table public.submissions enable row level security;
