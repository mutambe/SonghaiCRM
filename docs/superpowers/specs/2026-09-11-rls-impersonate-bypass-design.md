# RLS: fechar o buraco de cobertura do bypass de platform admin — Design

> Nasceu de um bug reportado em produção: "não consigo criar/editar agente de IA" durante
> Impersonate. A causa raiz não é específica de Agentes de IA — é um padrão de RLS
> (`OR public.fn_is_platform_admin()`) já aplicado em 97 das 155 políticas do schema, mas
> **incompleto** em ~60 tabelas tenant-aware. Este documento desenha o fechamento completo,
> por pedido explícito do dono do produto ("auditoria completa de todas as ~28 tabelas" —
> a contagem real, medida, é 60 tabelas / 65 políticas).

## Contexto medido (não suposição)

- `fn_is_platform_admin()` (`SECURITY DEFINER`, verifica `platform_admins` com
  `revoked_at is null`) já é um bypass amplo e pré-existente: qualquer platform admin, para
  qualquer tenant, **independente de estar a usar Impersonate ou não**. Não é um mecanismo
  novo — é o padrão que 97 políticas já usam.
- O commit de hoje (`a1ee89e7`, "fix(impersonate): resolveActiveOrg passa a priorizar o
  cookie de impersonate") corrigiu a camada de AUTORIZAÇÃO — `resolveActiveOrg` agora resolve
  correctamente o tenant impersonado para efeitos de `role`/redirect. Isso expôs (não criou)
  o buraco de cobertura: antes, a autorização já travava a pessoa mais cedo; agora que chega
  à página, as queries RLS-scoped (`createClient()`) contra tabelas sem o bypass devolvem
  vazio ou recusam a escrita, em silêncio — sem erro no console, porque RLS filtra, não lança.
- Medido em produção (`info@songhai.cc`, o único platform admin): é membro real **apenas**
  de "Songhai, Lda" (a própria empresa). Zero membership em "GENN TECH" e "Ferragem Egidio"
  — os tenants de cliente que impersona para os ajudar.
- Exemplo concreto que motivou o achado: `ai_agents` TEM o bypass (a página de editar
  consegue carregar a linha do agente); `ai_agent_versions` (onde vive o prompt/config real)
  e `ai_provider_credentials` (+ a view `ai_provider_credentials_safe`) NÃO TÊM — por isso a
  lista de credenciais chega vazia ao formulário (submit trava por validação) e a edição de
  um agente `mcp_agent` chega sem nenhuma versão.

## Metodologia da auditoria (evita falso positivo)

Uma busca textual ingénua por `fn_is_platform_admin` no corpo da política produz falsos
positivos: 6 políticas (`conversations_select`, `crm_leads_select`,
`crm_lead_activities_select`, `crm_lead_links_select`, `cae_select`, `appointments_select`)
pareciam sem bypass mas delegam para `fn_can_view_lead()`/`fn_can_view_conversation()`,
que **já** têm `when public.fn_is_platform_admin() then true` como primeiro `case`.
Confirmado lendo o `pg_proc.prosrc` das duas funções.

Processo usado (e que o plano de implementação deve repetir antes de escrever a migration
final, porque a produção pode ter mudado entre esta spec e a implementação):

1. `select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public' and qual !~ 'fn_is_platform_admin' and (with_check is null or with_check !~ 'fn_is_platform_admin')`.
2. Para cada linha, ler o `qual`/`with_check` por inteiro. Se chamar uma função que não seja
   `fn_user_org_ids()`/`fn_role_at_least()`, ler o `prosrc` dessa função antes de decidir.
3. Excluir tabelas sem `organization_id` (globais — `ai_models`, `ai_pricing`, `plans`,
   todas com `qual = true`) e dados pessoais que NUNCA devem ter bypass de platform admin
   (`user_recovery_codes` — recovery codes de MFA são por utilizador, não por tenant).
4. Excluir políticas de catálogo com `organization_id IS NULL` (`catalog_read_skill_pointers`,
   `catalog_read_skill_versions`) — linha global, forma de dado diferente, não é sobre a
   mesma isolação tenant.

## Escopo final: 60 tabelas, 65 políticas

Lista completa (nome de tabela; algumas têm política `_all` combinada, outras `_select` +
`_write` separadas — ver `2026-09-11-rls-impersonate-bypass-raw-audit.tsv`, neste mesmo
diretório, para o `qual`/`with_check` literal de cada uma das 65, extraído de produção em
2026-09-11):

```
agent_case_events, agent_cases, agent_inbox_items, ai_agent_runs, ai_agent_versions,
ai_faq_items, ai_provider_credentials, ai_purpose_bindings, ai_router_decisions,
ai_router_members, ai_routers, before_send_traces, channel_knobs, channel_session_health,
contact_field_proposals, conversation_notes, crm_lead_reactivations, crm_lead_risk_states,
crm_lead_scores, cron_jobs, demanda_conversas, demandas, disclosure_template_pointers,
disclosure_template_versions, flywheel_distiller_proposals, flywheel_judge_verdicts,
followup_enrollment_events, followup_enrollments, followup_flow_pointers,
followup_flow_versions, idempotency_keys, job_queue, judge_alignment_pool,
knowledge_searches, lead_checkpoints, lead_notes, lead_state, lead_state_transitions,
llm_calls, message_templates, meta_templates, metrics, org_memory_entries,
org_memory_pointers, org_memory_versions, outbound_copies, pacing_ledger,
playbook_pointers, playbook_versions, promise_table_pointers, promise_table_versions,
reentry_knob_pointers, reentry_knob_versions, reentry_template_pointers,
reentry_template_versions, send_ledger, skill_activations, skill_pointers,
skill_versions, storage_redaction_queue
```

**Exclusões deliberadas** (não entram nesta migration, com razão escrita):

| Tabela/política | Razão |
|---|---|
| `user_recovery_codes` | Dados pessoais (códigos de recuperação MFA de UM utilizador). Platform admin nunca deve ler o recovery code de outra pessoa via impersonate — isto seria abrir uma porta de account takeover, não fechar um buraco de produtividade. |
| `ai_models`, `ai_pricing`, `plans` | Sem `organization_id` — já `qual = true` (catálogo global, todo autenticado lê). Bypass não se aplica. |
| `catalog_read_skill_pointers`, `catalog_read_skill_versions` | `qual = organization_id IS NULL` — cobre a linha de catálogo global, forma de dado diferente da linha tenant (que tem a política `tenant_isolation_skill_*_all`, essa SIM entra no escopo). |
| `conversations_select`, `crm_leads_select`, `crm_lead_activities_select`, `crm_lead_links_select`, `cae_select`, `appointments_select` | Delegam para `fn_can_view_lead()`/`fn_can_view_conversation()`, que já bypassam platform admin internamente. Confirmado no `pg_proc.prosrc`. |

## Arquitectura da correcção

Não é um mecanismo novo. É fechar cobertura incompleta de um padrão que já existe.

Para cada uma das 65 políticas: `DROP POLICY IF EXISTS` + `CREATE POLICY` com o `qual`
original **exactamente como está hoje**, acrescentando `OR public.fn_is_platform_admin()`
ao fim do `USING` e, quando existir, do `WITH CHECK` — o mesmo texto literal que as 97
políticas corretas já usam (`... OR public.fn_is_platform_admin())`). Nenhuma lógica de
role/visibilidade existente é alterada; só se soma a alternativa que falta.

Isto é puramente SQL de política — sem tabela nova, sem coluna nova, sem função nova (logo
sem a doutrina do "revoke duplo" de `create function`, que não se aplica aqui). Idempotente
por natureza: `drop policy if exists` nunca falha se a política já não existir; `create
policy` recria do zero a cada aplicação.

**Tripla de migration completa** (doutrina do `CLAUDE.md`):
1. `supabase/migrations/<timestamp>_<NNNN>_rls-impersonate-bypass-completo.sql` — próximo
   número sequencial depois de `0177` (conferir `ls supabase/migrations/` no momento da
   implementação — pode já não ser `0178` se outra sessão tiver commitado primeiro; houve
   uma colisão exactamente nesse número hoje, resolvida por aviso directo entre sessões).
2. Apêndice idempotente equivalente no fim de `supabase/baseline.sql`.
3. Linha nova na tabela "Applied" do `MANIFEST.md`.

## Teste (o gate que prova isto — `pnpm test:db`)

Um invariante novo, `tests/invariants/rls-platform-admin-bypass-completo.test.ts`, medindo
a MESMA assimetria que a produção tinha:

1. **Setup:** dois tenants (`ORG_A`, `ORG_B`); um utilizador platform admin **sem nenhuma
   linha em `user_organizations`** para nenhum dos dois (replica `info@songhai.cc`); um
   utilizador normal, também sem membership em nenhum dos dois (controlo negativo).
2. **Para cada uma das 60 tabelas do escopo:** insere uma linha mínima válida em `ORG_A`
   (respeitando FKs/NOT NULLs — vai exigir fixtures por tabela, é o grosso do trabalho do
   plano de implementação) via `service_role` (bypass), depois confirma:
   - o platform admin, autenticado como ele mesmo (RLS real, não `service_role`), consegue
     `SELECT` a linha — e, para as tabelas com política `_write`/`_all`, consegue também
     `UPDATE`/`INSERT`/`DELETE`;
   - o utilizador normal (controlo negativo) **continua bloqueado** — sem isto, um `OR true`
     acidental na migration passaria despercebido.
3. **Controlo positivo do instrumento:** antes de tudo, confirma que a lista de 60 tabelas
   ainda bate com uma query fresca a `pg_policies` (mesma consulta desta spec) — se alguém
   adicionar uma tabela tenant-aware nova sem o bypass, este teste deve ficar vermelho
   automaticamnte, não só as 60 de hoje. É o que torna o gate vivo, não uma foto de 2026-09-11.

Dado o volume (60 tabelas × fixture própria), o plano de implementação pode agrupar tabelas
por "forma" (ex.: todas as `*_pointers`/`*_versions` do padrão versionado compartilham
fixture; `lead_*`/`crm_lead_*` compartilham um `crm_leads` pai) em vez de 60 casos
totalmente artesanais — mas cada tabela precisa aparecer explicitamente na asserção final,
nem que seja num loop parametrizado.

## Definition of Done desta mudança

- As 65 políticas reescritas, migration + baseline + MANIFEST.
- `pnpm test:db` verde, incluindo o invariante novo cobrindo as 60 tabelas mais o controlo
  negativo.
- Prova manual na VPS (produção real, `info@songhai.cc` impersonando "GENN TECH" ou
  "Ferragem Egidio"): criar e editar um agente de IA funciona — é o bug original, e é o
  critério de aceite mais direto que existe.
- `docs/current-state.md`/business-rules, se afirmarem algo sobre o alcance do Impersonate,
  corrigidos (DoD item 16).

## Fora de escopo (declarado, não esquecido)

- Não mexe em `resolveActiveOrg` nem no cookie de impersonate — essa parte já está correcta
  desde o commit de hoje.
- Não adiciona logging/auditoria nova de "platform admin leu/escreveu tabela X via
  impersonate" — é uma melhoria de observabilidade genuína, mas outro escopo; o
  `IMPERSONATE_COOKIE_NAME`/`ImpersonateBanner` já deixa visível NA TELA que se está a
  impersonar, o que cobre o requisito mínimo de transparência.
- Não revisita as 97 políticas que já têm o bypass — presume-se correctas (não fazem parte
  do defeito medido).
