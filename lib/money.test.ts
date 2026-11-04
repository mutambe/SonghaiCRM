import { describe, it, expect } from "vitest";

import {
  parseReaisToCents,
  formatCentsPadrao,
  formatCents,
  MOEDAS_SERVIDAS,
  MOEDA_PADRAO,
  simboloDaMoeda,
  formatValorDoNegocio,
  somaPorMoeda,
  formatSomaPorMoeda,
} from "./money";

describe("parseReaisToCents", () => {
  it("lê ponto como decimal quando o grupo final não é de milhar", () => {
    // O defeito que originou este arquivo: "249.90" virava 2499000 centavos
    // (R$ 24.990,00) porque todo ponto era descartado como separador de milhar.
    expect(parseReaisToCents("249.90")).toBe(24990);
    expect(parseReaisToCents("1234.5")).toBe(123450);
    expect(parseReaisToCents("0.99")).toBe(99);
  });

  it("lê vírgula como decimal (pt-BR)", () => {
    expect(parseReaisToCents("249,90")).toBe(24990);
    expect(parseReaisToCents("1.234,56")).toBe(123456);
    expect(parseReaisToCents("1.234.567,89")).toBe(123456789);
  });

  it("trata ponto seguido de 3 dígitos como milhar", () => {
    expect(parseReaisToCents("1.234")).toBe(123400);
    expect(parseReaisToCents("1.234.567")).toBe(123456700);
  });

  it("aceita o formato en quando o último separador é o ponto", () => {
    expect(parseReaisToCents("1,234.56")).toBe(123456);
  });

  it("lê número simples", () => {
    expect(parseReaisToCents("250")).toBe(25000);
    expect(parseReaisToCents(" 250 ")).toBe(25000);
  });

  it("devolve null para o que não é valor", () => {
    expect(parseReaisToCents("")).toBeNull();
    expect(parseReaisToCents("abc")).toBeNull();
    expect(parseReaisToCents("R$ 10")).toBeNull();
    expect(parseReaisToCents("-5")).toBeNull();
  });
});

/**
 * ⚠️ O SEPARADOR DECIMAL É FATO DA MOEDA, NÃO DO FORMULÁRIO (#3331).
 *
 * Medido numa instalação real, organização com `currency = USD`: quem digitava
 * `1,300` no campo de moeda do funil tinha **1,30** gravado — porque o parser
 * não sabia a moeda e tratava a vírgula como decimal, que é a regra do pt-BR.
 * Em en-US a vírgula é separador de MILHAR: eram mil e trezentos dólares.
 *
 * O que a moeda decide é o PAPEL de cada sinal, e o papel vem do MESMO `Intl`
 * que escreve o preço em `formatCents` (decimal de USD/MXN é «.», de BRL/EUR/
 * AOA é «,»). O que NÃO muda com a moeda: a régua de três dígitos do grupo de
 * milhar, que é o que desambigua o sinal solitário nas duas convenções.
 */
describe("parseReaisToCents — o separador vem da MOEDA da organização (#3331)", () => {
  // SonghaiCRM: o dólar escreve-se como em Moçambique ("249,90 US$", ver
  // LOCALE_DA_MOEDA_SEM_PAIS), e o parser segue o MESMO Intl que escreve o preço:
  // a vírgula é o decimal. O «1,300 = mil e trezentos» do upstream é a convenção
  // en-US, que esta distribuição não usa.
  it("⭐ dólar (convenção moçambicana): '1,300' são um e trinta e '1.300' são mil e trezentos", () => {
    expect(parseReaisToCents("1,300", "USD")).toBe(130);
    expect(parseReaisToCents("1.300", "USD")).toBe(130000);
  });

  it("dólar: '1,234.56' são mil duzentos e trinta e quatro e cinquenta e seis", () => {
    expect(parseReaisToCents("1,234.56", "USD")).toBe(123456);
  });

  it("real: '1.300' continua mil e trezentos (nada muda para quem já usa)", () => {
    expect(parseReaisToCents("1.300", "BRL")).toBe(130000);
  });

  it("real: '1.234,56' continua mil duzentos e trinta e quatro e cinquenta e seis", () => {
    expect(parseReaisToCents("1.234,56", "BRL")).toBe(123456);
  });

  /**
   * A MESMA string lida nas duas moedas: é a prova de que quem decide deixou
   * de ser o formulário.
   */
  it("⭐ a mesma string muda de leitura conforme a moeda", () => {
    expect(parseReaisToCents("1.300", "BRL")).toBe(130000);
    expect(parseReaisToCents("1.300", "USD")).toBe(130000);
    expect(parseReaisToCents("1,300", "USD")).toBe(130);
  });

  /**
   * Euro entra pelo mesmo caminho, e não por uma tabela nova: em pt-PT o
   * milhar é espaço (que o parser já descarta) e o decimal é vírgula, então o
   * ponto sobra sem papel declarado e cai na régua de três dígitos — que é
   * exatamente a leitura de antes. Cobre o ramo "sinal que a moeda não usa".
   */
  it("euro (pt-PT): o ponto também é milhar, e a vírgula é decimal", () => {
    expect(parseReaisToCents("1.300", "EUR")).toBe(130000);
    expect(parseReaisToCents("1,300", "EUR")).toBe(130);
  });

  /**
   * ⚠️ O CASO AMBÍGUO — o que este conserto resolve e o que ele NÃO resolve.
   *
   * `1,30` numa organização em dólar: vírgula com DOIS dígitos depois não é
   * grupo de milhar em convenção nenhuma (o grupo tem sempre três dígitos, em
   * en-US e em pt-BR) e também não é o decimal da moeda. Não existe leitura
   * en-US para este texto; a única leitura VÁLIDA em alguma convenção é a
   * decimal — 1,30 dólares, 130 centavos. É a leitura escolhida, e ela é a
   * mesma que o parser já fazia antes do conserto (nada piora para quem
   * digitou assim).
   *
   * O que NÃO fica resolvido, de propósito: se a pessoa queria dizer 130
   * dólares e digitou a vírgula por hábito, o parser não adivinha — o eco
   * embaixo do campo (`EcoDoValor`) escreve `= $1.30` antes de salvar, que é
   * onde esse engano aparece; e `130` ou `1.30` saem certos. O parser também
   * não recusa o texto: devolver `null` transformaria uma leitura duvidosa em
   * campo inválido, e "Valor inválido" não ensina qual dos dois números era.
   */
  it("⭐ ambiguidade declarada: '1,30' em dólar é decimal (e o eco mostra isso)", () => {
    expect(parseReaisToCents("1,30", "USD")).toBe(130);
    // No real nada muda: três casas depois da vírgula não existem em real, e a
    // vírgula é o decimal da moeda — "1,300" segue sendo um e trinta.
    expect(parseReaisToCents("1,30", "BRL")).toBe(130);
    expect(parseReaisToCents("1,300", "BRL")).toBe(130);
  });

  it("sem moeda, a régua é a de sempre (o padrão é o real)", () => {
    expect(parseReaisToCents("1.234")).toBe(123400);
    expect(parseReaisToCents("249,90")).toBe(24990);
    expect(parseReaisToCents("1,234.56")).toBe(123456);
    expect(MOEDA_PADRAO).toBe("MZN");
  });

  it("sinal repetido é sempre milhar, em qualquer moeda", () => {
    expect(parseReaisToCents("1.234.567", "USD")).toBe(123456700);
    expect(parseReaisToCents("1,234,567", "USD")).toBe(123456700);
    expect(parseReaisToCents("1.234.567", "BRL")).toBe(123456700);
    expect(parseReaisToCents("1,234,567", "BRL")).toBe(123456700);
  });

  it("moeda que o Intl recusa cai na régua do padrão, sem lançar", () => {
    expect(() => parseReaisToCents("1.300", "BR")).not.toThrow();
    expect(parseReaisToCents("1.300", "BR")).toBe(130000);
    expect(parseReaisToCents("1.300", "")).toBe(130000);
  });
});

/** Os espaços que o `Intl` emite são NBSP (U+00A0) ou narrow NBSP (U+202F). */
const semNbsp = (s: string) => s.replace(/[\u00A0\u202F]/g, " ");

describe("formatCents", () => {
  /**
   * ⚠️ Quem escolhe o locale do FORMATO é a MOEDA, não o idioma de quem lê.
   *
   * Parecia natural reusar `tagDeIdioma()` — o mesmo `es` que a interface já
   * resolve. Medido, não deduzido:
   *
   *     Intl.NumberFormat("es",    {currency:"MXN"}) -> "249,90 MXN"
   *     Intl.NumberFormat("es-MX", {currency:"MXN"}) -> "$249.90"
   *
   * O `es` puro cai na convenção da ESPANHA: vírgula decimal e o código ISO
   * depois do número. Quem vende no México lê "$249.90". O idioma da interface
   * é preferência de quem LÊ; a moeda é fato do NEGÓCIO, e é ela que manda no
   * separador decimal e no símbolo.
   */
  it("formata cada moeda na convenção de quem a usa", () => {
    expect(semNbsp(formatCents(24990, "BRL"))).toBe("R$ 249,90");
    expect(semNbsp(formatCents(24990, "MXN"))).toBe("$249.90");
    // SonghaiCRM: o dólar sai como se lê em Moçambique (pt-MZ), "249,90 US$".
    expect(semNbsp(formatCents(24990, "USD"))).toBe("249,90 US$");
    // Kwanza: símbolo DEPOIS do número e vírgula decimal, que é a convenção de
    // Angola — `formatadorDa` maximiza `und-AO` para `pt-AO` e é o ICU que
    // decide, não uma tabela nossa.
    expect(semNbsp(formatCents(24990, "AOA"))).toBe("249,90 Kz");
    // Euro: moeda sem país. A maximização de `und-EU` daria `€249.90`, a
    // convenção irlandesa; Portugal, Espanha, França, Alemanha e Itália
    // escrevem assim.
    expect(semNbsp(formatCents(24990, "EUR"))).toBe("249,90 €");
    expect(semNbsp(formatCents(149700, "EUR"))).toBe("1497,00 €");
  });

  /**
   * Servir uma moeda são TRÊS coisas juntas (ver o bloco de `MOEDAS_SERVIDAS`):
   * o seletor oferece, o schema aceita e `formatCents` sabe escrevê-la. As duas
   * primeiras já têm guarda em `tests/unit/moeda-da-organizacao-se-escolhe-na-tela.test.ts`;
   * a terceira é esta. Sem ela, uma moeda podia entrar na lista e cair no ramo
   * de degradação (`"AOA 249.90"`) sem nada ficar vermelho.
   */
  it("toda moeda servida sai formatada, nenhuma cai no ramo de degradação", () => {
    for (const moeda of MOEDAS_SERVIDAS) {
      expect(semNbsp(formatCents(24990, moeda))).not.toBe(`${moeda} 249.90`);
    }
  });

  /**
   * ⚠️ `_cents` não é sempre "centésimos", e o CHECK do banco não impede isso.
   *
   * `catalog_products.moeda` aceita qualquer `^[A-Z]{3}$`, mas todo o código de
   * dinheiro divide por 100 em duro. JPY e CLP não têm subunidade: 25.000
   * unidades menores são ￥25.000, e o /100 fixo mostra ￥250 — cem vezes menos,
   * no número que o agente de IA cota ao cliente.
   *
   * A permissão do schema é mais larga que a aritmética do código. Derivar as
   * unidades menores do próprio `Intl` fecha a diferença sem tabela na mão.
   */
  it("respeita as unidades menores da moeda, que nem sempre são 2", () => {
    expect(semNbsp(formatCents(25000, "JPY"))).toBe("￥25,000");
    expect(semNbsp(formatCents(25000, "CLP"))).toBe("$25.000");
    expect(semNbsp(formatCents(25000, "BRL"))).toBe("R$ 250,00");
  });


  /**
   * ⚠️ `formatCents` é EXPORTADA e roda num client component
   * (`app/app/products/_client.tsx`) — um valor de moeda ruim não pode
   * derrubar o render da lista inteira de produtos. Medido antes de escrever
   * o guard: `new Intl.NumberFormat(locale, {style:"currency", currency})`
   * LANÇA para `""`, `"BR"` (2 letras), `undefined` e `null`, mesmo que o
   * CHECK do banco (`^[A-Z]{3}$`) garanta o formato em toda linha que passa
   * por ele — a função não pode presumir que todo chamador futuro respeita
   * essa garantia. As cinco cópias que esta função substitui tinham
   * `try/catch` (ex.: `CRMSidePanel.tsx:201`); esta precisa da mesma rede.
   */
  it("não lança para moeda ruim — mostra o número em vez de derrubar a tela", () => {
    expect(() => formatCents(24990, "")).not.toThrow();
    expect(() => formatCents(24990, "BR")).not.toThrow();
    expect(() => formatCents(24990, undefined as unknown as string)).not.toThrow();
    expect(() => formatCents(24990, null as unknown as string)).not.toThrow();

    // O fallback precisa continuar informativo — o número certo, não "—" nem "".
    expect(formatCents(24990, "")).toContain("249");
  });
});
describe("MOEDAS_SERVIDAS — a lista que a tela oferece", () => {
  /**
   * ⚠️ ESTE CASO EXISTE PORQUE O ITEM NÃO TINHA GATE NENHUM.
   * Acrescentar `AOA` à lista é aditivo e não quebra teste algum: medido
   * tirando a moeda de volta — `lib/money.test.ts` seguia 11/11 e o
   * `tsc` saía zerado. Ou seja, nada prendia a oferta na tela, e quem
   * instalou em Angola voltaria a não ter como escolher a própria moeda
   * sem ninguém ficar sabendo.
   *
   * O que este caso prende é a OFERTA, não o padrão: o padrão continua
   * sendo o real, e isso é o caso seguinte.
   */
  it("serve o metical, o dólar e o rand — e nenhuma moeda brasileira (SonghaiCRM)", () => {
    expect(MOEDAS_SERVIDAS).toContain("MZN");
    expect(MOEDAS_SERVIDAS).toContain("USD");
    expect(MOEDAS_SERVIDAS).toContain("ZAR");
    expect(MOEDAS_SERVIDAS).not.toContain("BRL");
  });

  it("serve o euro, com o símbolo que o seletor mostra", () => {
    expect(MOEDAS_SERVIDAS).toContain("EUR");
    expect(simboloDaMoeda("EUR")).toBe("€");
  });

  it("e o padrão de quem não escolheu é o metical", () => {
    expect(MOEDA_PADRAO).toBe("MZN");
  });
});

describe("formatValorDoNegocio — a régua do negócio é ×100 em qualquer moeda", () => {
  const semNbsp = (t: string) => t.replace(/[\u00a0\u202f]/g, " ");

  it("⭐ guarani: 12.500.000 no negócio é ₲125.000, não cem vezes mais", () => {
    expect(semNbsp(formatValorDoNegocio(12_500_000, "PYG"))).toBe("Gs. 125.000");
    expect(semNbsp(formatValorDoNegocio(25_000_000, "PYG"))).toBe("Gs. 250.000");
  });

  it("em moeda de duas casas coincide com formatCents", () => {
    expect(semNbsp(formatValorDoNegocio(24990, "BRL"))).toBe(semNbsp(formatCents(24990, "BRL")));
  });

  it("sem centavos é o formato do card: real continua como sempre foi", () => {
    expect(semNbsp(formatValorDoNegocio(125_000, "BRL", { semCentavos: true }))).toBe("R$ 1.250");
    expect(semNbsp(formatValorDoNegocio(12_500_000, "PYG", { semCentavos: true }))).toBe("Gs. 125.000");
  });
});

describe("somaPorMoeda — cada moeda no seu balde (#1531)", () => {
  type Item = { cents: number | null; moeda: string };
  const somar = (itens: Item[]) =>
    somaPorMoeda(
      itens,
      (i) => i.cents,
      (i) => i.moeda,
    );

  it("soma dentro da moeda e nunca entre moedas", () => {
    const soma = somar([
      { cents: 100, moeda: "BRL" },
      { cents: 200, moeda: "EUR" },
      { cents: 300, moeda: "BRL" },
    ]);
    expect([...soma]).toEqual([
      ["BRL", 400],
      ["EUR", 200],
    ]);
  });

  it("sem valor não entra nem cria a moeda; zero cria", () => {
    const soma = somar([
      { cents: null, moeda: "USD" },
      { cents: 0, moeda: "BRL" },
    ]);
    expect(soma.has("USD")).toBe(false);
    expect(soma.get("BRL")).toBe(0);
  });
});

describe("formatSomaPorMoeda", () => {
  it("com uma moeda só é exatamente o formatador", () => {
    const soma = new Map([["BRL", 24990]]);
    expect(formatSomaPorMoeda(soma, formatValorDoNegocio)).toBe(formatValorDoNegocio(24990, "BRL"));
  });

  it("a régua é de quem chama: o mesmo guarani sai certo ou 100× conforme o formatador", () => {
    const soma = new Map([["PYG", 12_500_000]]);
    expect(semNbsp(formatSomaPorMoeda(soma, formatValorDoNegocio))).toBe("Gs. 125.000");
    expect(semNbsp(formatSomaPorMoeda(soma, formatCents))).toBe("Gs. 12.500.000");
  });

  it("ordem: `primeira` e depois as demais em ordem alfabética", () => {
    const soma = new Map([
      ["USD", 10000],
      ["EUR", 10000],
      ["BRL", 10000],
    ]);
    expect(semNbsp(formatSomaPorMoeda(soma, formatCents, { primeira: "USD" }))).toBe(
      "100,00 US$ + R$ 100,00 + 100,00 €",
    );
    // `primeira` fora da soma é ignorada — não inventa uma parcela zerada.
    expect(semNbsp(formatSomaPorMoeda(soma, formatCents, { primeira: "MXN" }))).toBe(
      "R$ 100,00 + 100,00 € + 100,00 US$",
    );
  });

  it("⭐ símbolo repetido leva o código; símbolo único não", () => {
    // SonghaiCRM: o dólar americano escreve "US$" aqui; o canadiano mantém "$".
    const pesoEDolar = new Map([
      ["MXN", 150000],
      ["CAD", 10000],
    ]);
    expect(semNbsp(formatSomaPorMoeda(pesoEDolar, formatCents))).toBe(
      "$100.00 CAD + $1,500.00 MXN",
    );

    const realEEuro = new Map([
      ["BRL", 10000],
      ["EUR", 10000],
    ]);
    expect(semNbsp(formatSomaPorMoeda(realEEuro, formatCents))).toBe("R$ 100,00 + 100,00 €");
  });

  it("soma vazia é texto vazio", () => {
    expect(formatSomaPorMoeda(new Map(), formatCents)).toBe("");
  });
});

// SonghaiCRM: o formatador "padrão" escreve em metical (substitui o formatCentsBRL).
describe("formatCentsPadrao", () => {
  it("mostra em meticais o que está guardado em centavos", () => {
    expect(formatCentsPadrao(24990)).toBe(formatCents(24990, "MZN"));
    expect(formatCentsPadrao(24990)).toMatch(/249,90/);
    expect(formatCentsPadrao(24990)).not.toContain("R$");
  });
});
