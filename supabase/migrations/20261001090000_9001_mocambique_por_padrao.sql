-- ============================================================================
-- 9001 — MOÇAMBIQUE POR PADRÃO (SonghaiCRM)
--
-- O SonghaiCRM é a distribuição moçambicana do DeskcommCRM. O upstream nasce
-- brasileiro: moeda `BRL`, fuso `America/Sao_Paulo` e idioma `pt-BR` são o
-- DEFAULT de dezenas de colunas, espalhadas por muitas migrations. Esta troca
-- os três padrões, de uma vez, pelo de Moçambique: `MZN`, `Africa/Maputo`,
-- `pt-MZ`.
--
-- ─── Por que pelo CATÁLOGO, e não coluna a coluna ─────────────────────────
--
-- Uma lista à mão envelheceria no primeiro merge do upstream que trouxesse
-- uma coluna nova com `default 'BRL'`. Lendo `information_schema.columns`, a
-- migration acha toda coluna de `public` cujo default é exatamente um desses
-- literais — inclusive as que ainda não existem hoje, quando o apêndice do
-- baseline for reaplicado pelo `update.sh` depois de um merge. Idempotente:
-- na segunda passada não há default brasileiro para trocar.
--
-- ─── O que ela troca em DADO, e o que não ─────────────────────────────────
--
-- Troca só o valor que é EXATAMENTE o padrão antigo (`BRL`, `America/Sao_Paulo`,
-- `pt-BR`): é o que uma linha gravou sem ninguém escolher. Um valor escolhido
-- (Lisboa, USD, ZAR) fica como está. Não há instalação com dados reais desta
-- distribuição (decisão do dono, 2026-10-01); mesmo assim a regra é a genérica,
-- para servir a qualquer clone. Só colunas `text`/`varchar`/`char` entram.
-- ============================================================================

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
