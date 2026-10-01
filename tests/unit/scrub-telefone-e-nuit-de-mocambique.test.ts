/**
 * O scrub do Sentry apaga telefone e NUIT MOÇAMBICANOS (SonghaiCRM).
 *
 * As regras do upstream têm a forma brasileira. Medido antes da correção: o
 * celular escrito como se escreve em Moçambique (`84 123 4567`) e o fixo de
 * Maputo (`21 123 456`) saíam INTEIROS rumo ao Sentry, e `+258841234567`
 * deixava um dígito à mostra. Um dígito solto do assinante já é pedaço de dado
 * de titular indo para fora da VPS — por isso a asserção é "nenhum dígito".
 *
 * Arquivo próprio, e não casos no `lib/sentry/scrub.test.ts` do upstream: os
 * merges futuros do upstream não esbarram nele.
 */
import { describe, expect, it } from "vitest";

import { scrubMessage } from "@/lib/sentry/scrub";

describe("scrubMessage — Moçambique", () => {
  it.each([
    ["celular com +258 e espaços", "+258 84 123 4567"],
    ["celular com +258 colado", "+258841234567"],
    ["celular com 258 colado (forma do WhatsApp)", "258841234567"],
    ["celular local com espaços", "84 123 4567"],
    ["celular local 3-3-3", "841 234 567"],
    ["celular local com hífens", "84-123-4567"],
    ["celular de outra operadora", "+258 87 765 4321"],
    ["fixo de Maputo com +258", "+258 21 123 456"],
    ["fixo local com espaços", "21 123 456"],
    ["NUIT colado", "400123456"],
  ])("apaga %s", (_caso, dado) => {
    const out = scrubMessage(`envio para ${dado} falhou`);
    expect(out, out).not.toMatch(/\d/);
    expect(out).toMatch(/\[(PHONE|NUIT)\]/);
  });

  it("não come número que não é dado pessoal (ano, contagem, id curto)", () => {
    const texto = "lote 2026 com 150 itens, tentativa 3 de 20000";
    expect(scrubMessage(texto)).toBe(texto);
  });

  it("UUID continua inteiro — é identificador de depuração", () => {
    const uuid = "0e6b16d5-299e-4bec-b952-40fa05e0bcb2";
    expect(scrubMessage(`contato ${uuid} sem telefone`)).toContain(uuid);
  });
});
