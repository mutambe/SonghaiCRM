/**
 * SonghaiCRM — o NUIT que o roteiro de atendimento captura é sempre um número
 * INTEIRO da mensagem, nunca 9 dígitos tirados de dentro de um número maior.
 *
 * Achado pelo e2e do main (2026-10-02): o cliente escreveu "529.982.247-25"
 * (11 dígitos) e o CRM gravou "529982247". A borda da captura só olhava se o
 * próximo caractere era dígito — e era um hífen —, e a conferência do lastro
 * aceitava os 9 dígitos por estarem CONTIDOS nos dígitos colados da mensagem.
 * Um cliente que errasse um dígito a mais ficava com um NUIT errado na ficha,
 * sem ninguém ser avisado.
 */
import { describe, expect, it } from "vitest";

import { classificarInbound, respostaTemLastro } from "@/lib/followup/captura-do-fluxo";

const nuit = { key: "nuit", label: "NUIT", type: "cpf" as const };

describe("NUIT no roteiro", () => {
  it("número com dígitos a mais NÃO vira NUIT cortado — o roteiro pergunta de novo", () => {
    for (const texto of ["529.982.247-25", "meu documento é 529.982.247-25", "1234567890", "123 456 789 0"]) {
      expect(classificarInbound(nuit, texto).resultado, texto).not.toBe("respondeu");
    }
  });

  it("NUIT inteiro, com ou sem separador, continua capturado", () => {
    for (const texto of ["o meu NUIT é 400 123 456", "nuit: 400-123-456, obrigado"]) {
      expect(classificarInbound(nuit, texto), texto).toMatchObject({
        resultado: "respondeu",
        captura: { valor: "400123456" },
      });
    }
  });

  it("o lastro recusa 9 dígitos tirados de dentro de um número maior", () => {
    expect(respostaTemLastro(nuit, "529982247", "meu documento é 529.982.247-25", { perguntaAtual: true })).toBe(false);
    expect(respostaTemLastro(nuit, "400123456", "é 400 123 456", { perguntaAtual: true })).toBe(true);
  });
});
