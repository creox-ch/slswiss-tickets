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
