/**
 * SonghaiCRM — OS VALORES SÃO DE MOÇAMBIQUE, E O MERGE DO UPSTREAM NÃO OS TROCA CALADO.
 *
 * Regra do dono do produto (2026-10-03): moeda, fuso, idioma, telefone, documento
 * e base legal são SEMPRE os de Moçambique. O upstream é brasileiro e escreve o
 * Brasil como valor de reserva em código novo — e isso entra SEM conflito no
 * `git merge upstream/main`, porque é linha nova num arquivo que nós não tocámos.
 *
 * Medido no merge de 2026-10-03 (108 PRs): oito rotas com `?? "pt-BR"`, um
 * exemplo de preço em «R$» na descrição de uma ferramenta da IA (o modelo copia
 * o exemplo), a lei brasileira citada no e-mail ao TITULAR dos dados, e
 * telefone de exemplo com +55 no campo de emparelhar o WhatsApp. Nenhum gate
 * reprovou; foram achados a varrer linha a linha. Este arquivo é a varredura.
 *
 * O que vigia (só código que EMBARCA: app, components, hooks, lib, workers; o
 * texto de comentário não conta — explicar o passado é permitido):
 *   1. reserva brasileira: `?? "pt-BR"`, `|| "BRL"`, `?? "BR"`, São Paulo;
 *   2. formatação no padrão brasileiro: `toLocaleString("pt-BR")`, `Intl.*("pt-BR")`;
 *   3. a lei brasileira (13.709/2018) citada em texto;
 *   4. dinheiro em reais escrito («R$ 249,90», `R$ ${…}`);
 *   5. o código de moeda "BRL";
 *   6. telefone de exemplo com +55;
 *   7. a sigla LGPD em texto que NÃO passa por `t()`/`traduzir()` — a camada pt-MZ
 *      só a troca por «Proteção de Dados» quando o texto passa por ela.
 *
 * Texto dentro de `t()`/`traduzir()` é medido como SAI da camada pt-MZ, não como
 * está escrito no fonte do upstream.
 *
 * Exceções têm motivo escrito. A 7 é uma CATRACA: o que existia em 2026-10-03
 * fica contado por arquivo e a contagem só pode descer (e, ao descer, a lista é
 * atualizada aqui — senão ela envelhece e passa a esconder regressão).
 *
 * Fuso: `fuso-de-mocambique.test.ts` já vigia São Paulo e `-03:00` linha a
 * linha; aqui entra só como valor de reserva (`?? "America/Sao_Paulo"`).
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { DICIONARIO, traduzir } from "@/lib/i18n/dicionario";

import { arquivosDeCodigo, caminhoRelativo } from "./helpers/varrer-codigo";

const RAIZES = ["app", "components", "hooks", "lib", "workers"] as const;

type Regra = "reserva" | "formato" | "lei" | "reais" | "brl" | "ddi55" | "lgpd";

interface Achado {
  regra: Regra;
  arquivo: string;
  linha: number;
  texto: string;
}

/** Valores brasileiros que não podem ser o valor de RESERVA de nada. */
const RESERVAS_BRASILEIRAS = new Set(["pt-BR", "BRL", "BR", "America/Sao_Paulo"]);

/** Chamadas que formatam número/data num locale. */
const FORMATADORES = /^(toLocaleString|toLocaleDateString|toLocaleTimeString|NumberFormat|DateTimeFormat)$/;

/** A chamada que leva o texto pela camada pt-MZ (`lib/i18n/pt-mz.ts`). */
const TRADUTORES = /^(t|traduzir)$/;

function nomeDaChamada(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return "";
}

/** O texto está dentro de um `t(...)` / `traduzir(...)`? */
function passaPelaCamada(no: ts.Node): boolean {
  for (let p: ts.Node | undefined = no.parent; p && !ts.isSourceFile(p); p = p.parent) {
    if (ts.isCallExpression(p) && TRADUTORES.test(nomeDaChamada(p.expression))) return true;
    if (ts.isBlock(p) || ts.isFunctionLike(p)) return false;
  }
  return false;
}

/** Os achados de UM arquivo — pura, para poder ser provada com fonte sintética. */
export function achadosNoFonte(arquivo: string, codigo: string): Achado[] {
  const tsx = arquivo.endsWith(".tsx");
  const fonte = ts.createSourceFile(arquivo, codigo, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const achados: Achado[] = [];
  const anotar = (regra: Regra, no: ts.Node, texto: string) =>
    achados.push({ regra, arquivo, linha: fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1, texto });

  const visitar = (no: ts.Node): void => {
    // 1. reserva: `x ?? "pt-BR"`, `x || "BRL"`
    if (
      ts.isBinaryExpression(no) &&
      (no.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || no.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      ts.isStringLiteralLike(no.right) &&
      RESERVAS_BRASILEIRAS.has(no.right.text)
    ) {
      anotar("reserva", no, no.getText(fonte));
    }
    // 2. formatação no locale brasileiro
    if ((ts.isCallExpression(no) || ts.isNewExpression(no)) && FORMATADORES.test(nomeDaChamada(no.expression))) {
      const primeiro = no.arguments?.[0];
      if (primeiro && ts.isStringLiteralLike(primeiro) && primeiro.text === "pt-BR") anotar("formato", no, no.getText(fonte));
    }

    let texto: string | null = null;
    // Chave de objeto (`{ "texto-fonte": … }`) é identificador, não texto mostrado:
    // em `frases-pt-mz.ts` a chave É a frase do upstream, e o valor é o que se lê.
    const ehChave = !!no.parent && ts.isPropertyAssignment(no.parent) && no.parent.name === no;
    if (ehChave) {
      // nada a medir
    } else if (ts.isStringLiteralLike(no) || ts.isTemplateHead(no) || ts.isTemplateMiddle(no) || ts.isTemplateTail(no)) texto = no.text;
    else if (ts.isJsxText(no)) texto = no.text;
    if (texto !== null) {
      // O que passa por t()/traduzir() é medido DEPOIS da camada pt-MZ: é isso
      // que o utilizador lê. "LGPD" vira «Proteção de Dados»; uma frase com +55
      // só fica limpa se `frases-pt-mz.ts` a reescrever.
      // Chave do dicionário conta como texto de tela: quem a mostra passa-a por
      // t() noutro arquivo (rótulo de catálogo, de menu, de enum).
      const viaCamada = passaPelaCamada(no) || Object.prototype.hasOwnProperty.call(DICIONARIO, texto);
      if (viaCamada) texto = traduzir(texto, "pt-MZ");
      if (/13\.709/.test(texto)) anotar("lei", no, texto);
      // «R$ 249,90» e `R$ ${valor}` (o template termina em "R$ " antes da lacuna).
      if (/R\$\s?\d/.test(texto) || (/R\$\s?$/.test(texto) && !ts.isStringLiteralLike(no))) anotar("reais", no, texto);
      if (ts.isStringLiteralLike(no) && no.text === "BRL") anotar("brl", no, texto);
      if (/\+55(?=[\s\d.]|$)/.test(texto)) anotar("ddi55", no, texto);
      if (/(?<![\p{L}\p{N}_])LGPD(?![\p{L}\p{N}_])/u.test(texto) && !viaCamada) anotar("lgpd", no, texto);
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return achados;
}

/** Exceções por arquivo e regra — cada uma diz por que não é defeito. */
const EXCECOES: Record<string, { regras: Regra[]; motivo: string }> = {
  "lib/i18n/dicionario.ts": {
    regras: ["ddi55", "lgpd"],
    motivo: "dicionário do upstream: as CHAVES são o texto-fonte brasileiro; a tela recebe a versão da camada pt-MZ",
  },
  "lib/agent-engine/guardrails/promise/engine.ts": {
    regras: ["reais", "formato"],
    motivo: "o veto responde na moeda que a MENSAGEM escreveu: só cai em reais quando o agente escreveu «R$»",
  },
  "lib/ai/rag/format-product.ts": { regras: ["reais"], motivo: "produtos da Nuvemshop — módulo brasileiro desligado" },
  "app/app/honorarios/_client.tsx": { regras: ["brl"], motivo: "Honorários — módulo brasileiro desligado" },
  "app/app/honorarios/_parcelas.tsx": { regras: ["brl"], motivo: "Honorários — módulo brasileiro desligado" },



  "lib/channels/phone-variants.ts": {
    regras: ["ddi55"],
    motivo: "variantes do nono dígito para número que JÁ chega com +55 (contacto brasileiro de verdade)",
  },
  "lib/webhooks/inbound.ts": {
    regras: ["ddi55"],
    motivo: "`normalizePhoneBR`, que só o CRM B2B (desligado) usa; a captação usa `normalizarTelefoneLocal` (+258)",
  },
};
/** A vitrine do design system (`/design`) é página interna, sem dado de cliente. */
const PASTAS_DE_EXCECAO = [
  { prefixo: "app/design/", motivo: "vitrine interna do design system" },
  { prefixo: "components/inbox/__fixtures__/", motivo: "dados de teste da caixa de entrada, não embarcam para o cliente" },
];

/**
 * CATRACA da regra 7 — a sigla LGPD fora de `t()`, por arquivo. Só desce; hoje
 * está em zero. Se um merge trouxer texto novo com a sigla, o certo é reescrevê-lo
 * (ou passá-lo por `t()`), e não acrescentar linha aqui.
 */
const LGPD_PENDENTE: Record<string, number> = {
  // Zerada em 2026-10-03: os 35 textos foram reescritos para «Proteção de Dados».
};

function excecao(achado: Achado): boolean {
  if (PASTAS_DE_EXCECAO.some((p) => achado.arquivo.startsWith(p.prefixo))) return true;
  return EXCECOES[achado.arquivo]?.regras.includes(achado.regra) ?? false;
}

const TODOS: Achado[] = arquivosDeCodigo(RAIZES).flatMap((abs) =>
  achadosNoFonte(caminhoRelativo(abs), readFileSync(abs, "utf8")),
);
const ARQUIVOS_VARRIDOS = arquivosDeCodigo(RAIZES).length;

const formatar = (a: Achado) => `${a.arquivo}:${a.linha} [${a.regra}] ${a.texto.trim().slice(0, 100)}`;

describe("a varredura olha de verdade (controle positivo)", () => {
  it("varre o código que embarca, e não zero arquivos", () => {
    expect(ARQUIVOS_VARRIDOS).toBeGreaterThan(1000);
  });

  it("acha o que existe: as chaves do dicionário e os módulos brasileiros desligados", () => {
    expect(TODOS.some((a) => a.arquivo === "lib/i18n/dicionario.ts" && a.regra === "lgpd")).toBe(true);
    expect(TODOS.some((a) => a.arquivo === "app/app/honorarios/_client.tsx" && a.regra === "brl")).toBe(true);
  });

  it("cada regra dispara num fonte sintético (e nenhuma dispara no texto moçambicano)", () => {
    const mau = [
      `const a = idioma ?? "pt-BR";`,
      `const b = moeda || "BRL";`,
      `const c = (1).toLocaleString("pt-BR");`,
      `const d = new Intl.NumberFormat("pt-BR");`,
      `const e = "Base legal: Lei nº 13.709/2018";`,
      `const f = "ex.: R$ 249,90";`,
      "const g = `R$ ${valor}`;",
      `const h = "BRL";`,
      `const i = "Use +55 11 99999-9999";`,
      `const j = "Prazo LGPD vencido";`,
    ].join("\n");
    const regras = new Set(achadosNoFonte("x.ts", mau).map((a) => a.regra));
    expect([...regras].sort()).toEqual(["brl", "ddi55", "formato", "lei", "lgpd", "reais", "reserva"]);

    const bom = [
      `const a = idioma ?? "pt-MZ";`,
      `const b = moeda ?? MOEDA_PADRAO;`,
      `const c = (1).toLocaleString("pt-MZ");`,
      `const e = "Base legal: Lei n.º 3/2017 (Moçambique)";`,
      `const f = "ex.: 249,90 MTn";`,
      `const i = "Use +258 84 123 4567";`,
      `const j = t("Prazo LGPD vencido");`,
      `// comentário pode citar R$ 10, +55 e LGPD`,
    ].join("\n");
    expect(achadosNoFonte("y.ts", bom).map(formatar)).toEqual([]);
  });
});

describe("os valores são de Moçambique", () => {
  for (const regra of ["reserva", "formato", "lei", "reais", "brl", "ddi55"] as const) {
    it(`regra «${regra}»: nada fora das exceções nomeadas`, () => {
      const culpados = TODOS.filter((a) => a.regra === regra && !excecao(a)).map(formatar);
      expect(
        culpados,
        "Use os valores de Moçambique: MOEDA_PADRAO/MZN, FUSO_PADRAO, \"pt-MZ\", +258, citacaoDaLei(perfilDoPais(…)). " +
          "Se for módulo brasileiro desligado ou dado do upstream, nomeie a exceção com motivo neste arquivo.",
      ).toEqual([]);
    });
  }

  it("as exceções nomeadas ainda existem (a lista não pode envelhecer)", () => {
    const vivas = new Set(TODOS.filter(excecao).map((a) => `${a.arquivo}#${a.regra}`));
    const mortas = Object.entries(EXCECOES).flatMap(([arquivo, { regras }]) =>
      regras.filter((r) => !vivas.has(`${arquivo}#${r}`)).map((r) => `${arquivo}#${r}`),
    );
    expect(mortas, "Exceção sem achado: tire-a da lista.").toEqual([]);
  });
});

describe("a sigla LGPD fora da camada pt-MZ — catraca que só desce", () => {
  const porArquivo: Record<string, number> = {};
  for (const a of TODOS) if (a.regra === "lgpd" && !excecao(a)) porArquivo[a.arquivo] = (porArquivo[a.arquivo] ?? 0) + 1;

  it("nenhum arquivo novo nem ocorrência a mais", () => {
    const acima = Object.entries(porArquivo)
      .filter(([arquivo, n]) => n > (LGPD_PENDENTE[arquivo] ?? 0))
      .map(([arquivo, n]) => `${arquivo}: ${n} (catraca ${LGPD_PENDENTE[arquivo] ?? 0})`);
    expect(
      acima,
      "Texto com «LGPD» que não passa por t(): use t(\"…\") (a camada troca por «Proteção de Dados») " +
        "ou escreva o texto moçambicano. Em Moçambique a base legal é a Lei n.º 3/2017.",
    ).toEqual([]);
  });

  it("quando a contagem desce, a catraca desce junto", () => {
    const abaixo = Object.entries(LGPD_PENDENTE)
      .filter(([arquivo, n]) => (porArquivo[arquivo] ?? 0) < n)
      .map(([arquivo, n]) => `${arquivo}: ${porArquivo[arquivo] ?? 0} (catraca ${n})`);
    expect(abaixo, "Atualize LGPD_PENDENTE para o número de agora.").toEqual([]);
  });
});
