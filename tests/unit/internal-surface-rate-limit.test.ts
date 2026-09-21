import { describe, expect, it, vi } from "vitest";

/**
 * Rate limit nas superfícies internas (issue do Tier 2 — /api/mcp,
 * /api/internal/agents/run e os crons ficavam sem nenhum teto de tentativas).
 *
 * Duas coisas a provar:
 *  1. `internalSurfaceRateLimited` barra por IP depois do teto, e NÃO barra
 *     quando não há IP identificável (mesma política documentada em
 *     lib/auth/rate-limit.ts — balde compartilhado viraria DoS contra o
 *     próprio scheduler self-host, que chama os crons sem proxy na frente).
 *  2. Uma rota real (recover-stuck-messages) devolve 429 com Retry-After
 *     quando o IP estoura o teto, e os testes de auth existentes (sem IP)
 *     continuam intocados — a prova de que a mudança não regrediu 403/200.
 */

vi.mock("@/lib/env", () => ({
  env: {
    INTERNAL_SECRET: "s3cr3t",
    INTERNAL_CRON_SECRET: "",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ lt: () => ({ limit: async () => ({ data: [], error: null }) }) }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const { internalSurfaceRateLimited } = await import("@/lib/auth/internal-rate-limit");
const { GET } = await import("@/app/api/v1/cron/recover-stuck-messages/route");

function reqComIp(ip: string | undefined, secret = "s3cr3t") {
  const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
  if (ip) headers["x-forwarded-for"] = ip;
  return new Request("http://localhost/api/v1/cron/recover-stuck-messages", { headers }) as never;
}

describe("internalSurfaceRateLimited", () => {
  it("sem IP identificável, nunca barra — evita balde global compartilhado", async () => {
    for (let i = 0; i < 50; i++) {
      const req = new Request("http://localhost/x") as never;
      expect(await internalSurfaceRateLimited(req, "teste_sem_ip", 5, 60)).toBe(false);
    }
  });

  it("com IP, barra depois do teto e libera outro IP à parte", async () => {
    const reqA = (ip: string) => new Request("http://localhost/x", { headers: { "x-forwarded-for": ip } }) as never;
    const scope = `teste_com_ip_${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      expect(await internalSurfaceRateLimited(reqA("1.2.3.4"), scope, 3, 60)).toBe(false);
    }
    expect(await internalSurfaceRateLimited(reqA("1.2.3.4"), scope, 3, 60)).toBe(true);
    // Outro IP tem orçamento próprio — o teto isola por origem, não é global.
    expect(await internalSurfaceRateLimited(reqA("9.9.9.9"), scope, 3, 60)).toBe(false);
  });
});

describe("recover-stuck-messages — 429 chega antes do 403 quando o IP estoura", () => {
  it("sem x-forwarded-for, o comportamento de auth existente não muda (403 com segredo errado)", async () => {
    const r = await GET(reqComIp(undefined, "errado"));
    expect(r.status).toBe(403);
  });

  it("estourando o teto por IP, devolve 429 com Retry-After mesmo com segredo certo", async () => {
    const ip = "203.0.113.9";
    // 30/60s é o teto de "cron" em lib/auth/internal-rate-limit — estoura com 31 chamadas.
    for (let i = 0; i < 30; i++) {
      const r = await GET(reqComIp(ip));
      expect(r.status).not.toBe(429);
    }
    const bloqueado = await GET(reqComIp(ip));
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.headers.get("Retry-After")).toBe("60");
  });
});
