/**
 * A moeda aparece como se lê em Moçambique: "Metical (MTn)", "249,90 MTn"
 * (decisão do dono do produto). O código ISO "MZN" não vai cru para a tela.
 */
import { describe, expect, it } from "vitest";

import { formatCents, formatCentsUSD, nomeDaMoeda, rotuloDaMoeda, simboloDaMoeda } from "@/lib/money";

describe("metical", () => {
  it("o valor sai com o símbolo MTn depois do número", () => {
    expect(formatCents(24990, "MZN")).toMatch(/^249,90\sMTn$/);
    expect(simboloDaMoeda("MZN")).toBe("MTn");
  });

  it("o nome é Metical, e o rótulo do seletor junta o símbolo", () => {
    expect(nomeDaMoeda("MZN")).toBe("Metical");
    expect(rotuloDaMoeda("MZN")).toBe("Metical (MTn)");
  });

  it("o dólar também sai como se lê em Moçambique, não à americana", () => {
    expect(formatCents(24990, "USD")).toMatch(/^249,90\sUS\$$/);
    expect(formatCentsUSD(24990)).toMatch(/^249,90\sUS\$$/);
    expect(rotuloDaMoeda("USD")).toBe("Dólar americano (US$)");
  });

  it("rand e euro têm nome legível", () => {
    expect(rotuloDaMoeda("ZAR")).toMatch(/^Rand sul-africano \(/);
    expect(rotuloDaMoeda("EUR")).toBe("Euro (€)");
  });

  it("moeda fora da lista cai no nome do Intl, sem lançar", () => {
    expect(nomeDaMoeda("JPY")).toMatch(/^Iene/i);
    expect(() => rotuloDaMoeda("JPY")).not.toThrow();
  });
});
