-- 0174 — CREDENCIAL DO PAYSUITE DA INSTÂNCIA CENTRAL (licenciamento).
--
-- A Task 7/8 do plano de licenciamento (`docs/superpowers/plans/
-- 2026-09-04-licenciamento-paysuite.md`) nasceu lendo a credencial do
-- PaySuite de env vars (`LICENSING_PAYSUITE_API_KEY`/`_WEBHOOK_SECRET`).
-- Pedido do dono do produto: mesma UX de `payment_credentials` (migration
-- 0162) — colar pela tela, cifrado no banco, nunca mais mostrado em texto —
-- porque quem administra a Central no dia a dia não deve precisar editar
-- `.env`/reiniciar container pra trocar essa credencial.
--
-- Singleton (`id='singleton'`), mesmo molde de `licensing_client_state`
-- (migration 0173): só existe UMA conta PaySuite da Central, não é dado
-- por-organização como o `payment_credentials` de tenant. RLS ligada com
-- ZERO policies + revoke geral — só a rota admin (service role) lê/escreve,
-- igual ao `payment_credentials`.
--
-- Cifra via `fn_encrypt_oauth`/`fn_decrypt_oauth` (mesma infra de
-- `lib/webhooks/secrets.ts`, já usada pelo Nuvemshop/WAHA/payment_credentials
-- de tenant) — não é infra nova.

create table if not exists public.licensing_paysuite_credentials (
  id text primary key default 'singleton' check (id = 'singleton'),
  api_token_encrypted bytea not null,
  webhook_secret_encrypted bytea not null,
  status text not null default 'healthy' check (status in ('healthy', 'error')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.licensing_paysuite_credentials enable row level security;
revoke all on public.licensing_paysuite_credentials from anon, authenticated;
grant select, insert, update on public.licensing_paysuite_credentials to service_role;

create or replace trigger trg_licensing_paysuite_credentials_updated_at
  before update on public.licensing_paysuite_credentials
  for each row execute function public.fn_set_updated_at();
