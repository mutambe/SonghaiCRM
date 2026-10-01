-- ============================================================================
-- songhai.sql — O APÊNDICE DA DISTRIBUIÇÃO SONGHAICRM (Moçambique)
--
-- O SonghaiCRM é o DeskcommCRM (upstream) com a identidade moçambicana por
-- cima. Este arquivo é aplicado LOGO DEPOIS do `supabase/baseline.sql`, na
-- MESMA chamada do psql (`-f baseline.sql -f songhai.sql`), em todo lugar que
-- aplica o baseline: o `install.sh` e o `update.sh` do kit (via
-- `reaplicar_baseline` em `_common.sh`), o `scripts/test-db.sh`, o
-- `scripts/test-update-com-dados.sh`, o `scripts/local-supabase.sh`, o
-- `scripts/smoke-llm.sh` e o workflow `e2e`.
--
-- ─── Por que um arquivo separado ───────────────────────────────────────────
--
--   1. MERGE LIMPO. O upstream acrescenta blocos ao `baseline.sql` toda semana,
--      antes e depois da varredura de anon, e no fim do arquivo. Bloco nosso
--      dentro dele esbarraria nos deles a cada `git merge upstream/main`.
--   2. A ÚLTIMA PALAVRA. Blocos do upstream regravam defaults brasileiros
--      (`alter column currency set default 'BRL'`) a cada reaplicação. Rodando
--      DEPOIS do baseline inteiro, Moçambique vence sempre — inclusive contra
--      um bloco brasileiro que o upstream ainda vai escrever.
--
-- ─── As regras da casa, as mesmas do baseline ──────────────────────────────
--
--   • Idempotente e auto-curativo: o `update.sh` reaplica este arquivo inteiro
--     em banco existente, SEM `ON_ERROR_STOP`.
--   • Cada bloco tem o cabeçalho `-- ---- <coisa> (migration NNNN) ----` e um
--     arquivo correspondente em `supabase/migrations/` + linha no MANIFEST.
--   • Função nova em `public`: `revoke ... from public, anon` no bloco, e a
--     VARREDURA de anon no FIM deste arquivo cobre o resto. Nenhum bloco entra
--     depois dela.
-- ============================================================================

-- ---- Moçambique por padrão: MZN, Africa/Maputo, pt-MZ (migration 0501) ----
do $$
declare
  c record;
  trocas constant text[][] := array[
    array['BRL', 'MZN'],
    array['America/Sao_Paulo', 'Africa/Maputo'],
    array['pt-BR', 'pt-MZ']
  ];
  t text[];
begin
  foreach t slice 1 in array trocas loop
    for c in
      select table_name, column_name, data_type
        from information_schema.columns
       where table_schema = 'public'
         and data_type in ('text', 'character varying', 'character')
         and column_default is not null
         and column_default ~ ('^''' || replace(t[1], '/', '\/') || '''::')
         and table_name in (
           select tablename from pg_catalog.pg_tables where schemaname = 'public'
         )
    loop
      execute format('alter table public.%I alter column %I set default %L', c.table_name, c.column_name, t[2]);
      execute format('update public.%I set %I = %L where %I = %L', c.table_name, c.column_name, t[2], c.column_name, t[1]);
    end loop;
  end loop;
end $$;

-- ---- Camada plataforma do playbook em português de Moçambique (migration 0502) ----
do $songhai_0502$
declare
  v_ativo text;
  v_nova uuid;
begin
  select v.content into v_ativo
  from public.playbook_pointers p
  join public.playbook_versions v on v.id = p.version_id
  where p.organization_id is null and p.layer = 'platform';

  -- Sem ponteiro (instalação nova): o seed do worker já lê o platform.md novo.
  -- Camada sem o texto brasileiro (já trocada, ou escrita à mão): não toca.
  if v_ativo is null or position('português do Brasil' in v_ativo) = 0 then
    return;
  end if;

  insert into public.playbook_versions (organization_id, layer, content)
  values (null, 'platform', $playbook_mz$# Camada plataforma — compliance e marca

> Seed versionada em git; a versão ATIVA mora em `playbook_versions` (DB) e é
> carregada por ponteiro a cada run. Regras duras (janela de envio, STOP,
> throttle, validação de promessa) NÃO vivem aqui: são hooks determinísticos
> com poder de veto — este texto apenas orienta o tom, nunca as substitui.

## Identidade

Você conversa por WhatsApp em nome da empresa da organização, sempre em
português de Moçambique, com naturalidade e respeito. Nome, apresentação e
persona vêm das instruções do agente, logo abaixo desta camada.

## Português de Moçambique

- Escreva como se escreve em Moçambique, na norma europeia: «telemóvel» (não
  «celular»), «contacto», «registo», «equipa», «ficheiro», «utilizador»,
  «palavra-passe», «autocarro», «pequeno-almoço».
- Para ação em curso, use «estar a» + infinitivo: «estou a verificar», nunca
  «estou verificando».
- Pronomes à moda europeia: «vou enviar-lhe», «diga-me», «a sua encomenda».
- Trate a pessoa por «você» ou pelo nome; se ela for formal, acompanhe com «o
  senhor» / «a senhora».
- Valores em metical: o símbolo vem depois do número, «1 500 MTn»; por
  extenso, «metical» no singular e «meticais» no plural.
- Se a pessoa escrever noutra língua, responda na língua dela.

## Transparência

- Apresente-se como as instruções do agente definem. Não acrescente por conta
  própria "assistente virtual", "robô" ou "IA" à apresentação.
- Nunca afirme ser humano. Se a pessoa perguntar diretamente se está a falar
  com um robô ou uma IA, responda com honestidade, numa frase, e retome o
  atendimento.
- Se a pessoa pedir para falar com um humano, acolha o pedido de imediato — a
  transferência é feita pelo sistema, você apenas confirma que vai acontecer.

## Respeito ao cliente

- Se a pessoa demonstrar que não quer receber mais mensagens, reconheça e
  encerre com cordialidade. O bloqueio em si é garantido pelo sistema.
- Não insista depois de uma recusa clara; uma recusa vale mais do que um guião.
- Nunca peça dados sensíveis (documentos, palavras-passe, dados bancários) por
  mensagem.

## Honestidade comercial

- Só afirme preços, prazos e condições que constem nas camadas de organização
  ou campanha. Sem número na fonte, não invente — ofereça confirmar com a
  equipa.
- Não prometa o que o produto não faz; dúvida técnica sem resposta na base é
  motivo de passagem para uma pessoa, não de improviso.

## Tom de escrita

- Mensagens curtas, uma ideia por mensagem, como uma pessoa escreveria.
- Zero jargão empresarial; nada de "estimado cliente" ou parágrafos de e-mail.
- Emojis com moderação e só se o cliente os usar primeiro.
$playbook_mz$)
  returning id into v_nova;

  update public.playbook_pointers
     set version_id = v_nova, updated_at = now()
   where organization_id is null and layer = 'platform';
end
$songhai_0502$;

-- ---- Pagamentos PaySuite: payment_credentials (só servidor) + payments (log por organização) (migration 0503) ----
create table if not exists public.payment_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'paysuite' check (provider = 'paysuite'),
  api_token_encrypted bytea not null,
  webhook_secret_encrypted bytea not null,
  webhook_path_token text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  status text not null default 'connecting' check (status in ('connecting', 'healthy', 'error')),
  status_reason text,
  last_health_check_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (organization_id, provider)
);

create unique index if not exists payment_credentials_webhook_path_token_idx
  on public.payment_credentials using btree (webhook_path_token);

alter table public.payment_credentials enable row level security;
revoke all on public.payment_credentials from public, anon, authenticated;
grant select, insert, update on public.payment_credentials to service_role;

drop trigger if exists trg_payment_credentials_updated_at on public.payment_credentials;
create trigger trg_payment_credentials_updated_at
  before update on public.payment_credentials
  for each row execute function public.fn_set_updated_at();


create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  provider text not null default 'paysuite' check (provider = 'paysuite'),
  provider_payment_id text not null,
  reference text not null,
  method text check (method in ('mpesa', 'emola', 'credit_card')),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'MZN' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  checkout_url text,
  raw_webhook_payload jsonb,
  created_by_user_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (organization_id, reference),
  unique (organization_id, provider_payment_id)
);

create index if not exists payments_org_idx on public.payments using btree (organization_id);
create index if not exists payments_lead_idx on public.payments using btree (lead_id) where lead_id is not null;

alter table public.payments enable row level security;
revoke all on public.payments from public, anon;
revoke insert, update, delete, truncate on public.payments from authenticated;
grant select on public.payments to authenticated;
grant select, insert, update on public.payments to service_role;

drop policy if exists tenant_isolation_payments_select on public.payments;
create policy tenant_isolation_payments_select on public.payments
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

drop trigger if exists trg_payments_updated_at on public.payments;
create trigger trg_payments_updated_at
  before update on public.payments
  for each row execute function public.fn_set_updated_at();

-- ---- Licença por organização: plans (catálogo) + organization_subscriptions (migration 0504) ----
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

-- ---- VARREDURA anon do apêndice da distribuição (repete a migration 0116 do upstream) ----
--
-- ⚠️ ÚLTIMO BLOCO DESTE ARQUIVO, DE PROPÓSITO. O `ALTER DEFAULT PRIVILEGES ...
-- GRANT ALL ON FUNCTIONS TO anon` do corpo do baseline vale para toda função
-- criada depois dele — inclusive as deste arquivo, que roda depois da
-- varredura do baseline. Esta é a mesma cura (migration 0116 do upstream),
-- repetida para alcançá-las. Vigiado por
-- `tests/unit/songhai-sql-varredura-e-o-ultimo-bloco.test.ts`.
do $$
declare
  f record;
  tinha_auth boolean;
  tinha_service boolean;
begin
  if to_regrole('anon') is null then
    return;
  end if;

  for f in
    select p.oid, p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
  loop
    tinha_auth := to_regrole('authenticated') is not null
                  and has_function_privilege('authenticated', f.oid, 'EXECUTE');
    tinha_service := to_regrole('service_role') is not null
                     and has_function_privilege('service_role', f.oid, 'EXECUTE');

    execute format('revoke execute on function %s from public, anon', f.assinatura);

    if tinha_auth then
      execute format('grant execute on function %s to authenticated', f.assinatura);
    end if;
    if tinha_service then
      execute format('grant execute on function %s to service_role', f.assinatura);
    end if;
  end loop;
end $$;
