-- 0181 — Agenda: integração com Google Calendar, Fase 1 (conectar/listar/
-- desconectar). Adaptado do módulo de Agenda do upstream (DeskcommCRM), que
-- tem um desenho bem mais amplo (sincronização incremental bidirecional,
-- eventos externos) — fora do escopo desta fase. Ver lib/agenda/google/.
--
-- Conexão é POR PESSOA (atendente), não por organização: cada um conecta a
-- própria agenda do Google, igual a `attendant_schedule` (migration 0165).
-- `unique (organization_id, user_id, provider, account_email)` deixa a mesma
-- pessoa conectar mais de UMA conta Google se precisar.

create table if not exists public.calendar_connections (
  id                             uuid primary key default gen_random_uuid(),
  organization_id                uuid not null references public.organizations(id) on delete cascade,
  user_id                        uuid not null references auth.users(id) on delete cascade,

  provider                       text not null default 'google_calendar'
                                  check (provider in ('google_calendar')),
  account_email                  text not null,

  -- Cifrado por public.fn_encrypt_oauth (pgp_sym AES-256) — a mesma RPC que
  -- lib/webhooks/secrets.ts já usa para webhook_sources/automation_rules.
  -- NUNCA em claro. Só service_role decifra.
  oauth_access_token_encrypted   bytea,
  oauth_refresh_token_encrypted  bytea,
  token_expires_at               timestamptz,
  scopes                         text[] not null default array[]::text[],

  status                         text not null default 'connecting'
                                  check (status in (
                                    'connecting','healthy','token_expired','scope_missing',
                                    'disconnected','rate_limited','error'
                                  )),
  last_sync_error                text,

  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

create unique index if not exists calendar_connections_conta_key
  on public.calendar_connections (organization_id, user_id, provider, account_email);
create index if not exists calendar_connections_org_pessoa_idx
  on public.calendar_connections (organization_id, user_id);
-- A varredura do worker de renovação (Fase 2): quem está para vencer.
create index if not exists calendar_connections_renovacao_idx
  on public.calendar_connections (token_expires_at)
  where status in ('healthy', 'rate_limited') and token_expires_at is not null;

comment on table public.calendar_connections is
  'A conta de agenda externa que UMA PESSOA conectou. Uma por atendente — por isso não cabe em tenant_integrations, que é uma por organização e por provedor.';
comment on column public.calendar_connections.oauth_access_token_encrypted is
  'Cifrado por public.fn_encrypt_oauth. NUNCA em claro. A chave vive em private.fn_oauth_key() e só service_role executa a decifragem.';
comment on column public.calendar_connections.token_expires_at is
  'Quando o access_token vence (~1h no Google). Fase 2 varre por aqui para renovar.';

alter table public.calendar_connections enable row level security;

-- A própria pessoa vê a conexão dela; manager vê a de qualquer atendente da
-- organização (mesmo piso de `attendant_schedule_select`, adaptado: aqui não
-- há motivo para expor a linha a todo mundo, porque ela carrega o e-mail da
-- conta pessoal do atendente).
drop policy if exists "calendar_connections_select" on public.calendar_connections;
create policy "calendar_connections_select" on public.calendar_connections
  for select using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager')))
  );

-- Escrita fica só para as rotas (service role, filtro programático) — ver
-- anti-pattern 10 do CLAUDE.md. RLS aqui é a segunda camada, não a primeira: a
-- rota nunca deixa o organization_id/user_id vir do corpo da requisição.
drop policy if exists "calendar_connections_write" on public.calendar_connections;
create policy "calendar_connections_write" on public.calendar_connections
  for all using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager')))
  ) with check (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager')))
  );

create or replace trigger trg_calendar_connections_updated_at
  before update on public.calendar_connections
  for each row execute function public.fn_set_updated_at();

revoke all on public.calendar_connections from anon;

-- ---------------------------------------------------------------------------
-- As agendas dentro de uma conta conectada. Fase 1 só registra a primária
-- (o e-mail da conta); escolher outras é tela da Fase 2.

create table if not exists public.calendar_connection_calendars (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  connection_id         uuid not null references public.calendar_connections(id) on delete cascade,

  external_calendar_id  text not null,
  name                  text not null,
  is_primary            boolean not null default false,
  time_zone             text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists calendar_connection_calendars_key
  on public.calendar_connection_calendars (organization_id, connection_id, external_calendar_id);

comment on table public.calendar_connection_calendars is
  'As agendas dentro de uma conta conectada. Fase 1 só grava a primária; contagem de conflito/sincronização são a Fase 2.';
comment on column public.calendar_connection_calendars.time_zone is
  'Fuso IANA do calendário. NULL = ainda não sincronizado; nunca trate NULL como UTC.';

alter table public.calendar_connection_calendars enable row level security;

drop policy if exists "calendar_connection_calendars_select" on public.calendar_connection_calendars;
create policy "calendar_connection_calendars_select" on public.calendar_connection_calendars
  for select using (
    public.fn_is_platform_admin()
    or exists (
      select 1 from public.calendar_connections c
      where c.id = calendar_connection_calendars.connection_id
        and c.organization_id = calendar_connection_calendars.organization_id
        and (c.user_id = auth.uid() or public.fn_role_at_least(c.organization_id, 'manager'))
    )
  );

drop policy if exists "calendar_connection_calendars_write" on public.calendar_connection_calendars;
create policy "calendar_connection_calendars_write" on public.calendar_connection_calendars
  for all using (public.fn_is_platform_admin())
  with check (public.fn_is_platform_admin());

create or replace trigger trg_calendar_connection_calendars_updated_at
  before update on public.calendar_connection_calendars
  for each row execute function public.fn_set_updated_at();

revoke all on public.calendar_connection_calendars from anon;

-- ---------------------------------------------------------------------------
-- Uso único do `state` do OAuth — a defesa contra replay. A chave primária É
-- o nonce: uma segunda tentativa com o mesmo nonce viola a unicidade, e é
-- assim que o replay é recusado (ver lib/agenda/google/estado.ts).

create table if not exists public.calendar_oauth_nonces (
  nonce            text primary key,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  expira_em        timestamptz not null,
  created_at       timestamptz not null default now()
);

create index if not exists calendar_oauth_nonces_expira_idx on public.calendar_oauth_nonces (expira_em);

comment on table public.calendar_oauth_nonces is
  'Uso único do state assinado do OAuth do Google. Linha expirada é lixo, não segredo — pode ser varrida por cron/TTL a qualquer momento.';

alter table public.calendar_oauth_nonces enable row level security;

-- Só a rota de callback (service role) escreve aqui; ninguém via RLS.
drop policy if exists "calendar_oauth_nonces_no_access" on public.calendar_oauth_nonces;
create policy "calendar_oauth_nonces_no_access" on public.calendar_oauth_nonces
  for all using (public.fn_is_platform_admin())
  with check (public.fn_is_platform_admin());

revoke all on public.calendar_oauth_nonces from anon, authenticated;
