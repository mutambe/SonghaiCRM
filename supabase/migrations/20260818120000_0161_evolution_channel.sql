-- 20260818120000_0161_evolution_channel.sql
-- Adiciona o Evolution API como quarto ChannelProvider. Mesmo padrão da
-- 0131/0132 (que adicionou o Zernio como terceiro): coluna nasce nullable,
-- CHECKs são recriados por inteiro (drop + add), nunca "duplicate_object" —
-- um clone que já rodou update.sh anterior tem a constraint com 3 valores, e
-- engolir o create deixaria o Evolution API sempre recusado ali, com o
-- update.sh saindo verde.

alter table public.channel_sessions
  add column if not exists evolution_instance_name text;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
  check (provider = any (array['waha'::text, 'meta_cloud'::text, 'zernio'::text, 'evolution'::text]));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha'       and waha_session_name       is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id    is not null) or
    (provider = 'zernio'     and zernio_account_id       is not null) or
    (provider = 'evolution'  and evolution_instance_name is not null)
  );

comment on column public.channel_sessions.evolution_instance_name is
  'Nome da instância na Evolution API (instância externa, não gerenciada por este repo). Endereça envio e webhook. Espelhado em lib/channels/session-ref.ts.';
