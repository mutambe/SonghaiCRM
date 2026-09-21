# Retenção automática da fila e do audit log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `job_queue` (linhas terminais: `done`/`failed`/`dead`) e `api_audit_log` (linhas vencidas) ganham poda/expurgo automático via cron diário, com as funções SQL residindo no banco (não no admin client) e os quatro crons existentes que hoje auditam incondicionalmente (`routing-worker`, `attendant-heartbeat`, `kb-conversations-batch`, `lgpd-sla-watcher`) passando a auditar só quando houve efeito.

**Architecture:** Duas funções `security definer` no Postgres (`fn_podar_fila_de_jobs`, `fn_expurgar_auditoria_vencida`) fazem o DELETE de verdade — o TypeScript só decide o relógio e o laço de lotes. Uma rota de cron nova (`app/api/v1/cron/data-retention`) chama as duas via RPC em lotes de 1000, com teto de 20 lotes por invocação. Duas variáveis de ambiente opcionais (`JOB_QUEUE_RETENTION_DAYS`, `AUDIT_LOG_RETENTION_DAYS`) permitem ajustar a retenção sem editar código; um piso mora DENTRO das funções SQL (vale até para um `psql` direto), e a interpretação do valor cru do `.env` mora em `lib/retencao/politica.ts` (nunca `z.coerce.number()` em `lib/env.ts` — valor inválido não pode derrubar o boot). Um guarda de AST (`tests/unit/cron-audita-so-quando-ha-efeito.test.ts`) varre **toda** rota em `app/api/v1/cron/` e reprova qualquer `audit()` fora de condição, cobrindo a classe inteira, não só as quatro rotas consertadas.

**Escopo deliberadamente MENOR que o upstream.** O commit de origem (`upstream/main`, `melgarafael/DeskcommCRM`, migration final `0167`) evoluiu depois para também podar um "espelho" de Google Calendar (`fn_expurgar_espelho_da_agenda`), nonces de OAuth (`fn_expurgar_nonces_de_oauth`) e retomar uma cascata de anonimização LGPD (`lib/lgpd/cascata.ts`) na mesma rota. **Nenhuma dessas três dependências existe no nosso fork** (não temos Agenda nativa com sync Google nem essa cascata retomável) e não foram pedidas — portar essas partes faria a rota falhar na importação. Este plano porta só o núcleo `job_queue` + `api_audit_log`, que é autocontido e bate 1:1 com o nosso schema atual.

**Tech Stack:** Next.js Route Handler, Supabase Postgres (`security definer` functions), Zod (`lib/env.ts`), Vitest (`tests/unit`), suíte de invariantes contra Postgres efêmero (`tests/invariants`, via `pnpm test:db` / `scripts/test-db.sh`), TypeScript Compiler API (`typescript` pkg, já em `package.json`) para o guarda de AST.

**Spec:** Não há spec formal — a "spec" é o commit upstream `219ea17c` + correções subsequentes (`caf47442`, `a7228aa1`, `31bf3067`) e o estado final em `upstream/main` para `supabase/migrations/20260820170000_0167_poda_da_fila_e_expurgo_do_audit.sql`, `lib/retencao/politica.ts` e `app/api/v1/cron/data-retention/route.ts`, com as três dependências de Agenda/LGPD-cascata **subtraídas** (ver seção acima). Referência de doutrina local: `CLAUDE.md` — seções "Migrations & Banco" (tripla migration/baseline/MANIFEST, revoke duplo em `security definer`) e "Definition of Done" itens 1-11.

## Global Constraints

- Toda tabela/função tocada já é tenant-aware ou de escopo de plataforma — nenhuma tabela nova, nenhuma RLS nova.
- Migration idempotente: `create index if not exists`, `create or replace function`, `revoke`/`grant` (no-op se já ausente/presente). Sem `ALTER` que quebre reaplicação.
- Toda `create function` nova em `public` termina com `revoke ... from public, anon, authenticated` + `grant ... to service_role` — as DUAS origens de EXECUTE (doutrina de migrations, item 9).
- Nenhuma env var nova pode ser **obrigatória**: ambas usam `z.string().optional().default("")`, nunca `z.coerce.number()` — valor inválido cai pro padrão em `lib/retencao/politica.ts`, nunca derruba o boot (`lib/env.ts` lança na primeira request quando o schema recusa).
- `.env.example`: chaves novas SEM `#` na frente do `=` (senão `tests/unit/env-example-sync.test.ts` reprova).
- Toda mutação relevante (poda que apagou algo, ou que falhou) emite `api_audit_log` via `audit()` — mas rodada sem efeito NÃO audita (é a regra que este plano introduz para as 4 rotas antigas também).
- `docker/scheduler/entrypoint.sh`: rota de cron nova precisa de linha correspondente, e o path é literal (`api/v1/cron/<rota>`) porque `tests/unit/cron-routes-scheduled.test.ts` compara a lista com o diretório `app/api/v1/cron` via grep.
- `pnpm test:db` roda os invariantes contra Postgres efêmero real com o `baseline.sql` aplicado (install E update) — é o único caminho que prova a migration antes de confiar nela. Rodar **localmente** antes de considerar a Task 6 concluída.
- Sem `console.log` novo (usar `logger` de `@/lib/logger`, já usado nas 4 rotas existentes onde aplicável — `kb-conversations-batch` e `lgpd-sla-watcher` já usam `console.error` pré-existente; não é escopo deste plano corrigi-los).

---

## Task 1: Migration 0177 — funções SQL + índices + MANIFEST + baseline.sql

**Files:**
- Create: `supabase/migrations/20260910100000_0177_poda_da_fila_e_expurgo_do_audit.sql`
- Modify: `supabase/migrations/MANIFEST.md` (nova linha na tabela "Applied", após a linha `0176`)
- Modify: `supabase/baseline.sql` (apêndice no fim do arquivo — hoje termina na linha 14201, bloco da migration 0176)

**Interfaces:**
- Produces: função `public.fn_podar_fila_de_jobs(p_retencao_dias int default null, p_limite int default null) returns int`, função `public.fn_expurgar_auditoria_vencida(p_retencao_dias int default null, p_limite int default null) returns int` — ambas `security definer`, `grant execute` só a `service_role`. Índices `idx_job_queue_poda`, `idx_audit_expurgo_created_at`, `idx_agent_inbox_items_ref_aberto`. As Tasks 5 e 6 consomem essas duas funções via `admin.rpc(nome, { p_retencao_dias, p_limite })`.

- [ ] **Step 1: Criar o arquivo de migration**

```sql
-- 0177 — A FILA E A AUDITORIA GANHAM PODA. O QUE TEM DONO NÃO SAI.
--
-- ═══ O DEFEITO MEDIDO ═══
--
--     $ grep -rn "from job_queue" lib workers app supabase scripts | grep -i delete
--     (zero linhas)
--
-- Nada no produto apaga job terminal. `job_queue` cresce desde a instalação e
-- nunca encolhe. `api_audit_log` tem retenção de 5 anos no `COMMENT ON TABLE`
-- (regra L-10, `docs/business-rules`) e em seis documentos — e nenhum código a
-- executava: nem expurgo, nem "cold storage S3".
--
-- Duas contas do cliente pagam por isso. Espaço: o plano free do Supabase
-- limita 500 MB de banco, e estas duas são as candidatas naturais a estourar
-- antes de qualquer tabela de negócio. CPU: o bloat degrada o `count(*)` do
-- claim de fila — uma tabela sem linha viva ainda cobra buscas em buffer.
--
-- ═══ POR QUE DELETE POR IDADE, E NÃO PARTICIONAMENTO ═══
--
-- Particionar `job_queue` por data exigiria mexer no caminho de escrita mais
-- quente do produto (o claim `FOR UPDATE SKIP LOCKED` com índice parcial e dois
-- índices ÚNICOS parciais — `uniq_job_queue_one_running_per_contact` e
-- `uniq_job_queue_source_event`, que numa tabela particionada precisariam
-- incluir a chave de partição para existir). Trocar a garantia de exatamente-um-
-- turno-por-lead por espaço em disco é um péssimo negócio. DELETE em lotes
-- resolve o problema declarado sem tocar em nada do claim.
--
-- ═══ O QUE TEM DONO NÃO SAI — TRÊS CORTES, NÃO UM ═══
--
-- (1) `pending` e `running` NUNCA saem. `pending` é trabalho que ainda vai sair
--     (o worker o reclama pelo relógio da fila); `running` está com um worker
--     agora, e se ele morrer o reaper o devolve pelo visibility timeout. Apagar
--     qualquer um dos dois PERDE trabalho. Terminais são só três, conferidos em
--     `lib/agent-engine/queue/queue.ts`: `done` (completeJob), `failed`
--     (cancelJob — veto permanente de negócio) e `dead` (esgotou max_attempts).
--
-- (2) `dead` com AVISO ABERTO na Central também tem dono — um humano que ainda
--     não olhou. `failJob`/`reapExpiredJobs` abrem `agent_inbox_items` com
--     `ref_kind='job_queue'` e `ref_id = job.id`; apagar o job deixaria o aviso
--     apontando para o vazio. O filtro `not exists` fica DENTRO do `where`, ANTES
--     do `limit`, e isso é load-bearing: filtrar depois do limite faria um lote
--     inteiro de jobs protegidos devolver 0, o laço do cron pararia achando que
--     acabou, e a poda morreria de fome com backlog na frente.
--
-- (3) O corte é por `created_at`, nunca por `locked_at`/`run_after` — as duas
--     colunas que outro código reescreve (mesma lição do recover-stuck-messages:
--     medir idade por coluna que alguém atualiza faz a linha rejuvenescer).
--
-- ═══ O EFEITO EM CASCATA, DECLARADO (não é surpresa, é escolha) ═══
--
-- Apagar um job leva junto, por FK `on delete cascade`, as linhas de
-- `send_ledger` (unique (job_id, seq)) e `before_send_traces` daquele run — as
-- duas também crescem monotonicamente, então isso é parte do conserto, não um
-- dano colateral. `llm_calls`, `lead_checkpoints` e `lead_state_transitions` são
-- `on delete set null`: o histórico de custo e de funil FICA, só perde o
-- ponteiro para o run.
--
-- Os DOIS consumidores de `send_ledger` sem janela de tempo foram medidos, e os
-- dois falham FECHADO quando a linha some:
--   - `countPriorAcceptedSends` = 0 ⇒ "1º outbound" ⇒ o disclosure de IA volta a
--     ser enviado (mais transparência, nunca menos);
--   - o mesmo sinal alimenta o gate LGPD, que VETA 1º toque de prospecção sem
--     base legal válida (`before-send.ts`) — vetar a mais, nunca a menos.
-- `health/circuit.ts` já é janelado (`windowMs`, default 6 h), muito abaixo de
-- qualquer retenção admissível aqui. Por isso o piso da função é de 7 dias e o
-- default é 90: nenhum dos dois consumidores muda de veredito nesse horizonte.
--
-- ═══ AUDITORIA: POR QUE UMA SECURITY DEFINER, E POR QUE ISSO NÃO É UMA PORTA ═══
--
-- `api_audit_log` é append-only NO SCHEMA, não só na prosa: o baseline concede
-- `SELECT, INSERT, REFERENCES, TRIGGER, TRUNCATE, MAINTAIN` a anon,
-- authenticated E service_role — DELETE e UPDATE não estão lá para ninguém.
-- Logo o expurgo NÃO pode sair pelo admin client; ele precisa de uma função que
-- rode como o dono da tabela. Cinco razões pelas quais esta função não vira uma
-- porta de adulteração de auditoria, e cada uma é conferível:
--
--   (a) ELA NÃO TEM SELETOR DE LINHA. Nenhum parâmetro de organização, ator,
--       ação, recurso, id ou limite superior de data. O único predicado é
--       `created_at < now() - N dias`: ela só sabe apagar pela ponta MAIS VELHA.
--       Não existe argumento que a faça apagar a linha de ontem que incomoda.
--   (b) O PISO MORA DENTRO DA FUNÇÃO, não em quem chama. `greatest(..., 90)`:
--       mesmo quem tem a service key e chame com `p_retencao_dias => 0` não
--       remove nada com menos de 90 dias. O knob só escolhe o quanto ALÉM do
--       piso, nunca aquém.
--   (c) NÃO É ALCANÇÁVEL PELA REST. `revoke` das duas origens de EXECUTE (o
--       grant direto a anon do `ALTER DEFAULT PRIVILEGES` do baseline, e o grant
--       a PUBLIC que o Postgres dá na criação) + grant só a `service_role`.
--   (d) ELA NÃO AMPLIA O RAIO DE QUEM JÁ TEM A CHAVE. Quem chama já é
--       service_role — que no self-host tem `TRUNCATE` nesta mesma tabela e o
--       dono do banco na mão. A função não abre poder novo; ela dá FORMA
--       auditável ao poder que já existia, e é a forma mais estreita possível.
--   (e) ELA REGISTRA A PRÓPRIA EROSÃO. O cron `data-retention` grava
--       `retention.sweep_run` com a contagem apagada — e essa linha, por ser
--       nova, é justamente a que a próxima chamada não alcança. A trilha guarda
--       quem a encurtou.
--
-- Hot 90 dias / cold em S3 NÃO é entregue aqui: um produto self-host não tem
-- para onde arquivar (o Supabase Storage do cliente é a MESMA cota, 1 GB, já
-- dividida com `whatsapp-media`, que também não tem poda). O que se entrega é o
-- expurgo na fronteira da retenção, que é a metade que o cliente pode executar
-- sozinho.
--
-- Idempotente: `create or replace` + `create index if not exists` + `revoke`
-- (no-op quando o privilégio já não existe). Nenhuma constraint nova, então não
-- há dado a deduplicar antes.

-- Índice de poda. Sem ele o DELETE por idade vira seq scan diário sobre a tabela
-- inteira — trocaria a conta de disco pela de CPU, que é o outro lado do problema.
-- Parcial nos três status terminais: é exatamente o conjunto que a poda visita.
create index if not exists idx_job_queue_poda
  on public.job_queue (created_at)
  where status in ('done', 'failed', 'dead');

-- O `api_audit_log` tem cinco índices e nenhum começa por `created_at`, então
-- `where created_at < corte` não tinha por onde entrar. Nome próprio da poda de
-- propósito: `create index if not exists` casa por NOME, e um nome genérico como
-- `idx_audit_created_at` poderia existir num clone com outra definição e virar
-- no-op silencioso.
create index if not exists idx_audit_expurgo_created_at
  on public.api_audit_log (created_at);

-- Acelera o corte (2): o anti-join contra os avisos ABERTOS que apontam para um
-- job. `idx_agent_inbox_items_open` é por (organization_id, created_at) e não
-- serve para procurar por `ref_id`.
create index if not exists idx_agent_inbox_items_ref_aberto
  on public.agent_inbox_items (ref_kind, ref_id)
  where status = 'open';

create or replace function public.fn_podar_fila_de_jobs(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Piso de 7 dias: abaixo disso a cascata em `send_ledger` começaria a mexer no
  -- horizonte em que "1º outbound" ainda significa alguma coisa para um lead vivo.
  v_dias int := greatest(coalesce(p_retencao_dias, 90), 7);
  v_limite int := least(greatest(coalesce(p_limite, 1000), 1), 10000);
  v_apagados int;
begin
  with candidatos as (
    select j.id
      from public.job_queue j
     where j.status in ('done', 'failed', 'dead')
       and j.created_at < now() - make_interval(days => v_dias)
       -- ANTES do limit, sempre. Ver corte (2) no cabeçalho.
       and not exists (
         select 1
           from public.agent_inbox_items i
          where i.ref_kind = 'job_queue'
            and i.ref_id = j.id
            and i.status = 'open'
       )
     order by j.created_at
     limit v_limite
  )
  delete from public.job_queue j
   using candidatos c
   where j.id = c.id;
  get diagnostics v_apagados = row_count;
  return v_apagados;
end;
$$;

create or replace function public.fn_expurgar_auditoria_vencida(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- 1825 dias = os 5 anos da regra L-10. O piso de 90 é o que impede que o knob
  -- vire apagador de rastro recente — ver (b) no cabeçalho.
  v_dias int := greatest(coalesce(p_retencao_dias, 1825), 90);
  v_limite int := least(greatest(coalesce(p_limite, 1000), 1), 10000);
  v_apagadas int;
begin
  with vencidas as (
    select a.id
      from public.api_audit_log a
     where a.created_at < now() - make_interval(days => v_dias)
     order by a.created_at
     limit v_limite
  )
  delete from public.api_audit_log a
   using vencidas v
   where a.id = v.id;
  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end;
$$;

-- As DUAS origens de EXECUTE, em ambas as funções (doutrina de migrations, item
-- 9): `revoke from public` não tira o grant DIRETO que o `ALTER DEFAULT
-- PRIVILEGES ... TO anon` do baseline dá a toda função nova; `revoke from anon`
-- não tira o grant a PUBLIC que o Postgres dá na criação. `authenticated` entra
-- porque nenhuma tela chama estas funções com a sessão do usuário — grant ali
-- seria superfície morta.
revoke execute on function public.fn_podar_fila_de_jobs(int, int)
  from public, anon, authenticated;
grant execute on function public.fn_podar_fila_de_jobs(int, int) to service_role;

revoke execute on function public.fn_expurgar_auditoria_vencida(int, int)
  from public, anon, authenticated;
grant execute on function public.fn_expurgar_auditoria_vencida(int, int) to service_role;

-- O COMMENT da tabela afirmava um mundo que nunca existiu ("Retencao 5 anos",
-- sem nada que a executasse). Passa a dizer o que o schema de fato faz, e a
-- apontar para quem faz — afirmação de estado que envelhece vira ponteiro.
comment on table public.api_audit_log is
  'L-10: append-only (sem GRANT de UPDATE/DELETE a ninguém). Retenção default 5 anos, '
  'expurgada por public.fn_expurgar_auditoria_vencida (piso de 90 dias) a partir do cron '
  'app/api/v1/cron/data-retention. Não há camada cold/S3.';

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Adicionar a linha no MANIFEST**

Adicionar, ao final da tabela "Applied" em `supabase/migrations/MANIFEST.md` (depois da linha `0176_licenciamento_por_tenant`, antes da nota "Nota sobre a fusão de 2026-09-02"):

```markdown
| `20260910100000` | `0177_poda_da_fila_e_expurgo_do_audit` | **`job_queue` (status terminal: done/failed/dead) e `api_audit_log` (vencida) ganham poda/expurgo automático.** Duas funções `security definer` (`fn_podar_fila_de_jobs`, `fn_expurgar_auditoria_vencida`) fazem o DELETE em lotes; o TypeScript (`app/api/v1/cron/data-retention`) só decide o relógio. `job_queue` preserva `pending`/`running` e qualquer `dead` com aviso ABERTO em `agent_inbox_items` (anti-join antes do `limit`, senão o lote morre de fome com backlog protegido na frente). `api_audit_log` não tinha DELETE/UPDATE concedido a ninguém — daí a `security definer`, sem seletor de linha (só idade) e com piso de 90 dias dentro do corpo da função. Índices `idx_job_queue_poda`/`idx_audit_expurgo_created_at`/`idx_agent_inbox_items_ref_aberto` para o corte não virar seq scan diário. Adota o núcleo da migration `0167` do DeskcommCRM upstream (job_queue + api_audit_log), sem o espelho de Google Calendar / nonces OAuth / cascata LGPD que o upstream acrescentou depois — dependências que não existem neste fork. |
```

- [ ] **Step 3: Apêndice idempotente no `supabase/baseline.sql`**

No FIM do arquivo `supabase/baseline.sql` (depois do último bloco existente, o da migration 0176), acrescentar:

```sql

-- ---- poda da fila e expurgo do audit (migration 0177) ----
create index if not exists idx_job_queue_poda
  on public.job_queue (created_at)
  where status in ('done', 'failed', 'dead');

create index if not exists idx_audit_expurgo_created_at
  on public.api_audit_log (created_at);

create index if not exists idx_agent_inbox_items_ref_aberto
  on public.agent_inbox_items (ref_kind, ref_id)
  where status = 'open';

create or replace function public.fn_podar_fila_de_jobs(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias int := greatest(coalesce(p_retencao_dias, 90), 7);
  v_limite int := least(greatest(coalesce(p_limite, 1000), 1), 10000);
  v_apagados int;
begin
  with candidatos as (
    select j.id
      from public.job_queue j
     where j.status in ('done', 'failed', 'dead')
       and j.created_at < now() - make_interval(days => v_dias)
       and not exists (
         select 1
           from public.agent_inbox_items i
          where i.ref_kind = 'job_queue'
            and i.ref_id = j.id
            and i.status = 'open'
       )
     order by j.created_at
     limit v_limite
  )
  delete from public.job_queue j
   using candidatos c
   where j.id = c.id;
  get diagnostics v_apagados = row_count;
  return v_apagados;
end;
$$;

create or replace function public.fn_expurgar_auditoria_vencida(
  p_retencao_dias int default null,
  p_limite int default null
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dias int := greatest(coalesce(p_retencao_dias, 1825), 90);
  v_limite int := least(greatest(coalesce(p_limite, 1000), 1), 10000);
  v_apagadas int;
begin
  with vencidas as (
    select a.id
      from public.api_audit_log a
     where a.created_at < now() - make_interval(days => v_dias)
     order by a.created_at
     limit v_limite
  )
  delete from public.api_audit_log a
   using vencidas v
   where a.id = v.id;
  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end;
$$;

revoke execute on function public.fn_podar_fila_de_jobs(int, int)
  from public, anon, authenticated;
grant execute on function public.fn_podar_fila_de_jobs(int, int) to service_role;

revoke execute on function public.fn_expurgar_auditoria_vencida(int, int)
  from public, anon, authenticated;
grant execute on function public.fn_expurgar_auditoria_vencida(int, int) to service_role;

comment on table public.api_audit_log is
  'L-10: append-only (sem GRANT de UPDATE/DELETE a ninguém). Retenção default 5 anos, '
  'expurgada por public.fn_expurgar_auditoria_vencida (piso de 90 dias) a partir do cron '
  'app/api/v1/cron/data-retention. Não há camada cold/S3.';

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260910100000_0177_poda_da_fila_e_expurgo_do_audit.sql supabase/migrations/MANIFEST.md supabase/baseline.sql
git commit -m "feat(retencao): fn_podar_fila_de_jobs e fn_expurgar_auditoria_vencida (migration 0177)"
```

(A Task 6 valida isto contra Postgres real via `pnpm test:db` — não declare esta task "pronta" antes disso rodar verde.)

---

## Task 2: `lib/retencao/politica.ts` — a regra pura, sem banco e sem env

**Files:**
- Create: `lib/retencao/politica.ts`
- Test: `tests/unit/retencao-poda-em-lotes.test.ts` (só o describe `interpretarRetencao` nesta task — o resto vem na Task 5)

**Interfaces:**
- Produces: `RETENCAO_FILA_DIAS_PADRAO = 90`, `RETENCAO_FILA_DIAS_PISO = 7`, `RETENCAO_AUDITORIA_DIAS_PADRAO = 1825`, `RETENCAO_AUDITORIA_DIAS_PISO = 90`, `interpretarRetencao(bruto: string | undefined, opcoes: { chave: string; padrao: number; piso: number }): { dias: number; aviso: string | null }`. Consumido pela Task 5 (`app/api/v1/cron/data-retention/route.ts`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/retencao-poda-em-lotes.test.ts` com só este describe por ora (as outras describes chegam na Task 5, que importa de `@/app/api/v1/cron/data-retention/route` — arquivo que ainda não existe):

```ts
import { describe, expect, it } from "vitest";

import { interpretarRetencao } from "@/lib/retencao/politica";

describe("interpretarRetencao — o knob nunca derruba o produto", () => {
  it("ausente ou vazio devolve o padrão, sem aviso", () => {
    // É o caminho de toda instalação que nunca editou `.env` — a doutrina de
    // packaging exige que ele funcione sem edição manual de arquivo.
    for (const bruto of [undefined, "", "   "]) {
      const r = interpretarRetencao(bruto, { chave: "K", padrao: 90, piso: 7 });
      expect(r).toEqual({ dias: 90, aviso: null });
    }
  });

  it("lixo devolve o padrão COM aviso — nunca a frase tranquilizadora", () => {
    for (const bruto of ["noventa", "90d", "-1", "0", "1.5", "NaN"]) {
      const r = interpretarRetencao(bruto, { chave: "K", padrao: 90, piso: 7 });
      expect(r.dias, `entrada ${bruto}`).toBe(90);
      expect(r.aviso, `entrada ${bruto} sem aviso`).toContain("K=");
    }
  });

  it("valor abaixo do piso é ELEVADO, com aviso", () => {
    const r = interpretarRetencao("2", { chave: "K", padrao: 90, piso: 7 });
    expect(r.dias).toBe(7);
    expect(r.aviso).toContain("piso");
  });

  it("valor válido passa inteiro, sem aviso", () => {
    expect(interpretarRetencao("400", { chave: "K", padrao: 90, piso: 7 })).toEqual({
      dias: 400,
      aviso: null,
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `NEXT_PUBLIC_SUPABASE_URL=https://test-placeholder.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x pnpm vitest run tests/unit/retencao-poda-em-lotes.test.ts --no-file-parallelism`
Expected: FAIL — `Cannot find module '@/lib/retencao/politica'`

(As três env vars na frente do comando contornam um `.env.local` local com `NEXT_PUBLIC_SUPABASE_URL` vazio, que faz o `??=` de `tests/setup/vitest.setup.ts` não aplicar o placeholder — problema de ambiente local, não do teste.)

- [ ] **Step 3: Implementar `lib/retencao/politica.ts`**

```ts
/**
 * A política de retenção — regra PURA, sem banco e sem env, para a poda da
 * fila e o expurgo da auditoria.
 *
 * ─── Por que um módulo, e não `z.coerce.number()` em `lib/env.ts` ───────────
 *
 * `lib/env.ts` LANÇA quando o schema recusa, e no Next isso acontece na
 * primeira requisição — com healthcheck TCP puro, o contêiner fica `healthy`
 * com 100% das respostas em 500. É a mesma armadilha documentada em
 * `AI_BUDGET_ENFORCEMENT`: um `z.coerce.number().int().positive()` aqui
 * transformaria `JOB_QUEUE_RETENTION_DAYS=noventa` — digitado às 2h por quem
 * está tentando liberar espaço — no derrubador do produto inteiro. As duas
 * chaves entram como `z.string()` e são interpretadas AQUI, onde lixo resolve
 * para o lado seguro.
 *
 * ─── O piso não é sugestão ──────────────────────────────────────────────────
 *
 * Este módulo devolve o número que o CHAMADOR pede ao banco; o piso de
 * verdade mora dentro de `fn_podar_fila_de_jobs` e `fn_expurgar_auditoria_
 * vencida` (`greatest(..., piso)`), porque só lá ele vale para QUALQUER
 * chamador — inclusive um `psql` na mão. Repeti-lo aqui serve para outra
 * coisa: para o operador ver no log que o valor dele foi elevado, em vez de
 * descobrir pela ausência de efeito. `tests/invariants/retencao-poda-e-
 * expurgo.test.ts` mede o lado do banco; `tests/unit/retencao-poda-em-
 * lotes.test.ts` mede este.
 */

/** 90 dias. Longe o bastante do horizonte em que "1º outbound" ainda diz algo. */
export const RETENCAO_FILA_DIAS_PADRAO = 90;
/** Piso da fila: abaixo disso a cascata em `send_ledger` alcança lead vivo. */
export const RETENCAO_FILA_DIAS_PISO = 7;
/** 1825 dias = os 5 anos da regra L-10 (`docs/business-rules`). */
export const RETENCAO_AUDITORIA_DIAS_PADRAO = 1825;
/** Piso da auditoria: o knob nunca vira apagador de rastro recente. */
export const RETENCAO_AUDITORIA_DIAS_PISO = 90;

export interface RetencaoInterpretada {
  /** Dias a pedir ao banco. Nunca abaixo do piso, nunca `NaN`. */
  readonly dias: number;
  /**
   * Frase pronta quando o valor do operador NÃO foi usado como escrito.
   * `null` quando a chave está ausente (o caso normal) ou foi aceita inteira.
   * Nunca a frase tranquilizadora: se o número dele não valeu, o log diz.
   */
  readonly aviso: string | null;
}

/**
 * Interpreta o valor cru de uma variável de ambiente de retenção.
 *
 * Ausente ou vazio → o padrão, sem aviso (é o caminho de toda instalação que
 * nunca editou `.env`, e a doutrina de packaging exige que ele funcione).
 * Não-numérico, zero ou negativo → o padrão, COM aviso.
 * Abaixo do piso → o piso, COM aviso.
 */
export function interpretarRetencao(
  bruto: string | undefined,
  opcoes: { readonly chave: string; readonly padrao: number; readonly piso: number },
): RetencaoInterpretada {
  const texto = (bruto ?? "").trim();
  if (texto === "") return { dias: opcoes.padrao, aviso: null };

  // `Number()` e não `parseInt`: `parseInt("90dias")` devolve 90 em silêncio, e
  // aceitar sufixo faria `JOB_QUEUE_RETENTION_DAYS=90d` virar 90 sem o operador
  // saber que o `d` foi ignorado. Aqui ele é lixo, e lixo tem aviso.
  const numero = Number(texto);
  if (!Number.isFinite(numero) || !Number.isInteger(numero) || numero <= 0) {
    return {
      dias: opcoes.padrao,
      aviso:
        `${opcoes.chave}="${texto}" não é um número inteiro de dias — ` +
        `usando o padrão de ${opcoes.padrao} dias.`,
    };
  }

  if (numero < opcoes.piso) {
    return {
      dias: opcoes.piso,
      aviso:
        `${opcoes.chave}=${numero} está abaixo do piso de ${opcoes.piso} dias — ` +
        `usando ${opcoes.piso}.`,
    };
  }

  return { dias: numero, aviso: null };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `NEXT_PUBLIC_SUPABASE_URL=https://test-placeholder.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x pnpm vitest run tests/unit/retencao-poda-em-lotes.test.ts --no-file-parallelism`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/retencao/politica.ts tests/unit/retencao-poda-em-lotes.test.ts
git commit -m "feat(retencao): interpretarRetencao — a regra pura do knob de dias"
```

---

## Task 3: Env vars — `JOB_QUEUE_RETENTION_DAYS` / `AUDIT_LOG_RETENTION_DAYS`

**Files:**
- Modify: `lib/env.ts:180-182` (bloco LGPD, adicionar logo depois)
- Modify: `.env.example:20` (seção "Cron / interno", adicionar logo depois)

**Interfaces:**
- Produces: `env.JOB_QUEUE_RETENTION_DAYS: string`, `env.AUDIT_LOG_RETENTION_DAYS: string` (ambas `z.string().optional().default("")`). Consumido pela Task 5 (`handle()` em `app/api/v1/cron/data-retention/route.ts`) e pela Task 8 (mock de `@/lib/env` no teste de AST).

- [ ] **Step 1: `lib/env.ts` — adicionar as duas chaves**

Localizar (por volta da linha 180):

```ts
  // LGPD export (S-08.04)
  LGPD_SIGNING_KEY: z.string().optional().default(""),
  LGPD_EXPORT_EXPIRES_HOURS: z.string().optional().default("72"),
  LGPD_DPO_EMAIL: z.string().optional().default(""),
```

Substituir por (acrescenta o bloco novo logo abaixo):

```ts
  // LGPD export (S-08.04)
  LGPD_SIGNING_KEY: z.string().optional().default(""),
  LGPD_EXPORT_EXPIRES_HOURS: z.string().optional().default("72"),
  LGPD_DPO_EMAIL: z.string().optional().default(""),

  // Poda de job_queue / expurgo de api_audit_log (cron data-retention).
  // z.string() de propósito, nunca z.coerce.number(): o piso de verdade mora
  // DENTRO de fn_podar_fila_de_jobs/fn_expurgar_auditoria_vencida, e um valor
  // digitado errado aqui não pode derrubar o boot — lib/retencao/politica.ts
  // interpreta o texto cru e cai pro padrão quando é lixo.
  JOB_QUEUE_RETENTION_DAYS: z.string().optional().default(""),
  AUDIT_LOG_RETENTION_DAYS: z.string().optional().default(""),
```

- [ ] **Step 2: `.env.example` — adicionar as duas chaves**

Localizar:

```
# --- Cron / interno ----------------------------------------------------------
# Bearer secret pros endpoints /api/v1/cron/*. DIFERENTE do service role key.
INTERNAL_SECRET=
# Secret dedicado opcional pros endpoints de cron. Se vazio, cai pra INTERNAL_SECRET.
INTERNAL_CRON_SECRET=
```

Substituir por:

```
# --- Cron / interno ----------------------------------------------------------
# Bearer secret pros endpoints /api/v1/cron/*. DIFERENTE do service role key.
INTERNAL_SECRET=
# Secret dedicado opcional pros endpoints de cron. Se vazio, cai pra INTERNAL_SECRET.
INTERNAL_CRON_SECRET=
# Dias de retenção da fila (job_queue, status done/failed/dead) antes do cron
# data-retention apagar. Vazio = 90 dias. Piso de 7 dias mora no banco (função
# fn_podar_fila_de_jobs) — este valor nunca derruba a poda, só a ajusta.
JOB_QUEUE_RETENTION_DAYS=90
# Dias de retenção do audit log antes do expurgo (regra L-10 = 5 anos). Vazio =
# 1825 dias. Piso de 90 dias mora no banco (fn_expurgar_auditoria_vencida).
AUDIT_LOG_RETENTION_DAYS=1825
```

- [ ] **Step 3: Confirmar que o typecheck e o gate de sincronia passam**

Run: `npx tsc --noEmit -p .`
Expected: sem erro novo relativo a `lib/env.ts`

Run: `NEXT_PUBLIC_SUPABASE_URL=https://test-placeholder.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x pnpm vitest run tests/unit/env-example-sync.test.ts --no-file-parallelism`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/env.ts .env.example
git commit -m "feat(retencao): JOB_QUEUE_RETENTION_DAYS e AUDIT_LOG_RETENTION_DAYS"
```

---

## Task 4: `lib/audit/actions.ts` — nova ação `retention.sweep_run`

**Files:**
- Modify: `lib/audit/actions.ts:190-192`

**Interfaces:**
- Produces: `"retention.sweep_run"` como literal válido no array `AUDIT_ACTIONS` (nome exato do tipo/const pode ser conferido no arquivo — é o mesmo array que já contém `"routing.worker_run"`/`"attendant.heartbeat_swept"`). Consumido pela Task 5 (`audit({ action: "retention.sweep_run", ... })`).

- [ ] **Step 1: Adicionar a linha**

Localizar:

```ts
  "routing.worker_run",
  "attendant.heartbeat_swept",
```

Substituir por:

```ts
  "routing.worker_run",
  "attendant.heartbeat_swept",
  "retention.sweep_run",
```

- [ ] **Step 2: Confirmar typecheck**

Run: `npx tsc --noEmit -p .`
Expected: sem erro novo

- [ ] **Step 3: Commit**

```bash
git add lib/audit/actions.ts
git commit -m "feat(retencao): retention.sweep_run em AUDIT_ACTIONS"
```

---

## Task 5: `app/api/v1/cron/data-retention/route.ts` — o relógio e o laço de lotes

**Files:**
- Create: `app/api/v1/cron/data-retention/route.ts`
- Modify: `tests/unit/retencao-poda-em-lotes.test.ts` (acrescentar as describes `podarHistorico`, `houveEfeito`, "os pisos do TypeScript e os do SQL", "o handler HTTP" — a describe `interpretarRetencao` da Task 2 fica)

**Interfaces:**
- Consumes: `interpretarRetencao`, `RETENCAO_FILA_DIAS_PADRAO`, `RETENCAO_FILA_DIAS_PISO`, `RETENCAO_AUDITORIA_DIAS_PADRAO`, `RETENCAO_AUDITORIA_DIAS_PISO` de `@/lib/retencao/politica` (Task 2); `env.JOB_QUEUE_RETENTION_DAYS`, `env.AUDIT_LOG_RETENTION_DAYS`, `env.INTERNAL_CRON_SECRET`, `env.INTERNAL_SECRET` de `@/lib/env` (Task 3); ação `"retention.sweep_run"` de `@/lib/audit/actions.ts` (Task 4).
- Produces: `export const TAMANHO_DO_LOTE = 1000`, `export const MAX_LOTES = 20`, `export interface PodaDb { rpc(...) }`, `export async function podarHistorico(db: PodaDb, ambiente: {...}): Promise<ResultadoDaRetencao>`, `export function houveEfeito(resultado: ResultadoDaRetencao): boolean`, `export async function GET/POST(req: NextRequest): Promise<Response>`. Consumido pela Task 8 (comportamento HTTP de referência, mesmo padrão que routing-worker/attendant-heartbeat) e pelo `docker/scheduler/entrypoint.sh` (Task 7).

- [ ] **Step 1: Escrever os testes que falham (acrescentar ao arquivo da Task 2)**

Adicionar ao TOPO de `tests/unit/retencao-poda-em-lotes.test.ts` (antes do describe `interpretarRetencao` já existente), os imports e mocks:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET,
  MAX_LOTES,
  type PodaDb,
  TAMANHO_DO_LOTE,
  houveEfeito,
  podarHistorico,
} from "@/app/api/v1/cron/data-retention/route";
import {
  RETENCAO_AUDITORIA_DIAS_PADRAO,
  RETENCAO_FILA_DIAS_PADRAO,
  RETENCAO_FILA_DIAS_PISO,
  interpretarRetencao,
} from "@/lib/retencao/politica";

vi.mock("@/lib/env", () => ({
  env: {
    INTERNAL_CRON_SECRET: "segredo",
    INTERNAL_SECRET: "",
    JOB_QUEUE_RETENTION_DAYS: "",
    AUDIT_LOG_RETENTION_DAYS: "",
  },
}));
const auditou = vi.fn();
vi.mock("@/lib/audit", () => ({ audit: (...args: unknown[]) => auditou(...args) }));

/** O que o `rpc` do admin client devolve nesta rodada (só o handler HTTP usa isto). */
let respostaRpc: { data: number | null; error: { message: string } | null } = {
  data: 0,
  error: null,
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => respostaRpc,
  }),
}));

/**
 * O LAÇO DE LOTES DA PODA.
 *
 * O DELETE em lotes não é preciosismo: um DELETE único num banco de cliente com
 * anos de histórico segura a tabela pelo tempo inteiro da varredura, e o
 * produto é instalado em VPS sem janela de manutenção. Três propriedades
 * sustentam isso, e as três são invisíveis a olho nu:
 *
 *   1. o laço PARA no primeiro lote incompleto (senão gasta uma ida ao banco a
 *      cada rodada só para ouvir zero, 1×/dia, para sempre);
 *   2. o laço tem TETO por invocação (senão a primeira rodada de uma instalação
 *      antiga segura o `curl` do cron até o timeout do crontab e deixa a última
 *      transação para o servidor abortar sozinho);
 *   3. quando o teto é atingido, o resultado DIZ que sobrou trabalho — silêncio
 *      aqui seria indistinguível de "acabou".
 *
 * A régua deste arquivo é a REGRA (o laço, o teto, a interpretação do knob). O
 * que o banco de fato apaga — e o que ele se recusa a apagar — é medido contra
 * um Postgres real em `tests/invariants/retencao-poda-e-expurgo.test.ts`.
 */
function bancoQueDevolve(sequencias: {
  fila: number[];
  auditoria: number[];
}): { db: PodaDb; chamadas: { nome: string; dias: number; limite: number }[] } {
  const chamadas: { nome: string; dias: number; limite: number }[] = [];
  const restante = { fila: [...sequencias.fila], auditoria: [...sequencias.auditoria] };
  const db: PodaDb = {
    async rpc(nome, args) {
      chamadas.push({ nome, dias: args.p_retencao_dias, limite: args.p_limite });
      const balde = nome === "fn_podar_fila_de_jobs" ? restante.fila : restante.auditoria;
      return { data: balde.shift() ?? 0, error: null };
    },
  };
  return { db, chamadas };
}
```

E acrescentar, DEPOIS do describe `interpretarRetencao` já existente:

```ts
describe("podarHistorico — o laço de lotes", () => {
  it("para no primeiro lote incompleto (não gasta uma ida a mais)", async () => {
    const { db, chamadas } = bancoQueDevolve({
      fila: [TAMANHO_DO_LOTE, 7],
      auditoria: [0],
    });
    const r = await podarHistorico(db, {});
    expect(r.jobs_apagados).toBe(TAMANHO_DO_LOTE + 7);
    expect(r.lotes_fila).toBe(2);
    expect(r.fila_tem_resto).toBe(false);
    expect(r.lotes_auditoria).toBe(1);
    expect(chamadas.filter((c) => c.nome === "fn_podar_fila_de_jobs")).toHaveLength(2);
  });

  it("respeita o teto por invocação e DECLARA que sobrou trabalho", async () => {
    const { db, chamadas } = bancoQueDevolve({
      fila: Array.from({ length: MAX_LOTES + 5 }, () => TAMANHO_DO_LOTE),
      auditoria: [0],
    });
    const r = await podarHistorico(db, {});
    expect(chamadas.filter((c) => c.nome === "fn_podar_fila_de_jobs")).toHaveLength(MAX_LOTES);
    expect(r.jobs_apagados).toBe(MAX_LOTES * TAMANHO_DO_LOTE);
    expect(r.fila_tem_resto).toBe(true);
  });

  it("pede ao banco os dias do padrão quando o .env está intocado", async () => {
    const { db, chamadas } = bancoQueDevolve({ fila: [0], auditoria: [0] });
    const r = await podarHistorico(db, {});
    expect(chamadas[0]).toEqual({
      nome: "fn_podar_fila_de_jobs",
      dias: RETENCAO_FILA_DIAS_PADRAO,
      limite: TAMANHO_DO_LOTE,
    });
    expect(chamadas[1]).toEqual({
      nome: "fn_expurgar_auditoria_vencida",
      dias: RETENCAO_AUDITORIA_DIAS_PADRAO,
      limite: TAMANHO_DO_LOTE,
    });
    expect(r.avisos).toEqual([]);
  });

  it("eleva ao piso o knob abaixo dele e devolve o aviso", async () => {
    const { db, chamadas } = bancoQueDevolve({ fila: [0], auditoria: [0] });
    const r = await podarHistorico(db, {
      JOB_QUEUE_RETENTION_DAYS: "1",
      AUDIT_LOG_RETENTION_DAYS: "0",
    });
    expect(chamadas[0]?.dias).toBe(RETENCAO_FILA_DIAS_PISO);
    // "0" é lixo (não-positivo), então cai no PADRÃO, não no piso — é a
    // diferença entre "escolheu pouco" e "escreveu bobagem".
    expect(chamadas[1]?.dias).toBe(RETENCAO_AUDITORIA_DIAS_PADRAO);
    expect(r.avisos).toHaveLength(2);
  });

  it("erro do banco sobe — a poda não engole falha em silêncio", async () => {
    const db: PodaDb = {
      async rpc() {
        return { data: null, error: { message: "permission denied for table api_audit_log" } };
      },
    };
    await expect(podarHistorico(db, {})).rejects.toThrow(/permission denied/);
  });
});

describe("houveEfeito — as duas direções", () => {
  const base = {
    jobs_apagados: 0,
    auditoria_apagada: 0,
    lotes_fila: 1,
    lotes_auditoria: 1,
    fila_tem_resto: false,
    auditoria_tem_resto: false,
    retencao_fila_dias: RETENCAO_FILA_DIAS_PADRAO,
    retencao_auditoria_dias: RETENCAO_AUDITORIA_DIAS_PADRAO,
    avisos: [] as string[],
  };

  it("rodada que não apagou nada NÃO ocupa linha de auditoria", () => {
    expect(houveEfeito(base)).toBe(false);
  });

  it("apagou job → audita; apagou auditoria → audita", () => {
    // A segunda é a que não pode se perder: é ela que faz o expurgo do audit
    // deixar rastro em vez de encolher a trilha em silêncio.
    expect(houveEfeito({ ...base, jobs_apagados: 1 })).toBe(true);
    expect(houveEfeito({ ...base, auditoria_apagada: 1 })).toBe(true);
  });
});

describe("os pisos do TypeScript e os do SQL são os mesmos números", () => {
  it("os quatro valores da política aparecem literalmente no baseline.sql", async () => {
    // Duas cópias de um piso é como um piso vira decorativo: o `.env.example`
    // documenta um número, a função do banco aplica outro, e ninguém percebe
    // porque os dois lados continuam "funcionando".
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(join(__dirname, "..", "..", "supabase", "baseline.sql"), "utf8");
    const bloco = sql.slice(sql.indexOf("-- ---- poda da fila e expurgo do audit (migration 0177)"));
    expect(bloco.length).toBeGreaterThan(500);
    expect(bloco).toContain(
      `greatest(coalesce(p_retencao_dias, ${RETENCAO_FILA_DIAS_PADRAO}), ${RETENCAO_FILA_DIAS_PISO})`,
    );
    expect(bloco).toContain(
      `greatest(coalesce(p_retencao_dias, ${RETENCAO_AUDITORIA_DIAS_PADRAO}), 90)`,
    );
  });
});

describe("o handler HTTP — a falha entra na trilha, o vazio não", () => {
  function requisicaoAutorizada(): Parameters<typeof GET>[0] {
    // O handler só lê `headers.get("authorization")`.
    return { headers: new Headers({ authorization: "Bearer segredo" }) } as never;
  }

  beforeEach(() => {
    auditou.mockClear();
  });

  it("rodada que não apagou nada responde 200 e NÃO audita", async () => {
    respostaRpc = { data: 0, error: null };
    const resposta = await GET(requisicaoAutorizada());
    expect(resposta.status).toBe(200);
    expect(auditou).not.toHaveBeenCalled();
  });

  it("rodada que apagou AUDITA — o expurgo do audit deixa rastro", async () => {
    respostaRpc = { data: 7, error: null };
    await GET(requisicaoAutorizada());
    expect(auditou).toHaveBeenCalledTimes(1);
    expect(auditou.mock.calls[0]?.[0]).toMatchObject({
      action: "retention.sweep_run",
      metadata: { jobs_apagados: 7 },
    });
  });

  it("rodada que FALHOU responde 500 e AUDITA a falha", async () => {
    respostaRpc = { data: null, error: { message: "permission denied for table api_audit_log" } };
    const resposta = await GET(requisicaoAutorizada());
    expect(resposta.status).toBe(500);
    expect(auditou).toHaveBeenCalledTimes(1);
    expect(auditou.mock.calls[0]?.[0]).toMatchObject({
      action: "retention.sweep_run",
      metadata: { falhou: true },
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `NEXT_PUBLIC_SUPABASE_URL=https://test-placeholder.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x pnpm vitest run tests/unit/retencao-poda-em-lotes.test.ts --no-file-parallelism`
Expected: FAIL — `Cannot find module '@/app/api/v1/cron/data-retention/route'`

- [ ] **Step 3: Implementar a rota**

```ts
/**
 * GET/POST /api/v1/cron/data-retention.
 *
 * As duas tabelas que crescem sozinhas numa instalação parada — `job_queue` e
 * `api_audit_log` — não tinham poda nenhuma:
 *
 *     $ grep -rn "from job_queue" lib workers app supabase scripts | grep -i delete
 *     (zero linhas)
 *
 * E a retenção de 5 anos do audit existia só no `COMMENT ON TABLE` e em seis
 * documentos. O plano free do Supabase limita 500 MB de banco: estas duas
 * estouram antes de qualquer tabela de negócio, e o bloat ainda cobra CPU no
 * `count(*)` do claim de fila.
 *
 * O que ele faz, e o que deliberadamente NÃO faz:
 *
 *   - chama `fn_podar_fila_de_jobs` e `fn_expurgar_auditoria_vencida` EM LOTES.
 *     Um DELETE grande num banco de cliente trava a tabela e o tempo do lock
 *     cresce com o backlog; lotes de `TAMANHO_DO_LOTE` fecham a transação a cada
 *     rodada e o backlog drena ao longo de vários dias, sem janela de manutenção;
 *   - **não decide o que é podável.** As duas regras (quais status são terminais,
 *     o que ainda tem dono, o piso da retenção) moram DENTRO das funções do
 *     banco, porque lá elas valem para qualquer chamador — inclusive um `psql`
 *     na mão. Este arquivo é só o relógio e o laço;
 *   - **não faz VACUUM.** Espaço liberado por DELETE volta a ser reutilizável
 *     pelo autovacuum, mas só um `VACUUM FULL` (que trava a tabela) o devolve ao
 *     sistema de arquivos. Rodar isso sozinho num banco de cliente, de
 *     madrugada, sem ninguém olhando, é pior que a cota apertada;
 *   - **não audita rodada vazia.** Varredura que não apagou nada não é mutação
 *     (mesmo critério do snooze-watcher e do recover-stuck-messages). A ÚNICA
 *     exceção é a rodada que FALHOU: sem ela, uma poda que parou de funcionar
 *     num clone ficaria idêntica, na trilha, a uma poda sem nada a fazer.
 *
 * Auth: mesmo contrato dos demais crons (Bearer INTERNAL_CRON_SECRET|
 * INTERNAL_SECRET, fail-closed).
 *
 * NOTA DE DEPLOY: não há `vercel.json` neste repo (self-host). O agendamento
 * vive no serviço `scheduler` (`docker/scheduler/entrypoint.sh`), diário.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  RETENCAO_AUDITORIA_DIAS_PADRAO,
  RETENCAO_AUDITORIA_DIAS_PISO,
  RETENCAO_FILA_DIAS_PADRAO,
  RETENCAO_FILA_DIAS_PISO,
  interpretarRetencao,
} from "@/lib/retencao/politica";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Linhas por transação. Pequeno o bastante para o lock não ser sentido por quem
 * está usando o sistema, grande o bastante para drenar um backlog de anos em
 * poucos dias de rodadas.
 */
export const TAMANHO_DO_LOTE = 1000;

/**
 * Teto de lotes POR TABELA e por invocação. Sem ele, a primeira rodada numa
 * instalação antiga tentaria apagar tudo de uma vez e seguraria a conexão do
 * cron até o `curl` desistir — deixando a transação do último lote para o
 * servidor abortar sozinho.
 */
export const MAX_LOTES = 20;

export interface ResultadoDaRetencao {
  jobs_apagados: number;
  auditoria_apagada: number;
  lotes_fila: number;
  lotes_auditoria: number;
  /** O último lote veio cheio e o teto foi atingido: sobrou trabalho para amanhã. */
  fila_tem_resto: boolean;
  auditoria_tem_resto: boolean;
  retencao_fila_dias: number;
  retencao_auditoria_dias: number;
  /** Avisos de configuração — nunca ausentes em silêncio quando existem. */
  avisos: string[];
}

/** Só a superfície que este cron usa — o teste injeta uma implementação. */
export interface PodaDb {
  rpc(
    nome: "fn_podar_fila_de_jobs" | "fn_expurgar_auditoria_vencida",
    args: { p_retencao_dias: number; p_limite: number },
  ): Promise<{ data: number | null; error: { message: string } | null }>;
}

async function drenar(
  db: PodaDb,
  nome: "fn_podar_fila_de_jobs" | "fn_expurgar_auditoria_vencida",
  dias: number,
): Promise<{ apagadas: number; lotes: number; temResto: boolean }> {
  let apagadas = 0;
  let lotes = 0;
  for (let i = 0; i < MAX_LOTES; i += 1) {
    const { data, error } = await db.rpc(nome, {
      p_retencao_dias: dias,
      p_limite: TAMANHO_DO_LOTE,
    });
    if (error) throw new Error(`${nome}: ${error.message}`);
    const n = data ?? 0;
    lotes += 1;
    apagadas += n;
    // Lote incompleto = a ponta velha acabou. Encerra sem gastar mais uma ida
    // ao banco só para ouvir zero.
    if (n < TAMANHO_DO_LOTE) return { apagadas, lotes, temResto: false };
  }
  return { apagadas, lotes, temResto: true };
}

/**
 * Separado do handler HTTP para o teste exercitar a REGRA (o laço de lotes, o
 * teto, o corte no lote incompleto) sem montar request/auth — mesmo desenho de
 * `recoverStuckMessages`.
 */
export async function podarHistorico(
  db: PodaDb,
  ambiente: {
    JOB_QUEUE_RETENTION_DAYS?: string;
    AUDIT_LOG_RETENTION_DAYS?: string;
  },
): Promise<ResultadoDaRetencao> {
  const fila = interpretarRetencao(ambiente.JOB_QUEUE_RETENTION_DAYS, {
    chave: "JOB_QUEUE_RETENTION_DAYS",
    padrao: RETENCAO_FILA_DIAS_PADRAO,
    piso: RETENCAO_FILA_DIAS_PISO,
  });
  const auditoria = interpretarRetencao(ambiente.AUDIT_LOG_RETENTION_DAYS, {
    chave: "AUDIT_LOG_RETENTION_DAYS",
    padrao: RETENCAO_AUDITORIA_DIAS_PADRAO,
    piso: RETENCAO_AUDITORIA_DIAS_PISO,
  });

  const jobs = await drenar(db, "fn_podar_fila_de_jobs", fila.dias);
  const linhas = await drenar(db, "fn_expurgar_auditoria_vencida", auditoria.dias);

  return {
    jobs_apagados: jobs.apagadas,
    auditoria_apagada: linhas.apagadas,
    lotes_fila: jobs.lotes,
    lotes_auditoria: linhas.lotes,
    fila_tem_resto: jobs.temResto,
    auditoria_tem_resto: linhas.temResto,
    retencao_fila_dias: fila.dias,
    retencao_auditoria_dias: auditoria.dias,
    avisos: [fila.aviso, auditoria.aviso].filter((a): a is string => a !== null),
  };
}

/**
 * A rodada mexeu em alguma coisa? É o que decide se ela ocupa uma linha de
 * auditoria. Exportada para o teste medir as DUAS direções — "não audita quando
 * não fez nada" sozinho é satisfeito por um cron que nunca audita.
 */
export function houveEfeito(resultado: ResultadoDaRetencao): boolean {
  return resultado.jobs_apagados > 0 || resultado.auditoria_apagada > 0;
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  let resultado: ResultadoDaRetencao;
  try {
    const admin = createAdminClient();
    // As duas funções são novas e não estão em `lib/database.types.ts` (gerado a
    // partir de um projeto Supabase vivo) — mesmo tratamento que
    // `recover-stuck-messages` dá a `emit_event`.
    const db: PodaDb = {
      async rpc(nome, args) {
        const { data, error } = await admin.rpc(nome as never, args as never);
        return { data: typeof data === "number" ? data : null, error };
      },
    };
    resultado = await podarHistorico(db, {
      JOB_QUEUE_RETENTION_DAYS: env.JOB_QUEUE_RETENTION_DAYS,
      AUDIT_LOG_RETENTION_DAYS: env.AUDIT_LOG_RETENTION_DAYS,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("[data-retention] poda falhou", { error: detail, requestId });
    // A falha ENTRA na trilha, e é o único caso em que uma rodada que não apagou
    // nada audita. Sem esta linha, uma poda que parou de funcionar — grants que
    // não vieram no `update.sh` de um clone, função ausente — seria
    // indistinguível de uma poda sem nada a fazer.
    void audit({
      action: "retention.sweep_run",
      organizationId: null,
      bypassedRls: true,
      metadata: { falhou: true, erro: detail.slice(0, 300) },
      requestId,
    });
    return fail("internal_error", "Failed to prune history.", 500, { requestId });
  }

  for (const aviso of resultado.avisos) {
    logger.warn("[data-retention] configuração de retenção ajustada", { aviso, requestId });
  }

  // Rodada que não apagou nada não é mutação. Rodada que apagou SEMPRE deixa
  // rastro — é isto que impede o expurgo do audit de ser encolhimento
  // silencioso da própria trilha.
  if (houveEfeito(resultado)) {
    void audit({
      action: "retention.sweep_run",
      organizationId: null,
      bypassedRls: true,
      metadata: resultado as unknown as Record<string, unknown>,
      requestId,
    });
  }

  return ok(resultado, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `NEXT_PUBLIC_SUPABASE_URL=https://test-placeholder.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x pnpm vitest run tests/unit/retencao-poda-em-lotes.test.ts --no-file-parallelism`
Expected: PASS (todas as describes, ~16 testes)

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/cron/data-retention/route.ts tests/unit/retencao-poda-em-lotes.test.ts
git commit -m "feat(retencao): rota /api/v1/cron/data-retention"
```

---

## Task 6: Invariante contra Postgres real

**Files:**
- Create: `tests/invariants/retencao-poda-e-expurgo.test.ts`

**Interfaces:**
- Consumes: `lastLine`, `sql` de `./gov-helpers` (já existe em `tests/invariants/gov-helpers.ts`); as funções `public.fn_podar_fila_de_jobs`/`public.fn_expurgar_auditoria_vencida` criadas na Task 1.

- [ ] **Step 1: Criar o arquivo de teste**

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * A PODA DA FILA E O EXPURGO DA AUDITORIA CONTRA UM POSTGRES DE VERDADE.
 *
 * ─── Por que invariante e não unidade ───────────────────────────────────────
 *
 * O que pode quebrar aqui é SQL, e as regras que importam só existem no banco:
 * quais status são terminais, o anti-join contra o aviso ainda aberto, o piso
 * dentro do corpo da função, a cascata das FKs e — a mais importante — o
 * privilégio de quem pode chamar. Nenhuma dessas propriedades é observável de
 * um mock. Roda contra o Postgres efêmero do `scripts/test-db.sh`, com o MESMO
 * `baseline.sql` que o kit self-host aplica.
 *
 * ─── O risco do conserto, que é o que este arquivo vigia ────────────────────
 *
 * Uma poda mal cortada PERDE TRABALHO. `pending` é trabalho que ainda vai sair;
 * `running` está com um worker agora. E `dead` com aviso ABERTO na Central tem
 * dono também: um humano que ainda não olhou. Um DELETE por idade que não
 * distinga essas três coisas é pior que a tabela crescendo.
 */

const ORG = "26100000-0000-4000-8000-000000000001";
const CONTATO = "26100000-0000-4000-8000-000000000002";

/** Um id determinístico por caso — sem colisão entre os testes deste arquivo. */
function id(n: number): string {
  return `26100000-1111-4000-8000-${String(n).padStart(12, "0")}`;
}

function conta(query: string): number {
  return Number(lastLine(sql(query)));
}

/**
 * `idade` em dias ANTES de agora. `status` decide o `kind` porque o CHECK
 * `job_queue_turn_needs_contact` amarra kind ⇔ contato — a poda não olha kind
 * nenhum, então usar `inbound_turn` em todos os casos é indiferente para a regra.
 */
function enfileirar(opts: { id: string; status: string; idadeDias: number }): void {
  sql(`
    insert into job_queue (id, organization_id, contact_id, kind, payload, status, created_at)
    values ('${opts.id}', '${ORG}', '${CONTATO}', 'inbound_turn', '{}'::jsonb,
            '${opts.status}', now() - interval '${opts.idadeDias} days');
  `);
}

beforeEach(() => {
  sql(`
    insert into organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'org-retencao-0177', 'Org Retencao LTDA', 'Org Retencao')
      on conflict (id) do nothing;
    insert into contacts (id, organization_id, name, phone_number)
      values ('${CONTATO}', '${ORG}', 'Lead da Poda', '+258840000177')
      on conflict (id) do nothing;
    delete from agent_inbox_items where organization_id = '${ORG}';
    delete from job_queue where organization_id = '${ORG}';
    delete from api_audit_log where organization_id = '${ORG}';
  `);
});

describe("fn_podar_fila_de_jobs — apaga o terminal velho, preserva o que tem dono", () => {
  it("controle positivo: a função existe e devolve inteiro", () => {
    // Sem isto, uma função ausente faria os casos de "não apagou" passarem por
    // vacuidade — zero apagados é verdade quando nada roda.
    expect(conta(`select public.fn_podar_fila_de_jobs(90, 100)`)).toBeGreaterThanOrEqual(0);
  });

  it("apaga done/failed/dead velhos e NÃO toca em pending/running", () => {
    enfileirar({ id: id(1), status: "done", idadeDias: 200 });
    enfileirar({ id: id(2), status: "failed", idadeDias: 200 });
    enfileirar({ id: id(3), status: "dead", idadeDias: 200 });
    // `pending` e `running` com a MESMA idade: se a regra fosse só idade, os
    // cinco sairiam juntos. É o corte por status que este caso mede.
    enfileirar({ id: id(4), status: "pending", idadeDias: 200 });
    enfileirar({ id: id(5), status: "running", idadeDias: 200 });

    const apagados = conta(`select public.fn_podar_fila_de_jobs(90, 1000)`);
    expect(apagados).toBe(3);

    const sobraram = sql(
      `select string_agg(status, ',' order by status) from job_queue where organization_id = '${ORG}'`,
    );
    expect(lastLine(sobraram)).toBe("pending,running");
  });

  it("NÃO apaga terminal recente (o corte é por idade, e é por created_at)", () => {
    enfileirar({ id: id(6), status: "done", idadeDias: 10 });
    expect(conta(`select public.fn_podar_fila_de_jobs(90, 1000)`)).toBe(0);
    expect(conta(`select count(*) from job_queue where id = '${id(6)}'`)).toBe(1);
  });

  it("NÃO apaga `dead` cujo aviso na Central ainda está ABERTO", () => {
    // `failJob`/`reapExpiredJobs` abrem `agent_inbox_items` com
    // ref_kind='job_queue' e ref_id = job.id. Apagar o job deixaria o aviso
    // apontando para o vazio — e quem ia investigar perde o objeto.
    enfileirar({ id: id(7), status: "dead", idadeDias: 400 });
    enfileirar({ id: id(8), status: "dead", idadeDias: 400 });
    sql(`
      insert into agent_inbox_items (organization_id, kind, severity, title, ref_kind, ref_id, status)
      values ('${ORG}', 'job_dead', 'critical', 'Job descartado', 'job_queue', '${id(7)}', 'open'),
             ('${ORG}', 'job_dead', 'critical', 'Job descartado', 'job_queue', '${id(8)}', 'resolved');
    `);

    expect(conta(`select public.fn_podar_fila_de_jobs(90, 1000)`)).toBe(1);
    // O protegido é o do aviso ABERTO; o do aviso já resolvido sai.
    expect(conta(`select count(*) from job_queue where id = '${id(7)}'`)).toBe(1);
    expect(conta(`select count(*) from job_queue where id = '${id(8)}'`)).toBe(0);
  });

  it("o job protegido não trava a fila: o lote pula por cima dele", () => {
    // A armadilha que este caso prende: filtrar os protegidos DEPOIS do `limit`
    // faria um lote inteiro de protegidos devolver 0, o laço do cron pararia
    // achando que acabou, e a poda morreria de fome com backlog atrás.
    enfileirar({ id: id(9), status: "dead", idadeDias: 500 }); // o MAIS VELHO, protegido
    sql(`
      insert into agent_inbox_items (organization_id, kind, severity, title, ref_kind, ref_id, status)
      values ('${ORG}', 'job_dead', 'critical', 'Job descartado', 'job_queue', '${id(9)}', 'open');
    `);
    enfileirar({ id: id(10), status: "done", idadeDias: 400 });

    // Lote de UM: se o filtro viesse depois do limit, o lote seria só o
    // protegido e a função devolveria 0 para sempre.
    expect(conta(`select public.fn_podar_fila_de_jobs(90, 1)`)).toBe(1);
    expect(conta(`select count(*) from job_queue where id = '${id(10)}'`)).toBe(0);
  });

  it("respeita o `p_limite` (é isso que torna o DELETE lote, e não travamento)", () => {
    for (let i = 0; i < 5; i += 1) {
      enfileirar({ id: id(20 + i), status: "done", idadeDias: 300 });
    }
    expect(conta(`select public.fn_podar_fila_de_jobs(90, 2)`)).toBe(2);
    expect(conta(`select count(*) from job_queue where organization_id = '${ORG}'`)).toBe(3);
  });

  it("o PISO de 7 dias mora na função: p_retencao_dias = 0 não apaga o de ontem", () => {
    enfileirar({ id: id(30), status: "done", idadeDias: 1 });
    enfileirar({ id: id(31), status: "done", idadeDias: 30 });
    // Quem chama pede zero; a função eleva ao piso e o de ontem sobrevive.
    expect(conta(`select public.fn_podar_fila_de_jobs(0, 1000)`)).toBe(1);
    expect(conta(`select count(*) from job_queue where id = '${id(30)}'`)).toBe(1);
  });

  it("a cascata leva o send_ledger do run (efeito DECLARADO, não surpresa)", () => {
    enfileirar({ id: id(40), status: "done", idadeDias: 300 });
    sql(`
      insert into send_ledger (organization_id, contact_id, job_id, seq, body_hash, status)
      values ('${ORG}', '${CONTATO}', '${id(40)}', 1, 'hash-0177', 'accepted');
    `);
    expect(conta(`select count(*) from send_ledger where job_id = '${id(40)}'`)).toBe(1);

    conta(`select public.fn_podar_fila_de_jobs(90, 1000)`);

    // `on delete cascade` — send_ledger/before_send_traces do run também crescem
    // sem poda, então isso é parte do conserto. Os dois consumidores de
    // send_ledger sem janela (disclosure de IA e gate LGPD de 1º toque) falham
    // FECHADO quando a linha some: disclosure a mais e veto a mais, nunca a menos.
    expect(conta(`select count(*) from send_ledger where job_id = '${id(40)}'`)).toBe(0);
  });
});

describe("fn_expurgar_auditoria_vencida — a retenção que a doutrina prometia", () => {
  function auditar(opts: { id: string; idadeDias: number }): void {
    sql(`
      insert into api_audit_log (id, organization_id, action, created_at)
      values ('${opts.id}', '${ORG}', 'retention.sweep_run',
              now() - interval '${opts.idadeDias} days');
    `);
  }

  it("apaga o que passou da retenção e preserva o que não passou", () => {
    auditar({ id: id(50), idadeDias: 2000 });
    auditar({ id: id(51), idadeDias: 1000 });
    expect(conta(`select public.fn_expurgar_auditoria_vencida(1825, 1000)`)).toBe(1);
    expect(conta(`select count(*) from api_audit_log where id = '${id(51)}'`)).toBe(1);
  });

  it("o PISO de 90 dias mora na função: nem com p_retencao_dias = 0 se apaga rastro recente", () => {
    // É esta linha que separa "expurgo de retenção" de "porta de adulteração de
    // auditoria". A função NÃO TEM seletor de linha — nem org, nem ator, nem
    // ação, nem id — e o único predicado é a idade, com piso no corpo.
    auditar({ id: id(52), idadeDias: 10 });
    auditar({ id: id(53), idadeDias: 400 });
    expect(conta(`select public.fn_expurgar_auditoria_vencida(0, 1000)`)).toBe(1);
    expect(conta(`select count(*) from api_audit_log where id = '${id(52)}'`)).toBe(1);
  });

  it("respeita o `p_limite`", () => {
    for (let i = 0; i < 4; i += 1) auditar({ id: id(60 + i), idadeDias: 2000 });
    expect(conta(`select public.fn_expurgar_auditoria_vencida(1825, 2)`)).toBe(2);
    expect(conta(`select count(*) from api_audit_log where organization_id = '${ORG}'`)).toBe(2);
  });
});

describe("append-only: por onde o expurgo pode passar, e por onde não pode", () => {
  it("NINGUÉM tem GRANT de DELETE/UPDATE em api_audit_log — nem service_role", () => {
    // É por isso que o expurgo precisa de uma `security definer`: o admin
    // client do produto não consegue apagar esta tabela, e é bom que não consiga.
    const linhas = sql(`
      select coalesce(string_agg(grantee || ':' || privilege_type, ',' order by grantee), '')
        from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'api_audit_log'
         and privilege_type in ('DELETE', 'UPDATE')
         and grantee in ('anon', 'authenticated', 'service_role');
    `);
    expect(lastLine(linhas)).toBe("");
  });

  it("as duas funções não são executáveis por anon nem por authenticated", () => {
    // As DUAS origens de EXECUTE: o grant direto do `ALTER DEFAULT PRIVILEGES
    // ... TO anon` do baseline, e o grant a PUBLIC que o Postgres dá na criação.
    // Tratar só uma deixa a função alcançável pela anon key, que vai ao browser.
    for (const fn of ["fn_podar_fila_de_jobs", "fn_expurgar_auditoria_vencida"]) {
      for (const papel of ["anon", "authenticated"]) {
        const pode = lastLine(
          sql(`select has_function_privilege('${papel}', 'public.${fn}(int,int)', 'EXECUTE')`),
        );
        expect(pode, `${papel} pode executar ${fn}`).toBe("f");
      }
    }
  });

  it("service_role PODE executar as duas (controle positivo do revoke)", () => {
    // Sem este caso, um `revoke` largo demais deixaria a suíte verde e a poda
    // morta: ninguém apagaria nada e o teste de exposição continuaria passando.
    for (const fn of ["fn_podar_fila_de_jobs", "fn_expurgar_auditoria_vencida"]) {
      const pode = lastLine(
        sql(`select has_function_privilege('service_role', 'public.${fn}(int,int)', 'EXECUTE')`),
      );
      expect(pode, `service_role NÃO pode executar ${fn}`).toBe("t");
    }
  });
});
```

- [ ] **Step 2: Rodar `pnpm test:db` e confirmar verde**

Run: `pnpm test:db`
Expected: sobe `pgvector/pgvector:pg17`, aplica `baseline.sql` em modo install (`ON_ERROR_STOP=1`) e update (idempotência), roda todos os invariantes — incluindo este arquivo novo — e termina verde. Se a migration da Task 1 tiver erro de sintaxe/idempotência, é AQUI que aparece, não no `test:unit`.

Se falhar na fase **update** (reaplicar sobre banco já com a 0177): a causa mais provável é o apêndice do `baseline.sql` não ser idempotente — conferir que todo `create function`/`create index` está com `or replace`/`if not exists`, e que os dois `revoke` não lançam em banco onde o privilégio já foi revogado (Postgres não lança nesse caso, é no-op — mas confira mesmo assim).

- [ ] **Step 3: Commit**

```bash
git add tests/invariants/retencao-poda-e-expurgo.test.ts
git commit -m "test(retencao): invariante contra Postgres real (fn_podar_fila_de_jobs/fn_expurgar_auditoria_vencida)"
```

---

## Task 7: Agendamento — linha nova no `docker/scheduler/entrypoint.sh`

**Files:**
- Modify: `docker/scheduler/entrypoint.sh`

**Interfaces:**
- Consumes: a rota `app/api/v1/cron/data-retention` criada na Task 5.

- [ ] **Step 1: Adicionar a linha ao heredoc `CRONS`**

Localizar o fim do bloco `CRONS="..."`:

```
15 4 * * *|60|api/v1/cron/sync-model-catalog
10 3 * * *|60|api/v1/cron/event-log-purge
40 3 * * *|120|api/v1/cron/prune-old-media
"
```

Substituir por (novo cron às 4h20, fora dos horários já ocupados — 3h/3h10/3h17/3h30/3h40/4h/4h15):

```
15 4 * * *|60|api/v1/cron/sync-model-catalog
10 3 * * *|60|api/v1/cron/event-log-purge
40 3 * * *|120|api/v1/cron/prune-old-media
20 4 * * *|120|api/v1/cron/data-retention
"
```

(Timeout de 120s: a poda faz até `MAX_LOTES=20` idas ao banco por tabela, cada uma um `DELETE` de até 1000 linhas — folga generosa, mesmo timeout que `prune-old-media` e `kb-conversations-batch` já usam.)

- [ ] **Step 2: Confirmar que o gate de paridade cron×rotas passa**

Run: `NEXT_PUBLIC_SUPABASE_URL=https://test-placeholder.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x pnpm vitest run tests/unit/cron-routes-scheduled.test.ts --no-file-parallelism`
Expected: PASS — a rota `data-retention` (Task 5) e a linha do entrypoint (este step) agora batem.

- [ ] **Step 3: Commit**

```bash
git add docker/scheduler/entrypoint.sh
git commit -m "feat(retencao): agenda data-retention no scheduler (04:20 diário)"
```

---

## Task 8: Guarda de AST — `audit()` fora de condição reprova (RED nas 4 rotas antigas)

**Files:**
- Create: `tests/unit/cron-audita-so-quando-ha-efeito.test.ts`

**Interfaces:**
- Consumes: pacote `typescript` (Compiler API), já em `package.json`. Varre `app/api/v1/cron/*/route.ts` via `readdirSync`/`readFileSync` — nenhum import de código de produção.
- Produces: `export function auditsIncondicionais(fonte: string, nomeDoArquivo: string): number[]` — não é consumida por outra task, mas fica exportada para eventual reuso.

**Este teste é ESPERADO falhar ao final desta task** (para `routing-worker`, `attendant-heartbeat`, `kb-conversations-batch`, `lgpd-sla-watcher`, que hoje auditam sem condição) — a Task 9 o torna verde.

- [ ] **Step 1: Criar o arquivo de teste**

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CRON QUE NÃO FEZ NADA NÃO ESCREVE NA TRILHA DE AUDITORIA — E CRON QUE FEZ, ESCREVE.
 *
 * ─── O defeito, medido ───────────────────────────────────────────────────────
 *
 * `routing-worker` roda 1×/min e `attendant-heartbeat` 1×/5min, e os dois
 * chamam `audit()` FORA de qualquer condição: milhares de linhas/mês numa
 * instalação que não atende ninguém, numa tabela append-only sem expurgo até
 * a Task 1 deste plano. `kb-conversations-batch` e `lgpd-sla-watcher` têm o
 * mesmo defeito, com cadência diária (mais barato, mas o mesmo problema).
 *
 * ─── Por que este arquivo tem DUAS partes, e nenhuma das duas basta sozinha ──
 *
 * A parte ESTÁTICA mede a CLASSE. O conserto por instância — trocar quatro
 * `void audit(`/`await audit(` de lugar — deixa a próxima rota de cron nascer
 * com o mesmo defeito, e o modo de falha é mudo (nada quebra, só cresce). O
 * guarda percorre o AST de TODA rota em `app/api/v1/cron/`, então ele alcança
 * rota que ainda não existe.
 *
 * Mas ele prova CONDICIONALIDADE, não "condicionada ao efeito" — um `if (true)`
 * o satisfaria. E o outro lado importa tanto quanto: uma rodada que fez trabalho
 * TEM de deixar rastro; "parar de auditar" seria trocar ruído por cegueira, que
 * é pior. Daí a parte de COMPORTAMENTO, que dirige `routing-worker` e
 * `attendant-heartbeat` nas duas direções — sem ela, um cron que nunca audita
 * passaria no guarda estático com louvor.
 */

const RAIZ = join(__dirname, "..", "..");
const DIR_CRON = join(RAIZ, "app", "api", "v1", "cron");

function rotasDeCron(): string[] {
  return readdirSync(DIR_CRON, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Chamadas a `audit(...)` que NÃO estão sob nenhuma condição, no fonte dado.
 * Devolve as linhas (1-based) das infratoras.
 *
 * Ancorado no AST e não em regex de propósito: a prosa deste repositório cita
 * `audit(` e `if (` em comentário o tempo todo, e um regex acusaria o texto que
 * descreve a regra — instrumento reprovando o arquivo por ele falar de si mesmo.
 */
export function auditsIncondicionais(fonte: string, nomeDoArquivo: string): number[] {
  const arquivo = ts.createSourceFile(nomeDoArquivo, fonte, ts.ScriptTarget.Latest, true);
  const infratoras: number[] = [];

  const souChamadaDeAudit = (no: ts.Node): boolean =>
    ts.isCallExpression(no) && ts.isIdentifier(no.expression) && no.expression.text === "audit";

  const visitar = (no: ts.Node): void => {
    if (souChamadaDeAudit(no)) {
      let pai: ts.Node | undefined = no.parent;
      let sobCondicao = false;
      while (pai && !ts.isSourceFile(pai)) {
        // `if`, `? :` e `&&`/`||` cobrem as três formas de "só quando" que
        // aparecem em rota HTTP. `for`/`while` NÃO contam: um laço sobre o
        // resultado já é o próprio efeito, mas laço vazio não chama nada, então
        // ele não é o caminho pelo qual o defeito volta.
        //
        // `catch` CONTA, e não é folga: um bloco de catch só executa quando algo
        // falhou, e "falhou" é efeito — é justamente a rodada que não pode ficar
        // idêntica, na trilha, à rodada que não tinha o que fazer. O que este
        // arquivo proíbe é a chamada no caminho NORMAL, que roda sempre.
        if (
          ts.isIfStatement(pai) ||
          ts.isCatchClause(pai) ||
          ts.isConditionalExpression(pai) ||
          (ts.isBinaryExpression(pai) &&
            (pai.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
              pai.operatorToken.kind === ts.SyntaxKind.BarBarToken))
        ) {
          sobCondicao = true;
          break;
        }
        pai = pai.parent;
      }
      if (!sobCondicao) {
        infratoras.push(arquivo.getLineAndCharacterOfPosition(no.getStart(arquivo)).line + 1);
      }
    }
    ts.forEachChild(no, visitar);
  };

  visitar(arquivo);
  return infratoras;
}

describe("rotas de cron × auditoria condicional (a CLASSE)", () => {
  const rotas = rotasDeCron();

  it("o instrumento enxerga as rotas e as chamadas (controle positivo)", () => {
    // Sem isto, um `readdir` vazio ou um AST que nunca casa `audit(` fariam o
    // caso abaixo passar por vacuidade — "zero infratoras" seria verdade e não
    // significaria nada.
    expect(rotas.length).toBeGreaterThan(10);
    const comAudit = rotas.filter((r) =>
      readFileSync(join(DIR_CRON, r, "route.ts"), "utf8").includes("audit("),
    );
    expect(comAudit.length).toBeGreaterThanOrEqual(5);
  });

  it.each(rotasDeCron())("%s não chama audit() fora de condição", (rota) => {
    const caminho = join(DIR_CRON, rota, "route.ts");
    const linhas = auditsIncondicionais(readFileSync(caminho, "utf8"), caminho);
    expect(
      linhas,
      `app/api/v1/cron/${rota}/route.ts chama audit() incondicionalmente na(s) linha(s) ` +
        `${linhas.join(", ")}. Um cron que audita sempre grava milhares de linhas/mês numa ` +
        `instalação parada, numa tabela append-only. A guarda certa é "auditar quando houve ` +
        `efeito" — nunca "parar de auditar".`,
    ).toEqual([]);
  });

  it("o instrumento acusa a violação quando ela existe (controle negativo)", () => {
    const sabotado = `
      import { audit } from "@/lib/audit";
      export async function GET() {
        const r = { swept: 0 };
        void audit({ action: "x", metadata: r });
        return r;
      }`;
    expect(auditsIncondicionais(sabotado, "sabotado.ts")).toHaveLength(1);
  });

  it("audit no corpo do try (caminho NORMAL) continua sendo infração", () => {
    // A fresta que a permissão a `catch` poderia abrir: envolver a chamada de
    // sempre num `try` e chamá-la de condicional. O `try` roda sempre.
    const sabotado = `
      import { audit } from "@/lib/audit";
      export async function GET() {
        try {
          void audit({ action: "x" });
        } catch {
          /* nada */
        }
      }`;
    expect(auditsIncondicionais(sabotado, "sabotado-try.ts")).toHaveLength(1);
  });

  it("o instrumento não confunde comentário com código (controle do controle)", () => {
    const prosa = `
      // A regra é: só chamar audit({...}) quando houve efeito, nunca fora de if (...).
      export const x = 1;`;
    expect(auditsIncondicionais(prosa, "prosa.ts")).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// COMPORTAMENTO — as duas direções, nas rotas consertadas
// ────────────────────────────────────────────────────────────────────────────

const SEGREDO = "segredo-de-cron-do-teste";

vi.mock("@/lib/env", () => ({
  env: {
    INTERNAL_CRON_SECRET: SEGREDO,
    INTERNAL_SECRET: "",
    JOB_QUEUE_RETENTION_DAYS: "",
    AUDIT_LOG_RETENTION_DAYS: "",
  },
}));

const auditou = vi.fn();
vi.mock("@/lib/audit", () => ({ audit: (...args: unknown[]) => auditou(...args) }));

const rodarRouting = vi.fn();
vi.mock("@/lib/routing/worker", () => ({ runRoutingWorker: () => rodarRouting() }));

/** O que o UPDATE de `attendant_availability` devolve nesta rodada. */
let varridos: { user_id: string }[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const cadeia: Record<string, unknown> = {};
      for (const metodo of ["update", "eq", "or"]) {
        cadeia[metodo] = () => cadeia;
      }
      cadeia.select = async () => ({ data: varridos, error: null });
      return cadeia;
    },
  }),
}));

function requisicaoAutorizada(): Parameters<
  typeof import("@/app/api/v1/cron/routing-worker/route").GET
>[0] {
  // As rotas só leem `headers.get("authorization")`; montar um `NextRequest` de
  // verdade traria o runtime do Next para dentro de um teste que não o exercita.
  return { headers: new Headers({ authorization: `Bearer ${SEGREDO}` }) } as never;
}

describe("routing-worker — audita quando drenou, cala quando não drenou", () => {
  beforeEach(() => {
    auditou.mockClear();
    rodarRouting.mockReset();
  });

  it("tick vazio (batch_size 0, sem erro) NÃO audita", async () => {
    rodarRouting.mockResolvedValue({ batch_size: 0, outcomes: {}, errors: [] });
    const { GET } = await import("@/app/api/v1/cron/routing-worker/route");
    const resposta = await GET(requisicaoAutorizada());
    expect(resposta.status).toBe(200);
    expect(auditou).not.toHaveBeenCalled();
  });

  it("tick que drenou um evento AUDITA (a direção que não pode se perder)", async () => {
    rodarRouting.mockResolvedValue({ batch_size: 1, outcomes: { assigned: 1 }, errors: [] });
    const { GET } = await import("@/app/api/v1/cron/routing-worker/route");
    await GET(requisicaoAutorizada());
    expect(auditou).toHaveBeenCalledTimes(1);
    expect(auditou.mock.calls[0]?.[0]).toMatchObject({ action: "routing.worker_run" });
  });

  it("falha de leitura do event_log AUDITA mesmo com batch_size 0", async () => {
    rodarRouting.mockResolvedValue({
      batch_size: 0,
      outcomes: {},
      errors: ["event_log_pull_failed: timeout"],
    });
    const { GET } = await import("@/app/api/v1/cron/routing-worker/route");
    await GET(requisicaoAutorizada());
    expect(auditou).toHaveBeenCalledTimes(1);
  });
});

describe("attendant-heartbeat — audita quando derrubou alguém", () => {
  beforeEach(() => {
    auditou.mockClear();
  });

  it("varredura que não derrubou ninguém NÃO audita", async () => {
    varridos = [];
    const { GET } = await import("@/app/api/v1/cron/attendant-heartbeat/route");
    const resposta = await GET(requisicaoAutorizada() as never);
    expect(resposta.status).toBe(200);
    expect(auditou).not.toHaveBeenCalled();
  });

  it("varredura que derrubou dois atendentes AUDITA", async () => {
    varridos = [{ user_id: "a" }, { user_id: "b" }];
    const { GET } = await import("@/app/api/v1/cron/attendant-heartbeat/route");
    await GET(requisicaoAutorizada() as never);
    expect(auditou).toHaveBeenCalledTimes(1);
    expect(auditou.mock.calls[0]?.[0]).toMatchObject({
      action: "attendant.heartbeat_swept",
      metadata: { swept: 2 },
    });
  });
});
```

- [ ] **Step 2: Rodar e CONFIRMAR QUE FALHA nas 4 rotas antigas**

Run: `NEXT_PUBLIC_SUPABASE_URL=https://test-placeholder.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x pnpm vitest run tests/unit/cron-audita-so-quando-ha-efeito.test.ts --no-file-parallelism`

Expected: FAIL — especificamente os casos `it.each` para `routing-worker`, `attendant-heartbeat`, `kb-conversations-batch`, `lgpd-sla-watcher` (cada um reportando a linha exata do `audit(`/`void audit(` incondicional), e as duas describes de COMPORTAMENTO ("tick vazio NÃO audita", "varredura que não derrubou ninguém NÃO audita") também falham, porque hoje as rotas auditam sempre.

**Este vermelho é o esperado — é o que prova que o guarda enxerga o defeito antes do conserto.** Não avance para a Task 9 sem ver este vermelho primeiro.

- [ ] **Step 3: Commit (sim, com o teste vermelho)**

```bash
git add tests/unit/cron-audita-so-quando-ha-efeito.test.ts
git commit -m "test(retencao): guarda de AST — audit() fora de condição (RED nas 4 rotas antigas, conserto na próxima task)"
```

---

## Task 9: Condicionar `audit()` nas 4 rotas existentes (GREEN)

**Files:**
- Modify: `app/api/v1/cron/routing-worker/route.ts`
- Modify: `app/api/v1/cron/attendant-heartbeat/route.ts`
- Modify: `app/api/v1/cron/kb-conversations-batch/route.ts`
- Modify: `app/api/v1/cron/lgpd-sla-watcher/route.ts`

**Interfaces:**
- Nenhuma interface nova — só envolve as chamadas `audit()` já existentes em `if (...)`. Torna verde o teste da Task 8.

- [ ] **Step 1: `routing-worker/route.ts`**

Localizar:

```ts
  void audit({
    action: "routing.worker_run",
    organizationId: null,
    bypassedRls: true,
    metadata: { batch_size: summary.batch_size, outcomes: summary.outcomes, errors: summary.errors.length },
    requestId,
  });
```

Substituir por:

```ts
  // Varredura que não drenou nada e não errou não é mutação — mesmo critério
  // do snooze-watcher e do recover-stuck-messages. `errors.length > 0` entra
  // porque `runRoutingWorker` devolve `batch_size: 0` com o erro DENTRO quando
  // o `select` do event_log falha: sem esta cláusula, o tick em que o banco
  // não respondeu ficaria idêntico, na trilha, ao tick de uma instalação sem
  // nada a fazer.
  if (summary.batch_size > 0 || summary.errors.length > 0) {
    void audit({
      action: "routing.worker_run",
      organizationId: null,
      bypassedRls: true,
      metadata: {
        batch_size: summary.batch_size,
        outcomes: summary.outcomes,
        errors: summary.errors.length,
      },
      requestId,
    });
  }
```

- [ ] **Step 2: `attendant-heartbeat/route.ts`**

Localizar:

```ts
  const swept = data?.length ?? 0;
  void audit({
    action: "attendant.heartbeat_swept",
    requestId,
    bypassedRls: true,
    metadata: { swept, timeout_minutes: HEARTBEAT_TIMEOUT_MINUTES, cutoff },
  });

  return ok({ swept, cutoff }, { requestId });
```

Substituir por:

```ts
  const swept = data?.length ?? 0;
  // Varredura que não derrubou ninguém não é mutação e não ocupa linha de
  // auditoria (mesmo critério do snooze-watcher e do recover-stuck-messages).
  // Esta rota roda 1×/5min: auditar incondicionalmente grava milhares de
  // linhas/mês numa instalação sem atendente algum, numa tabela append-only.
  // O caso de erro do UPDATE já sai por `fail(...)` acima, com log — não é
  // este `if` que o esconde.
  if (swept > 0) {
    void audit({
      action: "attendant.heartbeat_swept",
      requestId,
      bypassedRls: true,
      metadata: { swept, timeout_minutes: HEARTBEAT_TIMEOUT_MINUTES, cutoff },
    });
  }

  return ok({ swept, cutoff }, { requestId });
```

- [ ] **Step 3: `kb-conversations-batch/route.ts`**

Localizar:

```ts
  await audit({
    action: "rag.conversations_batch_run",
    organizationId: null,
    metadata: {
      orgs_processed: orgsProcessed,
      total_processed: totalProcessed,
      total_flagged: totalFlagged,
      total_skipped: totalSkipped,
      failures: failures.length,
      since_ts: sinceTs.toISOString(),
    },
    requestId,
  });
```

Substituir por:

```ts
  // `orgsProcessed` NÃO entra na condição: ele conta organizações VISITADAS, e
  // visitar uma organização sem conversa nova é exatamente o nada que esta
  // guarda existe para não registrar. `failures` entra: uma rodada em que toda
  // organização estourou tem os três contadores em zero, e sem esta cláusula
  // ficaria idêntica, na trilha, à rodada de uma instalação sem conversa nenhuma.
  const houveEfeito =
    totalProcessed > 0 || totalFlagged > 0 || totalSkipped > 0 || failures.length > 0;
  if (houveEfeito) {
    await audit({
      action: "rag.conversations_batch_run",
      organizationId: null,
      metadata: {
        orgs_processed: orgsProcessed,
        total_processed: totalProcessed,
        total_flagged: totalFlagged,
        total_skipped: totalSkipped,
        failures: failures.length,
        since_ts: sinceTs.toISOString(),
      },
      requestId,
    });
  }
```

- [ ] **Step 4: `lgpd-sla-watcher/route.ts`**

Localizar:

```ts
  void audit({
    action: "lgpd.sla_watcher_run",
    requestId,
    bypassedRls: true,
    metadata: {
      scanned,
      alarmed: alarmedCount,
      deduped: dedupedCount,
      errors: errorsCount,
      duration_ms: durationMs,
    },
  });
```

Substituir por:

```ts
  // `deduped` ENTRA na condição, e aqui a régua é mais generosa que nas outras
  // rotas de propósito: dedup significa que existe prazo LGPD estourado sendo
  // reencontrado, e num caminho de compliance o registro de que o alarme
  // continua de pé vale mais que a linha economizada. O que sai é só o tick de
  // uma instalação sem nenhuma solicitação vencida — que é o caso normal.
  if (alarmedCount > 0 || dedupedCount > 0 || errorsCount > 0) {
    void audit({
      action: "lgpd.sla_watcher_run",
      requestId,
      bypassedRls: true,
      metadata: {
        scanned,
        alarmed: alarmedCount,
        deduped: dedupedCount,
        errors: errorsCount,
        duration_ms: durationMs,
      },
    });
  }
```

- [ ] **Step 5: Rodar o teste da Task 8 e confirmar GREEN**

Run: `NEXT_PUBLIC_SUPABASE_URL=https://test-placeholder.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x pnpm vitest run tests/unit/cron-audita-so-quando-ha-efeito.test.ts --no-file-parallelism`
Expected: PASS — todos os `it.each` por rota (incluindo `data-retention`, cujo `audit()` já nasceu condicionado na Task 5), e as duas describes de comportamento.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/cron/routing-worker/route.ts app/api/v1/cron/attendant-heartbeat/route.ts app/api/v1/cron/kb-conversations-batch/route.ts app/api/v1/cron/lgpd-sla-watcher/route.ts
git commit -m "fix(retencao): as 4 rotas de cron antigas passam a auditar só quando houve efeito"
```

---

## Task 10: Verificação final

**Files:** nenhum arquivo novo — só comandos.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: 0 erros

- [ ] **Step 2: Lint**

Run: `npx eslint app/api/v1/cron/data-retention/route.ts app/api/v1/cron/routing-worker/route.ts app/api/v1/cron/attendant-heartbeat/route.ts app/api/v1/cron/kb-conversations-batch/route.ts app/api/v1/cron/lgpd-sla-watcher/route.ts lib/retencao/politica.ts lib/env.ts lib/audit/actions.ts tests/unit/retencao-poda-em-lotes.test.ts tests/unit/cron-audita-so-quando-ha-efeito.test.ts tests/invariants/retencao-poda-e-expurgo.test.ts`
Expected: sem output (limpo)

- [ ] **Step 3: Suíte unitária completa**

Run: `NEXT_PUBLIC_SUPABASE_URL=https://test-placeholder.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x pnpm test:unit`
Expected: verde, sem regressão em nenhum arquivo pré-existente (especial atenção a `tests/unit/env-example-sync.test.ts` e `tests/unit/cron-routes-scheduled.test.ts`)

- [ ] **Step 4: Invariantes contra Postgres real (install + update)**

Run: `pnpm test:db`
Expected: verde — install E update do `baseline.sql` (a Task 1 introduziu o apêndice; a Task 6 introduziu o teste que o mede). **Não considere esta feature "pronta" sem este passo verde** — é o único caminho que exercita o que o self-hoster realmente aplica.

- [ ] **Step 5: `gov:verify` (o gate que a CI roda)**

Run: `pnpm gov:verify`
Expected: verde (`typecheck && lint && lint:channels && test:unit`)

- [ ] **Step 6: Conferir a doc de estado atual, se aplicável**

Se `docs/current-state.md` ou `docs/business-rules/00-business-rules-catalog.md` afirmarem hoje algo como "audit log não tem expurgo" ou "job_queue não tem poda" (o achado original que motivou este plano no upstream), corrigir a afirmação para apontar ao mecanismo novo — DoD item 16 do `CLAUDE.md` prefere um comando verificável a um número que envelhece; se não houver afirmação desse tipo no nosso repo, pular este step.

- [ ] **Step 7: Commit final (se sobrar algo solto)**

```bash
git status --short
# Se tudo já foi commitado nas tasks anteriores, nada a fazer aqui.
```

---

## Self-Review (conferido ao escrever este plano)

1. **Cobertura da spec:** migration+baseline+MANIFEST (Task 1) ✓; política pura (Task 2) ✓; env vars (Task 3) ✓; ação de audit (Task 4) ✓; rota do cron (Task 5) ✓; invariante contra Postgres real (Task 6) ✓; agendamento (Task 7) ✓; guarda de AST + as 4 rotas antigas condicionadas (Tasks 8-9) ✓; verificação final incl. `pnpm test:db` (Task 10) ✓. As três dependências do upstream que NÃO existem no fork (espelho de agenda, nonces OAuth, cascata LGPD) foram explicitamente excluídas do escopo, não esquecidas.
2. **Placeholders:** nenhum "TBD"/"similar to Task N" — todo código é literal, incluindo os três arquivos de teste na íntegra.
3. **Consistência de tipos:** `ResultadoDaRetencao` (Task 5) tem exatamente os campos que `houveEfeito` (Task 5) e os testes das Tasks 5/6 esperam — sem `espelho_apagado`/`nonces_apagados` (removidos do upstream de propósito). `PodaDb.rpc` aceita só `"fn_podar_fila_de_jobs" | "fn_expurgar_auditoria_vencida"` em todos os call sites (rota, Task 5; teste unitário, Task 5; teste de invariante, Task 6 — este último chama a função SQL direto via `sql()`, não via `PodaDb`, então não há inconsistência de tipo ali).
