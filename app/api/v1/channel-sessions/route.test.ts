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
