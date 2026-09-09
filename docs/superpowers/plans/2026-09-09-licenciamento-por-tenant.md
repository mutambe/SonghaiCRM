# Licenciamento por Tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o fluxo de criação de tenant (owner_email hoje é descartado) e introduzir um catálogo real de pacotes (Agente Simples/Médio/Avançado/Enterprise) atribuível e alterável por organization, com enforcement de limites (nº de usuários, nº de conexões WhatsApp), descontinuando o modelo antigo de licenciamento por instalação.

**Architecture:** Duas tabelas novas (`plans` catálogo global, `organization_subscriptions` histórico versionado por organization — nunca UPDATE, sempre fecha+insere). `POST /api/v1/admin/tenants` passa a convidar o owner de verdade via `supabase.auth.admin.inviteUserByEmail` e criar a assinatura inicial na mesma operação. Um novo `PATCH .../subscription` permite trocar de plano depois. Um helper `lib/plans/limiteDoTenant.ts` é consultado nos dois pontos de escrita que contam contra limite (`team/invite`, `channel-sessions` POST) antes de criar a linha nova.

**Tech Stack:** Next.js Route Handlers, Supabase (Postgres + Auth Admin API), Zod, Vitest, Playwright — stack já em uso no repo, nenhuma dependência nova.

**Spec:** [`docs/superpowers/specs/2026-09-09-licenciamento-por-tenant-design.md`](../specs/2026-09-09-licenciamento-por-tenant-design.md)

## Global Constraints

- Toda tabela nova tenant-aware leva `organization_id` + RLS via `fn_user_org_ids()`; `plans` não é tenant-aware (catálogo global).
- Toda `create table` em `public` nasce com `ALL` para `anon`/`authenticated` por `ALTER DEFAULT PRIVILEGES` do baseline — **todo** `revoke`/`grant` deste plano usa `revoke all on ... from anon, authenticated` (as duas roles), nunca só uma.
- Mudança de schema sai em tripla: `supabase/migrations/*.sql` + apêndice idempotente em `supabase/baseline.sql` + linha em `supabase/migrations/MANIFEST.md`.
- Rotas `/api/v1/*` usam só `ok()`/`fail()` de `lib/api/wrappers.ts`; código de erro novo entra em `lib/api/errors.ts`, nunca renomeia um existente.
- `getUser()` nunca `getSession()`; handlers com `createAdminClient()` (service role, bypassa RLS) filtram `organization_id` manualmente.
- Toda mutação POST/PATCH bem-sucedida emite `audit()`; ação nova entra no fim de `lib/audit/actions.ts` (`AUDIT_ACTIONS`), nunca renomeia.
- Sem `console.log` deixado; `npm run typecheck` e `npm run lint` zerados ao final.

---

## File Structure

| Arquivo | Papel |
|---|---|
| `supabase/migrations/20260909140000_0176_licenciamento_por_tenant.sql` | Cria `plans`, `organization_subscriptions`; renomeia `licensing_*` → `_deprecated_licensing_*` |
| `supabase/baseline.sql` | Apêndice idempotente equivalente, para o kit self-host |
| `supabase/migrations/MANIFEST.md` | Linha nova na tabela "Applied" |
| `lib/api/errors.ts` | Novos códigos `plan_inactive`, `plan_limit_reached` |
| `lib/audit/actions.ts` | Novas ações `tenant.owner_invited`, `tenant.subscription_assigned`, `tenant.subscription_changed` |
| `lib/plans/limiteDoTenant.ts` (novo) | Resolve limites vigentes de uma organization a partir de `organization_subscriptions` → `plans.limits` |
| `lib/plans/limiteDoTenant.test.ts` (novo) | Unit do helper acima |
| `tests/invariants/rls-isolation.test.ts` | Adiciona `organization_subscriptions` ao array `TABLES` + seed |
| `app/api/v1/plans/route.ts` (novo) | `GET` — catálogo de pacotes ativos, para o formulário |
| `app/api/v1/plans/route.test.ts` (novo) | Unit |
| `app/api/v1/admin/tenants/route.ts` | `POST` reescrito: convite real do owner + assinatura inicial; `createSchema.plan` vira `plan_id` uuid; `"conflict"` → `tenant_already_exists` |
| `app/api/v1/admin/tenants/route.test.ts` (novo) | Unit do `POST` (hoje não existe nenhum) |
| `app/auth/confirm/route.ts` | Novo branch `type === "invite"` — pula `ensureTenantForUser` (org/membership já existem) |
| `hooks/useCreateTenant.ts` | `plan` (enum) → `plan_id` (uuid) |
| `hooks/usePlans.ts` (novo) | `GET /api/v1/plans` para preencher o seletor |
| `app/admin/(protected)/tenants/new/_form.tsx` | Seletor de plano passa a listar os 4 pacotes reais com preço |
| `app/api/v1/admin/tenants/[id]/route.ts` | `GET` passa a incluir a assinatura vigente (`plan`, `status`) na resposta |
| `app/api/v1/admin/tenants/[id]/subscription/route.ts` (novo) | `PATCH` — troca de plano |
| `app/api/v1/admin/tenants/[id]/subscription/route.test.ts` (novo) | Unit |
| `hooks/useTenantDetail.ts` | Tipo `TenantDetailResponse` ganha `subscription` |
| `hooks/useChangeSubscription.ts` (novo) | Mutation do `PATCH` acima |
| `components/admin/tenants/TenantOverview.tsx` | Lê `subscription.plan_display_name`/`status` em vez de `settings.plan` |
| `components/admin/tenants/ChangePlanDialog.tsx` (novo) | Modal "Alterar plano" |
| `components/admin/tenants/TenantActions.tsx` | Novo botão "Alterar plano" abrindo o modal acima |
| `app/api/v1/team/invite/route.ts` | Enforcement de `max_users` antes de enviar convites |
| `app/api/v1/team/invite/route.test.ts` | Novo caso: limite atingido |
| `app/api/v1/channel-sessions/route.ts` | Enforcement de `max_whatsapp_connections` antes de criar sessão |
| `app/api/v1/channel-sessions/route.test.ts` (novo, se não existir) | Novo caso: limite atingido |
| `app/admin/(protected)/licensing/` | Removido (pasta inteira) |
| `app/api/v1/licensing/admin/` | Removido (pasta inteira) |
| `tests/e2e/admin-cria-tenant-convite-owner.spec.ts` (novo) | E2E: admin cria tenant → owner aceita convite → loga |

---

### Task 1: Migration — `plans` + `organization_subscriptions` + descontinuação de `licensing_*`

**Files:**
- Create: `supabase/migrations/20260909140000_0176_licenciamento_por_tenant.sql`
- Modify: `supabase/baseline.sql` (apêndice no final do arquivo)
- Modify: `supabase/migrations/MANIFEST.md`

**Interfaces:**
- Produces: tabela `public.plans(id, slug, display_name, price_cents, setup_fee_cents, currency, limits jsonb, is_active)`; tabela `public.organization_subscriptions(id, organization_id, plan_id, status, billing_mode, assigned_by, notes, started_at, ended_at)` com índice único parcial garantindo no máximo 1 linha `ended_at is null` por `organization_id`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 20260909140000_0176_licenciamento_por_tenant.sql
--
-- Licenciamento por tenant (organization): catálogo real de pacotes
-- (songhai.cc/precos) + assinatura versionada. Substitui o modelo de
-- licenciamento por instalação (0173/0174) — decisão do dono do produto
-- (2026-09-09): uma única instância central multi-tenant, não uma
-- instalação self-host separada por cliente.
-- Ver docs/superpowers/specs/2026-09-09-licenciamento-por-tenant-design.md.

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in ('agente_simples', 'agente_medio', 'agente_avancado', 'enterprise')),
  display_name text not null,
  price_cents integer,
  setup_fee_cents integer,
  currency text not null default 'MZN',
  limits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.plans (slug, display_name, price_cents, setup_fee_cents, limits)
values
  ('agente_simples', 'Agente Simples', 500000, 200000, '{"max_users": 20, "max_whatsapp_connections": 1}'),
  ('agente_medio', 'Agente Médio', 800000, 300000, '{"max_users": 50, "max_whatsapp_connections": 2}'),
  ('agente_avancado', 'Agente Avançado', 1200000, 400000, '{"max_users": 200, "max_whatsapp_connections": 5}'),
  ('enterprise', 'Enterprise', null, null, '{}')
on conflict (slug) do nothing;

alter table public.plans enable row level security;
revoke all on public.plans from anon, authenticated;
grant select on public.plans to authenticated;
grant select, insert, update on public.plans to service_role;

drop policy if exists "plans_select_authenticated" on public.plans;
create policy "plans_select_authenticated" on public.plans
  for select to authenticated using (true);

-- Cobrança Songhai -> tenant (licença/plano). NÃO confundir com o módulo
-- comercial do tenant (PaySuite que a organization usa para cobrar os
-- próprios leads/clientes) — esse módulo não é tocado por esta migration.
create table if not exists public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status text not null check (status in ('active', 'suspended', 'cancelled')),
  billing_mode text not null default 'manual' check (billing_mode in ('manual', 'paysuite_managed')),
  assigned_by uuid references auth.users(id),
  notes text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists organization_subscriptions_org_idx
  on public.organization_subscriptions using btree (organization_id);

create unique index if not exists uq_organization_subscriptions_one_current
  on public.organization_subscriptions (organization_id)
  where ended_at is null;

alter table public.organization_subscriptions enable row level security;
revoke all on public.organization_subscriptions from anon, authenticated;
grant select on public.organization_subscriptions to authenticated;
grant select, insert, update on public.organization_subscriptions to service_role;

drop policy if exists "organization_subscriptions_tenant_select" on public.organization_subscriptions;
create policy "organization_subscriptions_tenant_select" on public.organization_subscriptions
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

-- Descontinuação do modelo de licenciamento por instalação (0173/0174):
-- renomeia em vez de apagar, para preservar histórico de trials/pagamentos
-- já emitidos. Idempotente via IF EXISTS — no update.sh de quem já rodou
-- esta migration, as tabelas de origem não existem mais e o comando é nulo.
alter table if exists public.licensing_installs rename to _deprecated_licensing_installs;
alter table if exists public.licensing_licenses rename to _deprecated_licensing_licenses;
alter table if exists public.licensing_payments rename to _deprecated_licensing_payments;
alter table if exists public.licensing_client_state rename to _deprecated_licensing_client_state;
alter table if exists public.licensing_paysuite_credentials rename to _deprecated_licensing_paysuite_credentials;
```

- [ ] **Step 2: Validar install fresco num Postgres descartável**

```bash
docker run --rm -d --name pg176test -e POSTGRES_PASSWORD=postgres -p 55432:5432 pgvector/pgvector:pg17
sleep 3
docker exec -i pg176test psql -U postgres -v ON_ERROR_STOP=1 < supabase/baseline.sql
```

Expected: sem erro. (O `baseline.sql` ainda NÃO tem o apêndice novo neste passo — isto valida que o `baseline.sql` atual, sem a mudança, ainda instala limpo, como controle antes de mexer nele.)

- [ ] **Step 3: Aplicar a migration nova sobre esse banco e verificar as tabelas**

```bash
docker exec -i pg176test psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/20260909140000_0176_licenciamento_por_tenant.sql
docker exec -i pg176test psql -U postgres -c "select slug, price_cents, limits from public.plans order by slug;"
docker exec -i pg176test psql -U postgres -c "select to_regclass('public._deprecated_licensing_installs'), to_regclass('public.licensing_installs');"
```

Expected: 4 linhas em `plans` (agente_avancado/agente_medio/agente_simples/enterprise); `_deprecated_licensing_installs` existe, `licensing_installs` é `NULL`.

- [ ] **Step 4: Reaplicar a migration no MESMO banco (teste de idempotência)**

```bash
docker exec -i pg176test psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/20260909140000_0176_licenciamento_por_tenant.sql
docker rm -f pg176test
```

Expected: sem erro (segunda aplicação é no-op — `create table if not exists`, `on conflict do nothing`, `alter table if exists` já renomeada não encontra o nome de origem).

- [ ] **Step 5: Apender o mesmo bloco ao final de `supabase/baseline.sql`**

Cole o corpo do Step 1 (sem o comentário de cabeçalho de migration) no final do arquivo, seguindo o padrão de separador já usado nos blocos anteriores:

```sql
-- ---- licenciamento por tenant, substitui modelo por instalação (migration 0176) ----

<mesmo corpo SQL do Step 1, do "create table if not exists public.plans" até o último "alter table ... rename to">
```

- [ ] **Step 6: Adicionar linha na tabela "Applied" de `supabase/migrations/MANIFEST.md`**

Inserir logo após a linha da `0175` (linha 227 hoje), seguindo o formato exato das linhas vizinhas:

```markdown

| `20260909140000` | `0176_licenciamento_por_tenant` | Licenciamento por tenant: catálogo real `plans` (Agente Simples/Médio/Avançado/Enterprise, songhai.cc/precos) + `organization_subscriptions` versionada (nunca UPDATE — fecha e insere). Descontinua o modelo por instalação (0173/0174): renomeia `licensing_*` para `_deprecated_licensing_*` em vez de apagar. Decisão do dono do produto (2026-09-09): instância central única multi-tenant, não self-host por cliente. |
```

- [ ] **Step 7: Rodar a suíte completa de invariantes contra `baseline.sql` já com o apêndice**

```bash
pnpm test:db
```

Expected: PASS (install fresh `ON_ERROR_STOP=1` + update idempotente + os 364 invariantes existentes, sem nenhum específico de `organization_subscriptions` ainda — isso é a Task 5).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260909140000_0176_licenciamento_por_tenant.sql supabase/baseline.sql supabase/migrations/MANIFEST.md
git commit -m "feat(schema): plans + organization_subscriptions, descontinua licensing por instalação"
```

---

### Task 2: Códigos de erro novos

**Files:**
- Modify: `lib/api/errors.ts:39-45` (bloco 409, perto de `tenant_already_exists`)

**Interfaces:**
- Produces: `ApiErrorCodes.plan_inactive`, `ApiErrorCodes.plan_limit_reached` — consumidos nas Tasks 7, 9 e 10.

- [ ] **Step 1: Adicionar os códigos**

```ts
// dentro do bloco "// 409 — conflito", logo após a linha de tenant_already_exists:
  tenant_already_exists: "tenant_already_exists",
  plan_inactive: "plan_inactive", // plan_id referenciado existe mas plans.is_active = false
  plan_limit_reached: "plan_limit_reached", // limits.max_users/max_whatsapp_connections do pacote atingido
```

(Ambos entram no bloco 409 — é o mesmo raciocínio de `tenant_already_exists`: o request em si é válido, o estado atual do recurso é que não permite.)

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 erros (é só extensão de um `as const`, nenhum consumidor ainda).

- [ ] **Step 3: Commit**

```bash
git add lib/api/errors.ts
git commit -m "feat(api): códigos de erro plan_inactive e plan_limit_reached"
```

---

### Task 3: Ações de auditoria novas

**Files:**
- Modify: `lib/audit/actions.ts:326` (fim do array `AUDIT_ACTIONS`, logo após `"appointment.status_changed"`)

**Interfaces:**
- Produces: `"tenant.owner_invited"`, `"tenant.subscription_assigned"`, `"tenant.subscription_changed"` — consumidos nas Tasks 7 e 9.

- [ ] **Step 1: Adicionar no fim do array (nunca no meio — a regra do arquivo é "acrescente no fim")**

```ts
  "appointment.status_changed",
  // Licenciamento por tenant (0176): convite real do owner na criação do
  // tenant (antes o owner_email era descartado) e as duas mutações da
  // assinatura versionada — criação inicial e troca de plano.
  "tenant.owner_invited",
  "tenant.subscription_assigned",
  "tenant.subscription_changed",
  "licensing.license_issued",
] as const;
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 erros.

- [ ] **Step 3: Commit**

```bash
git add lib/audit/actions.ts
git commit -m "feat(audit): ações de licenciamento por tenant"
```

---

### Task 4: `lib/plans/limiteDoTenant.ts`

**Files:**
- Create: `lib/plans/limiteDoTenant.ts`
- Create: `lib/plans/limiteDoTenant.test.ts`

**Interfaces:**
- Consumes: `createAdminClient()` de `@/lib/supabase/admin`.
- Produces: `export interface LimitesDoPlano { planSlug: string; planDisplayName: string; maxUsers: number; maxWhatsappConnections: number; }` e `export async function limitesDoTenant(organizationId: string): Promise<LimitesDoPlano | null>` — consumido nas Tasks 10 (enforcement) e 9 (UI mostrando o plano vigente).

- [ ] **Step 1: Escrever o teste (falhando — o arquivo ainda não existe)**

```ts
// lib/plans/limiteDoTenant.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";

function stubWithPlan(plan: { slug: string; display_name: string; limits: Record<string, number> } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({ data: plan ? { plan } : null, error: null }),
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("limitesDoTenant", () => {
  it("retorna Infinity para limite ausente na chave (caso Enterprise)", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      stubWithPlan({ slug: "enterprise", display_name: "Enterprise", limits: {} }) as never,
    );
    const { limitesDoTenant } = await import("./limiteDoTenant");
    const limites = await limitesDoTenant(ORG_ID);
    expect(limites?.maxUsers).toBe(Infinity);
    expect(limites?.maxWhatsappConnections).toBe(Infinity);
  });

  it("retorna os números do plano quando presentes", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      stubWithPlan({
        slug: "agente_simples",
        display_name: "Agente Simples",
        limits: { max_users: 20, max_whatsapp_connections: 1 },
      }) as never,
    );
    const { limitesDoTenant } = await import("./limiteDoTenant");
    const limites = await limitesDoTenant(ORG_ID);
    expect(limites).toEqual({
      planSlug: "agente_simples",
      planDisplayName: "Agente Simples",
      maxUsers: 20,
      maxWhatsappConnections: 1,
    });
  });

  it("retorna null quando não há assinatura vigente", async () => {
    vi.mocked(createAdminClient).mockReturnValue(stubWithPlan(null) as never);
    const { limitesDoTenant } = await import("./limiteDoTenant");
    expect(await limitesDoTenant(ORG_ID)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npx vitest run lib/plans/limiteDoTenant.test.ts
```

Expected: FAIL — `Cannot find module './limiteDoTenant'`.

- [ ] **Step 3: Implementar**

```ts
// lib/plans/limiteDoTenant.ts
import { createAdminClient } from "@/lib/supabase/admin";

export interface LimitesDoPlano {
  planSlug: string;
  planDisplayName: string;
  maxUsers: number;
  maxWhatsappConnections: number;
}

interface PlanRow {
  slug: string;
  display_name: string;
  limits: Record<string, number>;
}

/**
 * Limites vigentes de uma organization, via organization_subscriptions →
 * plans. Chave ausente em `limits` (caso do Enterprise) = sem limite
 * (Infinity), nunca zero — zero bloquearia toda criação.
 */
export async function limitesDoTenant(organizationId: string): Promise<LimitesDoPlano | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_subscriptions")
    .select("plan:plans(slug, display_name, limits)")
    .eq("organization_id", organizationId)
    .is("ended_at", null)
    .maybeSingle();

  if (error || !data) return null;
  const plan = (data as { plan: PlanRow | null }).plan;
  if (!plan) return null;

  return {
    planSlug: plan.slug,
    planDisplayName: plan.display_name,
    maxUsers: plan.limits.max_users ?? Infinity,
    maxWhatsappConnections: plan.limits.max_whatsapp_connections ?? Infinity,
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npx vitest run lib/plans/limiteDoTenant.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add lib/plans/limiteDoTenant.ts lib/plans/limiteDoTenant.test.ts
git commit -m "feat(plans): helper de limites vigentes por tenant"
```

---

### Task 5: Invariante de RLS para `organization_subscriptions`

**Files:**
- Modify: `tests/invariants/rls-isolation.test.ts`

**Interfaces:**
- Consumes: `sql()`, `countAs()`, o bloco `do $seed$` já existente (linhas 93-192 hoje).

- [ ] **Step 1: Ler o arquivo atual antes de editar**

```bash
cat -n tests/invariants/rls-isolation.test.ts | sed -n '139,227p'
```

Confirme os números de linha exatos antes de editar — o arquivo pode ter mudado desde a leitura usada para este plano (2026-09-09).

- [ ] **Step 2: Adicionar o seed de `organization_subscriptions` dentro do `foreach v_org` (logo após o bloco de `contact_field_proposals`, antes do `end loop;`)**

```sql
        -- organization_subscriptions (migration 0176): cada org de teste
        -- recebe uma assinatura no plano 'agente_simples' — plans é catálogo
        -- global já seedado pela própria migration, sem depender de fixture.
        if not exists (select 1 from public.organization_subscriptions where organization_id = v_org) then
          insert into public.organization_subscriptions (organization_id, plan_id, status)
            select v_org, id, 'active' from public.plans where slug = 'agente_simples' limit 1;
        end if;
```

- [ ] **Step 3: Adicionar `"organization_subscriptions"` ao array `TABLES`**

```ts
const TABLES = [
  // ... linhas existentes ...
  "org_guardrail_layers",
  // migration 0176 — assinatura de plano por tenant. plans (o catálogo) NÃO
  // entra aqui: não é tenant-aware, é leitura pública autenticada por design.
  "organization_subscriptions",
] as const;
```

- [ ] **Step 4: Rodar a suíte de invariantes**

```bash
pnpm test:db
```

Expected: PASS, incluindo os 2 testes novos gerados automaticamente para `organization_subscriptions` (cross-tenant = 0, own-org ≥ 1).

- [ ] **Step 5: Sabotar a policy e confirmar que o teste pega (prova de que ele vigia)**

Temporariamente troque a policy da Task 1 para `using (true)` num banco de teste local, rode `pnpm test:db` de novo, confirme que o teste de `organization_subscriptions` FALHA, depois reverta a policy para o valor real e rode `pnpm test:db` uma última vez confirmando PASS. Não commite a versão sabotada.

- [ ] **Step 6: Commit**

```bash
git add tests/invariants/rls-isolation.test.ts
git commit -m "test(rls): isolamento de organization_subscriptions entre tenants"
```

---

### Task 6: `GET /api/v1/plans` + `hooks/usePlans.ts`

**Files:**
- Create: `app/api/v1/plans/route.ts`
- Create: `app/api/v1/plans/route.test.ts`
- Create: `hooks/usePlans.ts`

**Interfaces:**
- Produces: `GET /api/v1/plans` → `{ data: Array<{ id: string; slug: string; display_name: string; price_cents: number | null; setup_fee_cents: number | null; currency: string }> }`, só planos `is_active = true`. Hook `usePlans()` retorna `useQuery` com essa forma — consumido na Task 8.

- [ ] **Step 1: Escrever o teste da rota (falhando)**

```ts
// app/api/v1/plans/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const PLANS = [
  { id: "p1", slug: "agente_simples", display_name: "Agente Simples", price_cents: 500000, setup_fee_cents: 200000, currency: "MZN", is_active: true },
  { id: "p2", slug: "agente_medio", display_name: "Agente Médio", price_cents: 800000, setup_fee_cents: 300000, currency: "MZN", is_active: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAdminClient).mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: PLANS.filter((p) => p.is_active), error: null }),
        }),
      }),
    }),
  } as never);
});

describe("GET /api/v1/plans", () => {
  it("lista só planos ativos", async () => {
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/plans"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ slug: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.slug).toBe("agente_simples");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npx vitest run app/api/v1/plans/route.test.ts
```

Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implementar a rota**

```ts
// app/api/v1/plans/route.ts
import { randomUUID } from "node:crypto";
import { ok, fail } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("plans")
    .select("id, slug, display_name, price_cents, setup_fee_cents, currency")
    .eq("is_active", true)
    .order("price_cents", { ascending: true, nullsFirst: false });

  if (error) {
    return fail("internal_error", "Falha ao listar pacotes", 500, {
      requestId,
      details: error.message,
    });
  }

  return ok(data ?? [], { requestId });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npx vitest run app/api/v1/plans/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Hook**

```ts
// hooks/usePlans.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";

export interface Plan {
  id: string;
  slug: string;
  display_name: string;
  price_cents: number | null;
  setup_fee_cents: number | null;
  currency: string;
}

export interface PlansResponse {
  data: Plan[];
}

export function usePlans() {
  return useQuery({
    queryKey: ["plans"] as const,
    queryFn: () => apiClient.get<PlansResponse>("/api/v1/plans"),
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add app/api/v1/plans hooks/usePlans.ts
git commit -m "feat(plans): endpoint público de catálogo + hook usePlans"
```

---

### Task 7: `POST /api/v1/admin/tenants` — convite real do owner + assinatura inicial

**Files:**
- Modify: `app/api/v1/admin/tenants/route.ts:20-31` (schema), `166-245` (handler POST)
- Create: `app/api/v1/admin/tenants/route.test.ts`
- Modify: `app/auth/confirm/route.ts` (novo branch `type === "invite"`)

**Interfaces:**
- Consumes: `limitesDoTenant` NÃO é usado aqui (tenant novo não tem membros ainda). Usa `ApiErrorCodes.plan_inactive`, `ApiErrorCodes.tenant_already_exists` (Task 2), ações `tenant.owner_invited`/`tenant.subscription_assigned` (Task 3).
- Produces: `POST /api/v1/admin/tenants` passa a aceitar `plan_id: string (uuid)` em vez de `plan: enum`; resposta 201 inalterada (`{ id, slug, display_name }`).

**Contexto crítico (não pular):** `app/auth/confirm/route.ts` hoje trata qualquer `type` que não seja `"recovery"` como fluxo de signup — chama `ensureTenantForUser(data.user)`, que **cria uma organization nova automaticamente** para quem acabou de confirmar e-mail. Se o convite do owner usar `supabase.auth.admin.inviteUserByEmail` (que gera link com `type=invite`), o owner cairia nesse branch e ganharia uma SEGUNDA organization, além da que o admin já criou — organization órfã duplicada. Por isso o Step 5 deste task edita `/auth/confirm` ANTES de o Step 6 rodar de ponta a ponta.

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// app/api/v1/admin/tenants/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";

function bodyDe(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    display_name: "Loja da Maria",
    slug: "loja-da-maria",
    plan_id: PLAN_ID,
    owner_email: "maria@example.com",
    ...overrides,
  };
}

function postReq(body: unknown) {
  return new NextRequest("http://localhost/api/v1/admin/tenants", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformAdmin).mockResolvedValue({
    user: { id: ADMIN_ID },
    platformAdmin: { user_id: ADMIN_ID, scope: "full", mfa_required: true },
  } as never);
});

describe("POST /api/v1/admin/tenants", () => {
  it("convida o owner, cria a org e a assinatura inicial — sucesso completo", async () => {
    const inviteUserByEmail = vi.fn(async () => ({ data: { user: { id: OWNER_ID } }, error: null }));
    const insertedOrg = { id: ORG_ID, slug: "loja-da-maria", display_name: "Loja da Maria" };
    let insertedMembership: unknown = null;
    let insertedSubscription: unknown = null;

    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { inviteUserByEmail } },
      from: (table: string) => {
        if (table === "plans") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: PLAN_ID, is_active: true }, error: null }) }) }) };
        }
        if (table === "organizations") {
          return { insert: () => ({ select: () => ({ single: async () => ({ data: insertedOrg, error: null }) }) }) };
        }
        if (table === "user_organizations") {
          return { insert: (v: unknown) => { insertedMembership = v; return { then: (r: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(r) }; } };
        }
        if (table === "organization_subscriptions") {
          return { insert: (v: unknown) => { insertedSubscription = v; return { then: (r: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(r) }; } };
        }
        throw new Error(`tabela não simulada: ${table}`);
      },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(postReq(bodyDe()));
    expect(res.status).toBe(201);
    expect(inviteUserByEmail).toHaveBeenCalledWith("maria@example.com", expect.objectContaining({ redirectTo: expect.any(String) }));
    expect(insertedMembership).toMatchObject({ organization_id: ORG_ID, user_id: OWNER_ID, role: "admin" });
    expect(insertedSubscription).toMatchObject({ organization_id: ORG_ID, plan_id: PLAN_ID, status: "active" });
  });

  it("plan_id inexistente/inativo → 409 plan_inactive, não cria organization", async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { inviteUserByEmail: vi.fn() } },
      from: (table: string) => {
        if (table === "plans") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
        }
        throw new Error(`não deveria chegar em ${table}`);
      },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(postReq(bodyDe()));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("plan_inactive");
  });

  it("slug duplicado → 409 tenant_already_exists (não mais 'conflict')", async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { inviteUserByEmail: vi.fn(async () => ({ data: { user: { id: OWNER_ID } }, error: null })) } },
      from: (table: string) => {
        if (table === "plans") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: PLAN_ID, is_active: true }, error: null }) }) }) };
        }
        if (table === "organizations") {
          return { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }) }) }) };
        }
        throw new Error(`não deveria chegar em ${table}`);
      },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(postReq(bodyDe()));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("tenant_already_exists");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npx vitest run app/api/v1/admin/tenants/route.test.ts
```

Expected: FAIL (schema ainda espera `plan` enum, não convida ninguém, código ainda é `"conflict"`).

- [ ] **Step 3: Reescrever `createSchema` e o handler `POST`**

```ts
// app/api/v1/admin/tenants/route.ts — substituir createSchema (linhas 20-31)
const createSchema = z.object({
  display_name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  legal_name: z.string().min(2).max(255).optional(),
  nuit: z.string().optional(),
  plan_id: z.string().uuid(),
  owner_email: z.string().email(),
});
```

```ts
// app/api/v1/admin/tenants/route.ts — substituir POST (linhas 166-245) por:
export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_error", "Invalid JSON body", 400, { requestId });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_error", "Invalid request body", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { display_name, slug, legal_name, nuit, plan_id, owner_email } = parsed.data;
  const admin = createAdminClient();

  // 1) Plano precisa existir e estar ativo — falha ANTES de convidar ninguém.
  const { data: plan } = await admin
    .from("plans")
    .select("id, is_active")
    .eq("id", plan_id)
    .maybeSingle();
  if (!plan || !plan.is_active) {
    return fail("plan_inactive", "Pacote inexistente ou inativo", 409, { requestId });
  }

  // 2) Convite do owner — chamada de rede à Auth API, fica FORA da transação
  // SQL que vem a seguir (trigger nunca faz HTTP; o mesmo raciocínio vale
  // para um handler que precisa da resposta da rede antes de decidir).
  // redirectTo aponta para /auth/confirm com type=invite explícito: o link
  // que o Supabase gera para convite não inclui `type` na query (mesmo
  // motivo documentado em requestPasswordReset.ts para recovery), então
  // precisamos afirmá-lo aqui para /auth/confirm saber que não deve
  // provisionar uma organization nova para este usuário.
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    owner_email,
    { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm?type=invite` },
  );
  if (inviteError || !invited?.user) {
    return fail(
      "internal_error",
      "Falha ao convidar o responsável pelo tenant",
      500,
      { requestId, details: inviteError?.message },
    );
  }
  const ownerId = invited.user.id;

  void audit({
    action: "tenant.owner_invited",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    requestId,
    metadata: { owner_email_hash: hashEmail(owner_email) },
  });

  // 3) Organization
  const { data: org, error: insertError } = await admin
    .from("organizations")
    .insert({
      display_name,
      slug,
      legal_name: legal_name ?? null,
      nuit: nuit ?? null,
      status: "active",
      created_by: adminCtx.user.id,
    })
    .select("id, slug, display_name")
    .single();

  if (insertError || !org) {
    if (insertError?.code === "23505") {
      return fail("tenant_already_exists", "Slug already exists", 409, { requestId });
    }
    return fail("internal_error", "Failed to create tenant", 500, {
      requestId,
      details: insertError?.message,
    });
  }

  // 4) Membership do owner (role admin) — não bloqueia a resposta 201 se
  // falhar isoladamente aqui seria pior (org sem dono), então propaga erro.
  const { error: memberError } = await admin.from("user_organizations").insert({
    organization_id: org.id,
    user_id: ownerId,
    role: "admin",
    accepted_at: null,
  });
  if (memberError) {
    return fail("internal_error", "Tenant criado mas falhou ao vincular o responsável", 500, {
      requestId,
      details: memberError.message,
    });
  }

  // 5) Assinatura inicial
  const { error: subError } = await admin.from("organization_subscriptions").insert({
    organization_id: org.id,
    plan_id,
    status: "active",
    assigned_by: adminCtx.user.id,
  });
  if (subError) {
    return fail("internal_error", "Tenant criado mas falhou ao atribuir o plano", 500, {
      requestId,
      details: subError.message,
    });
  }

  void audit({
    action: "tenant.subscription_assigned",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    organizationId: org.id,
    resourceType: "organization_subscription",
    requestId,
    metadata: { plan_id },
  });

  void audit({
    action: "tenant.created_by_platform_admin",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: org.id,
    resourceType: "organization",
    resourceId: org.id,
    requestId,
    metadata: { slug: org.slug, display_name: org.display_name, plan_id },
  });

  return ok(
    { id: org.id, slug: org.slug, display_name: org.display_name },
    { status: 201, requestId },
  );
}
```

Adicionar ao topo do arquivo: `import { audit, hashEmail } from "@/lib/audit";` (substitui o `import { audit } from "@/lib/audit"` existente na linha 6).

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npx vitest run app/api/v1/admin/tenants/route.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Editar `/auth/confirm` — branch `type === "invite"`**

Em `app/auth/confirm/route.ts`, logo após o branch existente `if (type === "recovery") { return redirectTo("/login/reset"); }` (linha 103-105), adicionar:

```ts
  if (type === "invite") {
    // O owner de um tenant criado por POST /api/v1/admin/tenants — a
    // organization e a membership JÁ existem (criadas naquele handler).
    // Cair no branch de signup abaixo chamaria ensureTenantForUser e criaria
    // uma SEGUNDA organization para este usuário. Convite aceito = só falta
    // definir senha; reusa a mesma tela de "nova senha" da recuperação.
    void audit({
      action: "auth.signup_confirmed",
      actorUserId: data.user.id,
      metadata: { via: "tenant_owner_invite" },
      requestId,
    });
    return redirectTo("/login/reset");
  }

```

- [ ] **Step 6: Testes existentes de `/auth/confirm` continuam passando**

```bash
npx vitest run tests/unit/link-de-email-tem-uma-query-so.test.ts
npx vitest run app/auth/confirm
```

Expected: PASS — nenhum teste existente cobre `type=invite` hoje, então nada quebra; se algum arquivo de teste cobrir esse route file inteiro, rode-o também antes de seguir.

- [ ] **Step 7: Typecheck + lint**

```bash
npx tsc --noEmit
npx eslint app/api/v1/admin/tenants/route.ts app/auth/confirm/route.ts
```

Expected: 0 erros.

- [ ] **Step 8: Commit**

```bash
git add app/api/v1/admin/tenants/route.ts app/api/v1/admin/tenants/route.test.ts app/auth/confirm/route.ts
git commit -m "fix(tenants): convida o owner de verdade e atribui a assinatura inicial"
```

---

### Task 8: Formulário de criação — plano real com preço

**Files:**
- Modify: `hooks/useCreateTenant.ts`
- Modify: `app/admin/(protected)/tenants/new/_form.tsx`

**Interfaces:**
- Consumes: `usePlans()` (Task 6) → `Plan[]`.
- Produces: `CreateTenantPayload.plan_id: string` (substitui `plan?: "standard" | "pro" | "enterprise"`).

- [ ] **Step 1: Atualizar o hook**

```ts
// hooks/useCreateTenant.ts
export interface CreateTenantPayload {
  display_name: string;
  slug: string;
  legal_name?: string;
  nuit?: string;
  plan_id: string;
  owner_email: string;
}
```//(resto do arquivo inalterado — só o campo `plan` vira `plan_id: string`, sem default aqui, o form decide)

- [ ] **Step 2: Atualizar o formulário — schema, estado e o `<Select>` de plano**

```tsx
// app/admin/(protected)/tenants/new/_form.tsx
// 1) trocar o import de topo, adicionar:
import { usePlans } from "@/hooks/usePlans";

// 2) trocar o schema (linhas 26-37):
const formSchema = z.object({
  display_name: z.string().min(2, "Mínimo 2 caracteres").max(120, "Máximo 120 caracteres"),
  slug: z
    .string()
    .min(2, "Mínimo 2 caracteres")
    .max(40, "Máximo 40 caracteres")
    .regex(/^[a-z0-9-]+$/, "Apenas letras minúsculas, números e hífens"),
  legal_name: z.string().min(2).max(255).optional().or(z.literal("")),
  nuit: z.string().optional().or(z.literal("")),
  plan_id: z.string().uuid("Selecione um pacote"),
  owner_email: z.string().email("E-mail inválido"),
});

// 3) dentro de NewTenantForm, adicionar:
  const { data: plansData } = usePlans();
  const plans = plansData?.data ?? [];

// 4) defaultValues: trocar `plan: "standard"` por `plan_id: ""`

// 5) onSubmit — trocar `plan: values.plan` por `plan_id: values.plan_id`

// 6) erro conflict — trocar:
        if (err.code === "conflict") {
// por:
        if (err.code === "tenant_already_exists") {

// 7) o bloco do <Select> de plano (linhas 230-251) vira:
            <div className="space-y-1.5">
              <Label htmlFor="plan_id">Pacote</Label>
              <Select
                value={watch("plan_id")}
                onValueChange={(v) => setValue("plan_id", v, { shouldValidate: true })}
              >
                <SelectTrigger id="plan_id" aria-label="Pacote">
                  <SelectValue placeholder="Selecione um pacote" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.display_name}
                      {plan.price_cents != null
                        ? ` — ${(plan.price_cents / 100).toLocaleString("pt-MZ")} ${plan.currency}/mês`
                        : " — sob consulta"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.plan_id && (
                <p className="text-xs text-error-fg">{errors.plan_id.message}</p>
              )}
            </div>
```

Remover também a variável `planValue` (linha 143, não usada mais — `watch("plan_id")` é chamado inline no `<Select>`).

- [ ] **Step 3: Rodar o app localmente e testar pela tela**

```bash
npm run dev
```

Abrir `http://localhost:3000/admin/tenants/new` logado como platform admin, confirmar que o `<Select>` mostra os 4 pacotes reais com preço em MZN, criar um tenant de teste e confirmar redirect para `/admin/tenants/<id>`. Isto é a doutrina de QA Visual — curl não prova esta parte.

- [ ] **Step 4: Typecheck + lint**

```bash
npx tsc --noEmit
npx eslint app/admin/\(protected\)/tenants/new/_form.tsx hooks/useCreateTenant.ts
```

- [ ] **Step 5: Commit**

```bash
git add hooks/useCreateTenant.ts "app/admin/(protected)/tenants/new/_form.tsx"
git commit -m "feat(admin): formulário de novo tenant usa o catálogo real de pacotes"
```

---

### Task 9: Troca de plano — `PATCH .../subscription` + UI

**Files:**
- Modify: `app/api/v1/admin/tenants/[id]/route.ts` (GET inclui a assinatura vigente)
- Create: `app/api/v1/admin/tenants/[id]/subscription/route.ts`
- Create: `app/api/v1/admin/tenants/[id]/subscription/route.test.ts`
- Modify: `hooks/useTenantDetail.ts`
- Create: `hooks/useChangeSubscription.ts`
- Modify: `components/admin/tenants/TenantOverview.tsx`
- Create: `components/admin/tenants/ChangePlanDialog.tsx`
- Modify: `components/admin/tenants/TenantActions.tsx`

**Interfaces:**
- Consumes: `limitesDoTenant` NÃO é usado aqui (troca de plano não é bloqueada por limite, ver spec §"Downgrade"). Usa `ApiErrorCodes.plan_inactive` (Task 2), ação `tenant.subscription_changed` (Task 3).
- Produces: `PATCH /api/v1/admin/tenants/[id]/subscription` body `{ plan_id: string; notes?: string }` → `{ data: { plan_id, plan_display_name, status, started_at } }`.

- [ ] **Step 1: Escrever o teste do PATCH (falhando)**

```ts
// app/api/v1/admin/tenants/[id]/subscription/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const NEW_PLAN_ID = "55555555-5555-4555-8555-555555555555";
const OLD_SUB_ID = "66666666-6666-4666-8666-666666666666";

function patchReq(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/admin/tenants/${ORG_ID}/subscription`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformAdmin).mockResolvedValue({
    user: { id: ADMIN_ID },
    platformAdmin: { user_id: ADMIN_ID, scope: "full", mfa_required: true },
  } as never);
});

describe("PATCH /api/v1/admin/tenants/[id]/subscription", () => {
  it("fecha a linha vigente e insere a nova, exatamente 1 linha aberta", async () => {
    let closedId: string | null = null;
    let inserted: unknown = null;

    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => {
        if (table === "plans") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: NEW_PLAN_ID, display_name: "Agente Médio", is_active: true }, error: null }) }) }) };
        }
        if (table === "organization_subscriptions") {
          return {
            select: () => ({
              eq: () => ({
                is: () => ({ maybeSingle: async () => ({ data: { id: OLD_SUB_ID }, error: null }) }),
              }),
            }),
            update: (v: unknown) => ({
              eq: () => { closedId = OLD_SUB_ID; void v; return { then: (r: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(r) }; },
            }),
            insert: (v: unknown) => {
              inserted = v;
              return { select: () => ({ single: async () => ({ data: { plan_id: NEW_PLAN_ID, status: "active", started_at: "2026-09-09T00:00:00Z" }, error: null }) }) };
            },
          };
        }
        throw new Error(`tabela não simulada: ${table}`);
      },
    } as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ plan_id: NEW_PLAN_ID }), { params: Promise.resolve({ id: ORG_ID }) });
    expect(res.status).toBe(200);
    expect(closedId).toBe(OLD_SUB_ID);
    expect(inserted).toMatchObject({ organization_id: ORG_ID, plan_id: NEW_PLAN_ID, status: "active" });
  });

  it("plan_id inativo → 409 plan_inactive", async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => {
        if (table === "plans") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: NEW_PLAN_ID, is_active: false }, error: null }) }) }) };
        }
        throw new Error(`não deveria chegar em ${table}`);
      },
    } as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ plan_id: NEW_PLAN_ID }), { params: Promise.resolve({ id: ORG_ID }) });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npx vitest run "app/api/v1/admin/tenants/[id]/subscription/route.test.ts"
```

Expected: FAIL — arquivo `route.ts` ainda não existe.

- [ ] **Step 3: Implementar o endpoint**

```ts
// app/api/v1/admin/tenants/[id]/subscription/route.ts
import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";

const patchSchema = z.object({
  plan_id: z.string().uuid(),
  notes: z.string().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id: organizationId } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_error", "Invalid JSON body", 400, { requestId });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_error", "Invalid request body", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const { plan_id, notes } = parsed.data;
  const admin = createAdminClient();

  const { data: plan } = await admin
    .from("plans")
    .select("id, display_name, is_active")
    .eq("id", plan_id)
    .maybeSingle();
  if (!plan || !plan.is_active) {
    return fail("plan_inactive", "Pacote inexistente ou inativo", 409, { requestId });
  }

  // Fecha a linha vigente (se houver — tenant pode não ter assinatura ainda
  // em bancos migrados de um estado anterior a esta feature).
  const { data: current } = await admin
    .from("organization_subscriptions")
    .select("id")
    .eq("organization_id", organizationId)
    .is("ended_at", null)
    .maybeSingle();

  if (current) {
    const { error: closeError } = await admin
      .from("organization_subscriptions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", current.id);
    if (closeError) {
      return fail("internal_error", "Falha ao fechar a assinatura vigente", 500, {
        requestId,
        details: closeError.message,
      });
    }
  }

  const { data: created, error: insertError } = await admin
    .from("organization_subscriptions")
    .insert({
      organization_id: organizationId,
      plan_id,
      status: "active",
      assigned_by: adminCtx.user.id,
      notes: notes ?? null,
    })
    .select("plan_id, status, started_at")
    .single();

  if (insertError || !created) {
    return fail("internal_error", "Falha ao atribuir o novo plano", 500, {
      requestId,
      details: insertError?.message,
    });
  }

  void audit({
    action: "tenant.subscription_changed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    organizationId,
    resourceType: "organization_subscription",
    requestId,
    metadata: { new_plan_id: plan_id, previous_subscription_id: current?.id ?? null },
  });

  return ok(
    { plan_id: created.plan_id, plan_display_name: plan.display_name, status: created.status, started_at: created.started_at },
    { requestId },
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npx vitest run "app/api/v1/admin/tenants/[id]/subscription/route.test.ts"
```

Expected: PASS (2/2).

- [ ] **Step 5: `GET /api/v1/admin/tenants/[id]` passa a incluir a assinatura vigente**

Em `app/api/v1/admin/tenants/[id]/route.ts`, adicionar uma consulta a mais no `Promise.all` (após `wahaRes`, linha 111-112) e no objeto de retorno:

```ts
    admin
      .from("channel_sessions")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    admin
      .from("organization_subscriptions")
      .select("plan_id, status, started_at, plans(display_name, price_cents, currency)")
      .eq("organization_id", id)
      .is("ended_at", null)
      .maybeSingle(),
  ]);
```

(renomear a desestruturação do `Promise.all` — linhas 53-62 — para incluir `subscriptionRes` como último elemento) e, no `return` final (linha 138):

```ts
  const subscription = subscriptionRes.data
    ? {
        plan_id: subscriptionRes.data.plan_id,
        plan_display_name: (subscriptionRes.data as { plans: { display_name: string } }).plans.display_name,
        status: subscriptionRes.data.status,
        started_at: subscriptionRes.data.started_at,
      }
    : null;

  return ok({ organization: org, counts, subscription }, { requestId });
```

- [ ] **Step 6: Atualizar o teste existente do GET pra não quebrar**

Em `app/api/v1/admin/tenants/[id]/route.test.ts`, o `contadorVazio()` (linhas 83-92) precisa devolver algo para `organization_subscriptions` também — como já cai no branch genérico (`table !== "lgpd_requests"`), o `.maybeSingle` precisa existir no stub. Adicionar `builder.maybeSingle = async () => ({ data: null, error: null });` dentro de `contadorVazio()`.

```bash
npx vitest run "app/api/v1/admin/tenants/[id]/route.test.ts"
```

Expected: PASS (o teste existente não afirma nada sobre `subscription`, só precisa não quebrar).

- [ ] **Step 7: Atualizar `hooks/useTenantDetail.ts`**

```ts
export interface TenantSubscription {
  plan_id: string;
  plan_display_name: string;
  status: "active" | "suspended" | "cancelled";
  started_at: string;
}

export interface TenantDetailResponse {
  data: {
    organization: TenantOrganization;
    counts: TenantCounts;
    subscription: TenantSubscription | null;
  };
}
```

- [ ] **Step 8: `hooks/useChangeSubscription.ts`**

```ts
// hooks/useChangeSubscription.ts
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

export interface ChangeSubscriptionPayload {
  id: string;
  plan_id: string;
  notes?: string;
}

export function useChangeSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, plan_id, notes }: ChangeSubscriptionPayload) =>
      apiClient.patch(`/api/v1/admin/tenants/${id}/subscription`, { plan_id, notes }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenant", variables.id] });
      toast.success("Plano alterado com sucesso");
    },
    onError: (err: Error) => {
      toast.error("Erro ao alterar plano", { description: err.message });
    },
  });
}
```

- [ ] **Step 9: `components/admin/tenants/ChangePlanDialog.tsx`**

```tsx
// components/admin/tenants/ChangePlanDialog.tsx
"use client";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlans } from "@/hooks/usePlans";
import { useChangeSubscription } from "@/hooks/useChangeSubscription";

interface ChangePlanDialogProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  currentPlanId?: string;
}

export function ChangePlanDialog({ open, onClose, organizationId, currentPlanId }: ChangePlanDialogProps) {
  const { data: plansData } = usePlans();
  const plans = plansData?.data ?? [];
  const [planId, setPlanId] = useState(currentPlanId ?? "");
  const changeSubscription = useChangeSubscription();

  function handleClose() {
    setPlanId(currentPlanId ?? "");
    onClose();
  }

  function handleConfirm() {
    if (!planId) return;
    changeSubscription.mutate(
      { id: organizationId, plan_id: planId },
      { onSuccess: onClose },
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Alterar plano</AlertDialogTitle>
          <AlertDialogDescription>
            O plano anterior fica registrado no histórico da organização.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-2">
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger aria-label="Novo plano">
              <SelectValue placeholder="Selecione um pacote" />
            </SelectTrigger>
            <SelectContent>
              {plans.map((plan) => (
                <SelectItem key={plan.id} value={plan.id}>
                  {plan.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleClose}>Cancelar</AlertDialogCancel>
          <Button onClick={handleConfirm} disabled={!planId || changeSubscription.isPending}>
            {changeSubscription.isPending ? "Salvando..." : "Confirmar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 10: `TenantOverview.tsx` — ler `subscription` em vez de `settings.plan`**

```tsx
// components/admin/tenants/TenantOverview.tsx
// trocar a linha 4 (import) para incluir TenantSubscription:
import type { TenantOrganization, TenantCounts, TenantSubscription } from "@/hooks/useTenantDetail";

// trocar a assinatura do componente (linha 49-52 e 58-59):
interface TenantOverviewProps {
  organization: TenantOrganization;
  counts: TenantCounts;
  subscription: TenantSubscription | null;
}

export function TenantOverview({ organization, counts, subscription }: TenantOverviewProps) {
  // remover a linha `const plan = ...`

// e a InfoRow de plano (linha 69) vira:
          <InfoRow
            label="Plano"
            value={
              subscription ? (
                <Badge variant="neutral">{subscription.plan_display_name}</Badge>
              ) : (
                <span className="text-muted-foreground">Sem assinatura</span>
              )
            }
          />
```

- [ ] **Step 11: `_client.tsx` e `TenantActions.tsx` — passar `subscription` adiante e adicionar o botão**

```tsx
// app/admin/(protected)/tenants/[id]/_client.tsx — linha 37 e 46-51:
  const { organization, counts, subscription } = data.data;
  // ...
        <TenantOverview organization={organization} counts={counts} subscription={subscription} />
        <TenantActions
          organizationId={organization.id}
          status={organization.status}
          displayName={organization.display_name}
          currentPlanId={subscription?.plan_id}
        />
```

```tsx
// components/admin/tenants/TenantActions.tsx
// import novo:
import { ChangePlanDialog } from "./ChangePlanDialog";

// prop nova na interface:
interface TenantActionsProps {
  organizationId: string;
  status: "active" | "suspended" | "redacted";
  displayName: string;
  currentPlanId?: string;
}

// dentro do componente, novo estado:
  const [changePlanOpen, setChangePlanOpen] = useState(false);

// novo botão, logo após o bloco de Impersonate (antes do bloco "Suspend"):
        <Button
          className="w-full"
          variant="outline"
          onClick={() => setChangePlanOpen(true)}
          aria-label="Alterar plano"
        >
          Alterar plano
        </Button>

// novo dialog, junto aos outros dois no fim do JSX:
      <ChangePlanDialog
        open={changePlanOpen}
        onClose={() => setChangePlanOpen(false)}
        organizationId={organizationId}
        currentPlanId={currentPlanId}
      />
```

- [ ] **Step 12: Testar pela tela**

```bash
npm run dev
```

Abrir `/admin/tenants/<id>` de um tenant de teste, clicar "Alterar plano", trocar, confirmar que o badge de plano atualiza sem reload.

- [ ] **Step 13: Typecheck + lint + commit**

```bash
npx tsc --noEmit
npx eslint components/admin/tenants hooks/useTenantDetail.ts hooks/useChangeSubscription.ts "app/api/v1/admin/tenants/[id]"
git add app/api/v1/admin/tenants/[id] hooks/useTenantDetail.ts hooks/useChangeSubscription.ts components/admin/tenants "app/admin/(protected)/tenants/[id]/_client.tsx"
git commit -m "feat(admin): troca de plano de um tenant existente, com histórico"
```

---

### Task 10: Enforcement de `max_users` (convite de equipe)

**Files:**
- Modify: `app/api/v1/team/invite/route.ts`
- Modify (ou criar, se não existir) `app/api/v1/team/invite/route.test.ts`

**Interfaces:**
- Consumes: `limitesDoTenant(organizationId)` (Task 4).
- Produces: nenhuma interface nova — comportamento adicional na rota existente.

- [ ] **Step 1: Ler o teste existente (se houver) antes de editar**

```bash
ls app/api/v1/team/invite/
```

Se `route.test.ts` já existir, leia-o primeiro para reusar os mocks (`requireRole`, `createAdminClient`, `sendEmail`) em vez de recriar do zero.

- [ ] **Step 2: Escrever o caso novo (falhando)**

```ts
// (adicionar ao arquivo de teste existente, ou criar um novo seguindo o
// padrão de mocks já usado nos outros testes deste diretório)
import { limitesDoTenant } from "@/lib/plans/limiteDoTenant";
vi.mock("@/lib/plans/limiteDoTenant", () => ({ limitesDoTenant: vi.fn() }));

it("recusa convite quando max_users já foi atingido", async () => {
  vi.mocked(limitesDoTenant).mockResolvedValue({
    planSlug: "agente_simples",
    planDisplayName: "Agente Simples",
    maxUsers: 1,
    maxWhatsappConnections: 1,
  });
  // ... mock de requireRole com org válida e de createAdminClient devolvendo
  // 1 membro ativo em user_organizations (contagem = 1, igual ao limite) ...
  const { POST } = await import("./route");
  const res = await POST(/* request com 1 convite novo */);
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.error.code).toBe("plan_limit_reached");
});
```

(Adapte os mocks de `requireRole`/`createAdminClient` ao padrão exato já usado nos testes vizinhos deste arquivo — não foram transcritos aqui por já existirem no repo e por variarem conforme o que o arquivo de teste atual já monta.)

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
npx vitest run app/api/v1/team/invite/route.test.ts
```

Expected: FAIL (endpoint ainda não checa limite).

- [ ] **Step 4: Implementar o enforcement**

Em `app/api/v1/team/invite/route.ts`, adicionar o import e a checagem logo após resolver `memberEmails` (depois da linha 88, antes do `for (const inv of input.invitations)` na linha 90):

```ts
import { limitesDoTenant } from "@/lib/plans/limiteDoTenant";

// ... (dentro de POST, após o bloco que popula memberEmails) ...

  const limites = await limitesDoTenant(activeOrg.orgId);
  if (limites) {
    const novosConvites = input.invitations.filter(
      (inv) => !memberEmails.has(inv.email.trim().toLowerCase()),
    ).length;
    const totalApos = memberEmails.size + novosConvites;
    if (totalApos > limites.maxUsers) {
      return fail(
        "plan_limit_reached",
        `O pacote ${limites.planDisplayName} permite até ${limites.maxUsers} usuários. Fale com o suporte para fazer upgrade.`,
        403,
        { requestId, details: { limit: "max_users", current: memberEmails.size, max: limites.maxUsers } },
      );
    }
  }
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
npx vitest run app/api/v1/team/invite/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Testar pela tela (organização de teste com pacote Agente Simples, 20 usuários)**

Convidar usuários até o limite e confirmar que o 21º é recusado com a mensagem correta na UI (toast de erro do formulário de convite).

- [ ] **Step 7: Typecheck + commit**

```bash
npx tsc --noEmit
git add app/api/v1/team/invite/route.ts app/api/v1/team/invite/route.test.ts
git commit -m "feat(team): enforcement de max_users do pacote no convite de equipe"
```

---

### Task 11: Enforcement de `max_whatsapp_connections` (nova conexão)

**Files:**
- Modify: `app/api/v1/channel-sessions/route.ts`
- Create (ou modificar, se já existir): `app/api/v1/channel-sessions/route.test.ts`

**Interfaces:**
- Consumes: `limitesDoTenant(organizationId)` (Task 4).

**Nota:** `app/api/v1/onboarding/whatsapp/session/route.ts` (o outro ponto de escrita em `channel_sessions`) **não** recebe enforcement — ele é determinístico por org (`org_<8>`, sempre a MESMA linha, nunca cria uma segunda conexão) e todo pacote permite pelo menos 1 conexão. Só `channel-sessions/route.ts` (POST) cria conexões *adicionais*.

- [ ] **Step 1: Escrever o teste novo (falhando)**

```ts
// app/api/v1/channel-sessions/route.test.ts (criar se não existir; se existir,
// adicionar este `it` reaproveitando os mocks de requireRole/createClient já lá)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { limitesDoTenant } from "@/lib/plans/limiteDoTenant";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/plans/limiteDoTenant", () => ({ limitesDoTenant: vi.fn() }));
vi.mock("@/lib/waha/client", () => ({ getWahaClient: vi.fn(() => ({ startSession: vi.fn() })), wahaFriendlyError: () => "erro" }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "u1" },
    org: { orgId: ORG_ID, name: "Org" },
  } as never);
});

describe("POST /api/v1/channel-sessions — enforcement de plano", () => {
  it("recusa conexão nova quando max_whatsapp_connections foi atingido", async () => {
    vi.mocked(limitesDoTenant).mockResolvedValue({
      planSlug: "agente_simples",
      planDisplayName: "Agente Simples",
      maxUsers: 20,
      maxWhatsappConnections: 1,
    });
    vi.mocked(createClient).mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({ is: () => ({ then: (r: (x: unknown) => unknown) => Promise.resolve({ count: 1, error: null }).then(r) }) }),
        }),
      }),
    } as never);

    const { POST } = await import("./route");
    const res = await POST(new NextRequest("http://localhost/api/v1/channel-sessions", { method: "POST", body: "{}" }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("plan_limit_reached");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npx vitest run app/api/v1/channel-sessions/route.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar o enforcement**

Em `app/api/v1/channel-sessions/route.ts`, adicionar o import no topo e a checagem logo após resolver `activeOrg` (depois da linha 67, antes da checagem do `waha` na linha 69):

```ts
import { limitesDoTenant } from "@/lib/plans/limiteDoTenant";

// ... dentro de POST, logo após `const { user, org: activeOrg } = authz;` ...

  const limites = await limitesDoTenant(activeOrg.orgId);
  if (limites) {
    const { count } = await supabase
      .from("channel_sessions")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", activeOrg.orgId)
      .is(ARCHIVED_AT, null);
    if ((count ?? 0) >= limites.maxWhatsappConnections) {
      return fail(
        "plan_limit_reached",
        `O pacote ${limites.planDisplayName} permite até ${limites.maxWhatsappConnections} conexão(ões) WhatsApp. Fale com o suporte para fazer upgrade.`,
        403,
        { requestId, details: { limit: "max_whatsapp_connections", current: count ?? 0, max: limites.maxWhatsappConnections } },
      );
    }
  }
```

Isso exige mover `const supabase = await createClient();` (hoje na linha 93) para ANTES desse bloco, já que a contagem também precisa do client. Reorganizar: declarar `supabase` logo após a checagem de `waha`, antes do bloco de enforcement.

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npx vitest run app/api/v1/channel-sessions/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Testar pela tela**

Organização de teste no pacote Agente Simples (1 conexão), já com 1 número conectado — tentar conectar um segundo pela tela de Conexões e confirmar o toast de erro com o texto do plano.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add app/api/v1/channel-sessions/route.ts app/api/v1/channel-sessions/route.test.ts
git commit -m "feat(channels): enforcement de max_whatsapp_connections do pacote"
```

---

### Task 12: Remover o painel antigo de licenciamento por instalação

**Files:**
- Delete: `app/admin/(protected)/licensing/` (pasta inteira: `page.tsx`, `_licencas.tsx`, `_paysuite-form.tsx`)
- Delete: `app/api/v1/licensing/admin/` (pasta inteira, incluindo `paysuite-credentials/`)

**Interfaces:** nenhuma — remoção pura.

- [ ] **Step 1: Localizar todo link/referência à tela antes de apagar**

```bash
grep -rn "admin/licensing\|licensing/admin" app/ components/ lib/ --include="*.tsx" --include="*.ts"
```

Anotar cada arquivo que referencia a rota (ex.: algum menu lateral do `/admin` fora de `lib/navigation/registry.ts` — a investigação anterior não achou a entrada nesse arquivo, então ela deve estar num componente de layout do próprio `/admin`).

- [ ] **Step 2: Remover cada link encontrado no Step 1**

Editar o(s) arquivo(s) de menu/sidebar do `/admin` removendo a entrada "Licenciamento" — sem código de exemplo aqui porque o arquivo exato depende do resultado do grep acima; siga o padrão das outras entradas do mesmo menu (mesmo componente, mesma estrutura de item).

- [ ] **Step 3: Apagar as pastas**

```bash
git rm -r "app/admin/(protected)/licensing" "app/api/v1/licensing/admin"
```

- [ ] **Step 4: Rodar a suíte inteira de unit tests**

```bash
pnpm test:unit
```

Expected: PASS — nenhum teste deveria importar arquivos dessas pastas (confirmar não há import quebrado; se algum teste falhar por importar algo de lá, ele também é removido neste step).

- [ ] **Step 5: Verificar que a navegação não quebrou (doutrina de "porta")**

```bash
npx vitest run tests/unit/navegacao-completude.test.ts
```

Expected: PASS — como a tela nunca teve entrada em `lib/navigation/registry.ts` (confirmado na investigação), este teste não deveria estar cobrindo-a; se estiver, remova a entrada correspondente do teste também.

- [ ] **Step 6: Testar pela tela**

```bash
npm run dev
```

Confirmar que `/admin/licensing` agora retorna 404 e que nenhum item de menu do `/admin` aponta mais para lá.

- [ ] **Step 7: Typecheck + lint + commit**

```bash
npx tsc --noEmit
npx eslint app/admin app/api/v1
git add -A
git commit -m "chore(licensing): remove o painel de licenciamento por instalação, descontinuado"
```

---

### Task 13: E2E — fluxo completo pela tela

**Files:**
- Create: `tests/e2e/admin-cria-tenant-convite-owner.spec.ts`

**Interfaces:** nenhuma — só exercita as rotas/UI já implementadas.

- [ ] **Step 1: Ler um spec E2E existente de admin como template**

```bash
ls tests/e2e/ | grep -i admin
```

Abra um deles (ex. o que testa suspensão de tenant, se existir) para copiar o padrão de login como platform admin e o setup de ambiente fresco (baseline.sql + bootstrap-owner.ts), conforme a doutrina de QA Visual do `CLAUDE.md`.

- [ ] **Step 2: Escrever o spec**

```ts
// tests/e2e/admin-cria-tenant-convite-owner.spec.ts
import { test, expect } from "@playwright/test";

test("admin cria tenant, owner aceita convite e loga", async ({ page, context }) => {
  // 1) Login como platform admin (usar o helper/fixture já usado pelos
  // outros specs de /admin/tenants deste diretório).
  await page.goto("/admin/tenants/new");

  await page.getByLabel("Nome de exibição").fill("E2E Tenant");
  await page.getByLabel("E-mail do responsável").fill(`owner-${Date.now()}@e2e.test`);
  // Selecionar o primeiro pacote disponível no <Select> real (não hardcode
  // de valor — o catálogo é dinâmico via GET /api/v1/plans).
  await page.getByLabel("Pacote").click();
  await page.getByRole("option").first().click();

  await page.getByRole("button", { name: "Criar tenant" }).click();
  await expect(page).toHaveURL(/\/admin\/tenants\/[0-9a-f-]+$/);

  // 2) Confirmar que a assinatura aparece na tela (prova visual do que a
  // Task 9 escreveu, medido com getBoundingClientRect/getComputedStyle
  // conforme a doutrina, se o layout precisar de checagem de posição —
  // aqui basta o texto estar visível).
  await expect(page.getByText(/Agente|Enterprise/)).toBeVisible();

  // 3) O e-mail de convite real não é capturável neste ambiente sem um
  // receiver de e-mail de verdade (Resend/Inbucket) — a doutrina de QA
  // Visual exige efeito colateral externo provado com receiver real, não
  // mock. Se o ambiente de teste já tiver um Inbucket/Mailhog configurado
  // para os outros specs de convite, reusar o mesmo helper de leitura de
  // caixa de entrada aqui; senão, este passo fica documentado como
  // NÃO MEDIDO nesta versão do spec e deve ser completado antes de
  // declarar a Task 13 pronta.
});
```

- [ ] **Step 2b: Resolver o passo 3 antes de considerar a task concluída**

Verificar em `playwright.config.ts` e nos specs vizinhos (`grep -rn "inbucket\|mailhog\|resend" tests/e2e/`) se já existe infraestrutura de e-mail de teste. Se existir, complete o spec lendo o link de convite recebido, navegando até ele, preenchendo senha em `/login/reset`, e confirmando login bem-sucedido no app. Se não existir, este é um item para reportar como NÃO MEDIDO ao final da implementação, não para inventar um mock que a doutrina de QA Visual já proíbe.

- [ ] **Step 3: Rodar o spec**

```bash
npx playwright test tests/e2e/admin-cria-tenant-convite-owner.spec.ts
```

Expected: PASS até onde a infraestrutura de e-mail do ambiente permitir (ver Step 2b).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/admin-cria-tenant-convite-owner.spec.ts
git commit -m "test(e2e): fluxo completo de criação de tenant com convite do owner"
```

---

## Fechamento

- [ ] **Rodar a suíte completa uma última vez**

```bash
npm run typecheck
npm run lint
pnpm test:unit
pnpm test:db
```

Expected: tudo verde. `pnpm test:e2e` também, na medida do que a Task 13 conseguiu cobrir (ver Step 2b acima — documentar explicitamente o que ficou NÃO MEDIDO, conforme a doutrina de verificação do `CLAUDE.md`).

- [ ] **Atualizar `docs/current-state.md` se ele mencionar o licenciamento por instalação como "pronto"** — buscar por `licensing_installs`/`/admin/licensing` nesse arquivo e corrigir a afirmação para o novo modelo.

- [ ] **Fora desta plano, pendente de decisão do dono do produto (não implementar sem autorização):** atualização de `CLAUDE.md`/`VISION.md` para refletir "instância central multi-tenant" em vez de "self-host por cliente" — a spec já registra isso como bloqueador de honestidade documental, mas é uma mudança de doutrina, não de código, e fica fora do escopo de execução automática deste plano.
