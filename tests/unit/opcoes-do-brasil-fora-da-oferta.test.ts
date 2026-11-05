/**
 * SonghaiCRM — as opções do Brasil não são oferecidas (decisão do dono, 2026-11-03:
 * «tudo deve ser referente a Moçambique»), mas o CÓDIGO delas fica para o merge com o
 * upstream seguir funcionando. Esta cerca prova as duas metades: a lista do que sai, e que o
 * catálogo e o menu continuam inteiros por baixo.
 */
import { describe, expect, it } from "vitest";

import { MODULOS_DO_BRASIL, MODULOS_OPCIONAIS, RECURSOS_DO_BRASIL } from "@/lib/instalacao/modulos";
import { NAV_DESTINATIONS, searchable } from "@/lib/navigation/registry";
import { RECURSOS_OPCIONAIS, ehOpcaoDoBrasil } from "@/lib/recursos-opcionais/catalogo";

describe("opções do Brasil fora da oferta", () => {
  it("os três módulos brasileiros e a Nuvemshop são os que saem", () => {
    expect([...MODULOS_DO_BRASIL].sort()).toEqual(["cobranca", "crm_b2b", "honorarios"]);
    expect([...RECURSOS_DO_BRASIL]).toEqual(["nuvemshop"]);
  });

  it("todo módulo da lista existe de verdade (a lista não pode envelhecer)", () => {
    for (const m of MODULOS_DO_BRASIL) expect(MODULOS_OPCIONAIS).toContain(m);
    for (const id of RECURSOS_DO_BRASIL) expect(RECURSOS_OPCIONAIS.map((r) => r.id)).toContain(id);
  });

  it("o catálogo marca como do Brasil exatamente o que a lista diz, e mais nada", () => {
    const marcados = RECURSOS_OPCIONAIS.filter((r) => ehOpcaoDoBrasil(r));
    expect(marcados.map((r) => r.id).sort()).toEqual(
      ["modulo:cobranca", "modulo:crm_b2b", "modulo:honorarios", "nuvemshop"].sort(),
    );
    // Núcleo e módulos neutros continuam oferecidos.
    for (const id of ["modulo:propostas", "modulo:financeiro", "modulo:banco_externo", "google_agenda"]) {
      const r = RECURSOS_OPCIONAIS.find((x) => x.id === id);
      expect(r, id).toBeDefined();
      expect(ehOpcaoDoBrasil(r!), id).toBe(false);
    }
  });

  it("a Nuvemshop não aparece no ⌘K, mas a porta continua no catálogo do menu", () => {
    const href = "/app/integrations/nuvemshop";
    expect(NAV_DESTINATIONS.some((d) => d.href === href)).toBe(true);
    const buscaveis = searchable(false, "admin", undefined, [...MODULOS_OPCIONAIS], []);
    expect(buscaveis.some((d) => d.href === href)).toBe(false);
  });
});
