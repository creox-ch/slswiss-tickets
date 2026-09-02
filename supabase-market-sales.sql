-- ============================================================
-- Фиксация сделки: что продано, за сколько и какая комиссия
-- Запусти в Supabase SQL Editor (идемпотентно, можно повторно)
-- ============================================================

-- Чужих денег мы не принимаем: покупатель платит продавцу напрямую. Поэтому
-- единственное основание для счёта на комиссию — отметка о продаже в кабинете
-- (AGB 5.5, 5.6). Данные сделки держим прямо в вещи: вещь продаётся один раз,
-- статус `sold` конечный, и отдельная таблица дала бы только лишний join.
alter table public.market_items add column if not exists sold_price_rappen  integer;
alter table public.market_items add column if not exists commission_rappen  integer;
alter table public.market_items add column if not exists sale_channel       text;
alter table public.market_items add column if not exists sold_by            text;
alter table public.market_items add column if not exists sold_at            timestamptz;

do $$
begin
  -- Цена продажи может отличаться от витринной в обе стороны: на маркете
  -- торгуются, а на горячие позиции обещан аукцион. Ограничиваем только снизу.
  if not exists (select 1 from pg_constraint where conname = 'market_items_sold_price_positive') then
    alter table public.market_items
      add constraint market_items_sold_price_positive
      check (sold_price_rappen is null or sold_price_rappen > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'market_items_sale_channel_known') then
    alter table public.market_items
      add constraint market_items_sale_channel_known
      check (sale_channel is null or sale_channel in ('market', 'online'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'market_items_sold_by_known') then
    alter table public.market_items
      add constraint market_items_sold_by_known
      check (sold_by is null or sold_by in ('seller', 'admin'));
  end if;

  -- Главный инвариант: проданная вещь без цены сделки — это счёт, который не на
  -- чем основать. Обратное тоже запрещено: цена сделки у непроданной вещи
  -- означала бы, что статус потеряли по дороге.
  if not exists (select 1 from pg_constraint where conname = 'market_items_sold_has_price') then
    alter table public.market_items
      add constraint market_items_sold_has_price
      check ((status = 'sold') = (sold_price_rappen is not null));
  end if;
end $$;

comment on column public.market_items.sold_price_rappen is
  'За сколько вещь реально продана, в рапенах. Основание для счёта на комиссию.';
comment on column public.market_items.commission_rappen is
  'Комиссия по этой сделке. Считается построчно (см. lib/market-commission.js): сумма построчных округлений не равна округлению суммы.';
comment on column public.market_items.sold_by is
  'seller — отметил продавец, admin — мы за него (пакет «Под ключ»).';

create index if not exists market_items_sold_at_idx
  on public.market_items (sold_at) where status = 'sold';

-- ------------------------------------------------------------
-- Сводка для счетов: сколько продал каждый продавец и сколько должен.
-- Вьюха, а не таблица: пересчитывается сама и не может разойтись с вещами.
-- ------------------------------------------------------------
create or replace view public.v_market_commissions as
select
  s.id                                as seller_id,
  s.email                             as seller_email,
  s.name                              as seller_name,
  count(i.id)                         as items_sold,
  sum(i.sold_price_rappen)            as gross_rappen,
  sum(i.commission_rappen)            as commission_rappen,
  min(i.sold_at)                      as first_sale_at,
  max(i.sold_at)                      as last_sale_at
from public.market_sellers s
join public.market_items i on i.seller_id = s.id and i.status = 'sold'
group by s.id, s.email, s.name;

comment on view public.v_market_commissions is
  'Кому и на сколько выставлять счёт после маркета. Комиссия суммируется построчно.';
