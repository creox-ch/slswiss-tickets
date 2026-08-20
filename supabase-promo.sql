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
-- Как завести код (примеры, выполнять по необходимости):
--
-- insert into public.promo_codes (code, scope, kind, value, max_uses, expires_at, note)
-- values ('PODRUGA20', 'market', 'percent', 20, 50, '2026-09-27 00:00+02', 'подругам продавцов');
--
-- insert into public.promo_codes (code, scope, kind, value, max_uses, note)
-- values ('PRESSE', 'forum', 'amount', 5000, 10, 'пресса, −50 CHF');
--
-- Выключить код, не удаляя (история заказов на него ссылается):
-- update public.promo_codes set active = false where code = 'PODRUGA20';
-- ------------------------------------------------------------
