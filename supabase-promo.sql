-- ============================================================
-- Промокоды + след фактически оплаченной суммы
-- Запусти в Supabase SQL Editor (идемпотентно, можно повторно)
-- ============================================================

-- Свои коды, а не купоны Payrexx: скидка применяется ДО создания gateway, чтобы
-- в Payrexx уходила уже итоговая сумма и она же лежала в заказе. Купон на стороне
-- Payrexx оставил бы в базе полную цену, а на счёте — меньше денег.
create table if not exists public.promo_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,                    -- ВЕРХНИЙ регистр, [A-Z0-9-]
  scope       text not null default 'all'
                check (scope in ('forum','market','all')),
  kind        text not null
                check (kind in ('percent','amount')),
  value       integer not null check (value > 0),      -- percent: 1..100; amount: рапены
  max_uses    integer check (max_uses is null or max_uses > 0),
  starts_at   timestamptz,
  expires_at  timestamptz,
  active      boolean not null default true,
  note        text,                                    -- для кого и зачем — чтобы через месяц не гадать
  created_at  timestamptz not null default now(),
  -- Процент больше 100 — почти всегда опечатка (ввели 2000 вместо 20).
  constraint promo_percent_range check (kind <> 'percent' or value between 1 and 100)
);

create index if not exists promo_codes_code_idx on public.promo_codes (code);

-- Строки заказов пишет только сервер (service_role), клиенту таблица не нужна:
-- RLS включён без policy — доступ закрыт всем, кроме service_role.
alter table public.promo_codes enable row level security;

-- Использования считаем по оплаченным заказам (как Early Bird), а не счётчиком
-- в этой таблице: pending-строка от брошенной корзины не должна жечь лимит.
create index if not exists tickets_promo_idx
  on public.tickets ((payload->'promo'->>'code'));

-- Считает база, а не клиент. Путь по вложенному JSON, написанный строкой в
-- supabase-js, при ошибке не падает, а молча возвращает ноль — и код с лимитом
-- «20 штук» работал бы бесконечно, о чём не сказал бы ни один тест. Здесь то же
-- выражение проверяемо, и оно одно на весь проект.
create or replace function public.count_promo_uses(p_code text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.tickets
  where payload->'promo'->>'code' = upper(trim(p_code))
    and status in ('paid', 'checked_in');
$$;

comment on function public.count_promo_uses(text) is
  'Сколько оплаченных заказов использовали этот промокод. Основание для max_uses.';

-- Фактически оплаченная сумма из транзакции Payrexx. Отдельной колонкой, а не
-- только в payload: по ней сверяют выручку, и она должна быть видна в обычном
-- SELECT рядом с amount. Расходится с amount → скидка прошла мимо нас.
alter table public.tickets add column if not exists paid_amount integer;
alter table public.tickets add column if not exists amount_mismatch boolean;

comment on column public.tickets.paid_amount is
  'Сумма из транзакции Payrexx в рапенах (что реально пришло). NULL — вебхук суммы не увидел.';
comment on column public.tickets.amount_mismatch is
  'true — paid_amount разошёлся с amount. Билет всё равно выдан, см. lib/payment-check.js.';

-- Заказы, где деньги разошлись с ценой: первое, куда смотреть при сверке выручки.
create index if not exists tickets_amount_mismatch_idx
  on public.tickets (amount_mismatch) where amount_mismatch;

-- ------------------------------------------------------------
-- Как завести код
--
-- Настоящих кодов здесь нет и быть не должно: репозиторий публичный, а рабочий
-- код живого магазина, лежащий в git, — это раздача скидок всем, кто умеет
-- читать. Заводить через SQL Editor в дашборде базы. Форма запроса:
--
-- insert into public.promo_codes (code, scope, kind, value, max_uses, expires_at, note)
-- values ('EXAMPLE-CODE', 'market', 'percent', 10, 50, '2026-12-31 00:00+01', 'кому и зачем выдан');
--
--   code        ВЕРХНИЙ регистр, [A-Z0-9-], до 32 знаков — ровно то, что понимает
--               normalizeCode в lib/promo.js. Код в нижнем регистре не найдётся никогда.
--   scope       'forum' — билеты, 'market' — пакеты продавцов, 'all' — и то и другое
--   kind+value  'percent' и 1..100, либо 'amount' и скидка в рапенах (5000 = 50 CHF)
--   max_uses    сколько раз им можно ОПЛАТИТЬ; null — без ограничения
--   expires_at  срок; null — бессрочно
--   note        через месяц это единственное, что объяснит, кому код выдавали
--
-- Выключить код, не удаляя (история заказов на него ссылается):
-- update public.promo_codes set active = false where code = 'EXAMPLE-CODE';
--
-- Посмотреть, сколько раз кодами оплатили:
-- select code, note, max_uses, public.count_promo_uses(code) as used
--   from public.promo_codes order by created_at desc;
-- ------------------------------------------------------------
