/**
 * Concordância depois da troca de gênero (SonghaiCRM).
 *
 * A camada `lib/i18n/pt-mz.ts` troca nomes que mudam de gênero — "a tela" vira
 * "o ecrã", "o aplicativo" vira "a aplicação", "o banco" vira "a base de dados",
 * "o time" vira "a equipa" — e acerta o determinante e o adjetivo colado ao nome.
 * O que ela não alcança é o predicativo mais adiante: "os ecrãs ficam vazias",
 * "a base de dados já tinha sido atualizado". A revisão das frases do produto
 * achou sete casos assim e os consertou em `AJUSTES_FINAIS`.
 *
 * Este teste roda a camada sobre TODA frase que passa por `t()` (e as chaves do
 * dicionário) e reprova o predicativo com o gênero errado. Frase nova do
 * upstream com o mesmo defeito fica vermelha aqui, com o texto na mensagem — o
 * conserto é uma linha em `AJUSTES_FINAIS` ou uma frase em `frases-pt-mz.ts`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { DICIONARIO } from "@/lib/i18n/dicionario";
import { paraPortuguesDeMocambique as mz } from "@/lib/i18n/pt-mz";

const RAIZ = process.cwd();

/** Todo texto que chega à tela por `t()`/`traduzir()`, mais as chaves do dicionário. */
function frasesDoProduto(): string[] {
  const textos = new Set<string>(Object.keys(DICIONARIO));
  const andar = (dir: string) => {
    for (const nome of readdirSync(path.join(RAIZ, dir))) {
      if (nome === "node_modules" || nome.startsWith(".")) continue;
      const rel = path.join(dir, nome);
      if (statSync(path.join(RAIZ, rel)).isDirectory()) andar(rel);
      else if (/\.tsx?$/.test(nome) && !/\.(test|spec)\.tsx?$/.test(nome)) {
        const src = readFileSync(path.join(RAIZ, rel), "utf8");
        if (!/\b(t|traduzir)\(/.test(src)) continue;
        const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, nome.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const visita = (no: ts.Node) => {
          if (ts.isCallExpression(no) && /^(t|traduzir)$/.test(no.expression.getText(sf))) {
            const a = no.arguments[0];
            if (a && ts.isStringLiteralLike(a)) textos.add(a.text);
          }
          ts.forEachChild(no, visita);
        };
        visita(sf);
      }
    }
  };
  for (const dir of ["app", "components", "lib", "hooks"]) andar(dir);
  return [...textos];
}

const MASCULINOS = "ecrã|ecrãs|separador|separadores";
const FEMININOS = "aplicação|aplicações|base de dados|bases de dados|equipa|equipas";
const LIGACAO =
  "é|são|está|estão|estava|estavam|fica|ficam|ficou|ficaram|ficar|foi|foram|tinha sido|tinham sido|continua|continuam|permanece|parece";
const ADVERBIO = "(?:(?:já|sempre|ainda|não|mais|muito|bem|logo)\\s+)?";
/** Particípio ou adjetivo comum no produto, com a terminação de gênero. */
const ADJETIVO = "(\\p{L}+(?:ad|id)[oa]s?|abert[oa]s?|vazi[oa]s?|sozinh[oa]s?|nov[oa]s?|pront[oa]s?|chei[oa]s?|inteir[oa]s?|ativ[oa]s?)";

function predicativo(nomes: string): RegExp {
  return new RegExp(`(?<![\\p{L}])(${nomes})(?![\\p{L}])([^.!?;:—,()]{0,40}?)(?<![\\p{L}])(?:${LIGACAO})\\s+${ADVERBIO}${ADJETIVO}(?![\\p{L}])`, "giu");
}

/** O sujeito não é o nome trocado: há outro sujeito no meio ("…ecrã, que é usado…"). */
const SUJEITO_NO_MEIO = /(?<![\p{L}])(ninguém|alguém|quem|que|o que|cada um|cada uma|todos|nenhum)(?![\p{L}])/iu;
/** Nome depois de preposição é complemento, não sujeito: "ninguém da equipa é chamado". */
const COMPLEMENTO = /(?<![\p{L}])(de|da|do|das|dos|na|no|nas|nos|à|ao|às|aos|para|com|pela|pelo|sem|entre)\s+$/iu;

function desconcordancias(frase: string): string[] {
  const achados: string[] = [];
  const conferir = (re: RegExp, errado: RegExp) => {
    for (const m of frase.matchAll(re)) {
      const [inteiro, , meio = "", adjetivo = ""] = m;
      if (SUJEITO_NO_MEIO.test(meio)) continue;
      if (COMPLEMENTO.test(frase.slice(Math.max(0, m.index - 10), m.index))) continue;
      if (errado.test(adjetivo)) achados.push(inteiro);
    }
  };
  conferir(predicativo(MASCULINOS), /as?$/u);
  conferir(predicativo(FEMININOS), /os?$/u);
  return achados;
}

describe("concordância depois da troca de gênero", () => {
  it("o detector acha o defeito (controle)", () => {
    expect(desconcordancias("e os ecrãs ficam vazias")).toEqual(["ecrãs ficam vazias"]);
    expect(desconcordancias("A base de dados já tinha sido atualizado e permanece")).toHaveLength(1);
    expect(desconcordancias("este ecrã atualiza-se e fica parada")).toHaveLength(1);
    expect(desconcordancias("ninguém da equipa é chamado")).toEqual([]);
    expect(desconcordancias("o ecrã está aberto")).toEqual([]);
  });

  it("nenhuma frase do produto sai com o predicativo no gênero errado", () => {
    const erradas = frasesDoProduto()
      .map((fonte) => ({ fonte, saida: mz(fonte) }))
      .flatMap(({ fonte, saida }) => desconcordancias(saida).map((trecho) => `«${trecho}» — fonte: «${fonte.slice(0, 120)}»`));
    expect(erradas, "conserte em AJUSTES_FINAIS (lib/i18n/pt-mz.ts) ou escreva a frase em lib/i18n/frases-pt-mz.ts").toEqual([]);
  });
});
