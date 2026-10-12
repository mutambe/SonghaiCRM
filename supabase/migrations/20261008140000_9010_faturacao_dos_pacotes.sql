-- manifest: **SonghaiCRM — faturação dos pacotes.** Preço acordado por cliente (`organization_subscriptions.agreed_price_cents` / `agreed_setup_cents`), piloto (`is_pilot`) e a âncora do ciclo (`billing_anchor`, herdada na troca de plano para a troca não reabrir o setup nem abrir ciclo novo); `subscription_items` (extras por cliente, p. ex. um número de WhatsApp a mais, que também sobem o limite do cliente) e `billing_addons` (catálogo GLOBAL dos extras, com o preço editável; preço nulo = por definir, nunca zero); `billing_invoices` + `billing_invoice_lines` (facturas e o que as compõe, uma por período, `unique (organization_id, period_start)`); `fn_emitir_fatura` (emite factura e linhas e marca extras pontuais como cobrados, numa transação) e `fn_marcar_fatura_paga` (idempotente; regista se entrou pelo PaySuite ou por transferência). Escritas só pelo servidor; o admin da organização lê as próprias facturas. Bloco no `supabase/songhai.sql`.

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
