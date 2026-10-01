/**
 * SonghaiCRM — a janela de cortesia é 6h-23h, domingo aberto (decisão do dono
 * do produto; o upstream usa 7h-22h). Este arquivo existe para um
 * `git merge upstream/main` que reescreva `PACING_DEFAULTS` não devolver o
 * 7h-22h em silêncio — e para a frase da tela dizer o mesmo número que o motor.
 */
import { describe, expect, it } from "vitest";

import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { traduzir } from "@/lib/i18n/dicionario";

describe("janela de cortesia do SonghaiCRM", () => {
  it("disparo e resposta abrem às 6h e fecham às 23h, com domingo aberto", () => {
    expect(PACING_DEFAULTS.windowStartHour).toBe(6);
    expect(PACING_DEFAULTS.windowEndHour).toBe(23);
    expect(PACING_DEFAULTS.respostaStartHour).toBe(6);
    expect(PACING_DEFAULTS.respostaEndHour).toBe(23);
    expect(PACING_DEFAULTS.allowSunday).toBe(true);
    expect(PACING_DEFAULTS.timezone).toBe("Africa/Maputo");
  });

  it("a tela de guardrails anuncia a mesma janela que o motor aplica", () => {
    const frase = traduzir("Janela operacional 7h-22h", "pt-MZ");
    expect(frase).toContain(`${PACING_DEFAULTS.windowStartHour}h-${PACING_DEFAULTS.windowEndHour}h`);
  });
});
