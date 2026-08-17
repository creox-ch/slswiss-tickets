-- ============================================================
-- Кабинет продавца бренд-маркета Frankenplatz (FASHION REBORN)
-- Шаг 1 ТЗ docs/TZ-market-cabinet.md — только схема, без UI.
-- Запусти в Supabase SQL Editor (проект dwcmiommviauwzkhkbki).
--
-- Оплата пакета остаётся в public.tickets (event_slug='frankenplatz-market-2026') —
-- это платёж, ему там место. Здесь живёт то, что появляется ПОСЛЕ оплаты:
-- продавец, его вещи и маркеты, на которые вещи допущены.
--
-- Денег в этих таблицах нет и не будет: покупатель платит продавцу напрямую
-- (AGB 5.9), мы только фиксируем сделку и выставляем счёт на комиссию. Поэтому
-- ни реквизитов выплат, ни платёжных сборов — см. решение 2026-08-17 в ТЗ.
-- ============================================================

-- ------------------------------------------------------------
-- Продавец. Появляется при первом входе в кабинет после оплаты пакета:
-- reference_id связывает его со строкой оплаты в tickets.
-- ------------------------------------------------------------
create table if not exists public.market_sellers (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  name              text,
  phone             text,
  -- какой пакет оплачен: ссылка на tickets.reference_id (не FK — tickets живёт
  -- своей жизнью и чистится cron'ом брошенных корзин, ронять продавца нельзя)
  ticket_reference  text,
  package           text check (package in ('online', 'market', 'turnkey')),
  locale            text not null default 'ru',
  created_at        timestamptz not null default now(),
  last_login_at     timestamptz
);

-- Один продавец на адрес: письма и вход идут по email, дубли сломают и то и другое.
create unique index if not exists market_sellers_email_idx
  on public.market_sellers (lower(email));

-- ------------------------------------------------------------
-- Маркет. Их несколько: пакет «Маркет» обещает участие в двух, а гарантия
-- возврата взноса (AGB 6.1) считается по двум маркетам подряд — значит нужна
-- сущность, а не константа с датой 27.09.
-- ------------------------------------------------------------
create table if not exists public.market_events (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  event_date  date not null,
  city        text not null default 'Baden',
  -- planned → announced → held (+cancelled, если не набрали 100 позиций)
  status      text not null default 'planned'
                check (status in ('planned', 'announced', 'held', 'cancelled')),
  created_at  timestamptz not null default now()
);

-- Первый маркет. ON CONFLICT — чтобы файл можно было прогнать повторно.
insert into public.market_events (slug, title, event_date, city, status)
values ('fashion-reborn-2026-09-27', 'FASHION REBORN · маркет №1', '2026-09-27', 'Baden', 'announced')
on conflict (slug) do nothing;

-- ------------------------------------------------------------
-- Вещь. Публичный номер FM-2026-NNNN выдаём сразу при создании: он нужен для
-- QR-этикетки и разговора с продавцом, а «дырки» в нумерации от брошенных
-- черновиков не вредны (в отличие от номеров билетов, где счётчик — деньги).
-- ------------------------------------------------------------
create sequence if not exists public.market_item_seq start 1;

create table if not exists public.market_items (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null references public.market_sellers(id) on delete cascade,
  item_no        bigint unique not null default nextval('public.market_item_seq'),
  qr_token       text unique,          -- выдаём при допуске на маркет (этикетка)

  -- описание вещи. category/condition — словари из каталога (lib/market-items.js)
  brand          text not null,
  category       text not null check (category in ('clothes', 'shoes', 'bags', 'acc')),
  sex            text not null default 'f' check (sex in ('f', 'm', 'u', 'k')),
  title          text not null,
  size           text,
  material       text,
  color          text,
  condition      text not null check (condition in ('new', 'ideal', 'good', 'fair')),

  -- цены в рапенах, как везде в проекте (100 = 1.00 CHF)
  price_rappen             integer not null check (price_rappen > 0),
  original_price_rappen    integer check (original_price_rappen > 0),
  -- нашу рекомендацию храним отдельно: от неё зависит гарантия возврата
  -- взноса (AGB 6.3 — цена выше рекомендованной снимает гарантию)
  recommended_price_rappen integer check (recommended_price_rappen > 0),
  -- чек/сертификат/коробка — второе условие той же гарантии (AGB 6.2)
  has_docs       boolean not null default false,

  -- описание ведём на трёх языках: пакет обещает каталог на ru/de/en.
  -- de/en заполняются машинным переводом при одобрении (шаг 7).
  description_ru text,
  description_de text,
  description_en text,

  -- пути в Supabase Storage; до 5 штук, минимум 1 для публикации (решение 17.08)
  photos         jsonb not null default '[]'::jsonb,

  -- draft → pending → approved_online → approved_market → reserved → sold
  -- (+ rejected, withdrawn, returned). Переходы — в lib/market-items.js.
  -- approved_online и approved_market различаются намеренно: мидл-бренды
  -- пускаем в каталог, но не обязательно на офлайн-маркет.
  status         text not null default 'draft'
                   check (status in ('draft', 'pending', 'approved_online', 'approved_market',
                                     'rejected', 'reserved', 'sold', 'withdrawn', 'returned')),
  -- причина отказа (AGB 3.6 разрешает отказ без объяснений, но человеку лучше объяснить)
  moderation_note text,
  -- приоритет в каталоге — обещание пакета «Под ключ»
  priority       boolean not null default false,
  -- на какой маркет допущена
  event_id       uuid references public.market_events(id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  published_at   timestamptz
);

create index if not exists market_items_seller_idx on public.market_items (seller_id);
create index if not exists market_items_status_idx on public.market_items (status);
create index if not exists market_items_qr_idx     on public.market_items (qr_token);
create index if not exists market_items_event_idx  on public.market_items (event_id);

-- ------------------------------------------------------------
-- RLS: включена, policy для anon НЕТ — как у tickets и submissions.
-- Весь доступ идёт через service_role из серверных роутов, браузер в таблицы
-- не ходит. Публичный каталог будет отдавать отдельный роут, а не PostgREST:
-- так наружу уедут только одобренные вещи и только нужные поля.
-- ------------------------------------------------------------
alter table public.market_sellers enable row level security;
alter table public.market_events  enable row level security;
alter table public.market_items   enable row level security;

-- Defense-in-depth: RLS не фильтрует TRUNCATE, а грант у публичных ролей
-- стоит по умолчанию. Инвариант проверяется в tests/pgtap/rls_access.sql.
revoke truncate on public.market_sellers, public.market_events, public.market_items
  from anon, authenticated;
