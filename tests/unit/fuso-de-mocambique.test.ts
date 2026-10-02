/**
 * SonghaiCRM — O FUSO É O DE MOÇAMBIQUE (Africa/Maputo, UTC+2, sem horário de
 * verão), e nunca o de São Paulo que o upstream crava.
 *
 * A regra está escrita no CLAUDE.md (secção "Fuso horário"). Este arquivo é o
 * que a torna obrigatória, porque o erro já foi pago: o primeiro e2e do main do
 * SonghaiCRM reprovou em dezenas de casos de Agenda e relatório porque as specs
 * do upstream criavam dados em `America/Sao_Paulo`/`-03:00` sobre uma
 * organização que nasce em Maputo; e a descrição de uma ferramenta MCP ensinava
 * a IA a escrever `-03:00` — cinco horas de erro em cada compromisso marcado.
 *
 * O que é vigiado:
 *   1. o fuso padrão e o da janela de envio são Africa/Maputo;
 *   2. código que EMBARCA não traz São Paulo nem `-03:00` fora de comentário
 *      (as exceções estão nomeadas, com motivo);
 *   3. as specs de ecrã (tests/e2e) não trazem São Paulo nem `-03:00` nenhum;
 *   4. a dica de fuso que a tela mostra dá o exemplo de Maputo.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { traduzir } from "@/lib/i18n/dicionario";
import { FUSO_PADRAO } from "@/lib/tempo/fusos";

const RAIZ = path.resolve(__dirname, "../..");
const BRASIL = /America\/Sao_Paulo|-03:00/;

/** Exceções no código que embarca — cada uma diz por que não é defeito. */
const PODE_CITAR_O_BRASIL: Record<string, string> = {
  "lib/lgpd/holidays-br.ts": "feriados do Brasil: módulo do upstream, fora do registro de países do SonghaiCRM",
  "lib/i18n/dicionario.ts": "chave original do upstream; a tela em pt-MZ mostra a versão de lib/i18n/frases-pt-mz.ts",
  "lib/i18n/frases-pt-mz.ts": "a mesma chave, do lado esquerdo do registro que a substitui por Africa/Maputo",
};

function arquivos(dir: string, filtro: (f: string) => boolean): string[] {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return [];
  const saida: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) saida.push(...arquivos(rel, filtro));
    else if (filtro(rel)) saida.push(rel);
  }
  return saida;
}

const ehCodigo = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f);
/** Linha de comentário (`//`, ` * `, `/*`) não conta: explicar o passado é permitido. */
const ehComentario = (linha: string) => /^\s*(\/\/|\*|\/\*)/.test(linha);

describe("fuso de Moçambique", () => {
  it("o fuso padrão e o da janela de envio são Africa/Maputo", () => {
    expect(FUSO_PADRAO).toBe("Africa/Maputo");
    expect(PACING_DEFAULTS.timezone).toBe(FUSO_PADRAO);
  });

  it("código que embarca não traz São Paulo nem -03:00 fora de comentário", () => {
    const culpados: string[] = [];
    for (const dir of ["app", "components", "hooks", "lib", "workers"]) {
      for (const f of arquivos(dir, ehCodigo)) {
        if (PODE_CITAR_O_BRASIL[f]) continue;
        fs.readFileSync(path.join(RAIZ, f), "utf8")
          .split("\n")
          .forEach((linha, i) => {
            if (BRASIL.test(linha) && !ehComentario(linha)) culpados.push(`${f}:${i + 1}`);
          });
      }
    }
    expect(
      culpados,
      "Use FUSO_PADRAO (lib/tempo/fusos.ts) e o desvio +02:00 — ver a secção 'Fuso horário' do CLAUDE.md.",
    ).toEqual([]);
  });

  it("as specs de ecrã não criam dados em São Paulo nem com -03:00", () => {
    const culpados = arquivos("tests/e2e", (f) => /\.ts$/.test(f)).filter((f) =>
      BRASIL.test(fs.readFileSync(path.join(RAIZ, f), "utf8")),
    );
    expect(
      culpados,
      "A organização do e2e nasce em Africa/Maputo (seed por FUSO_PADRAO). Fixe o navegador e os dados em Africa/Maputo/+02:00.",
    ).toEqual([]);
  });

  it("as exceções ainda existem (exceção órfã não protege nada)", () => {
    for (const f of Object.keys(PODE_CITAR_O_BRASIL)) {
      expect(fs.existsSync(path.join(RAIZ, f)), f).toBe(true);
    }
  });

  it("a dica de fuso da tela dá o exemplo de Maputo", () => {
    expect(traduzir("A janela de envio é avaliada neste fuso (ex.: America/Sao_Paulo).", "pt-MZ")).toContain(
      "Africa/Maputo",
    );
  });
});
