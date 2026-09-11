import { describe, expect, it } from "vitest";

import { interpretarRetencao } from "@/lib/retencao/politica";

describe("interpretarRetencao — o knob nunca derruba o produto", () => {
  it("ausente ou vazio devolve o padrão, sem aviso", () => {
    // É o caminho de toda instalação que nunca editou `.env` — a doutrina de
    // packaging exige que ele funcione sem edição manual de arquivo.
    for (const bruto of [undefined, "", "   "]) {
      const r = interpretarRetencao(bruto, { chave: "K", padrao: 90, piso: 7 });
      expect(r).toEqual({ dias: 90, aviso: null });
    }
  });

  it("lixo devolve o padrão COM aviso — nunca a frase tranquilizadora", () => {
    for (const bruto of ["noventa", "90d", "-1", "0", "1.5", "NaN"]) {
      const r = interpretarRetencao(bruto, { chave: "K", padrao: 90, piso: 7 });
      expect(r.dias, `entrada ${bruto}`).toBe(90);
      expect(r.aviso, `entrada ${bruto} sem aviso`).toContain("K=");
    }
  });

  it("valor abaixo do piso é ELEVADO, com aviso", () => {
    const r = interpretarRetencao("2", { chave: "K", padrao: 90, piso: 7 });
    expect(r.dias).toBe(7);
    expect(r.aviso).toContain("piso");
  });

  it("valor válido passa inteiro, sem aviso", () => {
    expect(interpretarRetencao("400", { chave: "K", padrao: 90, piso: 7 })).toEqual({
      dias: 400,
      aviso: null,
    });
  });
});
