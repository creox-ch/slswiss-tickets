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
  -- форумные билеты Frankenplatz: event_slug != null (иначе билет стенда SoiLüDi),
  -- детали заказа (день/категория/ланч/EB, суммы) — в payload. См. lib/forum-tickets.
  event_slug      text,
  payload         jsonb not null default '{}'::jsonb,
  paid_at         timestamptz,
  checked_in_at   timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists tickets_reference_idx on public.tickets (reference_id);
create index if not exists tickets_qr_idx on public.tickets (qr_token);
create index if not exists tickets_event_slug_idx on public.tickets (event_slug);

-- Человеко-номер билета форума: FP-2026-NNNN. Отдельный счётчик (не глобальный id),
-- чтобы номера форума шли подряд без «дыр» от билетов стенда SoiLüDi. Присваивается
-- при оплате (webhook), не на pending — брошенные корзины номер не жгут.
create sequence if not exists public.forum_ticket_seq start 1;
alter table public.tickets add column if not exists ticket_no bigint unique;

-- Идемпотентно выдаёт номер: первый вызов берёт nextval, повторный (ретрай вебхука)
-- возвращает уже присвоенный, НЕ сжигая новый.
create or replace function public.assign_forum_ticket_no(p_reference_id text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_no bigint;
begin
  update public.tickets
     set ticket_no = nextval('public.forum_ticket_seq')
   where reference_id = p_reference_id and ticket_no is null
   returning ticket_no into v_no;
  if v_no is null then
    select ticket_no into v_no from public.tickets where reference_id = p_reference_id;
  end if;
  return v_no;
end;
$$;

-- Функцию зовёт только сервер (service_role, обходит грант). Закрываем публичный
-- REST-доступ (anon/authenticated), чтобы её нельзя было дёрнуть из браузера/curl.
revoke execute on function public.assign_forum_ticket_no(text) from public, anon, authenticated;

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
  -- воронка обычных заявок: new→in_progress→done (+spam/archived).
  -- Подписка на рассылку (form_key='newsletter') использует свой double opt-in:
  -- pending (письмо ушло, ждём подтверждения) → confirmed (перешёл по ссылке);
  -- unsubscribed — отписался (List-Unsubscribe / ссылка отписки).
  status      text not null default 'new'
                check (status in ('new','in_progress','done','spam','archived','pending','confirmed','unsubscribed')),
  -- согласие на обработку перс. данных (GDPR/revDSG); created_at = момент согласия
  consent     boolean not null default false
);

create index if not exists submissions_created_idx on public.submissions (created_at desc);
create index if not exists submissions_source_idx  on public.submissions (source);
create index if not exists submissions_email_idx   on public.submissions (lower(email));
create index if not exists submissions_profile_idx on public.submissions (profile_id);

-- RLS on; доступ только через service_role (как tickets). anon-policy НЕ создаём.
alter table public.submissions enable row level security;

-- Defense-in-depth: снимаем дефолтные Supabase-гранты TRUNCATE у публичных ролей.
-- RLS фильтрует SELECT/INSERT/UPDATE/DELETE, но НЕ TRUNCATE — а он у anon/
-- authenticated стоял по умолчанию. Через PostgREST недостижим, но грант лишний.
-- Инвариант проверяется в tests/pgtap/rls_access.sql.
revoke truncate on public.tickets, public.submissions from anon, authenticated;
