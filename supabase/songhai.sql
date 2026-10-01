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
