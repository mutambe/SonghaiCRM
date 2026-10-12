-- manifest: **SonghaiCRM — quota de tokens de IA por conta.** `organization_subscriptions.ai_tokens_override` (quota acordada só com este cliente; nulo = vale a do pacote, `plans.limits.ai_tokens_per_account`, por conta de WhatsApp); `ai_token_alerts` (um aviso por organização, período e nível — 80 ou 100 — para o aviso sair UMA vez e o cliente ver o banner); `fn_tokens_de_ia_no_periodo` (soma `input_tokens + output_tokens` de `llm_calls` num intervalo, a régua única dos tokens). A quota renova com o ciclo de facturação. Só avisa — não corta o serviço (para cortar existe o orçamento em dinheiro). Bloco no `supabase/songhai.sql`.

alter table public.organization_subscriptions
  add column if not exists ai_tokens_override bigint check (ai_tokens_override is null or ai_tokens_override >= 1);

comment on column public.organization_subscriptions.ai_tokens_override is
  'Quota MENSAL de tokens de IA acordada só com este cliente (total da organização, não por conta). Nulo = vale plans.limits.ai_tokens_per_account × número de contas de WhatsApp contratadas.';

create table if not exists public.ai_token_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  window_start date not null,
  window_end date not null,
  level smallint not null check (level in (80, 100)),
  consumed_tokens bigint not null,
  quota_tokens bigint not null,
  created_at timestamptz not null default now(),
  constraint ai_token_alerts_um_por_nivel unique (organization_id, window_start, level)
);

create index if not exists ai_token_alerts_org_idx
  on public.ai_token_alerts using btree (organization_id, window_end desc);

alter table public.ai_token_alerts enable row level security;
revoke all on public.ai_token_alerts from public, anon, authenticated;
grant select on public.ai_token_alerts to authenticated;
grant select, insert on public.ai_token_alerts to service_role;

drop policy if exists tenant_isolation_ai_token_alerts_select on public.ai_token_alerts;
create policy tenant_isolation_ai_token_alerts_select on public.ai_token_alerts
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'admin'));

create or replace function public.fn_tokens_de_ia_no_periodo(p_org uuid, p_from timestamptz, p_to timestamptz)
returns bigint
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(sum(input_tokens::bigint + output_tokens::bigint), 0)::bigint
    from public.llm_calls
   where organization_id = p_org
     and created_at >= p_from
     and created_at < p_to;
$$;

comment on function public.fn_tokens_de_ia_no_periodo(uuid, timestamptz, timestamptz) is
  'Tokens de IA (entrada + saída) da organização no intervalo [p_from, p_to). A régua ÚNICA dos tokens do pacote: o aviso, o banner e a tela leem daqui. Cache de prompt não conta. security invoker: recebe a organização por argumento e não valida membership, então definer seria leitura cross-tenant.';

revoke execute on function public.fn_tokens_de_ia_no_periodo(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.fn_tokens_de_ia_no_periodo(uuid, timestamptz, timestamptz) to service_role;
