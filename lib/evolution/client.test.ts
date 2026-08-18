import { afterEach, describe, expect, it, vi } from "vitest";

import { EvolutionClient, getEvolutionClient } from "./client";

describe("getEvolutionClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("retorna null sem EVOLUTION_API_BASE_URL", () => {
    vi.stubEnv("EVOLUTION_API_BASE_URL", "");
    vi.stubEnv("EVOLUTION_API_KEY", "abc");
    expect(getEvolutionClient()).toBeNull();
  });

  it("retorna null sem EVOLUTION_API_KEY", () => {
    vi.stubEnv("EVOLUTION_API_BASE_URL", "http://localhost:8080");
    vi.stubEnv("EVOLUTION_API_KEY", "");
    expect(getEvolutionClient()).toBeNull();
  });

  it("retorna um client configurado com as duas vars presentes", () => {
    vi.stubEnv("EVOLUTION_API_BASE_URL", "http://localhost:8080");
    vi.stubEnv("EVOLUTION_API_KEY", "abc");
    expect(getEvolutionClient()).toBeInstanceOf(EvolutionClient);
  });
});

describe("EvolutionClient.sendText", () => {
  it("chama POST /message/sendText/{instance} com o header apikey", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: { id: "3EB0ABC", remoteJid: "5511999999999@s.whatsapp.net", fromMe: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new EvolutionClient("http://localhost:8080", "abc");
    const res = await client.sendText("org_1", "5511999999999@s.whatsapp.net", "oi");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/message/sendText/org_1",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ apikey: "abc" }),
      }),
    );
    expect(res).toEqual({ key: { id: "3EB0ABC", remoteJid: "5511999999999@s.whatsapp.net", fromMe: true } });
  });

  it("lança com o corpo do erro quando a resposta não é ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "number invalid" }),
    );
    const client = new EvolutionClient("http://localhost:8080", "abc");
    await expect(client.sendText("org_1", "invalid", "oi")).rejects.toThrow("evolution_400");
  });
});
