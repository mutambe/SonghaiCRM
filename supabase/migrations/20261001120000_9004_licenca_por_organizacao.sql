-- SonghaiCRM — 9004: LICENÇA POR ORGANIZAÇÃO (planos + assinatura).
--
-- Reaplica, sobre o upstream, a 0176 do fork antigo do SonghaiCRM: o catálogo
-- real de pacotes (songhai.cc/precos, em meticais) e a assinatura de cada
-- organização, com histórico. Decisão do dono do produto (2026-09-09): uma
-- instância central multi-organização, licenciada por organização.
--
-- O upstream guarda o plano só como RÓTULO em `organizations.settings.plan`,
-- sem limite nenhum. Aqui o plano tem limites (`max_users`,
-- `max_whatsapp_connections`) que o produto APLICA no convite de equipa e na
-- ligação de número (lib/plans/limiteDoTenant.ts). Chave ausente em `limits`
-- (Enterprise) = sem limite, nunca zero.
--
-- Organização SEM assinatura vigente não é bloqueada: é o estado de toda
-- instalação nova e de quem ainda não recebeu plano — bloquear ali travaria a
-- instalação inteira. Por isso não há backfill.
--
-- `plans` é catálogo: legível por qualquer usuário logado, escrito só pelo
-- servidor. `organization_subscriptions` é lida pela própria organização (e
-- pelo admin da plataforma) e escrita só pelo servidor. No máximo UMA
-- assinatura vigente (`ended_at is null`) por organização — trocar de plano
-- encerra a atual e abre outra, preservando o histórico.
--
-- A cobrança Songhai → organização (licença) NÃO se confunde com o módulo de
-- pagamento da organização (PaySuite, migration 9003), com que ela cobra os
-- próprios clientes.
--
-- Idempotente: reaplicar (update.sh) não duplica nem falha.

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
revoke all on public.plans from public, anon, authenticated;
grant select on public.plans to authenticated;
grant select, insert, update on public.plans to service_role;

drop policy if exists plans_select_authenticated on public.plans;
create policy plans_select_authenticated on public.plans
  for select to authenticated using (true);


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
revoke all on public.organization_subscriptions from public, anon, authenticated;
grant select on public.organization_subscriptions to authenticated;
grant select, insert, update on public.organization_subscriptions to service_role;

drop policy if exists tenant_isolation_organization_subscriptions_select on public.organization_subscriptions;
create policy tenant_isolation_organization_subscriptions_select on public.organization_subscriptions
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );


-- Troca de plano ATÓMICA: encerra a assinatura vigente e abre a nova numa só
-- transação (o fork fazia em duas chamadas, com compensação à mão se a segunda
-- falhasse). O `for update` na organização serializa duas trocas simultâneas.
-- Plano inexistente ou fora de venda → erro `plan_inactive` (22023). Usada na
-- atribuição inicial (criação da organização) e na troca pelo admin.
create or replace function public.fn_trocar_plano_da_organizacao(
  p_org uuid, p_plan uuid, p_actor uuid, p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform 1 from public.organizations where id = p_org for update;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.plans where id = p_plan and is_active) then
    raise exception 'plan_inactive' using errcode = '22023';
  end if;
  update public.organization_subscriptions set ended_at = now()
   where organization_id = p_org and ended_at is null;
  insert into public.organization_subscriptions (organization_id, plan_id, status, assigned_by, notes)
  values (p_org, p_plan, 'active', p_actor, p_notes)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.fn_trocar_plano_da_organizacao(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fn_trocar_plano_da_organizacao(uuid, uuid, uuid, text) to service_role;
