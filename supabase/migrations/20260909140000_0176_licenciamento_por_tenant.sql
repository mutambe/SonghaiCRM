-- 20260909140000_0176_licenciamento_por_tenant.sql
--
-- Licenciamento por tenant (organization): catálogo real de pacotes
-- (songhai.cc/precos) + assinatura versionada. Substitui o modelo de
-- licenciamento por instalação (0173/0174) — decisão do dono do produto
-- (2026-09-09): uma única instância central multi-tenant, não uma
-- instalação self-host separada por cliente.
-- Ver docs/superpowers/specs/2026-09-09-licenciamento-por-tenant-design.md.

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in ('agente_simples', 'agente_medio', 'agente_avancado', 'enterprise')),
  display_name text not null,
  price_cents integer,
  setup_fee_cents integer,
  currency text not null default 'MZN',
  limits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.plans (slug, display_name, price_cents, setup_fee_cents, limits)
values
  ('agente_simples', 'Agente Simples', 500000, 200000, '{"max_users": 20, "max_whatsapp_connections": 1}'),
  ('agente_medio', 'Agente Médio', 800000, 300000, '{"max_users": 50, "max_whatsapp_connections": 2}'),
  ('agente_avancado', 'Agente Avançado', 1200000, 400000, '{"max_users": 200, "max_whatsapp_connections": 5}'),
  ('enterprise', 'Enterprise', null, null, '{}')
on conflict (slug) do nothing;

alter table public.plans enable row level security;
revoke all on public.plans from anon, authenticated;
grant select on public.plans to authenticated;
grant select, insert, update on public.plans to service_role;

drop policy if exists "plans_select_authenticated" on public.plans;
create policy "plans_select_authenticated" on public.plans
  for select to authenticated using (true);

-- Cobrança Songhai -> tenant (licença/plano). NÃO confundir com o módulo
-- comercial do tenant (PaySuite que a organization usa para cobrar os
-- próprios leads/clientes) — esse módulo não é tocado por esta migration.
create table if not exists public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status text not null check (status in ('active', 'suspended', 'cancelled')),
  billing_mode text not null default 'manual' check (billing_mode in ('manual', 'paysuite_managed')),
  assigned_by uuid references auth.users(id),
  notes text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists organization_subscriptions_org_idx
  on public.organization_subscriptions using btree (organization_id);

create unique index if not exists uq_organization_subscriptions_one_current
  on public.organization_subscriptions (organization_id)
  where ended_at is null;

alter table public.organization_subscriptions enable row level security;
revoke all on public.organization_subscriptions from anon, authenticated;
grant select on public.organization_subscriptions to authenticated;
grant select, insert, update on public.organization_subscriptions to service_role;

drop policy if exists "organization_subscriptions_tenant_select" on public.organization_subscriptions;
create policy "organization_subscriptions_tenant_select" on public.organization_subscriptions
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

-- Descontinuação do modelo de licenciamento por instalação (0173/0174):
-- renomeia em vez de apagar, para preservar histórico de trials/pagamentos
-- já emitidos. Idempotente via IF EXISTS — no update.sh de quem já rodou
-- esta migration, as tabelas de origem não existem mais e o comando é nulo.
alter table if exists public.licensing_installs rename to _deprecated_licensing_installs;
alter table if exists public.licensing_licenses rename to _deprecated_licensing_licenses;
alter table if exists public.licensing_payments rename to _deprecated_licensing_payments;
alter table if exists public.licensing_client_state rename to _deprecated_licensing_client_state;
alter table if exists public.licensing_paysuite_credentials rename to _deprecated_licensing_paysuite_credentials;
