import { afterEach, describe, expect, it, vi } from "vitest";

import { CHANNEL_STATUSES } from "@/lib/schemas/channels";

import { evolutionAdapter } from "./evolution";
import * as evolutionClientModule from "@/lib/evolution/client";

describe("evolutionAdapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    // `checkHealth` usa `vi.spyOn` (não `vi.mock` do módulo inteiro) para não
    // quebrar os testes de `isConfigured`/`send` acima, que dependem do
    // `getEvolutionClient` REAL lendo `process.env` — um `vi.mock` de módulo
    // inteiro substituiria essa função para o arquivo todo.
    vi.restoreAllMocks();
  });

  it("provider é 'evolution'", () => {
    expect(evolutionAdapter.provider).toBe("evolution");
  });

  it("resolveRecipient: telefone vira @s.whatsapp.net", () => {
    expect(
      evolutionAdapter.resolveRecipient({
        isGroup: false,
        groupChatId: null,
        phoneNumber: "+5511999999999",
        waIdentity: null,
      }),
    ).toBe("5511999999999@s.whatsapp.net");
  });

  it("isConfigured: false sem env", () => {
    vi.stubEnv("EVOLUTION_API_BASE_URL", "");
    vi.stubEnv("EVOLUTION_API_KEY", "");
    expect(evolutionAdapter.isConfigured()).toBe(false);
  });

  it("send: sem client configurado devolve externalId null (noop, não erro)", async () => {
    vi.stubEnv("EVOLUTION_API_BASE_URL", "");
    vi.stubEnv("EVOLUTION_API_KEY", "");
    const res = await evolutionAdapter.send({
      sessionRef: "org_abc",
      to: "5511999999999@s.whatsapp.net",
      kind: "text",
      body: "oi",
    });
    expect(res).toEqual({ externalId: null });
  });

  it("codes tem os três códigos esperados", () => {
    expect(evolutionAdapter.codes).toEqual({
      notConfigured: "evolution_not_configured",
      sendFailed: "evolution_error",
      unknownError: "evolution_unknown",
    });
  });

  describe("checkHealth: status devolvido nunca é o vocabulário cru da Evolution", () => {
    // Invariante: `channel_sessions.status` tem CHECK para só estes 5 valores.
    // Repassar `open`/`connecting`/`close` cru faz o UPDATE falhar em silêncio
    // (ver `lib/evolution/state.ts`). Cobre os três estados reais e um
    // desconhecido — nenhum pode escapar do vocabulário canônico.
    const casos: Array<[string | null, string]> = [
      ["open", "WORKING"],
      ["connecting", "SCAN_QR_CODE"],
      ["close", "STOPPED"],
      ["um_estado_que_a_evolution_inventou_amanha", "FAILED"],
    ];

    for (const [estadoCru, esperado] of casos) {
      it(`state "${estadoCru}" → status "${esperado}", sempre um dos 5 valores do CHECK`, async () => {
        vi.spyOn(evolutionClientModule, "getEvolutionClient").mockReturnValue({
          getConnectionState: vi.fn().mockResolvedValue(estadoCru),
        } as unknown as ReturnType<typeof evolutionClientModule.getEvolutionClient>);

        const health = await evolutionAdapter.checkHealth!({ sessionRef: "org_abc" });

        expect(health.status).toBe(esperado);
        if (health.status !== null) {
          expect(CHANNEL_STATUSES as readonly string[]).toContain(health.status);
        }
      });
    }

    it("client não conseguiu ler o estado (null): reachable false, status null — não é 'saudável' por omissão", async () => {
      vi.spyOn(evolutionClientModule, "getEvolutionClient").mockReturnValue({
        getConnectionState: vi.fn().mockResolvedValue(null),
      } as unknown as ReturnType<typeof evolutionClientModule.getEvolutionClient>);

      const health = await evolutionAdapter.checkHealth!({ sessionRef: "org_abc" });
      expect(health.reachable).toBe(false);
      expect(health.status).toBeNull();
    });
  });
});
