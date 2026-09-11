import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteOrResolveOwner } from "@/lib/admin/invite-tenant-owner";
import { sendPasswordRecoveryEmail } from "@/lib/supabase/public-auth";

/**
 * POST /api/v1/admin/tenants/[id]/owner — "resetar o acesso" do responsável
 * do tenant a partir do painel de plataforma.
 *
 * O caso motivador: admin cria o tenant, digita o e-mail do owner errado, e
 * até aqui não havia conserto sem SQL manual — o convite ficava pendente
 * (ou, como no tenant que gerou este bug, a membership nem existia: 0 em
 * "Usuários"). `change_email` cobre os dois: sem membership nenhuma OU com
 * convite pendente, ele substitui. Se o dono já aceitou, `change_email` é
 * recusado (409) — ali o conserto é `reset_password`, não trocar e-mail.
 */

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  hashEmail: vi.fn((email: string) => `hash:${email}`),
}));
vi.mock("@/lib/admin/invite-tenant-owner", () => ({
  inviteOrResolveOwner: vi.fn(),
}));
vi.mock("@/lib/supabase/public-auth", () => ({
  sendPasswordRecoveryEmail: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://crm.exemplo.com.br" } }));

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const OLD_OWNER_ID = "55555555-5555-4555-8555-555555555555";
const NEW_OWNER_ID = "66666666-6666-4666-8666-666666666666";

interface Membership {
  id: string;
  user_id: string;
  organization_id: string;
  role: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

interface Fixture {
  org: { id: string; slug: string; status: string } | null;
  memberships: Membership[];
  idempotencyRows: Array<{ key: string; endpoint: string; response_body: unknown }>;
  usersById: Record<string, { email: string }>;
  deletedUsers: string[];
}

function membershipBuilder(fx: Fixture) {
  const filtros: Array<(m: Membership) => boolean> = [];
  let order: "asc" | "desc" | null = null;
  let lim: number | null = null;
  const builder = {
    select: () => builder,
    eq: (col: keyof Membership, val: unknown) => {
      filtros.push((m) => m[col] === val);
      return builder;
    },
    is: (col: keyof Membership, val: null) => {
      filtros.push((m) => m[col] === val);
      return builder;
    },
    order: (_col: string, opts?: { ascending?: boolean }) => {
      order = opts?.ascending === false ? "desc" : "asc";
      return builder;
    },
    limit: (n: number) => {
      lim = n;
      return builder;
    },
    insert: (row: Record<string, unknown>) => {
      const created: Membership = {
        id: `m-${fx.memberships.length + 1}`,
        user_id: row.user_id as string,
        organization_id: row.organization_id as string,
        role: row.role as string,
        accepted_at: (row.accepted_at as string | null) ?? null,
        revoked_at: null,
      };
      fx.memberships.push(created);
      return { error: null };
    },
    update: (patch: Partial<Membership>) => ({
      eq: (col: keyof Membership, val: unknown) => {
        for (const m of fx.memberships) {
          if (m[col] === val) Object.assign(m, patch);
        }
        return Promise.resolve({ error: null });
      },
    }),
    maybeSingle: async () => {
      let rows = fx.memberships.filter((m) => filtros.every((f) => f(m)));
      if (order) rows = [...rows].sort((a, b) => (order === "desc" ? -1 : 1) * a.id.localeCompare(b.id));
      if (lim) rows = rows.slice(0, lim);
      return { data: rows[0] ?? null, error: null };
    },
    then: (resolve: (v: { count: number; error: null }) => unknown) => {
      const rows = fx.memberships.filter((m) => filtros.every((f) => f(m)));
      return Promise.resolve({ count: rows.length, error: null }).then(resolve);
    },
  };
  return builder;
}

function orgBuilder(fx: Fixture) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: fx.org, error: null }),
  };
  return builder;
}

function idempotencyBuilder(fx: Fixture) {
  let matchKey: string | null = null;
  let matchEndpoint: string | null = null;
  const builder = {
    select: () => builder,
    eq: (col: string, val: string) => {
      if (col === "key") matchKey = val;
      if (col === "endpoint") matchEndpoint = val;
      return builder;
    },
    maybeSingle: async () => ({
      data:
        fx.idempotencyRows.find((r) => r.key === matchKey && r.endpoint === matchEndpoint) ??
        null,
      error: null,
    }),
    insert: (row: { key: string; endpoint: string; response_body: unknown }) => {
      fx.idempotencyRows.push(row);
      return { select: () => ({ single: async () => ({ data: { id: "idem-1" }, error: null }) }) };
    },
  };
  return builder;
}

function makeAdminStub(fx: Fixture) {
  return {
    from: (table: string) => {
      if (table === "organizations") return orgBuilder(fx);
      if (table === "user_organizations") return membershipBuilder(fx);
      if (table === "idempotency_keys") return idempotencyBuilder(fx);
      throw new Error(`tabela não simulada: ${table}`);
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: fx.usersById[id] ? { id, email: fx.usersById[id].email } : null },
          error: null,
        }),
        deleteUser: async (id: string) => {
          fx.deletedUsers.push(id);
          return { error: null };
        },
      },
    },
  };
}

function fixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    org: { id: ORG_ID, slug: "egidio-comercial", status: "active" },
    memberships: [],
    idempotencyRows: [],
    usersById: {},
    deletedUsers: [],
    ...overrides,
  };
}

function req(body: unknown, idempotencyKey: string | null = "idem-key-1") {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return new NextRequest(`http://localhost/api/v1/admin/tenants/${ORG_ID}/owner`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

let fx: Fixture;

beforeEach(() => {
  vi.clearAllMocks();
  fx = fixture();
  vi.mocked(requirePlatformAdmin).mockResolvedValue({
    user: { id: ADMIN_ID },
    platformAdmin: { user_id: ADMIN_ID, scope: "full", mfa_required: true },
  } as never);
  vi.mocked(createAdminClient).mockImplementation(() => makeAdminStub(fx) as never);
  vi.mocked(inviteOrResolveOwner).mockResolvedValue({
    ok: true,
    userId: NEW_OWNER_ID,
    wasInvited: true,
  } as never);
});

describe("POST /api/v1/admin/tenants/[id]/owner", () => {
  it("sem Idempotency-Key → 422", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ action: "resend" }, null), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(422);
  });

  it("tenant inexistente → 404", async () => {
    fx.org = null;
    const { POST } = await import("./route");
    const res = await POST(req({ action: "change_email", email: "certo@ex.com" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("tenant redigido → 409", async () => {
    fx.org = { id: ORG_ID, slug: "x", status: "redacted" };
    const { POST } = await import("./route");
    const res = await POST(req({ action: "change_email", email: "certo@ex.com" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(409);
  });

  it("change_email SEM membership nenhuma (o bug real: tenant criado com 0 em Usuários) — cria a membership nova", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ action: "change_email", email: "certo@ex.com" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(200);
    expect(inviteOrResolveOwner).toHaveBeenCalledWith(expect.anything(), "certo@ex.com");
    expect(fx.memberships).toHaveLength(1);
    expect(fx.memberships[0]).toMatchObject({
      user_id: NEW_OWNER_ID,
      accepted_at: null,
      revoked_at: null,
    });
  });

  it("change_email com convite PENDENTE existente — revoga o antigo, convida o novo, e apaga o usuário órfão (sem outra membership)", async () => {
    fx.memberships.push({
      id: "m-old",
      user_id: OLD_OWNER_ID,
      organization_id: ORG_ID,
      role: "admin",
      accepted_at: null,
      revoked_at: null,
    });
    fx.usersById[OLD_OWNER_ID] = { email: "errado@ex.com" };

    const { POST } = await import("./route");
    const res = await POST(req({ action: "change_email", email: "certo@ex.com" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });

    expect(res.status).toBe(200);
    const old = fx.memberships.find((m) => m.id === "m-old")!;
    expect(old.revoked_at).not.toBeNull();
    expect(fx.memberships.some((m) => m.user_id === NEW_OWNER_ID && !m.revoked_at)).toBe(true);
    expect(fx.deletedUsers).toEqual([OLD_OWNER_ID]);
  });

  it("change_email com dono JÁ ACEITE → 409 owner_already_active (não mexe em ninguém)", async () => {
    fx.memberships.push({
      id: "m-old",
      user_id: OLD_OWNER_ID,
      organization_id: ORG_ID,
      role: "admin",
      accepted_at: "2026-01-01T00:00:00Z",
      revoked_at: null,
    });
    fx.usersById[OLD_OWNER_ID] = { email: "dono@ex.com" };

    const { POST } = await import("./route");
    const res = await POST(req({ action: "change_email", email: "outro@ex.com" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });

    expect(res.status).toBe(409);
    expect(inviteOrResolveOwner).not.toHaveBeenCalled();
    expect(fx.memberships).toHaveLength(1);
  });

  it("resend sem membership nenhuma → 409 owner_not_pending", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ action: "resend" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(409);
  });

  it("resend com convite pendente — reconvida o mesmo e-mail", async () => {
    fx.memberships.push({
      id: "m-old",
      user_id: OLD_OWNER_ID,
      organization_id: ORG_ID,
      role: "admin",
      accepted_at: null,
      revoked_at: null,
    });
    fx.usersById[OLD_OWNER_ID] = { email: "pendente@ex.com" };
    vi.mocked(inviteOrResolveOwner).mockResolvedValue({
      ok: true,
      userId: OLD_OWNER_ID,
      wasInvited: true,
    } as never);

    const { POST } = await import("./route");
    const res = await POST(req({ action: "resend" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });

    expect(res.status).toBe(200);
    expect(inviteOrResolveOwner).toHaveBeenCalledWith(expect.anything(), "pendente@ex.com");
  });

  it("reset_password sem dono aceite → 409 owner_not_active", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ action: "reset_password" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });
    expect(res.status).toBe(409);
    expect(sendPasswordRecoveryEmail).not.toHaveBeenCalled();
  });

  it("reset_password com dono aceite — dispara o e-mail de recovery", async () => {
    fx.memberships.push({
      id: "m-old",
      user_id: OLD_OWNER_ID,
      organization_id: ORG_ID,
      role: "admin",
      accepted_at: "2026-01-01T00:00:00Z",
      revoked_at: null,
    });
    fx.usersById[OLD_OWNER_ID] = { email: "dono@ex.com" };

    const { POST } = await import("./route");
    const res = await POST(req({ action: "reset_password" }), {
      params: Promise.resolve({ id: ORG_ID }),
    });

    expect(res.status).toBe(200);
    expect(sendPasswordRecoveryEmail).toHaveBeenCalledWith(
      "dono@ex.com",
      expect.stringContaining("type=recovery"),
    );
  });

  it("Idempotency-Key repetida → devolve o resultado gravado sem convidar de novo", async () => {
    const { POST } = await import("./route");
    const first = await POST(
      req({ action: "change_email", email: "certo@ex.com" }, "chave-fixa"),
      { params: Promise.resolve({ id: ORG_ID }) },
    );
    expect(first.status).toBe(200);
    expect(fx.memberships).toHaveLength(1);
    expect(inviteOrResolveOwner).toHaveBeenCalledTimes(1);

    const second = await POST(
      req({ action: "change_email", email: "certo@ex.com" }, "chave-fixa"),
      { params: Promise.resolve({ id: ORG_ID }) },
    );
    expect(second.status).toBe(200);
    // Não convidou de novo nem duplicou a membership.
    expect(inviteOrResolveOwner).toHaveBeenCalledTimes(1);
    expect(fx.memberships).toHaveLength(1);
  });
});
