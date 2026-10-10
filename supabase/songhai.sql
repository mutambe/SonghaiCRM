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

-- ---- Moçambique por padrão: MZN, Africa/Maputo, pt-MZ (migration 9001) ----
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

-- ---- Camada plataforma do playbook em português de Moçambique (migration 9002) ----
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

-- ---- Pagamentos PaySuite: payment_credentials (só servidor) + payments (log por organização) (migration 9003) ----
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

-- ---- Licença por organização: plans (catálogo) + organization_subscriptions (migration 9004) ----
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

-- ---- Modelos Claude 5.5 no catálogo: Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5 (migration 9005) ----
--
-- O seletor do provedor Anthropic lê `ai_models`, curado por migration (o cron
-- `sync-model-catalog` só atualiza linhas da OpenRouter). Mesma lista em
-- `ai_pricing`, senão o gasto sai NULL e não conta no teto. Padrão do provedor
-- inalterado. Preços em centavos de USD por milhão de tokens.

insert into public.ai_models
  (provider, model_id, display_name, description, context_window,
   input_price_per_million_cents, output_price_per_million_cents, supports_tools)
values
  ('anthropic', 'claude-fable-5-1',  'Claude Fable 5.1',
   'O mais capaz da Anthropic, para raciocínio e trabalho agêntico exigentes. Custo acima do Opus; respostas podem demorar.',
   1000000, 1000, 5000, true),
  ('anthropic', 'claude-opus-5-5',   'Claude Opus 5.5',
   'O Opus atual: muito capaz para agentes, mais barato que o Opus 5.',
   1000000, 400, 2000, true),
  ('anthropic', 'claude-sonnet-5-5', 'Claude Sonnet 5.5',
   'O Sonnet atual: rapidez e capacidade para atendimento e agentes.',
   1000000, 200, 1000, true),
  ('anthropic', 'claude-haiku-5-5',  'Claude Haiku 5.5',
   'O mais rápido e barato: classificação, extração e encaminhamento. Acima de 100 mil tokens de entrada o preço sobe para $0,50/$2,50 por milhão.',
   1000000, 10, 50, true)
on conflict (provider, model_id) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  context_window = excluded.context_window,
  input_price_per_million_cents = excluded.input_price_per_million_cents,
  output_price_per_million_cents = excluded.output_price_per_million_cents,
  supports_tools = excluded.supports_tools,
  deprecated_at = null;

insert into public.ai_pricing
  (model, prompt_cents_per_million_tokens, completion_cents_per_million_tokens, notes)
values
  ('claude-fable-5-1',  1000, 5000, 'catálogo 9005'),
  ('claude-opus-5-5',    400, 2000, 'catálogo 9005'),
  ('claude-sonnet-5-5',  200, 1000, 'catálogo 9005'),
  ('claude-haiku-5-5',    10,   50, 'catálogo 9005 — até 100 mil tokens de entrada; acima, 50/250')
on conflict (model) do update set
  prompt_cents_per_million_tokens = excluded.prompt_cents_per_million_tokens,
  completion_cents_per_million_tokens = excluded.completion_cents_per_million_tokens,
  notes = excluded.notes,
  superseded_at = null;

-- ---- Esforço do modelo por ponto de IA: ai_purpose_bindings.effort (migration 9006) ----
--
-- Nulo = padrão do modelo. Quais níveis cada modelo aceita: lib/ai/esforco.ts.

alter table public.ai_purpose_bindings
  add column if not exists effort text
  check (effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max'));

comment on column public.ai_purpose_bindings.effort is
  'Esforço do modelo neste ponto (output_config.effort da Anthropic). Nulo = padrão do modelo. Níveis por modelo: lib/ai/esforco.ts.';

-- ---- Esforço do modelo por agente: ai_agent_versions.effort (migration 9007) ----
--
-- Nulo = padrão do modelo; agentes existentes ficam nulos. Agente novo nasce
-- com Haiku 5.5 / medium pelo código (lib/ai/agents/padrao-do-agente-novo.ts).

alter table public.ai_agent_versions
  add column if not exists effort text
  check (effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max'));

comment on column public.ai_agent_versions.effort is
  'Esforço do modelo deste agente (output_config.effort da Anthropic). Nulo = padrão do modelo. Níveis por modelo: lib/ai/esforco.ts.';

-- ---- Funcionalidades por pacote: plans.limits.features (migration 9008) ----
--
-- Ausente = todas (Enterprise); [] = nenhuma. Só preenche onde a chave não existe,
-- para não desfazer o que o admin tenha ajustado.

update public.plans
   set limits = limits || jsonb_build_object('features', '[]'::jsonb)
 where slug = 'agente_simples' and not (limits ? 'features');

update public.plans
   set limits = limits || jsonb_build_object('features',
         '["agenda", "crm", "qualificacao_leads", "relatorios"]'::jsonb)
 where slug = 'agente_medio' and not (limits ? 'features');

update public.plans
   set limits = limits || jsonb_build_object('features',
         '["agenda", "crm", "qualificacao_leads", "relatorios", "analytics", "integracoes", "mpesa"]'::jsonb)
 where slug = 'agente_avancado' and not (limits ? 'features');

-- enterprise: sem a chave `features` = todas, como `max_users` ausente = sem limite.

comment on column public.plans.limits is
  'Limites e funcionalidades do pacote. max_users / max_whatsapp_connections: numéricos, ausente = sem limite. features: lista de funcionalidades além do agente e do WhatsApp (lib/plans/funcionalidades.ts); ausente = todas, [] = nenhuma.';

-- ---- Origem do agente aplicado a partir de um modelo: ai_agents.source_* (migration 9009) ----

alter table public.ai_agents
  add column if not exists source_agent_id uuid references public.ai_agents(id) on delete set null,
  add column if not exists source_version_id uuid references public.ai_agent_versions(id) on delete set null;

comment on column public.ai_agents.source_agent_id is
  'Agente-modelo de que este nasceu (aplicar modelo a um cliente). Nulo = criado na própria organização. Pode apontar para OUTRA organização: é só o registro de origem, nunca uma dependência — apagar o modelo zera o ponteiro.';
comment on column public.ai_agents.source_version_id is
  'Versão publicada do modelo que foi copiada. Mesma regra de source_agent_id.';

-- ---- Faturação dos pacotes: preço acordado, extras, facturas (migration 9010) ----
--
-- A troca de plano herda a âncora do ciclo (redefine fn_trocar_plano_da_organizacao da 9004).

-- ---- preço acordado, piloto e âncora do ciclo -------------------------------
alter table public.organization_subscriptions
  add column if not exists agreed_price_cents integer check (agreed_price_cents is null or agreed_price_cents >= 0),
  add column if not exists agreed_setup_cents integer check (agreed_setup_cents is null or agreed_setup_cents >= 0),
  add column if not exists is_pilot boolean not null default false,
  add column if not exists billing_anchor date;

comment on column public.organization_subscriptions.agreed_price_cents is
  'Mensalidade acordada com ESTE cliente. Nulo = vale o preço do pacote (plans.price_cents). Zero é um preço (cliente isento), não ausência.';
comment on column public.organization_subscriptions.agreed_setup_cents is
  'Setup acordado com este cliente. Nulo = vale plans.setup_fee_cents.';
comment on column public.organization_subscriptions.is_pilot is
  'Piloto: setup grátis e 50% de desconto na mensalidade da PRIMEIRA factura. Aplicado pelo sistema ao emitir; não se repete.';
comment on column public.organization_subscriptions.billing_anchor is
  'Dia em que o ciclo mensal da organização começou. A troca de plano herda-o: o ciclo é da organização, não da assinatura.';

update public.organization_subscriptions
   set billing_anchor = (started_at at time zone 'Africa/Maputo')::date
 where billing_anchor is null;

-- A troca de plano passa a herdar a âncora do ciclo. `create or replace` sobre a
-- definição da 9004: o corpo é o mesmo, mais a âncora.
create or replace function public.fn_trocar_plano_da_organizacao(
  p_org uuid, p_plan uuid, p_actor uuid, p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_anchor date;
begin
  perform 1 from public.organizations where id = p_org for update;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.plans where id = p_plan and is_active) then
    raise exception 'plan_inactive' using errcode = '22023';
  end if;

  -- O ciclo é da organização: herda o da assinatura anterior; sem anterior, hoje.
  select coalesce(billing_anchor, (started_at at time zone 'Africa/Maputo')::date)
    into v_anchor
    from public.organization_subscriptions
   where organization_id = p_org
   order by started_at asc
   limit 1;
  v_anchor := coalesce(v_anchor, (now() at time zone 'Africa/Maputo')::date);

  update public.organization_subscriptions set ended_at = now()
   where organization_id = p_org and ended_at is null;
  insert into public.organization_subscriptions (organization_id, plan_id, status, assigned_by, notes, billing_anchor)
  values (p_org, p_plan, 'active', p_actor, p_notes, v_anchor)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.fn_trocar_plano_da_organizacao(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fn_trocar_plano_da_organizacao(uuid, uuid, uuid, text) to service_role;

-- ---- extras por cliente -------------------------------------------------------
create table if not exists public.subscription_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('whatsapp_extra', 'user_extra', 'custom')),
  description text not null check (char_length(description) between 2 and 120),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null default 1 check (quantity between 1 and 1000),
  recurrence text not null check (recurrence in ('monthly', 'once')),
  adds_whatsapp_connections integer not null default 0 check (adds_whatsapp_connections >= 0),
  adds_users integer not null default 0 check (adds_users >= 0),
  started_on date not null default ((now() at time zone 'Africa/Maputo')::date),
  ended_on date,
  billed_invoice_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint subscription_items_periodo check (ended_on is null or ended_on >= started_on)
);

create index if not exists subscription_items_org_idx
  on public.subscription_items using btree (organization_id) where ended_on is null;

comment on table public.subscription_items is
  'Extras contratados por UM cliente (um número de WhatsApp a mais, utilizadores, etc.). Entram na factura e, se adds_*, sobem o limite do cliente na hora (lib/billing/calculo.ts).';

-- ---- catálogo global dos extras --------------------------------------------------
-- O preço aqui é o PADRÃO: ao contratar um extra a um cliente o operador pode
-- alterá-lo só para ele. Preço NULO = por definir (a tela exige defini-lo antes de
-- vender); nunca zero, que daria o extra de graça em silêncio. Os nomes são os dos
-- add-ons da página de preços; os valores não estão semeados porque a página só
-- indica intervalos, «sob consulta» ou «40% do plano base» (que é por cliente).
create table if not exists public.billing_addons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9_]{2,40}$'),
  description text not null check (char_length(description) between 2 and 120),
  kind text not null check (kind in ('whatsapp_extra', 'user_extra', 'custom')),
  unit_price_cents integer check (unit_price_cents is null or unit_price_cents >= 0),
  recurrence text not null check (recurrence in ('monthly', 'once')),
  adds_whatsapp_connections integer not null default 0 check (adds_whatsapp_connections >= 0),
  adds_users integer not null default 0 check (adds_users >= 0),
  is_active boolean not null default true,
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.billing_addons (slug, description, kind, unit_price_cents, recurrence, adds_whatsapp_connections, adds_users, sort)
values
  ('whatsapp_extra', 'Número de WhatsApp adicional', 'whatsapp_extra', null, 'monthly', 1, 0, 10),
  ('utilizador_extra', 'Utilizador adicional', 'user_extra', null, 'monthly', 0, 1, 20),
  ('integracao_crm', 'Integração com CRM', 'custom', null, 'once', 0, 0, 30),
  ('integracao_erp', 'Integração com ERP', 'custom', null, 'once', 0, 0, 40),
  ('agente_adicional', 'Agente adicional', 'custom', null, 'monthly', 0, 0, 50)
on conflict (slug) do nothing;

alter table public.billing_addons enable row level security;
revoke all on public.billing_addons from public, anon, authenticated;
grant select, insert, update on public.billing_addons to service_role;

-- ---- facturas -----------------------------------------------------------------
create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.organization_subscriptions(id),
  period_start date not null,
  period_end date not null,
  due_date date not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'MZN',
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  -- Por onde o dinheiro entrou: o PaySuite (M-Pesa, e-Mola, cartão) confirma sozinho; a
  -- transferência bancária é dada como paga por uma pessoa.
  paid_via text check (paid_via is null or paid_via in ('paysuite', 'transferencia')),
  reference text not null unique,
  provider_payment_id text,
  checkout_url text,
  reminded_at timestamptz,
  warned_at timestamptz,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint billing_invoices_paga_tem_data check (status <> 'paid' or paid_at is not null),
  constraint billing_invoices_uma_por_periodo unique (organization_id, period_start)
);

create index if not exists billing_invoices_abertas_idx
  on public.billing_invoices using btree (due_date) where status = 'open';
create index if not exists billing_invoices_org_idx
  on public.billing_invoices using btree (organization_id, period_start desc);

create table if not exists public.billing_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  position integer not null,
  kind text not null check (kind in ('plano', 'setup', 'extra', 'desconto')),
  description text not null,
  amount_cents integer not null,
  item_id uuid references public.subscription_items(id) on delete set null
);

create index if not exists billing_invoice_lines_invoice_idx
  on public.billing_invoice_lines using btree (invoice_id, position);

alter table public.subscription_items enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_invoice_lines enable row level security;

revoke all on public.subscription_items from public, anon, authenticated;
revoke all on public.billing_invoices from public, anon, authenticated;
revoke all on public.billing_invoice_lines from public, anon, authenticated;
grant select on public.subscription_items to authenticated;
grant select on public.billing_invoices to authenticated;
grant select on public.billing_invoice_lines to authenticated;
grant select, insert, update on public.subscription_items to service_role;
grant select, insert, update on public.billing_invoices to service_role;
grant select, insert, update on public.billing_invoice_lines to service_role;

-- Dinheiro é do admin da organização: manager para baixo não vê factura.
drop policy if exists tenant_isolation_subscription_items_select on public.subscription_items;
create policy tenant_isolation_subscription_items_select on public.subscription_items
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'admin'));

drop policy if exists tenant_isolation_billing_invoices_select on public.billing_invoices;
create policy tenant_isolation_billing_invoices_select on public.billing_invoices
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'admin'));

drop policy if exists tenant_isolation_billing_invoice_lines_select on public.billing_invoice_lines;
create policy tenant_isolation_billing_invoice_lines_select on public.billing_invoice_lines
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'admin'));

-- ---- emitir factura (atómico e idempotente) -----------------------------------
-- p_lines: [{"kind","description","amount_cents","item_id"?}]. O total é a soma, nunca
-- negativo. Devolve o id da factura nova, ou NULL se o período já tinha factura
-- (rodada repetida, dois processos ao mesmo tempo): quem chama não duplica nada.
create or replace function public.fn_emitir_fatura(
  p_org uuid, p_sub uuid, p_period_start date, p_period_end date, p_due date,
  p_currency text, p_reference text, p_lines jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_total integer;
begin
  select greatest(0, coalesce(sum((l->>'amount_cents')::integer), 0))
    into v_total
    from jsonb_array_elements(p_lines) l;

  insert into public.billing_invoices
    (organization_id, subscription_id, period_start, period_end, due_date, amount_cents, currency, reference)
  values
    (p_org, p_sub, p_period_start, p_period_end, p_due, v_total, p_currency, p_reference)
  on conflict (organization_id, period_start) do nothing
  returning id into v_id;

  if v_id is null then
    return null;
  end if;

  insert into public.billing_invoice_lines (invoice_id, organization_id, position, kind, description, amount_cents, item_id)
  select v_id, p_org, ord::integer, l->>'kind', l->>'description', (l->>'amount_cents')::integer,
         nullif(l->>'item_id', '')::uuid
    from jsonb_array_elements(p_lines) with ordinality as t(l, ord);

  -- extras pontuais cobram-se uma vez: ficam amarrados a esta factura
  update public.subscription_items i
     set billed_invoice_id = v_id
   where i.organization_id = p_org
     and i.recurrence = 'once'
     and i.billed_invoice_id is null
     and i.id in (select nullif(l->>'item_id', '')::uuid from jsonb_array_elements(p_lines) l);

  return v_id;
end;
$$;

revoke execute on function public.fn_emitir_fatura(uuid, uuid, date, date, date, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_emitir_fatura(uuid, uuid, date, date, date, text, text, jsonb) to service_role;

-- ---- marcar paga (idempotente) --------------------------------------------------
create or replace function public.fn_marcar_fatura_paga(
  p_invoice uuid, p_provider_payment_id text default null, p_via text default 'paysuite'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  update public.billing_invoices
     set status = 'paid',
         paid_at = now(),
         paid_via = p_via,
         provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id)
   where id = p_invoice and status = 'open'
   returning organization_id into v_org;

  if v_org is null then
    return jsonb_build_object('changed', false);
  end if;
  return jsonb_build_object('changed', true, 'organization_id', v_org);
end;
$$;

revoke execute on function public.fn_marcar_fatura_paga(uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_marcar_fatura_paga(uuid, text, text) to service_role;

-- ---- Quota de tokens de IA por conta: ai_tokens_override, ai_token_alerts, fn_tokens_de_ia_no_periodo (migration 9011) ----

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

-- ---- Aviso de caso também por e-mail: config_aviso_de_caso_email (migration 9012) ----

create table if not exists public.config_aviso_de_caso_email (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  emails text[] not null default '{}'::text[] check (cardinality(emails) <= 10),
  ligado boolean not null default false,
  atualizado_por uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.config_aviso_de_caso_email is
  'Quem recebe POR E-MAIL o aviso de caso aberto pela IA. Canal adicional ao aviso no WhatsApp (config_aviso_de_caso), que continua com um único número. A lista é validada pelo servidor (lib/billing/config.ts#lerEmails).';

alter table public.config_aviso_de_caso_email enable row level security;
revoke all on public.config_aviso_de_caso_email from public, anon, authenticated;
grant select on public.config_aviso_de_caso_email to authenticated;
grant select, insert, update on public.config_aviso_de_caso_email to service_role;

drop policy if exists tenant_isolation_config_aviso_de_caso_email_select on public.config_aviso_de_caso_email;
create policy tenant_isolation_config_aviso_de_caso_email_select on public.config_aviso_de_caso_email
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'admin'));

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
