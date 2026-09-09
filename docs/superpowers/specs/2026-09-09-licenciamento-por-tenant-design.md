# Licenciamento por tenant (organization) — design

> Data: 2026-09-09.

## Contexto e decisão de fundo (supersede parcialmente `2026-09-04-licenciamento-paysuite-design.md`)

A spec de 2026-09-04 desenhou um modelo de **duas superfícies** — uma "instância central" da
Songhai vendendo licenças a "instâncias de cliente" (cada cliente correndo o SonghaiCRM na própria
VPS). Esta spec **substitui essa arquitetura**: não existe mais "instância de cliente". A decisão
do dono do produto, tomada nesta sessão, é que **todos os clientes usam recursos de uma única
instância central** — a VPS da própria Songhai. Um "cliente" deixa de ser uma instalação separada e
passa a ser uma `organization` (tenant) dentro dessa instância única, usando a multi-tenancy com RLS
que o produto já tem desde o dia 1.

Isto muda o eixo de negócio descrito no `CLAUDE.md` ("monetização = licenciamento por assinatura
recorrente da **instalação** self-host em VPS"). **`CLAUDE.md` e `VISION.md` precisam de atualização
separada** para refletir "instância central multi-tenant, licenciada por organization" em vez de
"self-host por cliente" — fora do escopo de implementação desta spec, mas bloqueador de honestidade
documental antes ou junto do merge.

O que a spec de 2026-09-04 descreveu sobre o **módulo de comércio do tenant** (o PaySuite que cada
organization usa para cobrar os próprios leads/clientes finais) **não é afetado** — continua
existindo, com credenciais próprias por organization, ortogonal a esta spec. Esta spec trata
exclusivamente da cobrança **Songhai → tenant** (licença/plano), nunca do PaySuite comercial do
tenant. Todo campo novo abaixo carrega essa distinção no nome e no comentário SQL para não colidir.

## Objetivo

1. Corrigir o bug real: `owner_email` coletado na criação do tenant é hoje descartado — o
   tenant nasce sem ninguém conseguindo logar nele.
2. Permitir que o plano/licença de uma organization seja **atribuído na criação e alterado depois**
   (hoje fica congelado, sem endpoint de mudança), com histórico auditável.
3. Descontinuar o modelo de licenciamento por instalação (`licensing_installs` e tabelas
   relacionadas, tela `/admin/licensing`), que não faz mais sentido numa instância única.
4. Deixar o desenho pronto para, no futuro, ligar cobrança automática via PaySuite por organization
   específica (sob pedido do cliente), sem precisar de nova migration.

## Arquitetura e modelo de dados

Duas tabelas novas, ambas na base de dados única da instância central:

```sql
create table plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in ('standard', 'pro', 'enterprise')),
  display_name text not null,
  limits jsonb not null default '{}'::jsonb,  -- ex: {"max_users": 5, "max_whatsapp_connections": 1}
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Cobrança Songhai -> tenant (licença/plano). NÃO confundir com o módulo comercial
-- do tenant (PaySuite que a organization usa para cobrar os próprios leads/clientes).
create table organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  plan_id uuid not null references plans(id),
  status text not null check (status in ('active', 'suspended', 'cancelled')),
  billing_mode text not null default 'manual' check (billing_mode in ('manual', 'paysuite_managed')),
  assigned_by uuid references auth.users(id),
  notes text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_organization_subscriptions_current
  on organization_subscriptions (organization_id)
  where ended_at is null;
```

- **Nunca se faz UPDATE numa linha de `organization_subscriptions`** para trocar de plano. Trocar
  de plano = fechar a linha vigente (`ended_at = now()`) e inserir uma nova. A vigente é sempre a
  única linha por `organization_id` com `ended_at is null` — um `unique` parcial garante isso:

  ```sql
  create unique index uq_organization_subscriptions_one_current
    on organization_subscriptions (organization_id)
    where ended_at is null;
  ```

- Isto dá histórico auditável de graça, sem tabela separada — segue a doutrina DIRC (não duplica:
  o plano vigente é lido, nunca guardado num segundo lugar; `organizations` **não** ganha coluna
  `plan_id` própria, evitando dois lugares afirmarem o plano ao mesmo tempo).
- RLS: `organization_subscriptions` leva a policy padrão `tenant_isolation_organization_subscriptions_all`
  via `fn_user_org_ids()` para leitura pelos membros do próprio tenant (read-only — um `admin` de
  tenant vê o próprio plano). Escrita (INSERT) é feita só pelo handler admin via service role,
  filtrando `organization_id` explicitamente e checando `requirePlatformAdmin()` — service role
  bypassa RLS, então o handler é a única barreira de escrita.
- `plans` não é tenant-aware (é catálogo global da Songhai) — sem RLS, leitura pública autenticada
  (qualquer usuário logado pode ver o catálogo pra saber o que existe), escrita só platform admin.
- Seed inicial de `plans` (`standard`/`pro`/`enterprise`) entra na mesma migration.

### Descontinuação do modelo por instalação

Migration forward-fix renomeia (não apaga) as tabelas da spec anterior:
`licensing_installs` → `_deprecated_licensing_installs`, e mesma coisa para `licensing_licenses`,
`licensing_payments`, `licensing_client_state`. Revoga `EXECUTE`/acesso de qualquer função
`security definer` associada. A tela `/admin/licensing` e o item de navegação correspondente em
`lib/navigation/registry.ts` são removidos. Manter os dados renomeados por um período (não
definido nesta spec — decisão operacional de quando apagar de vez) evita perda irreversível caso
haja necessidade de consulta histórica.

## Fluxo de criação de tenant + convite do owner

`POST /api/v1/admin/tenants` (handler existente, `app/api/v1/admin/tenants/route.ts`) passa a
executar, nesta ordem:

1. **Convite primeiro, fora de transação SQL** (é uma chamada de rede à Auth API, não pode entrar
   numa transação Postgres — mesma razão pela qual trigger nunca faz HTTP): `supabase.auth.admin
   .inviteUserByEmail(owner_email)`. Se o e-mail já pertence a um usuário existente, resolve o
   `user_id` existente em vez de enviar convite novo (idempotente — reenviar para o mesmo e-mail
   não duplica).
2. **Transação SQL única** (organization + membership + subscription): insere a `organization`,
   insere `user_organizations` com `role='admin'` e `pending_invite=true` (novo booleano — vira
   `false` quando o convite é aceito, via callback/trigger de `auth.users` já existente ou checado
   no login), insere a linha inicial em `organization_subscriptions` com o `plan_id` escolhido no
   formulário e `status='active'`.
3. Se o passo 2 falhar depois do passo 1 ter sucesso, a operação retorna erro explícito ao admin
   (não cria organization órfã); reenviar a operação é seguro porque o invite já é idempotente.
4. `api_audit_log` ganha uma entrada de criação, incluindo `plan_id` atribuído.

`app/admin/(protected)/tenants/[id]/` ganha uma ação "Alterar plano": abre modal, escolhe novo
`plan_id`, escreve a nova linha em `organization_subscriptions` fechando a anterior, grava audit
log. Endpoint novo: `PATCH /api/v1/admin/tenants/[id]/subscription`.

## Tratamento de erros e casos-limite

- **E-mail já é dono de outra organization**: fluxo de "adicionar membership à conta existente"
  em vez de convite novo, conforme passo 1 acima.
- **Plano inexistente ou inativo** (`plans.is_active=false`): Zod + FK barram; endpoint retorna
  `fail()` com código `plan_inactive`.
- **Downgrade com dados acima do novo limite** (ex.: tenant tem 10 usuários, novo plano permite 5):
  **fora de escopo desta spec**. Esta mudança só registra o plano vigente; enforcement de
  `limits` (feature-gating) é trabalho futuro separado — TODO explícito, não implementar aqui.
- **Cobrança automática por organization (`billing_mode = 'paysuite_managed'`)**: fora de escopo de
  implementação desta spec. O campo existe desde já para não exigir migration nova quando for
  ligado, mas nenhuma lógica de cobrança automática é construída agora — `billing_mode` fica sempre
  `'manual'` na prática até uma spec futura decidir o fluxo (webhook, retries, degradação por
  inadimplência).

## Testes

- Invariante de RLS (`tests/invariants/`): 2 organizations, cada uma só vê a própria
  `organization_subscriptions`.
- Unit do `POST /api/v1/admin/tenants` (hoje sem teste nenhum): sucesso completo, invite falha não
  cria organization, e-mail já existente vira membership em vez de convite.
- Unit do `PATCH /api/v1/admin/tenants/[id]/subscription`: linha antiga fecha (`ended_at`
  preenchido), exatamente uma linha com `ended_at is null` por organization, `plan_inactive`
  rejeitado.
- E2E (Playwright, doutrina de QA Visual): fluxo completo "admin cria tenant → e-mail de convite →
  owner aceita → owner loga" pela tela — prova o bug original resolvido, não só o backend.
- Migration validada em Postgres descartável (`pgvector/pgvector:pg17`): install fresh
  (`ON_ERROR_STOP=1`) e update idempotente, incluindo a renomeação das tabelas `licensing_*`.

## Fora de escopo desta spec

- Self-service de signup (confirmado nesta sessão: criação continua manual pelo admin).
- Cobrança automática via PaySuite por organization (campo `billing_mode` preparado, lógica não
  implementada).
- Enforcement de `limits` do plano (feature-gating por nº de usuários/conexões/etc.).
- Apagar de vez as tabelas `_deprecated_licensing_*` (decisão operacional futura).
- Atualização de `CLAUDE.md`/`VISION.md` para refletir o novo eixo de negócio (instância central
  multi-tenant em vez de self-host por cliente) — tratar como tarefa documental separada, antes ou
  junto do merge desta feature.
