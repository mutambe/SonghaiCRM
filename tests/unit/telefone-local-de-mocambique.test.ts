/**
 * Planilha e formulário de captação leem o telefone como MOÇAMBICANO quando não
 * há indicativo (SonghaiCRM). O upstream assumia o Brasil (+55): o lead que
 * digitava "84 123 4567" no site nascia com um número brasileiro.
 */
import { describe, expect, it } from "vitest";

import { normalizarTelefoneLocal } from "@/lib/channels/telefone-local";
import { normalizaTelefone } from "@/lib/contacts/csv";
import { mapInboundPayload } from "@/lib/webhooks/inbound";

describe("normalizarTelefoneLocal", () => {
  it.each([
    ["84 123 4567", "+258841234567"],
    ["841234567", "+258841234567"],
    ["258 84 123 4567", "+258841234567"],
    ["+258 84 123 4567", "+258841234567"],
    ["87-765-4321", "+258877654321"],
    ["21 123 456", "+25821123456"],
    ["+351 912 345 678", "+351912345678"],
  ])("%s → %s", (raw, e164) => {
    expect(normalizarTelefoneLocal(raw)).toBe(e164);
  });

  it.each(["11999998888", "(11) 99999-8888", "5511999998888", "123", "941234567", "", null, 12])(
    "recusa %s — não adivinha outro país",
    (raw) => {
      expect(normalizarTelefoneLocal(raw)).toBeNull();
    },
  );
});

describe("os dois caminhos de entrada usam a regra de Moçambique", () => {
  it("a importação de planilha", () => {
    expect(normalizaTelefone("84 123 4567")).toBe("+258841234567");
    expect(normalizaTelefone("11999998888")).toBeNull();
  });

  it("a captação por webhook (formulário do site)", () => {
    expect(mapInboundPayload({ telefone: "84 123 4567", email: "a@b.co" }).phone).toBe("+258841234567");
  });
});
