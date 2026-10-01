/**
 * O registro de frases em português de Moçambique (`lib/i18n/frases-pt-mz.ts`).
 *
 * Três garantias, porque o registro é chaveado pelo texto-fonte do upstream:
 *   1. toda chave EXISTE na fonte — se um merge do upstream mudar a frase, a
 *      chave fica órfã e a mensagem volta a sair em brasileiro sem ninguém ver;
 *   2. toda mensagem dos modelos de follow-up TEM frase — mensagem nova do
 *      upstream não passa calada;
 *   3. nenhuma frase traz marca do português do Brasil.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { textoDoCompromisso } from "@/lib/agenda/texto-do-compromisso";
import { MODELOS_DE_FOLLOWUP } from "@/lib/followup/modelos";
import { MODELOS_DE_CLINICA } from "@/lib/followup/modelos/clinica";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { FRASES_PT_MZ } from "@/lib/i18n/frases-pt-mz";

const RAIZ = process.cwd();
/**
 * Fora da varredura: o próprio registro e o dicionário do upstream — este
 * guarda a frase como CHAVE de tradução e a mantém depois que o código que a
 * usava mudou, o que esconderia a chave órfã (medido: com a frase da reunião
 * trocada na fonte, o caso continuava verde).
 */
const FORA = new Set([path.join("lib", "i18n", "frases-pt-mz.ts"), path.join("lib", "i18n", "dicionario.ts")]);

/** Todo .ts/.tsx do produto que USA texto: sem testes, o registro e o dicionário. */
function fontes(): string {
  const partes: string[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(path.join(RAIZ, dir))) {
      const rel = path.join(dir, nome);
      if (statSync(path.join(RAIZ, rel)).isDirectory()) andar(rel);
      else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) && !FORA.has(rel)) {
        partes.push(readFileSync(path.join(RAIZ, rel), "utf8"));
      }
    }
  };
  for (const dir of ["lib", "app", "components", "hooks", "workers"]) andar(dir);
  // `"…frase " +\n "continuação"` chega inteiro ao t(): junta as concatenações.
  return partes.join("\n").replace(/(["'])\s*\+\s*\n\s*\1/g, "");
}

/** Marcas do português do Brasil que não podem chegar ao cliente moçambicano. */
const MARCAS_DO_BRASIL = [
  /\bOi\b/,
  /\bme (diz|responde|chama|avisa|escrever)\b/i,
  /\bpra\b/i,
  /\ba gente\b/i,
  /\bequipe\b/i,
  // Gerúndio PROGRESSIVO ("está pensando") ou que abre a mensagem ("Passando…"): em
  // Moçambique, «a» + infinitivo. O de modo ("referindo o segmento") é correto e fica.
  /(?<![\p{L}])(est[áa]|estou|estamos|estão|continua|fica)\s+\p{L}+ndo(?![\p{L}])/iu,
  /^(Passando|Aguardando|Esperando)(?![\p{L}])/u,
];

describe("registro de frases pt-MZ", () => {
  it("toda chave existe na fonte do produto — nenhuma ficou órfã depois de um merge", () => {
    const fonte = fontes();
    // Cru (literal entre plicas, JSX) ou escapado (literal entre aspas com \" dentro).
    const orfas = Object.keys(FRASES_PT_MZ).filter(
      (chave) => !fonte.includes(chave) && !fonte.includes(JSON.stringify(chave).slice(1, -1)),
    );
    expect(orfas).toEqual([]);
  });

  it("toda mensagem dos modelos de follow-up tem a sua frase", () => {
    const corpos = MODELOS_DE_CLINICA.flatMap((m) =>
      m.grafo.nodes.flatMap((n) => (n.type === "action" && n.config.mode === "text" ? [n.config.body] : [])),
    );
    expect(corpos.length).toBeGreaterThan(0);
    const valores = new Set(Object.values(FRASES_PT_MZ));
    expect(corpos.filter((c) => !valores.has(c))).toEqual([]);
  });

  it("nenhuma frase traz marca do português do Brasil", () => {
    for (const [fonte, frase] of Object.entries(FRASES_PT_MZ)) {
      for (const marca of MARCAS_DO_BRASIL) {
        expect(frase, `«${frase}» (fonte: «${fonte}») casa ${marca}`).not.toMatch(marca);
      }
    }
  });
});

describe("as frases chegam ao cliente", () => {
  it("o fluxo instalado de um modelo leva o texto moçambicano", () => {
    const corpos = MODELOS_DE_FOLLOWUP.flatMap((m) =>
      m.grafo.nodes.flatMap((n) => (n.type === "action" && n.config.mode === "text" ? [n.config.body] : [])),
    );
    expect(corpos.join(" ")).not.toMatch(/\bOi!|me diz|a gente/);
    expect(corpos).toContain(
      "Consigo arranjar-lhe outro horário. Diga-me o dia da semana e o período que lhe dão mais jeito.",
    );
  });

  it("a mensagem da reunião e o lembrete da agenda", () => {
    const texto = textoDoCompromisso({
      startsAt: "2030-01-02T13:05:00Z",
      timeZone: "Africa/Maputo",
      url: "https://meet.google.com/abc-defg-hij",
      idioma: "pt-MZ",
    });
    expect(texto).toMatch(/^A sua reunião está marcada para 02\/01\/2030, 15:05 \(Africa\/Maputo\)\./);
    expect(traduzir("Passando pra lembrar do seu compromisso:", "pt-MZ")).toBe("Só para lembrar o seu compromisso:");
  });

  it("outro idioma não recebe a frase moçambicana", () => {
    expect(traduzir("Sua reunião está marcada para", "es" as string as Idioma)).not.toBe("A sua reunião está marcada para");
  });
});
