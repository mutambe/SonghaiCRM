/**
 * O português de Moçambique também nas saídas que não passam por `t()`:
 * a mensagem de erro da API (`fail()`) e o HTML de e-mail — este só nos nós
 * de texto, nunca em atributo, link, estilo ou nas chaves `{{ .X }}` do GoTrue.
 */
import { describe, expect, it } from "vitest";

import { fail } from "@/lib/api/wrappers";
import { htmlEmPortuguesDeMocambique } from "@/lib/i18n/pt-mz";

describe("fail()", () => {
  it("a mensagem de erro sai em português de Moçambique", async () => {
    const res = fail("validation_error", "Digite sua senha para salvar o contato.", 422);
    const corpo = (await res.json()) as { error: { message: string } };
    expect(corpo.error.message).toBe("Introduza a sua palavra-passe para guardar o contacto.");
  });
});

describe("HTML de e-mail", () => {
  it("troca o texto e deixa atributo, link e estilo intactos", () => {
    const html =
      '<p style="color:#000" title="contato">Redefinir sua senha</p>' +
      '<a href="https://x.co/contato?{{ .TokenHash }}">Salvar</a>' +
      "<style>.contato{color:red}</style>";
    expect(htmlEmPortuguesDeMocambique(html)).toBe(
      '<p style="color:#000" title="contato">Redefinir a sua palavra-passe</p>' +
        '<a href="https://x.co/contato?{{ .TokenHash }}">Guardar</a>' +
        "<style>.contato{color:red}</style>",
    );
  });
});
