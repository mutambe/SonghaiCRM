/**
 * O IDIOMA DA INTERFACE É UM SÓ: PORTUGUÊS DE MOÇAMBIQUE (SonghaiCRM).
 *
 * O upstream (DeskcommCRM) serve português do Brasil e espanhol, com um
 * registro de idiomas que liga e desliga cada um pelo nível. Aqui o registro
 * continua — é ele que faz os merges futuros não esbarrarem —, mas só `pt-MZ`
 * aparece. Este arquivo reprova a volta de qualquer outro idioma à escolha de
 * quem usa, e o idioma padrão diferente de pt-MZ.
 *
 * Substitui os testes do upstream que mediam o espanhol (removidos com ele).
 */
import { describe, expect, it } from "vitest";

import { localeDeData, tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO, IDIOMAS, normalizarIdioma, parseAcceptLanguage } from "@/lib/i18n/idiomas";
import { IDIOMAS_VISIVEIS } from "@/lib/i18n/registro";

describe("só português de Moçambique aparece", () => {
  it("o registro oferece um idioma só, e é pt-MZ", () => {
    expect(IDIOMAS_VISIVEIS.map((i) => i.codigo)).toEqual(["pt-MZ"]);
    expect(IDIOMAS).toEqual(["pt-MZ"]);
    expect(IDIOMA_PADRAO).toBe("pt-MZ");
  });

  it("qualquer idioma guardado ou pedido pelo navegador vira pt-MZ", () => {
    for (const bruto of ["pt-BR", "es", "es-MX", "zh-CN", "en-US", "", null, undefined]) {
      expect(normalizarIdioma(bruto)).toBe("pt-MZ");
    }
    expect(parseAcceptLanguage("pt-PT,pt;q=0.9")).toBe("pt-MZ");
    expect(parseAcceptLanguage("es-MX,es;q=0.9")).toBeNull();
  });

  it("data no português europeu e número/moeda no formato de Moçambique", () => {
    expect(localeDeData("pt-MZ").code).toBe("pt");
    expect(tagDeIdioma("pt-MZ")).toBe("pt-MZ");
  });

  it("traduzir aplica o vocabulário de Moçambique", () => {
    expect(traduzir("Novo contato", "pt-MZ")).toBe("Novo contacto");
    expect(traduzir("Salvando…", "pt-MZ")).toBe("A guardar…");
  });
});
