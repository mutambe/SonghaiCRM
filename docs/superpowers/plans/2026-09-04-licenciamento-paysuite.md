# Licenciamento self-host via PaySuite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cobrar uma assinatura recorrente do operador de cada instalação self-host via
PaySuite, com um gate que degrada (não bloqueia leitura) quando a assinatura vence, e um token
assinado (Ed25519) que a instalação do cliente não consegue forjar editando a própria base.

**Architecture:** Duas superfícies no mesmo repo Git. A **instância central** (só a Songhai
corre) expõe `app/api/v1/licensing/*`: emissão manual de licença, verificação (assina um token
curto com o status actual), renovação (cria cobrança PaySuite) e o webhook de confirmação. A
**instância de cliente** (o produto normal) ganha `lib/licensing/` + um cron diário que busca o
token, `middleware.ts` que bloqueia mutações quando o token/])último contacto indicam
vencimento, e uma tela em Configurações › Billing com o botão "Renovar agora".

**Tech Stack:** Next.js Route Handlers, `node:crypto` (Ed25519, sem dependência nova), Supabase
Postgres, Zod, `lib/payments/paysuite/client.ts` (já existe — reaproveitado, não duplicado).

**Spec:** [`docs/superpowers/specs/2026-09-04-licenciamento-paysuite-design.md`](../specs/2026-09-04-licenciamento-paysuite-design.md)

## Global Constraints

- Trial: 7 dias, emissão manual (sem self-service nesta versão — nem trial nem pago).
- Grace period offline: 7 dias corridos sem conseguir renovar o token → trata como vencido.
- Degradação: bloqueia só mutações (POST/PATCH/DELETE em `/api/v1/*`, excepto
  `/api/v1/webhooks/*` e `/api/v1/cron/*` — ver justificativa na Tarefa 11); leitura sempre
  passa.
- Segurança: par Ed25519 gerado uma vez; a chave privada só existe no `.env` da instância
  central; a chave pública fica embutida em `lib/licensing/chave-publica.ts` (parte da imagem, o
  cliente não consegue trocar editando a própria base de dados).
- PaySuite: reaproveitar `createPayment`/`getPayment` de `lib/payments/paysuite/client.ts` —
  **não** duplicar o cliente REST. Amount em string decimal MZN (`"100.50"`), não cents (a API
  do PaySuite não aceita cents).
- Idempotência de webhook: `unique(paysuite_payment_id)` + `.eq("status", "pending")` no UPDATE
  como claim atómico — reentrega depois de já processado não repete a extensão do período (mesmo
  padrão de `recover-stuck-messages` e do webhook de pagamentos de tenant já existente).
- Toda mudança de schema sai como migration versionada **e** apêndice idempotente em
  `supabase/baseline.sql` **e** linha no `MANIFEST.md` (doutrina não-negociável do `CLAUDE.md`).
- Código novo em `app/api/v1/*` usa sempre `ok()`/`fail()` de `lib/api/wrappers.ts`, nunca
  `NextResponse` direto.
- Sem `console.log` — usar `lib/logger`.
- **Fora de escopo desta plan** (documentado no spec): self-service de signup, cobrança
  automática com cartão guardado, e a actualização de `VISION.md`/`CLAUDE.md` para reflectir o
  fecho do repositório (decisão de doutrina separada, do dono do produto).

---

### Task 1: Schema — tabelas de licenciamento + vocabulário de erro/auditoria

**Files:**
- Create: `supabase/migrations/20260904130000_0173_licensing_paysuite.sql`
- Modify: `supabase/baseline.sql` (apêndice, no fim do arquivo)
- Modify: `supabase/migrations/MANIFEST.md` (linha nova na tabela "Applied")
- Modify: `lib/api/errors.ts:26` (adicionar `license_required` na secção 403)
- Modify: `lib/audit/actions.ts` (adicionar `"licensing.license_issued"` no fim do array)

**Interfaces:**
- Produces (tabelas que as tarefas seguintes usam): `licensing_installs(id, customer_name,
  contact_email, notes, created_at)`; `licensing_licenses(id, install_id, license_key, status,
  plan_amount_cents, plan_interval_days, trial_ends_at, current_period_end, created_at,
  updated_at)`; `licensing_payments(id, license_id, paysuite_payment_id, amount_cents, status,
  checkout_url, created_at, paid_at)`; `licensing_client_state(id, token, fetched_at,
  updated_at)` (linha única `id='singleton'`).
- Produces: `ApiErrorCodes.license_required` e `AuditAction` inclui
  `"licensing.license_issued"`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0173 — LICENCIAMENTO SELF-HOST (assinatura recorrente via PaySuite).
--
-- Duas famílias de tabela, propósitos diferentes:
--
-- `licensing_installs/licenses/payments` só existem com dado real na
-- instância CENTRAL (a que a Songhai opera) — é o livro de clientes da
-- própria Songhai, não dado de tenant do CRM. Sem RLS multi-tenant (não é
-- esse o modelo aqui); RLS ligada com ZERO policies + revoke geral, mesmo
-- molde de `payment_credentials` (migration 0162): só service_role toca.
--
-- `licensing_client_state` é o cache local da INSTÂNCIA DE CLIENTE — uma
-- linha singleton com o último token assinado recebido da central e quando
-- foi buscado. Existe em toda instalação (central ou cliente), fica vazia
-- na central porque ela não se autoverifica.

create table if not exists public.licensing_installs (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  contact_email text not null,
  notes text,
  created_at timestamp with time zone not null default now()
);

alter table public.licensing_installs enable row level security;
revoke all on public.licensing_installs from anon, authenticated;
grant select, insert, update on public.licensing_installs to service_role;

create table if not exists public.licensing_licenses (
  id uuid primary key default gen_random_uuid(),
  install_id uuid not null references public.licensing_installs(id) on delete cascade,
  license_key text not null unique,
  status text not null default 'trial' check (status in ('trial', 'active', 'revoked')),
  plan_amount_cents bigint not null check (plan_amount_cents > 0),
  plan_interval_days integer not null default 30 check (plan_interval_days > 0),
  trial_ends_at timestamp with time zone,
  current_period_end timestamp with time zone not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists licensing_licenses_install_idx
  on public.licensing_licenses using btree (install_id);

alter table public.licensing_licenses enable row level security;
revoke all on public.licensing_licenses from anon, authenticated;
grant select, insert, update on public.licensing_licenses to service_role;

create or replace trigger trg_licensing_licenses_updated_at
  before update on public.licensing_licenses
  for each row execute function public.fn_set_updated_at();

create table if not exists public.licensing_payments (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licensing_licenses(id) on delete cascade,
  paysuite_payment_id text not null unique,
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  checkout_url text,
  created_at timestamp with time zone not null default now(),
  paid_at timestamp with time zone
);

create index if not exists licensing_payments_license_idx
  on public.licensing_payments using btree (license_id);

alter table public.licensing_payments enable row level security;
revoke all on public.licensing_payments from anon, authenticated;
grant select, insert, update on public.licensing_payments to service_role;

create table if not exists public.licensing_client_state (
  id text primary key default 'singleton' check (id = 'singleton'),
  token text,
  fetched_at timestamp with time zone,
  updated_at timestamp with time zone not null default now()
);

alter table public.licensing_client_state enable row level security;
revoke all on public.licensing_client_state from anon, authenticated;
grant select, insert, update on public.licensing_client_state to service_role;

create or replace trigger trg_licensing_client_state_updated_at
  before update on public.licensing_client_state
  for each row execute function public.fn_set_updated_at();
```

- [ ] **Step 2: Adicionar o apêndice idempotente ao `baseline.sql`**

Abra `supabase/baseline.sql`, vá ao fim do arquivo e acrescente um bloco rotulado (mesmo texto do
Step 1, mas todo `create table` já está `if not exists` — já é idempotente por construção; não
precisa reescrever para `add column if not exists` porque são tabelas novas, não alteração de
tabela existente):

```sql
-- ---- licenciamento self-host via PaySuite (migration 0173) ----
-- (colar aqui o conteúdo INTEIRO do Step 1, incluindo os dois triggers)
```

- [ ] **Step 3: Registrar no MANIFEST**

Em `supabase/migrations/MANIFEST.md`, na tabela "Applied", acrescentar:

```markdown
| 0173 | `licensing_paysuite` | Tabelas de licenciamento self-host (`licensing_installs/licenses/payments/client_state`) — assinatura recorrente do operador da VPS via PaySuite. |
```

- [ ] **Step 4: Vocabulário de erro**

Em `lib/api/errors.ts`, na secção `// 403 — authz`, adicionar:

```ts
  license_required: "license_required", // gate de assinatura self-host — mutação bloqueada, leitura passa
```

- [ ] **Step 5: Vocabulário de auditoria**

Em `lib/audit/actions.ts`, no fim do array `AUDIT_ACTIONS`, adicionar:

```ts
  "licensing.license_issued",
```

- [ ] **Step 6: Aplicar a migration e validar o baseline**

```bash
# aplica na instância de dev configurada
pnpm supabase db push
# ou, se preferir MCP: mcp__plugin_supabase_supabase__apply_migration com o SQL do Step 1
```

Depois, valide o baseline num Postgres descartável (install fresh + update idempotente):

```bash
docker run --rm -e POSTGRES_PASSWORD=postgres -p 55432:5432 -d --name pg-baseline-test pgvector/pgvector:pg17
sleep 3
PGPASSWORD=postgres psql -h localhost -p 55432 -U postgres -v ON_ERROR_STOP=1 -f supabase/baseline.sql
PGPASSWORD=postgres psql -h localhost -p 55432 -U postgres -f supabase/baseline.sql   # update, sem ON_ERROR_STOP
docker rm -f pg-baseline-test
```

Expected: os dois comandos `psql` terminam sem erro fatal (o segundo pode imprimir avisos de
"already exists" para objetos que não são `if not exists` — nenhum aqui é o caso).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260904130000_0173_licensing_paysuite.sql supabase/baseline.sql supabase/migrations/MANIFEST.md lib/api/errors.ts lib/audit/actions.ts
git commit -m "feat(licensing): schema de licenciamento self-host via PaySuite"
```

---

### Task 2: Chaves de assinatura (Ed25519) e env vars

**Files:**
- Create: `lib/licensing/chave-publica.ts`
- Modify: `lib/env.ts` (após o campo `APP_ACCENT_HEX`, antes de `});`)
- Modify: `.env.example`

**Interfaces:**
- Produces: `LICENSING_PUBLIC_KEY_PEM: string` (constante exportada de
  `lib/licensing/chave-publica.ts`), `env.LICENSING_SIGNING_PRIVATE_KEY`,
  `env.LICENSING_PUBLIC_BASE_URL`, `env.LICENSING_PAYSUITE_API_KEY`,
  `env.LICENSING_PAYSUITE_WEBHOOK_SECRET` (todas só preenchidas na instância central),
  `env.LICENSE_KEY`, `env.LICENSING_CENTRAL_URL` (só preenchidas na instância de cliente).

- [ ] **Step 1: Gerar o par de chaves**

```bash
node -e "
const { generateKeyPairSync } = require('node:crypto');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
console.log('--- PUBLIC (cola em lib/licensing/chave-publica.ts) ---');
console.log(publicKey.export({ type: 'spki', format: 'pem' }));
console.log('--- PRIVATE (cola em LICENSING_SIGNING_PRIVATE_KEY, só no .env da central) ---');
console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }));
"
```

Guarde a saída — a chave privada **nunca** entra no Git. A pública entra no código-fonte (é
segura de expor: só serve para VERIFICAR assinatura, não para assinar).

- [ ] **Step 2: Criar `lib/licensing/chave-publica.ts`**

```ts
/**
 * Chave pública Ed25519 que verifica os tokens de licença assinados pela
 * instância central. Embutida na imagem Docker (não é `.env`) — trocar de
 * chave exige nova imagem publicada, deliberado: só a Songhai controla o
 * par. A privada correspondente vive só em `LICENSING_SIGNING_PRIVATE_KEY`
 * no `.env` da instância central, nunca commitada.
 */
export const LICENSING_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
<colar aqui a saída do Step 1>
-----END PUBLIC KEY-----
`;
```

- [ ] **Step 3: Adicionar as env vars em `lib/env.ts`**

Logo após o campo `APP_ACCENT_HEX: z.string().optional().default(""),` e antes do `});` que
fecha o `schema`, adicionar:

```ts

  // Licenciamento self-host via PaySuite — ver docs/superpowers/specs/2026-09-04-licenciamento-paysuite-design.md
  // Só preenchidas na instância CENTRAL (a que a Songhai opera):
  LICENSING_SIGNING_PRIVATE_KEY: z.string().optional().default(""),
  LICENSING_PUBLIC_BASE_URL: z.string().optional().default(""),
  LICENSING_PAYSUITE_API_KEY: z.string().optional().default(""),
  LICENSING_PAYSUITE_WEBHOOK_SECRET: z.string().optional().default(""),
  // Só preenchidas na instância de CLIENTE (o produto normal, self-host):
  LICENSE_KEY: z.string().optional().default(""),
  LICENSING_CENTRAL_URL: z.string().optional().default(""),
```

- [ ] **Step 4: Sincronizar `.env.example`**

Acrescentar ao fim de `.env.example`:

```bash
# Licenciamento self-host via PaySuite — preencha SÓ um dos dois blocos.
# Instância central (Songhai):
LICENSING_SIGNING_PRIVATE_KEY=
LICENSING_PUBLIC_BASE_URL=
LICENSING_PAYSUITE_API_KEY=
LICENSING_PAYSUITE_WEBHOOK_SECRET=
# Instância de cliente (self-host normal):
LICENSE_KEY=
LICENSING_CENTRAL_URL=
```

- [ ] **Step 5: Rodar o teste de sincronia e o typecheck**

```bash
pnpm test:unit -- env-example-sync
pnpm typecheck
```

Expected: PASS nos dois.

- [ ] **Step 6: Commit**

```bash
git add lib/licensing/chave-publica.ts lib/env.ts .env.example
git commit -m "feat(licensing): par de chaves Ed25519 e env vars de licenciamento"
```

---

### Task 3: `lib/licensing/token.ts` — assinar e verificar o token de licença

**Files:**
- Create: `lib/licensing/token.ts`
- Test: `lib/licensing/token.test.ts`

**Interfaces:**
- Consumes: `LICENSING_PUBLIC_KEY_PEM` de `lib/licensing/chave-publica.ts` (Task 2).
- Produces: `signLicenseToken(payload: Omit<LicenseTokenPayload, "iat">, privateKeyPem: string):
  string` e `verifyLicenseToken(token: string, publicKeyPem: string): LicenseTokenPayload |
  null`, tipo `LicenseTokenPayload = { license_id: string; status: "trial" | "active" |
  "past_due" | "revoked"; current_period_end: string; iat: number }`. Usado pela Task 6 (central
  assina) e pela Task 10 (cliente verifica).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/licensing/token.test.ts
import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { signLicenseToken, verifyLicenseToken } from "./token";

function gerarPar() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

describe("licensing/token", () => {
  it("assina e verifica um token válido", () => {
    const { publicPem, privatePem } = gerarPar();
    const token = signLicenseToken(
      { license_id: "lic-1", status: "active", current_period_end: "2026-12-01T00:00:00.000Z" },
      privatePem,
    );
    const payload = verifyLicenseToken(token, publicPem);
    expect(payload).not.toBeNull();
    expect(payload?.license_id).toBe("lic-1");
    expect(payload?.status).toBe("active");
  });

  it("rejeita token com payload adulterado (troca de status sem re-assinar)", () => {
    const { publicPem, privatePem } = gerarPar();
    const token = signLicenseToken(
      { license_id: "lic-1", status: "past_due", current_period_end: "2026-01-01T00:00:00.000Z" },
      privatePem,
    );
    const [body, sig] = token.split(".");
    const payloadAdulterado = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    payloadAdulterado.status = "active";
    const bodyAdulterado = Buffer.from(JSON.stringify(payloadAdulterado)).toString("base64url");
    const tokenAdulterado = `${bodyAdulterado}.${sig}`;

    expect(verifyLicenseToken(tokenAdulterado, publicPem)).toBeNull();
  });

  it("rejeita token verificado com a chave pública errada", () => {
    const par1 = gerarPar();
    const par2 = gerarPar();
    const token = signLicenseToken(
      { license_id: "lic-1", status: "active", current_period_end: "2026-12-01T00:00:00.000Z" },
      par1.privatePem,
    );
    expect(verifyLicenseToken(token, par2.publicPem)).toBeNull();
  });

  it("rejeita string mal formada sem lançar", () => {
    const { publicPem } = gerarPar();
    expect(verifyLicenseToken("lixo-sem-ponto", publicPem)).toBeNull();
    expect(verifyLicenseToken("", publicPem)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm test:unit -- lib/licensing/token.test.ts
```

Expected: FAIL — `Cannot find module './token'`.

- [ ] **Step 3: Implementar**

```ts
// lib/licensing/token.ts
/**
 * Token curto assinado (Ed25519) que prova o estado da licença sem precisar
 * de contacto de rede a cada request. Assinado só pela instância central
 * (chave privada em `LICENSING_SIGNING_PRIVATE_KEY`); a instância de cliente
 * só tem a chave pública embutida na imagem — editar a própria base de dados
 * não fabrica um token válido, porque a assinatura não bateria mais.
 */
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export interface LicenseTokenPayload {
  license_id: string;
  status: "trial" | "active" | "past_due" | "revoked";
  current_period_end: string;
  iat: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signLicenseToken(
  payload: Omit<LicenseTokenPayload, "iat">,
  privateKeyPem: string,
): string {
  const full: LicenseTokenPayload = { ...payload, iat: Date.now() };
  const body = b64url(Buffer.from(JSON.stringify(full), "utf8"));
  const key = createPrivateKey(privateKeyPem);
  const signature = sign(null, Buffer.from(body, "utf8"), key);
  return `${body}.${b64url(signature)}`;
}

export function verifyLicenseToken(token: string, publicKeyPem: string): LicenseTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  try {
    const key = createPublicKey(publicKeyPem);
    const valido = verify(null, Buffer.from(body, "utf8"), key, Buffer.from(sig, "base64url"));
    if (!valido) return null;
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LicenseTokenPayload;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm test:unit -- lib/licensing/token.test.ts
```

Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/licensing/token.ts lib/licensing/token.test.ts
git commit -m "feat(licensing): assinatura e verificação Ed25519 do token de licença"
```

---

### Task 4: `lib/licensing/gate.ts` — decisão de bloqueio (pura, sem I/O)

**Files:**
- Create: `lib/licensing/gate.ts`
- Test: `lib/licensing/gate.test.ts`

**Interfaces:**
- Consumes: `verifyLicenseToken` e `LicenseTokenPayload` de `lib/licensing/token.ts` (Task 3).
- Produces: `avaliarAcesso(cached: { token: string | null; fetchedAt: Date | null }, now: Date,
  publicKeyPem: string): { bloqueado: boolean; motivo: "sem_licenca" | "sem_contato" |
  "assinatura_vencida" | null }`. Usado pela Task 11 (`middleware.ts`).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/licensing/gate.test.ts
import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { signLicenseToken } from "./token";
import { avaliarAcesso, GRACE_PERIOD_MS } from "./gate";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function token(status: "trial" | "active" | "past_due" | "revoked", periodEndIso: string) {
  return signLicenseToken({ license_id: "lic-1", status, current_period_end: periodEndIso }, privatePem);
}

describe("licensing/gate", () => {
  const now = new Date("2026-09-04T12:00:00.000Z");

  it("bloqueia quando não há token cacheado (nunca contactou a central)", () => {
    const r = avaliarAcesso({ token: null, fetchedAt: null }, now, publicPem);
    expect(r).toEqual({ bloqueado: true, motivo: "sem_licenca" });
  });

  it("libera com token 'trial' dentro do período", () => {
    const t = token("trial", "2026-09-10T00:00:00.000Z");
    const r = avaliarAcesso({ token: t, fetchedAt: now }, now, publicPem);
    expect(r).toEqual({ bloqueado: false, motivo: null });
  });

  it("libera com token 'active' dentro do período", () => {
    const t = token("active", "2026-10-01T00:00:00.000Z");
    const r = avaliarAcesso({ token: t, fetchedAt: now }, now, publicPem);
    expect(r).toEqual({ bloqueado: false, motivo: null });
  });

  it("bloqueia com token 'past_due'", () => {
    const t = token("past_due", "2026-08-01T00:00:00.000Z");
    const r = avaliarAcesso({ token: t, fetchedAt: now }, now, publicPem);
    expect(r).toEqual({ bloqueado: true, motivo: "assinatura_vencida" });
  });

  it("bloqueia com token 'revoked' mesmo com current_period_end no futuro", () => {
    const t = token("revoked", "2027-01-01T00:00:00.000Z");
    const r = avaliarAcesso({ token: t, fetchedAt: now }, now, publicPem);
    expect(r).toEqual({ bloqueado: true, motivo: "assinatura_vencida" });
  });

  it("bloqueia com token 'active' cujo current_period_end já passou (token velho, cache não renovado)", () => {
    const t = token("active", "2026-09-01T00:00:00.000Z"); // antes de `now`
    const r = avaliarAcesso({ token: t, fetchedAt: now }, now, publicPem);
    expect(r).toEqual({ bloqueado: true, motivo: "assinatura_vencida" });
  });

  it("bloqueia com token adulterado (assinatura não bate)", () => {
    const t = token("active", "2026-10-01T00:00:00.000Z");
    const adulterado = t.slice(0, -4) + "xxxx";
    const r = avaliarAcesso({ token: adulterado, fetchedAt: now }, now, publicPem);
    expect(r).toEqual({ bloqueado: true, motivo: "sem_licenca" });
  });

  it("bloqueia por falta de contacto quando o último fetch passou do grace period, mesmo com token 'active'", () => {
    const t = token("active", "2027-01-01T00:00:00.000Z"); // ainda válido
    const fetchedAt = new Date(now.getTime() - GRACE_PERIOD_MS - 1000);
    const r = avaliarAcesso({ token: t, fetchedAt }, now, publicPem);
    expect(r).toEqual({ bloqueado: true, motivo: "sem_contato" });
  });

  it("libera quando o último fetch está dentro do grace period, mesmo perto do limite", () => {
    const t = token("active", "2027-01-01T00:00:00.000Z");
    const fetchedAt = new Date(now.getTime() - GRACE_PERIOD_MS + 1000);
    const r = avaliarAcesso({ token: t, fetchedAt }, now, publicPem);
    expect(r).toEqual({ bloqueado: false, motivo: null });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm test:unit -- lib/licensing/gate.test.ts
```

Expected: FAIL — `Cannot find module './gate'`.

- [ ] **Step 3: Implementar**

```ts
// lib/licensing/gate.ts
/**
 * Decisão de bloqueio do gate de licenciamento. Puro — sem I/O — para ser
 * testável sem banco nem rede; `middleware.ts` (Task 11) só monta o
 * `{ token, fetchedAt }` a partir do banco e chama isto.
 *
 * Duas checagens independentes, as DUAS precisam passar:
 *  1. O token (assinado, não forjável por edição de banco) diz `active`/
 *     `trial` E `current_period_end` ainda não passou.
 *  2. O último fetch bem-sucedido da central foi há menos de
 *     `GRACE_PERIOD_MS` — cobre queda temporária do serviço central sem
 *     penalizar quem paga; mas evita que uma instalação fique parada para
 *     sempre num token cacheado sem nunca revalidar.
 */
import { verifyLicenseToken } from "./token";

export const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedLicenseState {
  token: string | null;
  fetchedAt: Date | null;
}

export interface GateDecision {
  bloqueado: boolean;
  motivo: "sem_licenca" | "sem_contato" | "assinatura_vencida" | null;
}

export function avaliarAcesso(cached: CachedLicenseState, now: Date, publicKeyPem: string): GateDecision {
  if (!cached.token || !cached.fetchedAt) {
    return { bloqueado: true, motivo: "sem_licenca" };
  }

  if (now.getTime() - cached.fetchedAt.getTime() > GRACE_PERIOD_MS) {
    return { bloqueado: true, motivo: "sem_contato" };
  }

  const payload = verifyLicenseToken(cached.token, publicKeyPem);
  if (!payload) {
    return { bloqueado: true, motivo: "sem_licenca" };
  }

  if (payload.status === "revoked" || payload.status === "past_due") {
    return { bloqueado: true, motivo: "assinatura_vencida" };
  }

  if (new Date(payload.current_period_end).getTime() < now.getTime()) {
    return { bloqueado: true, motivo: "assinatura_vencida" };
  }

  return { bloqueado: false, motivo: null };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm test:unit -- lib/licensing/gate.test.ts
```

Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/licensing/gate.ts lib/licensing/gate.test.ts
git commit -m "feat(licensing): decisão pura do gate de assinatura (grace period + token)"
```

---

### Task 5: Central — emissão manual de licença

**Files:**
- Create: `app/api/v1/licensing/admin/route.ts`
- Test: `app/api/v1/licensing/admin/route.test.ts`

**Interfaces:**
- Consumes: `ok`/`fail` de `lib/api/wrappers.ts`; `loadAuthUser` de `lib/auth/server.ts`
  (retorna `{ id, is_platform_admin, ... } | null`); `audit` de `lib/audit`; `createAdminClient`
  de `lib/supabase/admin`; tabelas `licensing_installs`/`licensing_licenses` (Task 1).
- Produces: `POST /api/v1/licensing/admin` — `201 { data: { id, license_key,
  current_period_end } }`. Só a Songhai (via `is_platform_admin`) chama isto; não é consumido
  por nenhuma tarefa seguinte, é o ponto de entrada manual do fluxo.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// app/api/v1/licensing/admin/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const loadAuthUserMock = vi.fn();
const insertInstallMock = vi.fn();
const insertLicenseMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: loadAuthUserMock }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "licensing_installs") {
        return {
          insert: () => ({
            select: () => ({
              single: insertInstallMock,
            }),
          }),
        };
      }
      return {
        insert: () => ({
          select: () => ({
            single: insertLicenseMock,
          }),
        }),
      };
    },
  }),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/v1/licensing/admin", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/licensing/admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recusa quem não é platform admin", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: false });
    const res = await POST(req({ customer_name: "X", contact_email: "a@b.com", plan_amount_cents: 5000 }) as never);
    expect(res.status).toBe(403);
  });

  it("recusa payload inválido", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: true });
    const res = await POST(req({ customer_name: "" }) as never);
    expect(res.status).toBe(422);
  });

  it("cria install + license trial e devolve a chave", async () => {
    loadAuthUserMock.mockResolvedValue({ id: "u1", is_platform_admin: true });
    insertInstallMock.mockResolvedValue({ data: { id: "install-1" }, error: null });
    insertLicenseMock.mockResolvedValue({
      data: { id: "lic-1", license_key: "abc123", current_period_end: "2026-09-11T00:00:00.000Z" },
      error: null,
    });

    const res = await POST(
      req({ customer_name: "Loja X", contact_email: "loja@x.com", plan_amount_cents: 500000 }) as never,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { license_key: string } };
    expect(body.data.license_key).toBe("abc123");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm test:unit -- app/api/v1/licensing/admin/route.test.ts
```

Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implementar**

```ts
// app/api/v1/licensing/admin/route.ts
/**
 * POST /api/v1/licensing/admin — emissão manual de licença (Songhai only).
 *
 * Sem self-service nesta versão: a venda acontece fora do sistema, e quem
 * administra a instância central chama isto (via painel interno ou curl) para
 * registar o cliente e gerar a chave que ele cola no `.env` da instalação
 * dele. Ver docs/superpowers/specs/2026-09-04-licenciamento-paysuite-design.md.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  customer_name: z.string().min(1).max(200),
  contact_email: z.string().email(),
  notes: z.string().max(2000).optional(),
  plan_amount_cents: z.number().int().positive(),
  plan_interval_days: z.number().int().positive().default(30),
  trial_days: z.number().int().min(0).default(7),
});

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const user = await loadAuthUser();
  if (!user?.is_platform_admin) {
    return fail("forbidden", "Só platform admin emite licenças.", 403, { requestId });
  }

  const json = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { customer_name, contact_email, notes, plan_amount_cents, plan_interval_days, trial_days } =
    parsed.data;
  const admin = createAdminClient();

  const { data: install, error: installErr } = await admin
    .from("licensing_installs")
    .insert({ customer_name, contact_email, notes: notes ?? null })
    .select("id")
    .single();
  if (installErr || !install) {
    return fail("internal_error", installErr?.message ?? "falha ao criar install", 500, { requestId });
  }

  const trialEndsAt = new Date(Date.now() + trial_days * 24 * 60 * 60 * 1000).toISOString();
  const licenseKey = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

  const { data: license, error: licenseErr } = await admin
    .from("licensing_licenses")
    .insert({
      install_id: (install as { id: string }).id,
      license_key: licenseKey,
      status: "trial",
      plan_amount_cents,
      plan_interval_days,
      trial_ends_at: trialEndsAt,
      current_period_end: trialEndsAt,
    })
    .select("id, license_key, current_period_end")
    .single();
  if (licenseErr || !license) {
    return fail("internal_error", licenseErr?.message ?? "falha ao criar licença", 500, { requestId });
  }

  void audit({
    action: "licensing.license_issued",
    actorUserId: user.id,
    organizationId: null,
    resourceType: "licensing_license",
    resourceId: (license as { id: string }).id,
    requestId,
    metadata: { customer_name, plan_amount_cents, plan_interval_days, trial_days },
  });

  return ok(license, { status: 201, requestId });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm test:unit -- app/api/v1/licensing/admin/route.test.ts
```

Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/licensing/admin/route.ts app/api/v1/licensing/admin/route.test.ts
git commit -m "feat(licensing): emissão manual de licença (central, platform admin only)"
```

---

### Task 6: Central — verificação (assina o token)

**Files:**
- Create: `app/api/v1/licensing/verify/route.ts`
- Test: `app/api/v1/licensing/verify/route.test.ts`

**Interfaces:**
- Consumes: `signLicenseToken` (Task 3); `checkRateLimit(key, limit, windowSec):
  Promise<{allowed: boolean}>` de `@/lib/ai/dispatcher/rate-limit`; `env.LICENSING_SIGNING_PRIVATE_KEY`
  (Task 2); tabela `licensing_licenses` (Task 1).
- Produces: `POST /api/v1/licensing/verify` — `200 { data: { token, status, current_period_end }
  }`. Consumido pela Task 9 (`lib/licensing/central-client.ts`, chamado do lado do cliente).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// app/api/v1/licensing/verify/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const rateLimitMock = vi.fn();
const maybeSingleMock = vi.fn();

vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: rateLimitMock }));
vi.mock("@/lib/env", () => ({ env: { LICENSING_SIGNING_PRIVATE_KEY: PRIVATE_PEM } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock,
        }),
      }),
    }),
  }),
}));

import { generateKeyPairSync } from "node:crypto";
const { privateKey } = generateKeyPairSync("ed25519");
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/v1/licensing/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/licensing/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockResolvedValue({ allowed: true });
  });

  it("recusa license_key ausente", async () => {
    const res = await POST(req({}) as never);
    expect(res.status).toBe(422);
  });

  it("devolve 429 quando rate limited", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false });
    const res = await POST(req({ license_key: "abc1234567" }) as never);
    expect(res.status).toBe(429);
  });

  it("devolve 404 para chave desconhecida", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await POST(req({ license_key: "abc1234567" }) as never);
    expect(res.status).toBe(404);
  });

  it("devolve status 'past_due' quando current_period_end já passou", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: "lic-1",
        status: "active",
        current_period_end: "2020-01-01T00:00:00.000Z",
        trial_ends_at: null,
      },
      error: null,
    });
    const res = await POST(req({ license_key: "abc1234567" }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string; token: string } };
    expect(body.data.status).toBe("past_due");
    expect(body.data.token).toContain(".");
  });

  it("devolve status 'trial' quando dentro do período", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: "lic-1",
        status: "trial",
        current_period_end: "2099-01-01T00:00:00.000Z",
        trial_ends_at: "2099-01-01T00:00:00.000Z",
      },
      error: null,
    });
    const res = await POST(req({ license_key: "abc1234567" }) as never);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("trial");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm test:unit -- app/api/v1/licensing/verify/route.test.ts
```

Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implementar**

```ts
// app/api/v1/licensing/verify/route.ts
/**
 * POST /api/v1/licensing/verify — a instância de cliente chama isto (via
 * cron diário, `lib/licensing/central-client.ts`) para renovar o token
 * cacheado. `status` é sempre DERIVADO na hora a partir de
 * `current_period_end`/`trial_ends_at` — nunca fica um valor "vencido"
 * parado no banco esperando um cron virar; a única escrita no `status` da
 * licença acontece no webhook de pagamento (Task 8) e na revogação manual.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { signLicenseToken } from "@/lib/licensing/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({ license_key: z.string().min(10) });

interface LicenseRow {
  id: string;
  status: string;
  current_period_end: string;
  trial_ends_at: string | null;
}

export function deriveStatus(license: LicenseRow): "trial" | "active" | "past_due" | "revoked" {
  if (license.status === "revoked") return "revoked";
  if (Date.now() > new Date(license.current_period_end).getTime()) return "past_due";
  return license.status === "trial" ? "trial" : "active";
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "license_key ausente ou inválido.", 422, { requestId });
  }
  const { license_key: licenseKey } = parsed.data;

  const limited = await checkRateLimit(`licensing:verify:${licenseKey}`, 30, 3600);
  if (!limited.allowed) {
    return fail("rate_limited", "Muitas verificações. Tente novamente mais tarde.", 429, { requestId });
  }

  const admin = createAdminClient();
  const { data: license } = await admin
    .from("licensing_licenses")
    .select("id, status, current_period_end, trial_ends_at")
    .eq("license_key", licenseKey)
    .maybeSingle();

  if (!license) {
    return fail("not_found", "Chave de licença desconhecida.", 404, { requestId });
  }

  const row = license as LicenseRow;
  const status = deriveStatus(row);
  const token = signLicenseToken(
    { license_id: row.id, status, current_period_end: row.current_period_end },
    env.LICENSING_SIGNING_PRIVATE_KEY,
  );

  return ok({ token, status, current_period_end: row.current_period_end }, { requestId });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm test:unit -- app/api/v1/licensing/verify/route.test.ts
```

Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/licensing/verify/route.ts app/api/v1/licensing/verify/route.test.ts
git commit -m "feat(licensing): endpoint de verificação assina token com status derivado"
```

---

### Task 7: Central — renovação (cria cobrança PaySuite)

**Files:**
- Create: `app/api/v1/licensing/renew/route.ts`
- Test: `app/api/v1/licensing/renew/route.test.ts`

**Interfaces:**
- Consumes: `createPayment(apiToken, input): Promise<{id, checkoutUrl}>` de
  `@/lib/payments/paysuite/client.ts` (**já existe**, não recriar); `env.LICENSING_PAYSUITE_API_KEY`,
  `env.LICENSING_PUBLIC_BASE_URL` (Task 2); tabelas `licensing_licenses`/`licensing_payments`
  (Task 1).
- Produces: `POST /api/v1/licensing/renew` — `201 { data: { checkout_url, payment_id } }`.
  Consumido pela Task 9 (`central-client.ts`, chamado a partir do botão "Renovar agora" da Task
  12).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// app/api/v1/licensing/renew/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const maybeSingleMock = vi.fn();
const insertMock = vi.fn();
const createPaymentMock = vi.fn();

vi.mock("@/lib/env", () => ({
  env: {
    LICENSING_PAYSUITE_API_KEY: "tok-central",
    LICENSING_PUBLIC_BASE_URL: "https://central.example.com",
  },
}));
vi.mock("@/lib/payments/paysuite/client", () => ({ createPayment: createPaymentMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "licensing_licenses") {
        return { select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) };
      }
      return { insert: insertMock };
    },
  }),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/v1/licensing/renew", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/licensing/renew", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recusa license_key ausente", async () => {
    const res = await POST(req({}) as never);
    expect(res.status).toBe(422);
  });

  it("devolve 404 para chave desconhecida", async () => {
    maybeSingleMock.mockResolvedValue({ data: null });
    const res = await POST(req({ license_key: "abc1234567" }) as never);
    expect(res.status).toBe(404);
  });

  it("cria pagamento no PaySuite e registra licensing_payments", async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: "lic-1", plan_amount_cents: 500000 } });
    createPaymentMock.mockResolvedValue({ id: "psuite-1", checkoutUrl: "https://paysuite.tech/checkout/x" });
    insertMock.mockResolvedValue({ error: null });

    const res = await POST(req({ license_key: "abc1234567" }) as never);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { checkout_url: string } };
    expect(body.data.checkout_url).toBe("https://paysuite.tech/checkout/x");
    expect(createPaymentMock).toHaveBeenCalledWith(
      "tok-central",
      expect.objectContaining({ amount: "5000.00" }),
    );
  });

  it("devolve 502 quando o PaySuite falha", async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: "lic-1", plan_amount_cents: 500000 } });
    createPaymentMock.mockRejectedValue(new Error("upstream down"));
    const res = await POST(req({ license_key: "abc1234567" }) as never);
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm test:unit -- app/api/v1/licensing/renew/route.test.ts
```

Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implementar**

```ts
// app/api/v1/licensing/renew/route.ts
/**
 * POST /api/v1/licensing/renew — botão "Renovar agora" (Task 12) chama isto
 * através de `lib/licensing/central-client.ts` (Task 9). Cria a cobrança no
 * PaySuite com o valor do PLANO (não pede valor no body — evita que quem
 * chamar a rota diretamente escolha o próprio preço) e devolve o
 * `checkout_url` para o cliente pagar. A confirmação chega depois pelo
 * webhook (Task 8), não por este endpoint.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPayment } from "@/lib/payments/paysuite/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({ license_key: z.string().min(10) });

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "license_key ausente ou inválido.", 422, { requestId });
  }

  const admin = createAdminClient();
  const { data: license } = await admin
    .from("licensing_licenses")
    .select("id, plan_amount_cents")
    .eq("license_key", parsed.data.license_key)
    .maybeSingle();

  if (!license) {
    return fail("not_found", "Chave de licença desconhecida.", 404, { requestId });
  }
  const row = license as { id: string; plan_amount_cents: number };

  const reference = `lic-${row.id}-${Date.now()}`;
  const amount = (row.plan_amount_cents / 100).toFixed(2);

  let payment: { id: string; checkoutUrl: string };
  try {
    payment = await createPayment(env.LICENSING_PAYSUITE_API_KEY, {
      amount,
      reference,
      description: "Renovação de assinatura SonghaiCRM",
      webhook_url: `${env.LICENSING_PUBLIC_BASE_URL}/api/v1/licensing/webhooks/paysuite`,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return fail("upstream_unavailable", `PaySuite indisponível: ${detail}`, 502, { requestId });
  }

  const { error: insertErr } = await admin.from("licensing_payments").insert({
    license_id: row.id,
    paysuite_payment_id: payment.id,
    amount_cents: row.plan_amount_cents,
    status: "pending",
    checkout_url: payment.checkoutUrl,
  });
  if (insertErr) {
    return fail("internal_error", insertErr.message, 500, { requestId });
  }

  return ok({ checkout_url: payment.checkoutUrl, payment_id: payment.id }, { status: 201, requestId });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm test:unit -- app/api/v1/licensing/renew/route.test.ts
```

Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/licensing/renew/route.ts app/api/v1/licensing/renew/route.test.ts
git commit -m "feat(licensing): endpoint de renovação cria cobrança PaySuite"
```

---

### Task 8: Central — webhook de confirmação PaySuite

**Files:**
- Create: `app/api/v1/licensing/webhooks/paysuite/route.ts`
- Test: `app/api/v1/licensing/webhooks/paysuite/route.test.ts`

**Interfaces:**
- Consumes: `verifyInboundSignature(rawBody, header, secret): boolean` de
  `@/lib/webhooks/inbound` (**já existe**, reaproveitado); `env.LICENSING_PAYSUITE_WEBHOOK_SECRET`
  (Task 2); tabelas `licensing_payments`/`licensing_licenses` (Task 1).
- Produces: efeito colateral — estende `licensing_licenses.current_period_end` e marca
  `status='active'` em `payment.success`. Nenhuma tarefa seguinte importa deste módulo (é a
  ponta da cadeia); a Task 6 (`verify`) é quem LÊ o resultado na próxima chamada.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// app/api/v1/licensing/webhooks/paysuite/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const updatePaymentMock = vi.fn();
const singleLicenseMock = vi.fn();
const updateLicenseMock = vi.fn();

vi.mock("@/lib/env", () => ({ env: { LICENSING_PAYSUITE_WEBHOOK_SECRET: "segredo-webhook" } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "licensing_payments") {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({ maybeSingle: updatePaymentMock }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ single: singleLicenseMock }) }),
        update: () => ({ eq: updateLicenseMock }),
      };
    },
  }),
}));

import { POST } from "./route";

function assinar(body: string) {
  return createHmac("sha256", "segredo-webhook").update(body).digest("hex");
}

function req(bodyObj: unknown, signature?: string) {
  const body = JSON.stringify(bodyObj);
  return new Request("http://localhost/api/v1/licensing/webhooks/paysuite", {
    method: "POST",
    body,
    headers: { "x-signature": signature ?? assinar(body) },
  });
}

describe("POST /api/v1/licensing/webhooks/paysuite", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejeita assinatura inválida", async () => {
    const res = await POST(req({ event: "payment.success", data: { id: "p1" } }, "assinatura-errada") as never);
    expect(res.status).toBe(401);
  });

  it("ignora evento desconhecido com 200", async () => {
    const res = await POST(req({ event: "payout.success", data: { id: "p1" } }) as never);
    expect(res.status).toBe(200);
  });

  it("ignora quando não há pagamento pendente correspondente (idempotência)", async () => {
    updatePaymentMock.mockResolvedValue({ data: null, error: null });
    const res = await POST(req({ event: "payment.success", data: { id: "p1" } }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { reason?: string } };
    expect(body.data.reason).toBe("pagamento_nao_encontrado");
  });

  it("em payment.success: marca pago e estende current_period_end", async () => {
    updatePaymentMock.mockResolvedValue({
      data: { id: "pay-1", license_id: "lic-1", amount_cents: 500000 },
      error: null,
    });
    singleLicenseMock.mockResolvedValue({
      data: { id: "lic-1", current_period_end: "2026-09-04T00:00:00.000Z", plan_interval_days: 30 },
      error: null,
    });
    updateLicenseMock.mockResolvedValue({ error: null });

    const res = await POST(req({ event: "payment.success", data: { id: "p1" } }) as never);
    expect(res.status).toBe(200);
    expect(updateLicenseMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm test:unit -- app/api/v1/licensing/webhooks/paysuite/route.test.ts
```

Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implementar**

```ts
// app/api/v1/licensing/webhooks/paysuite/route.ts
/**
 * POST /api/v1/licensing/webhooks/paysuite — confirmação da renovação (Task
 * 7). Mesmo algoritmo de assinatura do webhook de pagamentos de tenant
 * (`app/api/v1/webhooks/payments/paysuite/[token]/route.ts`), reaproveitado
 * via `verifyInboundSignature` — não reescrito.
 *
 * Idempotência: o `.eq("status", "pending")` no UPDATE é o claim atómico —
 * uma reentrega do mesmo evento (o PaySuite reenvia em timeout) já encontra
 * `status='success'` e não casa a condição, então `maybeSingle()` devolve
 * null e a extensão do período NÃO roda de novo.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { verifyInboundSignature } from "@/lib/webhooks/inbound";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PaySuiteWebhookBody {
  event?: string;
  data?: { id?: string };
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const rawBody = await req.text();

  if (!verifyInboundSignature(rawBody, req.headers.get("x-signature"), env.LICENSING_PAYSUITE_WEBHOOK_SECRET)) {
    return fail("unauthorized", "Assinatura inválida.", 401, { requestId });
  }

  let body: PaySuiteWebhookBody;
  try {
    body = JSON.parse(rawBody) as PaySuiteWebhookBody;
  } catch {
    return fail("invalid_request", "Corpo não é JSON válido.", 400, { requestId });
  }

  if (body.event !== "payment.success" && body.event !== "payment.failed") {
    return ok({ status: "ignored" }, { requestId });
  }
  const paymentId = body.data?.id;
  if (!paymentId) {
    return ok({ status: "ignored" }, { requestId });
  }

  const admin = createAdminClient();
  const novoStatus = body.event === "payment.success" ? "success" : "failed";

  const { data: payment, error: updErr } = await admin
    .from("licensing_payments")
    .update({ status: novoStatus, paid_at: novoStatus === "success" ? new Date().toISOString() : null })
    .eq("paysuite_payment_id", paymentId)
    .eq("status", "pending")
    .select("id, license_id, amount_cents")
    .maybeSingle();

  if (updErr) {
    logger.error("[licensing.webhooks.paysuite] falha ao atualizar pagamento", {
      error: updErr.message,
      requestId,
    });
    return fail("internal_error", "Falha ao gravar confirmação.", 500, { requestId });
  }

  if (!payment) {
    return ok({ status: "ignored", reason: "pagamento_nao_encontrado" }, { requestId });
  }

  if (novoStatus === "success") {
    const row = payment as { id: string; license_id: string; amount_cents: number };
    const { data: license } = await admin
      .from("licensing_licenses")
      .select("id, current_period_end, plan_interval_days")
      .eq("id", row.license_id)
      .single();

    if (license) {
      const lic = license as { id: string; current_period_end: string; plan_interval_days: number };
      const base = Math.max(new Date(lic.current_period_end).getTime(), Date.now());
      const novoFim = new Date(base + lic.plan_interval_days * 24 * 60 * 60 * 1000).toISOString();
      await admin
        .from("licensing_licenses")
        .update({ status: "active", current_period_end: novoFim })
        .eq("id", lic.id);
    }
  }

  return ok({ status: "processed" }, { requestId });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm test:unit -- app/api/v1/licensing/webhooks/paysuite/route.test.ts
```

Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/licensing/webhooks/paysuite/route.ts app/api/v1/licensing/webhooks/paysuite/route.test.ts
git commit -m "feat(licensing): webhook PaySuite estende current_period_end (idempotente)"
```

---

### Task 9: Cliente — `lib/licensing/central-client.ts`

**Files:**
- Create: `lib/licensing/central-client.ts`
- Test: `lib/licensing/central-client.test.ts`

**Interfaces:**
- Produces: `fetchLicenseToken(baseUrl: string, licenseKey: string): Promise<string>` e
  `requestRenewal(baseUrl: string, licenseKey: string): Promise<{ checkoutUrl: string }>`, e
  `class LicensingCentralError extends Error`. Consumido pela Task 10 (cron) e pela Task 12
  (server action do botão "Renovar agora").

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/licensing/central-client.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchLicenseToken, requestRenewal, LicensingCentralError } from "./central-client";

describe("licensing/central-client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetchLicenseToken devolve o token em sucesso", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ data: { token: "abc.def" } }), { status: 200 }),
    );
    const token = await fetchLicenseToken("https://central.example.com", "key-1");
    expect(token).toBe("abc.def");
  });

  it("fetchLicenseToken lança LicensingCentralError em 404", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "chave desconhecida" } }), { status: 404 }),
    );
    await expect(fetchLicenseToken("https://central.example.com", "key-1")).rejects.toThrow(
      LicensingCentralError,
    );
  });

  it("requestRenewal devolve checkoutUrl em sucesso", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ data: { checkout_url: "https://paysuite.tech/checkout/x" } }), {
        status: 201,
      }),
    );
    const { checkoutUrl } = await requestRenewal("https://central.example.com", "key-1");
    expect(checkoutUrl).toBe("https://paysuite.tech/checkout/x");
  });

  it("requestRenewal lança LicensingCentralError quando o body não tem checkout_url", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 200 }),
    );
    await expect(requestRenewal("https://central.example.com", "key-1")).rejects.toThrow(
      LicensingCentralError,
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm test:unit -- lib/licensing/central-client.test.ts
```

Expected: FAIL — `Cannot find module './central-client'`.

- [ ] **Step 3: Implementar**

```ts
// lib/licensing/central-client.ts
/**
 * Cliente HTTP que a instalação de CLIENTE usa para falar com a instância
 * central (`env.LICENSING_CENTRAL_URL`). Timeout curto de propósito: isto
 * roda dentro de um cron (Task 10) e de uma server action (Task 12) — travar
 * a instalação inteira porque a central está lenta seria pior que o próprio
 * gate de licença.
 */
export class LicensingCentralError extends Error {}

const TIMEOUT_MS = 10_000;

function trimEndSlash(url: string): string {
  return url.replace(/\/$/, "");
}

export async function fetchLicenseToken(baseUrl: string, licenseKey: string): Promise<string> {
  const res = await fetch(`${trimEndSlash(baseUrl)}/api/v1/licensing/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ license_key: licenseKey }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const json = (await res.json().catch(() => ({}))) as {
    data?: { token?: string };
    error?: { message?: string };
  };

  if (!res.ok || !json.data?.token) {
    throw new LicensingCentralError(json.error?.message ?? `licensing verify falhou (${res.status})`);
  }
  return json.data.token;
}

export async function requestRenewal(baseUrl: string, licenseKey: string): Promise<{ checkoutUrl: string }> {
  const res = await fetch(`${trimEndSlash(baseUrl)}/api/v1/licensing/renew`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ license_key: licenseKey }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const json = (await res.json().catch(() => ({}))) as {
    data?: { checkout_url?: string };
    error?: { message?: string };
  };

  if (!res.ok || !json.data?.checkout_url) {
    throw new LicensingCentralError(json.error?.message ?? `licensing renew falhou (${res.status})`);
  }
  return { checkoutUrl: json.data.checkout_url };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm test:unit -- lib/licensing/central-client.test.ts
```

Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/licensing/central-client.ts lib/licensing/central-client.test.ts
git commit -m "feat(licensing): cliente HTTP da instalação para a instância central"
```

---

### Task 10: Cliente — cron `licensing-refresh`

**Files:**
- Create: `app/api/v1/cron/licensing-refresh/route.ts`
- Test: `app/api/v1/cron/licensing-refresh/route.test.ts`
- Modify: `docker/scheduler/entrypoint.sh` (registrar o cron)

**Interfaces:**
- Consumes: `fetchLicenseToken` (Task 9); `env.LICENSE_KEY`, `env.LICENSING_CENTRAL_URL` (Task
  2); tabela `licensing_client_state` (Task 1).
- Produces: efeito colateral — grava `{ token, fetched_at }` em `licensing_client_state` (linha
  `id='singleton'`). Consumido pela Task 11 (`middleware.ts` lê essa linha).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// app/api/v1/cron/licensing-refresh/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchLicenseTokenMock = vi.fn();
const upsertMock = vi.fn();

vi.mock("@/lib/env", () => ({
  env: {
    INTERNAL_CRON_SECRET: "cron-secret",
    INTERNAL_SECRET: "",
    LICENSE_KEY: "key-1",
    LICENSING_CENTRAL_URL: "https://central.example.com",
  },
}));
vi.mock("@/lib/licensing/central-client", () => ({ fetchLicenseToken: fetchLicenseTokenMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ upsert: upsertMock }) }),
}));

import { GET } from "./route";

function req(auth?: string) {
  return new Request("http://localhost/api/v1/cron/licensing-refresh", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("GET /api/v1/cron/licensing-refresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recusa sem o segredo de cron", async () => {
    const res = await GET(req() as never);
    expect(res.status).toBe(403);
  });

  it("atualiza licensing_client_state com o token novo", async () => {
    fetchLicenseTokenMock.mockResolvedValue("token-assinado");
    upsertMock.mockResolvedValue({ error: null });

    const res = await GET(req("Bearer cron-secret") as never);
    expect(res.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "singleton", token: "token-assinado" }),
    );
  });

  it("não lança quando a central está inacessível — mantém o cache anterior", async () => {
    fetchLicenseTokenMock.mockRejectedValue(new Error("timeout"));
    const res = await GET(req("Bearer cron-secret") as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { refreshed: boolean } };
    expect(body.data.refreshed).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm test:unit -- app/api/v1/cron/licensing-refresh/route.test.ts
```

Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implementar**

```ts
// app/api/v1/cron/licensing-refresh/route.ts
/**
 * GET/POST /api/v1/cron/licensing-refresh — busca o token de licença na
 * instância central 1x/dia e cacheia em `licensing_client_state`. Mesmo
 * contrato de auth dos demais crons (Bearer INTERNAL_CRON_SECRET|
 * INTERNAL_SECRET). Instalação sem `LICENSE_KEY`/`LICENSING_CENTRAL_URL`
 * configurados (ex.: a própria instância central, ou um clone que ainda não
 * recebeu licença) é NO-OP — não é erro, o gate (Task 11) trata "nunca
 * contactou" como bloqueio, o que é o comportamento certo para uma
 * instalação sem licença configurada.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLicenseToken } from "@/lib/licensing/central-client";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  if (!env.LICENSE_KEY || !env.LICENSING_CENTRAL_URL) {
    return ok({ skipped: true }, { requestId });
  }

  try {
    const token = await fetchLicenseToken(env.LICENSING_CENTRAL_URL, env.LICENSE_KEY);
    const admin = createAdminClient();
    await admin.from("licensing_client_state").upsert({
      id: "singleton",
      token,
      fetched_at: new Date().toISOString(),
    });
    return ok({ refreshed: true }, { requestId });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn("[licensing-refresh] falha ao contactar a central — mantendo cache anterior", {
      error: detail,
      requestId,
    });
    return ok({ refreshed: false, reason: detail }, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm test:unit -- app/api/v1/cron/licensing-refresh/route.test.ts
```

Expected: PASS (3 testes).

- [ ] **Step 5: Registrar no scheduler**

Em `docker/scheduler/entrypoint.sh`, na lista de crons, adicionar uma linha (1x/dia, de
madrugada — não é urgente, e evita competir com os crons de minuto-a-minuto):

```
0 3 * * *|25|api/v1/cron/licensing-refresh
```

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/cron/licensing-refresh/route.ts app/api/v1/cron/licensing-refresh/route.test.ts docker/scheduler/entrypoint.sh
git commit -m "feat(licensing): cron diário busca token de licença na central"
```

---

### Task 11: Cliente — `middleware.ts` (enforcement)

**Files:**
- Create: `middleware.ts` (raiz do repo — não existe ainda)
- Test: `lib/licensing/gate.test.ts` já cobre a decisão pura (Task 4); este arquivo é fino de
  propósito e verificado manualmente no Step 4 abaixo.

**Interfaces:**
- Consumes: `avaliarAcesso` (Task 4); `LICENSING_PUBLIC_KEY_PEM` (Task 2); tabela
  `licensing_client_state` (Task 1).
- Produces: intercepta toda requisição — nenhuma tarefa seguinte depende deste módulo.

**Nota de escopo (desvio deliberado do texto literal do spec):** o spec diz "bloqueia mutações...
exceto a própria rota de billing". Rotas de renovação (`/api/v1/licensing/*`) vivem na
**instância central**, não na instância de cliente — o cliente nunca as chama localmente, só via
`fetch` para `LICENSING_CENTRAL_URL`. O que precisa de exclusão explícita aqui são
`/api/v1/webhooks/*` (WAHA, PaySuite de tenant — bloquear entrega de webhook de terceiro
descartaria mensagem/pagamento em vez de só avisar o operador) e `/api/v1/cron/*` (os próprios
crons internos, incluindo o `licensing-refresh` que precisa continuar rodando justamente para
poder SAIR do estado bloqueado).

- [ ] **Step 1: Implementar**

```ts
// middleware.ts
/**
 * Gate de assinatura self-host (licenciamento via PaySuite). Roda em runtime
 * Node (não edge) porque precisa de `node:crypto` para verificar Ed25519 —
 * ver docs/superpowers/specs/2026-09-04-licenciamento-paysuite-design.md.
 *
 * Só intercepta MUTAÇÃO (POST/PUT/PATCH/DELETE) em `/api/v1/*`, excluindo
 * webhooks e crons (ver Task 11 do plano — bloquear entrega de webhook de
 * terceiro perde dado, não é isso que "degradar" deveria significar).
 * Leitura (GET) nunca é tocada por este middleware.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { avaliarAcesso } from "@/lib/licensing/gate";
import { LICENSING_PUBLIC_KEY_PEM } from "@/lib/licensing/chave-publica";

export const config = {
  runtime: "nodejs" as const,
  matcher: ["/api/v1/:path*"],
};

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const EXCLUDED_PREFIXES = ["/api/v1/webhooks", "/api/v1/cron"];

export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (!MUTATING_METHODS.has(req.method)) {
    return NextResponse.next();
  }

  const path = req.nextUrl.pathname;
  if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return NextResponse.next();
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("licensing_client_state")
    .select("token, fetched_at")
    .eq("id", "singleton")
    .maybeSingle();

  const row = data as { token: string | null; fetched_at: string | null } | null;
  const decisao = avaliarAcesso(
    {
      token: row?.token ?? null,
      fetchedAt: row?.fetched_at ? new Date(row.fetched_at) : null,
    },
    new Date(),
    LICENSING_PUBLIC_KEY_PEM,
  );

  if (decisao.bloqueado) {
    return NextResponse.json(
      {
        error: {
          code: "license_required",
          message:
            "Assinatura pendente. Regularize em Configurações › Billing para continuar criando ou editando dados.",
          details: { reason: decisao.motivo },
        },
      },
      { status: 403 },
    );
  }

  return NextResponse.next();
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS — confirma que `middleware.ts` compila e os imports resolvem.

- [ ] **Step 3: Verificação manual (dev server)**

```bash
pnpm dev
```

Num segundo terminal, sem `LICENSE_KEY` configurado (instalação de cliente nova, ainda sem
`licensing_client_state` populado):

```bash
curl -i -X POST http://localhost:3000/api/v1/ai/agents -H "Content-Type: application/json" -d '{}'
```

Expected: `403` com `{"error":{"code":"license_required", ...}}`.

```bash
curl -i http://localhost:3000/api/v1/health
```

Expected: `200` — GET nunca é bloqueado.

- [ ] **Step 4: Commit**

```bash
git add middleware.ts
git commit -m "feat(licensing): middleware bloqueia mutação quando assinatura vence, libera leitura"
```

---

### Task 12: Cliente — UI em Configurações › Billing

**Files:**
- Create: `app/actions/licensing/renovar.ts`
- Create: `app/app/settings/billing/_components/RenovarLicencaButton.tsx`
- Modify: `app/app/settings/billing/page.tsx` (troca o card "Em breve — Fase 2" pelo estado real)
- Test: `app/actions/licensing/renovar.test.ts`

**Interfaces:**
- Consumes: `requestRenewal` (Task 9); `requireAuth`/`resolveActiveOrg` de `lib/auth/server.ts`
  (já usados na página actual); `env.LICENSE_KEY`, `env.LICENSING_CENTRAL_URL` (Task 2); tabela
  `licensing_client_state` (Task 1, lida direto na página para mostrar `current_period_end`).
- Produces: nenhuma tarefa seguinte depende disto — é a ponta visível ao usuário.

- [ ] **Step 1: Escrever o teste da server action (falha primeiro)**

```ts
// app/actions/licensing/renovar.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireAuthMock = vi.fn();
const resolveActiveOrgMock = vi.fn();
const requestRenewalMock = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireAuth: requireAuthMock,
  resolveActiveOrg: resolveActiveOrgMock,
}));
vi.mock("@/lib/env", () => ({
  env: { LICENSE_KEY: "key-1", LICENSING_CENTRAL_URL: "https://central.example.com" },
}));
vi.mock("@/lib/licensing/central-client", () => ({ requestRenewal: requestRenewalMock }));

import { renovarLicenca } from "./renovar";

describe("renovarLicenca (server action)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recusa quem não é admin da org ativa", async () => {
    requireAuthMock.mockResolvedValue({ id: "u1" });
    resolveActiveOrgMock.mockResolvedValue({ orgId: "org1", role: "agent" });
    const r = await renovarLicenca();
    expect("error" in r).toBe(true);
  });

  it("devolve checkoutUrl quando admin e tudo configurado", async () => {
    requireAuthMock.mockResolvedValue({ id: "u1" });
    resolveActiveOrgMock.mockResolvedValue({ orgId: "org1", role: "admin" });
    requestRenewalMock.mockResolvedValue({ checkoutUrl: "https://paysuite.tech/checkout/x" });
    const r = await renovarLicenca();
    expect(r).toEqual({ checkoutUrl: "https://paysuite.tech/checkout/x" });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm test:unit -- app/actions/licensing/renovar.test.ts
```

Expected: FAIL — `Cannot find module './renovar'`.

- [ ] **Step 3: Implementar a server action**

```ts
// app/actions/licensing/renovar.ts
"use server";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { env } from "@/lib/env";
import { requestRenewal } from "@/lib/licensing/central-client";

export async function renovarLicenca(): Promise<{ checkoutUrl: string } | { error: string }> {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org || ROLE_RANK[org.role] < ROLE_RANK.admin) {
    return { error: "Permissão insuficiente." };
  }

  if (!env.LICENSE_KEY || !env.LICENSING_CENTRAL_URL) {
    return { error: "Esta instalação não tem licenciamento configurado." };
  }

  try {
    const { checkoutUrl } = await requestRenewal(env.LICENSING_CENTRAL_URL, env.LICENSE_KEY);
    return { checkoutUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Falha ao gerar cobrança." };
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm test:unit -- app/actions/licensing/renovar.test.ts
```

Expected: PASS (2 testes).

- [ ] **Step 5: Componente do botão**

```tsx
// app/app/settings/billing/_components/RenovarLicencaButton.tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { renovarLicenca } from "@/app/actions/licensing/renovar";

export function RenovarLicencaButton() {
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setErro(null);
            const r = await renovarLicenca();
            if ("error" in r) {
              setErro(r.error);
              return;
            }
            window.open(r.checkoutUrl, "_blank", "noopener,noreferrer");
          })
        }
      >
        {pending ? "Gerando cobrança…" : "Renovar agora"}
      </Button>
      {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
    </div>
  );
}
```

- [ ] **Step 6: Actualizar a página de billing**

Em `app/app/settings/billing/page.tsx`, substituir o card "Em breve — Fase 2" (linhas 30-46) por
um estado real: lê `licensing_client_state` com o admin client, verifica o token com
`avaliarAcesso`, mostra `current_period_end` e o botão.

```tsx
// app/app/settings/billing/page.tsx
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { emailDeSuporte } from "@/lib/branding/saida";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { avaliarAcesso } from "@/lib/licensing/gate";
import { verifyLicenseToken } from "@/lib/licensing/token";
import { LICENSING_PUBLIC_KEY_PEM } from "@/lib/licensing/chave-publica";
import { Card } from "@/components/ui/card";
import { RenovarLicencaButton } from "./_components/RenovarLicencaButton";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const suporte = emailDeSuporte();

  if (!env.LICENSE_KEY || !env.LICENSING_CENTRAL_URL) {
    return (
      <div className="flex h-full flex-col gap-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">Planos, faturas e cobrança.</p>
        </header>
        <Card className="max-w-xl p-6">
          <h2 className="text-sm font-semibold">Licenciamento não configurado</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta instalação não tem `LICENSE_KEY`/`LICENSING_CENTRAL_URL` no `.env`.{" "}
            {suporte ? (
              <>
                Contate <a className="underline" href={`mailto:${suporte}`}>{suporte}</a>.
              </>
            ) : null}
          </p>
        </Card>
      </div>
    );
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("licensing_client_state")
    .select("token, fetched_at")
    .eq("id", "singleton")
    .maybeSingle();
  const row = data as { token: string | null; fetched_at: string | null } | null;

  const decisao = avaliarAcesso(
    { token: row?.token ?? null, fetchedAt: row?.fetched_at ? new Date(row.fetched_at) : null },
    new Date(),
    LICENSING_PUBLIC_KEY_PEM,
  );
  const payload = row?.token ? verifyLicenseToken(row.token, LICENSING_PUBLIC_KEY_PEM) : null;

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">Assinatura desta instalação.</p>
      </header>
      {decisao.bloqueado ? (
        <Card className="max-w-xl border-destructive/50 p-6">
          <h2 className="text-sm font-semibold text-destructive">Assinatura pendente</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Criar ou editar dados está bloqueado até regularizar. Leitura continua disponível
            normalmente.
          </p>
          <div className="mt-4">
            <RenovarLicencaButton />
          </div>
        </Card>
      ) : (
        <Card className="max-w-xl p-6">
          <h2 className="text-sm font-semibold">Assinatura em dia</h2>
          {payload ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Renova até {new Date(payload.current_period_end).toLocaleDateString("pt-MZ")}.
            </p>
          ) : null}
          <div className="mt-4">
            <RenovarLicencaButton />
          </div>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Typecheck e lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: PASS nos dois.

- [ ] **Step 8: Verificação visual (doutrina de QA Visual — ambiente fresco)**

```bash
pnpm build && pnpm start
```

Com Playwright (ou manualmente no browser), logado como admin de uma org de teste: navegue até
`/app/settings/billing`. Confirme por `getBoundingClientRect`/leitura de texto (não a olho):

1. Sem `licensing_client_state` populado → card "Assinatura pendente" visível, botão "Renovar
   agora" presente.
2. Clique em "Renovar agora" → abre nova aba com uma URL `https://paysuite.tech/checkout/...`
   (ou erro visível se `LICENSING_CENTRAL_URL` não estiver acessível no ambiente de teste — nesse
   caso registre como achado, não como falha desta tarefa).

- [ ] **Step 9: Commit**

```bash
git add app/actions/licensing/renovar.ts app/actions/licensing/renovar.test.ts app/app/settings/billing/_components/RenovarLicencaButton.tsx app/app/settings/billing/page.tsx
git commit -m "feat(licensing): tela de billing mostra estado da assinatura e botão de renovação"
```

---

## Depois de todas as tarefas

- [ ] Rodar a suíte completa: `pnpm typecheck && pnpm lint && pnpm test:unit`
- [ ] Rodar `pnpm test:db` (a migration da Task 1 mexe em schema)
- [ ] Confirmar living-system checklist (`docs/doctrine/sistema-vivo.md`) e navegação: a tela de
  billing já tinha porta (`lib/navigation/registry.ts:508-516`, `group: "organizacao"`) — não
  precisa de entrada nova.
- [ ] Actualizar `docs/testing/user-journey-map.md` com o caso de renovação de licença.
- [ ] Lembrar o bloqueador registado no spec: `VISION.md`/`CLAUDE.md` deste fork ainda afirmam
  "open source" e "não assinatura" — resolver antes do merge para produção.
