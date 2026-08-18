import { afterEach, describe, expect, it, vi } from "vitest";

import { evolutionAdapter } from "./evolution";

describe("evolutionAdapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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
});
