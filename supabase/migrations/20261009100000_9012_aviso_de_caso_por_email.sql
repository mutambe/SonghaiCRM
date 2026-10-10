-- manifest: **SonghaiCRM — aviso de caso também por e-mail.** `config_aviso_de_caso_email`: uma linha por organização com a lista de e-mails (até 10) que recebem o aviso quando a IA abre um caso, e o interruptor `ligado`. É um canal ADICIONAL e independente do aviso no WhatsApp (que guarda um único número e cujo corte na entrada do WhatsApp não se mexe): não acrescenta nenhum número ao recebimento de mensagens. Escrita só pelo servidor; o admin da organização lê. Bloco no `supabase/songhai.sql`.

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
