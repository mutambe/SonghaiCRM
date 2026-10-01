/**
 * SonghaiCRM — a lista que preenche o endereço do "Provedor personalizado"
 * (`lib/ai/pontos/enderecos-conhecidos.ts`). Ela não executa nada: só escreve o
 * campo. O que precisa ser verdade é que o que ela escreve seja aceito pela rota
 * de credenciais sem retoque, e que nunca aponte para a rede interna.
 */
import { describe, expect, it } from "vitest";

import { ENDERECOS_CONHECIDOS, enderecoConhecidoPorUrl } from "@/lib/ai/pontos/enderecos-conhecidos";

describe("endereços conhecidos do provedor personalizado", () => {
  it("todo endereço é https, público e já no formato que a rota grava (sem barra final)", () => {
    for (const e of ENDERECOS_CONHECIDOS) {
      const url = new URL(e.baseUrl);
      expect(url.protocol, e.id).toBe("https:");
      expect(e.baseUrl, e.id).toBe(e.baseUrl.trim().replace(/\/+$/, ""));
      expect(url.hostname, e.id).not.toMatch(/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/);
      expect(url.hostname, e.id).toContain(".");
    }
  });

  it("ids e endereços não se repetem", () => {
    const ids = ENDERECOS_CONHECIDOS.map((e) => e.id);
    const urls = ENDERECOS_CONHECIDOS.map((e) => e.baseUrl);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("reconhece o endereço escolhido, mesmo com barra final ou espaço; o resto não", () => {
    expect(enderecoConhecidoPorUrl("https://api.groq.com/openai/v1/ ")?.id).toBe("groq");
    expect(enderecoConhecidoPorUrl("https://meu-gateway.example/v1")).toBeUndefined();
    expect(enderecoConhecidoPorUrl("")).toBeUndefined();
  });
});
