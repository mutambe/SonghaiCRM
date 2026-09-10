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
