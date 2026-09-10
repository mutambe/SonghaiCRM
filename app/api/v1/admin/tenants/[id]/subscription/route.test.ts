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

/** Stub de `organizations` que devolve o tenant como existente. */
function orgExistsBuilder() {
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: ORG_ID }, error: null }) }) }) };
}

/** Stub de `organizations` que devolve "não existe" (tenant inválido). */
function orgMissingBuilder() {
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
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
        if (table === "organizations") return orgExistsBuilder();
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
        if (table === "organizations") return orgExistsBuilder();
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

  it("organization_id inexistente → 404 not_found, sem chegar em plans/subscriptions", async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => {
        if (table === "organizations") return orgMissingBuilder();
        throw new Error(`não deveria chegar em ${table}`);
      },
    } as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ plan_id: NEW_PLAN_ID }), { params: Promise.resolve({ id: ORG_ID }) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("insert falha depois do close ter sucesso → reabre a linha antiga e devolve 500 com o estado registrado", async () => {
    let closedId: string | null = null;
    let reopenedId: string | null = null;

    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => {
        if (table === "organizations") return orgExistsBuilder();
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
              eq: () => {
                const patch = v as { ended_at: string | null };
                if (patch.ended_at !== null) {
                  closedId = OLD_SUB_ID;
                } else {
                  reopenedId = OLD_SUB_ID;
                }
                return { then: (r: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
              },
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({ data: null, error: { message: "insert falhou de propósito" } }),
              }),
            }),
          };
        }
        throw new Error(`tabela não simulada: ${table}`);
      },
    } as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ plan_id: NEW_PLAN_ID }), { params: Promise.resolve({ id: ORG_ID }) });
    expect(res.status).toBe(500);
    expect(closedId).toBe(OLD_SUB_ID);
    expect(reopenedId).toBe(OLD_SUB_ID);

    const body = (await res.json()) as { error: { code: string; details?: unknown } };
    expect(body.error.code).toBe("internal_error");
    // Reopen (compensação) teve sucesso aqui — details fica só a mensagem
    // crua do insert. O objeto {insert_error, reopen_error, ...} só aparece
    // quando a PRÓPRIA compensação falha (não mascarar estado inconsistente).
    expect(body.error.details).toBe("insert falhou de propósito");
  });
});
