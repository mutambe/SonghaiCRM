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
