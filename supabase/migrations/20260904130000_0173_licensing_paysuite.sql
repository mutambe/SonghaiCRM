-- 0173 — LICENCIAMENTO SELF-HOST (assinatura recorrente via PaySuite).
--
-- Duas famílias de tabela, propósitos diferentes:
--
-- `licensing_installs/licenses/payments` só existem com dado real na
-- instância CENTRAL (a que a Songhai opera) — é o livro de clientes da
-- própria Songhai, não dado de tenant do CRM. Sem RLS multi-tenant (não é
-- esse o modelo aqui); RLS ligada com ZERO policies + revoke geral, mesmo
-- molde de `payment_credentials` (migration 0162): só service_role toca.
--
-- `licensing_client_state` é o cache local da INSTÂNCIA DE CLIENTE — uma
-- linha singleton com o último token assinado recebido da central e quando
-- foi buscado. Existe em toda instalação (central ou cliente), fica vazia
-- na central porque ela não se autoverifica.

create table if not exists public.licensing_installs (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  contact_email text not null,
  notes text,
  created_at timestamp with time zone not null default now()
);

alter table public.licensing_installs enable row level security;
revoke all on public.licensing_installs from anon, authenticated;
grant select, insert, update on public.licensing_installs to service_role;

create table if not exists public.licensing_licenses (
  id uuid primary key default gen_random_uuid(),
  install_id uuid not null references public.licensing_installs(id) on delete cascade,
  license_key text not null unique,
  status text not null default 'trial' check (status in ('trial', 'active', 'revoked')),
  plan_amount_cents bigint not null check (plan_amount_cents > 0),
  plan_interval_days integer not null default 30 check (plan_interval_days > 0),
  trial_ends_at timestamp with time zone,
  current_period_end timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists licensing_licenses_install_idx
  on public.licensing_licenses using btree (install_id);

alter table public.licensing_licenses enable row level security;
revoke all on public.licensing_licenses from anon, authenticated;
grant select, insert, update on public.licensing_licenses to service_role;

create or replace trigger trg_licensing_licenses_updated_at
  before update on public.licensing_licenses
  for each row execute function public.fn_set_updated_at();

create table if not exists public.licensing_payments (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licensing_licenses(id) on delete cascade,
  paysuite_payment_id text not null unique,
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  checkout_url text,
  created_at timestamp with time zone not null default now(),
  paid_at timestamp with time zone
);

create index if not exists licensing_payments_license_idx
  on public.licensing_payments using btree (license_id);

alter table public.licensing_payments enable row level security;
revoke all on public.licensing_payments from anon, authenticated;
grant select, insert, update on public.licensing_payments to service_role;

create table if not exists public.licensing_client_state (
  id text primary key default 'singleton' check (id = 'singleton'),
  token text,
  fetched_at timestamp with time zone,
  updated_at timestamp with time zone not null default now()
);

alter table public.licensing_client_state enable row level security;
revoke all on public.licensing_client_state from anon, authenticated;
grant select, insert, update on public.licensing_client_state to service_role;

create or replace trigger trg_licensing_client_state_updated_at
  before update on public.licensing_client_state
  for each row execute function public.fn_set_updated_at();
