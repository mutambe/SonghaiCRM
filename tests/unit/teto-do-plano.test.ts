/**
 * O teto do plano (SonghaiCRM, migration 0504): números de WhatsApp e usuários.
 *
 * Sem assinatura vigente, nada é bloqueado — é o estado de toda instalação nova.
 * Com assinatura, o teto conta só números de WhatsApp VIVOS (o que está
 * arquivado não ocupa vaga; Instagram/Messenger e chamada não são número do
 * plano) e vale em TODAS as portas que ligam um número.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { limitesMock } = vi.hoisted(() => ({ limitesMock: vi.fn() }));
vi.mock("@/lib/plans/limiteDoTenant", () => ({ limitesDoTenant: limitesMock }));

import { PROVEDORES_DE_NUMERO_WHATSAPP, tetoDeConexoesWhatsApp } from "@/lib/plans/teto-de-conexoes";

const ORG = "22222222-2222-4222-8222-222222222222";
const SIMPLES = { planSlug: "agente_simples", planDisplayName: "Agente Simples", maxUsers: 20, maxWhatsappConnections: 1 };

/** Falso cliente que guarda os filtros e devolve a contagem pedida. */
function db(contagem: number, erro: { message: string } | null = null) {
  const filtros: Record<string, unknown> = {};
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (c: string, v: unknown) => ((filtros[`eq:${c}`] = v), b);
  b.in = (c: string, v: unknown) => ((filtros[`in:${c}`] = v), b);
  b.is = (c: string, v: unknown) => {
    filtros[`is:${c}`] = v;
    return Promise.resolve({ count: contagem, error: erro });
  };
  return { cliente: { from: () => b } as never, filtros };
}

// Com chaves: `mockReset()` devolve o próprio mock, e uma função devolvida pelo
// `beforeEach` o Vitest chama como LIMPEZA depois do teste — o mock rodava de novo.
beforeEach(() => {
  limitesMock.mockReset();
});

describe("tetoDeConexoesWhatsApp", () => {
  it("sem assinatura vigente nunca bloqueia", async () => {
    limitesMock.mockResolvedValue(null);
    expect(await tetoDeConexoesWhatsApp(db(99).cliente, ORG)).toBeNull();
  });

  it("Enterprise (sem limite) nunca bloqueia", async () => {
    limitesMock.mockResolvedValue({ ...SIMPLES, maxWhatsappConnections: Infinity });
    expect(await tetoDeConexoesWhatsApp(db(99).cliente, ORG)).toBeNull();
  });

  it("abaixo do teto: liga", async () => {
    limitesMock.mockResolvedValue({ ...SIMPLES, maxWhatsappConnections: 2 });
    expect(await tetoDeConexoesWhatsApp(db(1).cliente, ORG)).toBeNull();
  });

  it("⭐ no teto: recusa, dizendo o pacote e o limite", async () => {
    limitesMock.mockResolvedValue(SIMPLES);
    const teto = await tetoDeConexoesWhatsApp(db(1).cliente, ORG);
    expect(teto?.mensagem).toMatch(/Agente Simples permite até 1 número/);
    expect(teto?.details).toEqual({ limit: "max_whatsapp_connections", current: 1, max: 1 });
  });

  it("conta só números de WhatsApp vivos, da própria organização", async () => {
    limitesMock.mockResolvedValue(SIMPLES);
    const { cliente, filtros } = db(0);
    await tetoDeConexoesWhatsApp(cliente, ORG);
    expect(filtros["eq:organization_id"]).toBe(ORG);
    expect(filtros["in:provider"]).toEqual([...PROVEDORES_DE_NUMERO_WHATSAPP]);
    expect(filtros["is:archived_at"]).toBeNull();
    expect(PROVEDORES_DE_NUMERO_WHATSAPP).not.toContain("zernio_social");
    expect(PROVEDORES_DE_NUMERO_WHATSAPP).not.toContain("wacalls");
  });

  it("falha de contagem não vira bloqueio (regra comercial, não de segurança)", async () => {
    limitesMock.mockResolvedValue(SIMPLES);
    expect(await tetoDeConexoesWhatsApp(db(5, { message: "boom" }).cliente, ORG)).toBeNull();
  });

  it("falha ao LER o pacote também deixa passar — nunca vira 500 na tela de ligar o número", async () => {
    limitesMock.mockImplementation(async () => {
      throw new Error("banco fora");
    });
    expect(await tetoDeConexoesWhatsApp(db(5).cliente, ORG)).toBeNull();
  });

  it("um cliente que lança (sem `from`) também deixa passar", async () => {
    limitesMock.mockResolvedValue(SIMPLES);
    expect(await tetoDeConexoesWhatsApp({} as never, ORG)).toBeNull();
  });
});

describe("todas as portas que ligam um número aplicam o teto", () => {
  it.each([
    "app/api/v1/channel-sessions/route.ts",
    "app/api/v1/channels/official/route.ts",
    "app/api/v1/channels/partner/route.ts",
    "app/api/v1/channels/graph-partner/route.ts",
  ])("%s", (arquivo) => {
    const fonte = readFileSync(path.join(process.cwd(), arquivo), "utf8");
    expect(fonte).toContain("tetoDeConexoesWhatsApp(");
    expect(fonte).toContain('"plan_limit_reached"');
  });

  it("e o convite e o aceite aplicam o teto de usuários", () => {
    for (const arquivo of ["app/api/v1/team/invite/route.ts", "lib/auth/aplicar-convite.ts"]) {
      const fonte = readFileSync(path.join(process.cwd(), arquivo), "utf8");
      expect(fonte, arquivo).toContain("limitesDoTenant(");
      expect(fonte, arquivo).toContain("plan_limit_reached");
    }
  });
});
