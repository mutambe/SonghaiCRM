/**
 * A trava de promessas enxerga o METICAL (SonghaiCRM).
 *
 * O detector do upstream só lia real (`R$`, `reais`) e euro. Em Moçambique o
 * agente podia escrever "fica por 1 MT" a um cliente com o piso da tabela em
 * 5 000 MT e nada vetava — a trava existia, mas era cega para a moeda daqui.
 *
 * Arquivo próprio, e não casos no teste do upstream: os merges futuros não
 * esbarram nele.
 */
import { describe, expect, it } from "vitest";

import { decidePromise, extractPromises } from "@/lib/agent-engine/guardrails/promise/engine";

describe("extractPromises — metical", () => {
  it.each([
    ["fica por 1 500 MT", 150_000],
    ["fica por 1 500,00 MT", 150_000],
    ["o valor é MT 2 000", 200_000],
    ["MZN 249,90 à vista", 24_990],
    ["sai a 500 Mt", 50_000],
    ["por 750 meticais", 75_000],
    ["custa 1 metical", 100],
  ])("%s → %i centavos em MZN", (texto, centavos) => {
    expect(extractPromises(texto)).toContainEqual({
      kind: "price",
      value: centavos,
      moeda: "MZN",
    });
  });

  it.each([
    "temos 500 clientes satisfeitos",
    "o atendimento é das 8h às 17h",
    "submeta 3 documentos",
    "MTV às 20h",
  ])("não lê preço onde não há: %s", (texto) => {
    expect(extractPromises(texto).filter((p) => p.kind === "price")).toEqual([]);
  });
});

describe("decidePromise — o piso vale em metical", () => {
  const table = { minPriceCents: 500_000 };

  it("veta preço abaixo do piso e responde em MZN, não em R$", () => {
    const d = decidePromise({ candidate: "Para si fica por 1 MT.", table });
    expect(d.allow).toBe(false);
    expect(d.code).toBe("promise_out_of_table");
    // O ICU escreve o metical como "MTn" em pt-MZ (ou "MZN", conforme a versão).
    expect(d.reason).toMatch(/MTn|MZN/);
    expect(d.reason).not.toContain("R$");
  });

  it("deixa passar preço dentro da tabela", () => {
    expect(decidePromise({ candidate: "O plano custa 6 000 MT por mês.", table }).allow).toBe(true);
  });
});
