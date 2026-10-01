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
