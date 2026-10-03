import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  platform: vi.fn(),
  mfa: vi.fn(),
  suporte: vi.fn(),
  rpc: vi.fn(),
  audit: vi.fn(),
}));

// SonghaiCRM: as rotas usam o helper de ESCRITA do upstream (#2078); o mock o
// reproduz sobre os mesmos dublês (`h.platform`, `h.mfa`).
vi.mock("@/lib/auth/requirePlatformAdmin", async () => {
  const { EscritaDePlatformAdminNegada } = await import("@/lib/auth/recusa-de-escrita-de-admin");
  const { fail } = await import("@/lib/api/wrappers");
  return {
    requirePlatformAdmin: h.platform,
    requirePlatformAdminEscrita: async () => {
      const c = await h.platform();
      if (c.platformAdmin.scope !== "full") throw new EscritaDePlatformAdminNegada("forbidden_scope");
      if (await h.mfa()) throw new EscritaDePlatformAdminNegada("mfa_required");
      return c;
    },
    falhaDaEscritaDePlatformAdmin: (err: unknown, requestId?: string) =>
      err instanceof EscritaDePlatformAdminNegada
        ? fail(err.code, err.message, 403, { requestId })
        : fail("forbidden", "Platform admin required", 403, { requestId }),
  };
});
vi.mock("@/lib/auth/server", () => ({ mfaEmDivida: h.mfa }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.suporte }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: h.rpc,
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: { id: "sub-2", plan: { slug: "agente_medio" } }, error: null });
      return b;
    },
  }),
}));

import { PATCH } from "./route";

const ORG = "22222222-2222-4222-8222-222222222222";
const PLANO = "33333333-3333-4333-8333-333333333333";
const ctx = { params: Promise.resolve({ id: ORG }) };
const pedido = (body: unknown) =>
  new Request(`http://localhost/api/v1/admin/tenants/${ORG}/subscription`, { method: "PATCH", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  h.suporte.mockResolvedValue(null);
  h.mfa.mockResolvedValue(false);
  h.platform.mockResolvedValue({ user: { id: "admin-1" }, platformAdmin: { scope: "full" } });
});

describe("PATCH /api/v1/admin/tenants/[id]/subscription", () => {
  it("troca pelo procedimento atómico e audita", async () => {
    h.rpc.mockResolvedValue({ data: "sub-2", error: null });
    const res = await PATCH(pedido({ plan_id: PLANO }) as never, ctx);
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("fn_trocar_plano_da_organizacao", {
      p_org: ORG,
      p_plan: PLANO,
      p_actor: "admin-1",
      p_notes: null,
    });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "tenant.subscription_changed", organizationId: ORG }));
  });

  it("acesso de suporte (escopo parcial) não muda plano", async () => {
    h.platform.mockResolvedValue({ user: { id: "admin-1" }, platformAdmin: { scope: "support" } });
    const res = await PATCH(pedido({ plan_id: PLANO }) as never, ctx);
    expect(res.status).toBe(403);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("quem não é admin da plataforma é recusado", async () => {
    h.platform.mockRejectedValue(new Error("forbidden"));
    expect((await PATCH(pedido({ plan_id: PLANO }) as never, ctx)).status).toBe(403);
  });

  it("plano fora de venda → 409 plan_inactive", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "plan_inactive" } });
    const res = await PATCH(pedido({ plan_id: PLANO }) as never, ctx);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("plan_inactive");
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("troca simultânea (índice de uma vigente) → 409, não 500", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate" } });
    expect((await PATCH(pedido({ plan_id: PLANO }) as never, ctx)).status).toBe(409);
  });

  it("organização inexistente → 404", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "organization_not_found" } });
    expect((await PATCH(pedido({ plan_id: PLANO }) as never, ctx)).status).toBe(404);
  });

  it("plan_id que não é uuid → 400", async () => {
    expect((await PATCH(pedido({ plan_id: "x" }) as never, ctx)).status).toBe(400);
  });
});
