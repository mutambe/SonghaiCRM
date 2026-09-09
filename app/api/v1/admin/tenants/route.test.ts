import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  hashEmail: vi.fn((email: string) => `hash:${email}`),
}));

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
