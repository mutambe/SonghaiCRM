/**
 * Teto de tentativas em MCP, /api/internal e crons (SonghaiCRM).
 *
 * As três superfícies validam um segredo fixo e não tinham limite nenhum. O
 * limite é por IP e NUNCA entra sem IP identificável — senão o próprio
 * `scheduler` da instalação, que chama os crons sem `x-forwarded-for`, seria
 * trancado.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const contadores = new Map<string, number>();
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn(async (balde: string, limite: number, janela: number) => {
    const n = (contadores.get(balde) ?? 0) + 1;
    contadores.set(balde, n);
    return { allowed: n <= limite, count: n, limit: limite, window_sec: janela };
  }),
}));

import { superficieInterna, superficieInternaLimitada } from "@/lib/auth/limite-das-superficies-internas";

const comIp = (ip: string) => new Headers({ "x-forwarded-for": `${ip}, 10.0.0.1` });

async function tentar(pathname: string, headers: Headers, vezes: number): Promise<number> {
  let barradas = 0;
  for (let i = 0; i < vezes; i++) if (await superficieInternaLimitada(pathname, headers)) barradas++;
  return barradas;
}

beforeEach(() => contadores.clear());

describe("quais caminhos são superfície interna", () => {
  it.each([
    ["/api/mcp", "mcp"],
    ["/api/mcp/sse", "mcp"],
    ["/api/internal/agents/run", "internal"],
    ["/api/v1/cron/event-log-drain", "cron"],
  ])("%s → %s", (p, escopo) => {
    expect(superficieInterna(p)?.escopo).toBe(escopo);
  });

  it.each(["/api/mcpx", "/api/v1/contacts", "/app/inbox", "/api/v1/crons"])("%s não é", (p) => {
    expect(superficieInterna(p)).toBeNull();
  });
});

describe("o teto", () => {
  it("cron: a 31.ª tentativa do mesmo IP no minuto é barrada", async () => {
    expect(await tentar("/api/v1/cron/channel-health", comIp("203.0.113.9"), 30)).toBe(0);
    expect(await tentar("/api/v1/cron/channel-health", comIp("203.0.113.9"), 1)).toBe(1);
  });

  it("o balde é por IP: outra origem não paga a conta da primeira", async () => {
    await tentar("/api/v1/cron/channel-health", comIp("203.0.113.9"), 40);
    expect(await tentar("/api/v1/cron/channel-health", comIp("198.51.100.7"), 1)).toBe(0);
  });

  it("MCP tem teto próprio, mais folgado (agente conversa muito)", async () => {
    expect(await tentar("/api/mcp", comIp("203.0.113.9"), 120)).toBe(0);
    expect(await tentar("/api/mcp", comIp("203.0.113.9"), 1)).toBe(1);
  });

  it("⭐ SEM IP identificável nunca barra — o scheduler da instalação chama os crons assim", async () => {
    expect(await tentar("/api/v1/cron/event-log-drain", new Headers(), 500)).toBe(0);
  });

  it("caminho comum nunca é contado", async () => {
    expect(await tentar("/api/v1/contacts", comIp("203.0.113.9"), 500)).toBe(0);
    expect(contadores.size).toBe(0);
  });
});

describe("o proxy aplica o teto antes de liberar os caminhos públicos", () => {
  it("superficieInternaLimitada vem antes do isPublicPath no proxy.ts", () => {
    const fonte = readFileSync(path.join(process.cwd(), "proxy.ts"), "utf8");
    const limite = fonte.indexOf("await superficieInternaLimitada(pathname, request.headers)");
    const publico = fonte.indexOf("if (isPublicPath(pathname))");
    expect(limite).toBeGreaterThan(-1);
    expect(publico).toBeGreaterThan(-1);
    expect(limite).toBeLessThan(publico);
  });
});
