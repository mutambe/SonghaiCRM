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
// lib/admin/invite-tenant-owner.ts importa @/lib/env (redirectTo do convite) —
// sem isto o teste depende do .env.local local estar bem preenchido, que não
// é garantia num ambiente de teste (CI seta placeholders via
// tests/setup/vitest.setup.ts; local pode ter valor vazio numa var opcional
// e derrubar a suíte inteira num erro de import, não de asserção).
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://crm.exemplo.com.br" } }));

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

  it("owner_email já pertence a usuário confirmado → resolve o user_id existente em vez de 500", async () => {
    const inviteUserByEmail = vi.fn(async () => ({
      data: { user: null },
      error: { message: "A user with this email address has already been registered", code: "email_exists", status: 422 },
    }));
    const listUsers = vi.fn(async () => ({
      data: { users: [{ id: OWNER_ID, email: "maria@example.com" }] },
      error: null,
    }));
    const insertedOrg = { id: ORG_ID, slug: "loja-da-maria", display_name: "Loja da Maria" };
    let insertedMembership: unknown = null;
    let insertedSubscription: unknown = null;

    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { inviteUserByEmail, listUsers } },
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
    expect(listUsers).toHaveBeenCalled();
    expect(insertedMembership).toMatchObject({ organization_id: ORG_ID, user_id: OWNER_ID, role: "admin" });
    expect(insertedSubscription).toMatchObject({ organization_id: ORG_ID, plan_id: PLAN_ID, status: "active" });
  });

  it("owner_email 'já existe' mas não é encontrado no diretório → 500 internal_error (não inventa user_id)", async () => {
    const inviteUserByEmail = vi.fn(async () => ({
      data: { user: null },
      error: { message: "already registered", code: "email_exists", status: 422 },
    }));
    const listUsers = vi.fn(async () => ({ data: { users: [] }, error: null }));

    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { inviteUserByEmail, listUsers } },
      from: (table: string) => {
        if (table === "plans") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: PLAN_ID, is_active: true }, error: null }) }) }) };
        }
        throw new Error(`não deveria chegar em ${table}`);
      },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(postReq(bodyDe()));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("internal_error");
  });

  it("membership falha após organization criada → organization é desfeita (compensação), 500 claro", async () => {
    const inviteUserByEmail = vi.fn(async () => ({ data: { user: { id: OWNER_ID } }, error: null }));
    const insertedOrg = { id: ORG_ID, slug: "loja-da-maria", display_name: "Loja da Maria" };
    let deletedOrgId: unknown = null;

    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { inviteUserByEmail } },
      from: (table: string) => {
        if (table === "plans") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: PLAN_ID, is_active: true }, error: null }) }) }) };
        }
        if (table === "organizations") {
          return {
            insert: () => ({ select: () => ({ single: async () => ({ data: insertedOrg, error: null }) }) }),
            delete: () => ({ eq: async (_col: string, val: unknown) => { deletedOrgId = val; return { error: null }; } }),
          };
        }
        if (table === "user_organizations") {
          return { insert: () => ({ then: (r: (x: unknown) => unknown) => Promise.resolve({ error: { message: "boom" } }).then(r) }) };
        }
        throw new Error(`não deveria chegar em ${table}`);
      },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(postReq(bodyDe()));
    expect(res.status).toBe(500);
    expect(deletedOrgId).toBe(ORG_ID);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("internal_error");
  });

  it("subscription falha após organization e membership criadas → organization é desfeita (compensação), 500 claro", async () => {
    const inviteUserByEmail = vi.fn(async () => ({ data: { user: { id: OWNER_ID } }, error: null }));
    const insertedOrg = { id: ORG_ID, slug: "loja-da-maria", display_name: "Loja da Maria" };
    let deletedOrgId: unknown = null;

    vi.mocked(createAdminClient).mockReturnValue({
      auth: { admin: { inviteUserByEmail } },
      from: (table: string) => {
        if (table === "plans") {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: PLAN_ID, is_active: true }, error: null }) }) }) };
        }
        if (table === "organizations") {
          return {
            insert: () => ({ select: () => ({ single: async () => ({ data: insertedOrg, error: null }) }) }),
            delete: () => ({ eq: async (_col: string, val: unknown) => { deletedOrgId = val; return { error: null }; } }),
          };
        }
        if (table === "user_organizations") {
          return { insert: () => ({ then: (r: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(r) }) };
        }
        if (table === "organization_subscriptions") {
          return { insert: () => ({ then: (r: (x: unknown) => unknown) => Promise.resolve({ error: { message: "boom" } }).then(r) }) };
        }
        throw new Error(`não deveria chegar em ${table}`);
      },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(postReq(bodyDe()));
    expect(res.status).toBe(500);
    expect(deletedOrgId).toBe(ORG_ID);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("internal_error");
  });
});
