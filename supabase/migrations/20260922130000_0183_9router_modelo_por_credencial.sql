-- 0183: 9Router escolhe modelo pelo que a CREDENCIAL descobriu, não pelo
-- catálogo global `ai_models`.
--
-- Mesmo bug do 0178/0179/0180 (Groq/NVIDIA/DeepSeek/Qwen/Zhipu/Moonshot):
-- `ModelPicker.tsx` mostrava "Nenhum modelo disponível" pra quem cadastrava e
-- validava uma chave 9Router — só que aqui SEED não resolve. Os outros
-- provedores têm um catálogo que É o mesmo pra qualquer instalação (a Groq
-- vende os mesmos modelos pra todo mundo); o 9Router é um gateway que o
-- PRÓPRIO OPERADOR roda, na frente dos aliases que ele mesmo configurou
-- (`cc/claude-opus-4-5`, ou o que quer que ele tenha chamado o roteamento
-- automático de free-tier dele) — não existe uma lista global pra curar,
-- porque a lista de A é diferente da de B.
--
-- A tela já resolve isso do lado de fora (`ModelPicker` ganha
-- `credentialModels`, só quando `provider === "9router"`, alimentado por
-- `ai_provider_credentials.models_available` — a mesma lista que
-- `validate9RouterKey` já busca em `GET {endpoint}/models` ao validar a
-- chave, gravada em `lib/ai/credenciais/guardar.ts`). Falta o espelho no
-- servidor: `fn_publish_ai_agent_version` recusava TODO agente 9Router com
-- `model_not_found`, porque checava contra `ai_models`, que pra este
-- provider está e vai continuar vazia de propósito.
--
-- Escopo é só `9router` — Ollama e os demais seguem exatamente como estavam,
-- pedido explícito do dono do produto: não é a mesma mudança para todo
-- provedor "local", é só para este.
create or replace function public.fn_publish_ai_agent_version(
  p_org_id uuid,
  p_agent_id uuid,
  p_version_id uuid
)
returns table (
  agent_id uuid,
  version_id uuid,
  previous_version_id uuid,
  published_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agent record;
  v_version record;
  v_credential record;
  v_session record;
  v_model_count integer;
  v_previous_version_id uuid;
  v_published_at timestamptz := now();
begin
  select a.id, a.organization_id, a.published_version_id, a.archived_at
    into v_agent
  from public.ai_agents a
  where a.id = p_agent_id
  for update;

  if not found then
    raise exception 'agent_not_found' using errcode = 'P0001';
  end if;
  if v_agent.organization_id <> p_org_id then
    raise exception 'agent_not_found' using errcode = 'P0001';
  end if;
  if v_agent.archived_at is not null then
    raise exception 'agent_archived' using errcode = 'P0001';
  end if;

  select v.id, v.organization_id, v.agent_id, v.status, v.provider, v.model,
         v.credential_id, v.channel_session_id
    into v_version
  from public.ai_agent_versions v
  where v.id = p_version_id
  for update;

  if not found then
    raise exception 'version_not_found' using errcode = 'P0001';
  end if;
  if v_version.agent_id <> p_agent_id or v_version.organization_id <> p_org_id then
    raise exception 'version_not_found' using errcode = 'P0001';
  end if;
  if v_version.status not in ('draft', 'superseded') then
    raise exception 'version_invalid_state' using errcode = 'P0001';
  end if;

  if v_version.credential_id is null then
    raise exception 'credential_missing' using errcode = 'P0001';
  end if;

  select c.id, c.organization_id, c.provider, c.is_active, c.validated_at, c.models_available
    into v_credential
  from public.ai_provider_credentials c
  where c.id = v_version.credential_id;

  if not found or v_credential.organization_id <> p_org_id then
    raise exception 'credential_not_found' using errcode = 'P0001';
  end if;
  if not v_credential.is_active then
    raise exception 'credential_inactive' using errcode = 'P0001';
  end if;
  if v_credential.validated_at is null then
    raise exception 'credential_not_validated' using errcode = 'P0001';
  end if;
  if v_credential.provider <> v_version.provider then
    raise exception 'credential_provider_mismatch' using errcode = 'P0001';
  end if;

  select s.id, s.organization_id, s.status
    into v_session
  from public.channel_sessions s
  where s.id = v_version.channel_session_id;

  if not found or v_session.organization_id <> p_org_id then
    raise exception 'channel_session_not_found' using errcode = 'P0001';
  end if;
  if v_session.status <> 'WORKING' then
    raise exception 'channel_session_offline' using errcode = 'P0001';
  end if;

  if v_version.provider = '9router' then
    -- Catálogo não é global: é o que a validação DAQUELA credencial achou.
    if v_credential.models_available is null
       or not (v_version.model = any(v_credential.models_available)) then
      raise exception 'model_not_found' using errcode = 'P0001';
    end if;
  else
    select count(*)
      into v_model_count
    from public.ai_models m
    where m.provider = v_version.provider
      and m.model_id = v_version.model
      and m.deprecated_at is null;

    if v_model_count = 0 then
      raise exception 'model_not_found' using errcode = 'P0001';
    end if;
  end if;

  v_previous_version_id := v_agent.published_version_id;

  if v_previous_version_id is not null and v_previous_version_id <> p_version_id then
    update public.ai_agent_versions
       set status = 'superseded', superseded_at = v_published_at
     where id = v_previous_version_id;
  end if;

  update public.ai_agent_versions
     set status = 'published',
         published_at = v_published_at,
         superseded_at = null
   where id = p_version_id;

  update public.ai_agents
     set published_version_id = p_version_id,
         updated_at = v_published_at
   where id = p_agent_id;

  return query
    select p_agent_id, p_version_id, v_previous_version_id, v_published_at;
end;
$$;

comment on function public.fn_publish_ai_agent_version(uuid, uuid, uuid) is
  'EPIC-13 S-13.06 (fixed in 0026): compares channel_sessions.status against WORKING (uppercase). '
  '0183: 9Router valida o modelo contra ai_provider_credentials.models_available (catálogo por '
  'credencial) em vez de ai_models (catálogo global) — só para provider=''9router''; demais provedores inalterados.';
