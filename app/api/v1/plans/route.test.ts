import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: vi.fn() }));

const PLANS = [
  { id: "p1", slug: "agente_simples", display_name: "Agente Simples", price_cents: 500000, setup_fee_cents: 200000, currency: "MZN", is_active: true },
  { id: "p2", slug: "agente_medio", display_name: "Agente Médio", price_cents: 800000, setup_fee_cents: 300000, currency: "MZN", is_active: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, count: 1, limit: 60, window_sec: 60 });
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

  it("retorna 429 quando o rate limit por IP estoura", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, count: 61, limit: 60, window_sec: 60 });
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/plans"));
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });
});
