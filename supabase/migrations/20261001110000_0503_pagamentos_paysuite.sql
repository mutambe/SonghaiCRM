-- SonghaiCRM — 0503: INTEGRAÇÃO DE PAGAMENTO (PaySuite: M-Pesa, e-Mola, cartão).
--
-- Reaplicação, nesta base, da migration 0162 do fork antigo do SonghaiCRM. Duas
-- tabelas, propósitos e acessos diferentes:
--
-- `payment_credentials` guarda SÓ segredo (token de API e segredo de webhook,
-- cifrados por `fn_encrypt_oauth`). Nenhuma tela lê isto pelo PostgREST: a rota
-- (service role) decifra e devolve à tela de configuração só o que é sanitizado.
-- RLS ligada com ZERO policies + nenhum privilégio para anon/authenticated — o
-- mesmo desenho da configuração SMTP (`configuracao-de-smtp-e-server-side`).
--
-- `payments` é o LOG da transação (valor, status, referência), que a tela do
-- negócio mostra: SELECT escopado pela organização. ESCRITA só pela rota de
-- cobrança e pelo webhook de confirmação (service role).
--
-- `reference` é a idempotência do NOSSO lado (duplo-clique em "Cobrar" não grava
-- duas linhas); `provider_payment_id` é a do lado do PaySuite (a reentrega do
-- webhook não grava dois "pagamento confirmado"). `amount_cents`/`currency`
-- registram o que foi COBRADO, não um ponteiro para `crm_leads.value_cents`, que
-- pode mudar depois. Moeda padrão MZN (metical).
--
-- Idempotente: reaplicar (update.sh) não duplica nada nem falha.

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
-- Leitura pela RLS (authenticated); escrita só pela rota (service role).
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
