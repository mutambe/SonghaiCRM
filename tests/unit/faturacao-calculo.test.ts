/**
 * SonghaiCRM — o dinheiro dos pacotes, caso a caso (lib/billing/calculo.ts).
 *
 * Funções puras: cada caso é uma conta que dá para conferir à mão.
 */
import { describe, expect, it } from "vitest";

import {
  acaoDaRegua,
  dataEmMaputo,
  dataPrevistaDaSuspensao,
  diasEntre,
  indicesAEmitir,
  limitesAcrescentadosPelosExtras,
  mensalidadeQueVale,
  montarLinhas,
  periodoDaFatura,
  somarMeses,
  totalDasLinhas,
  vencimentoDaFatura,
  type EntradaDasLinhas,
  type ItemDeCobranca,
} from "@/lib/billing/calculo";

const MEDIO = { planoNome: "Agente Médio", planoPriceCents: 800_000, planoSetupCents: 300_000 };

function entrada(sobre: Partial<EntradaDasLinhas> = {}): EntradaDasLinhas {
  return {
    indice: 1,
    periodoInicio: "2026-11-10",
    periodoFim: "2026-12-09",
    ...MEDIO,
    agreedPriceCents: null,
    agreedSetupCents: null,
    isPilot: false,
    itens: [],
    ...sobre,
  };
}

const extra = (sobre: Partial<ItemDeCobranca> = {}): ItemDeCobranca => ({
  id: "item-1",
  description: "Número de WhatsApp adicional",
  unitPriceCents: 150_000,
  quantity: 1,
  recurrence: "monthly",
  startedOn: "2026-10-01",
  endedOn: null,
  billedInvoiceId: null,
  ...sobre,
});

describe("datas — Maputo, UTC+2, sem horário de verão", () => {
  it("a data de Maputo não é a de UTC perto da meia-noite", () => {
    // 23:30 UTC de 9 de Outubro já é 01:30 de 10 de Outubro em Maputo
    expect(dataEmMaputo(new Date("2026-10-09T23:30:00Z"))).toBe("2026-10-10");
    expect(dataEmMaputo(new Date("2026-10-09T21:59:00Z"))).toBe("2026-10-09");
  });

  it("31 de Janeiro + 1 mês encosta no fim de Fevereiro, e o dia 31 não deriva", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2028-01-31", 1)).toBe("2028-02-29");
    // contado SEMPRE a partir do início, não mês a mês: março volta ao 31
    expect(somarMeses("2026-01-31", 2)).toBe("2026-03-31");
  });

  it("o período acaba na véspera do seguinte", () => {
    expect(periodoDaFatura("2026-10-10", 0)).toEqual({ inicio: "2026-10-10", fim: "2026-11-09" });
    expect(periodoDaFatura("2026-10-10", 3)).toEqual({ inicio: "2027-01-10", fim: "2027-02-09" });
  });

  it("atravessa o fim do ano", () => {
    expect(somarMeses("2026-12-15", 1)).toBe("2027-01-15");
    expect(diasEntre("2027-01-01", "2026-12-31")).toBe(1);
  });
});

describe("a mensalidade que vale", () => {
  it("o preço acordado vence o do pacote; sem ele vale o do pacote", () => {
    expect(mensalidadeQueVale(800_000, 650_000)).toBe(650_000);
    expect(mensalidadeQueVale(800_000, null)).toBe(800_000);
  });

  it("acordado em ZERO é um preço (cliente isento), não 'sem preço'", () => {
    expect(mensalidadeQueVale(800_000, 0)).toBe(0);
  });

  it("Enterprise sem preço nenhum: não há o que cobrar", () => {
    expect(mensalidadeQueVale(null, null)).toBeNull();
    expect(montarLinhas(entrada({ planoPriceCents: null, planoSetupCents: null }))).toBeNull();
  });

  it("Enterprise com preço acordado cobra o acordado", () => {
    const l = montarLinhas(entrada({ planoPriceCents: null, planoSetupCents: null, agreedPriceCents: 5_000_000 }))!;
    expect(totalDasLinhas(l)).toBe(5_000_000);
  });
});

describe("as linhas da factura", () => {
  it("mês normal: só a mensalidade", () => {
    const l = montarLinhas(entrada())!;
    expect(l).toHaveLength(1);
    expect(totalDasLinhas(l)).toBe(800_000);
  });

  it("primeira factura: mensalidade + setup", () => {
    const l = montarLinhas(entrada({ indice: 0 }))!;
    expect(l.map((x) => x.kind)).toEqual(["plano", "setup"]);
    expect(totalDasLinhas(l)).toBe(1_100_000); // 8.000 + 3.000 MZN
  });

  it("PILOTO: setup grátis e 50% do primeiro mês — 4.000 MZN em vez de 11.000", () => {
    const l = montarLinhas(entrada({ indice: 0, isPilot: true }))!;
    expect(totalDasLinhas(l)).toBe(400_000);
    expect(l.filter((x) => x.kind === "desconto").map((x) => x.amountCents)).toEqual([-300_000, -400_000]);
  });

  it("o desconto do piloto NÃO se repete na segunda factura", () => {
    const l = montarLinhas(entrada({ indice: 1, isPilot: true }))!;
    expect(totalDasLinhas(l)).toBe(800_000);
    expect(l.some((x) => x.kind === "desconto")).toBe(false);
  });

  it("setup acordado vence o do pacote", () => {
    const l = montarLinhas(entrada({ indice: 0, agreedSetupCents: 100_000 }))!;
    expect(totalDasLinhas(l)).toBe(900_000);
  });

  it("piloto sem setup no pacote não inventa linha de setup", () => {
    const l = montarLinhas(entrada({ indice: 0, isPilot: true, planoSetupCents: 0 }))!;
    expect(l.some((x) => x.kind === "setup")).toBe(false);
    expect(totalDasLinhas(l)).toBe(400_000);
  });

  it("nunca sai negativa", () => {
    const l = montarLinhas(entrada({ agreedPriceCents: 0, itens: [] }))!;
    expect(totalDasLinhas(l)).toBe(0);
    expect(totalDasLinhas([{ kind: "desconto", description: "x", amountCents: -5 }])).toBe(0);
  });
});

describe("extras por cliente", () => {
  it("um número de WhatsApp a mais soma-se à mensalidade, todos os meses", () => {
    const l = montarLinhas(entrada({ itens: [extra()] }))!;
    expect(totalDasLinhas(l)).toBe(950_000);
    expect(l[1]).toMatchObject({ kind: "extra", itemId: "item-1" });
  });

  it("quantidade multiplica", () => {
    const l = montarLinhas(entrada({ itens: [extra({ quantity: 3 })] }))!;
    expect(totalDasLinhas(l)).toBe(800_000 + 450_000);
    expect(l[1]!.description).toContain("×3");
  });

  it("extra que acabou antes do período não entra; o que acaba durante ainda entra", () => {
    expect(totalDasLinhas(montarLinhas(entrada({ itens: [extra({ endedOn: "2026-11-09" })] }))!)).toBe(800_000);
    expect(totalDasLinhas(montarLinhas(entrada({ itens: [extra({ endedOn: "2026-11-10" })] }))!)).toBe(950_000);
  });

  it("extra que só começa depois do período não entra", () => {
    expect(totalDasLinhas(montarLinhas(entrada({ itens: [extra({ startedOn: "2026-12-10" })] }))!)).toBe(800_000);
  });

  it("extra pontual cobra-se UMA vez: depois de facturado, não volta", () => {
    const pontual = extra({ recurrence: "once", description: "Formação extra", unitPriceCents: 20_000 });
    expect(totalDasLinhas(montarLinhas(entrada({ itens: [pontual] }))!)).toBe(820_000);
    expect(totalDasLinhas(montarLinhas(entrada({ itens: [{ ...pontual, billedInvoiceId: "fat-1" }] }))!)).toBe(800_000);
  });

  it("extra pontual cancelado antes de facturado não entra", () => {
    const pontual = extra({ recurrence: "once", unitPriceCents: 20_000, endedOn: "2026-10-20" });
    expect(totalDasLinhas(montarLinhas(entrada({ itens: [pontual] }))!)).toBe(800_000);
  });

  it("o extra soma-se ao preço ACORDADO, não ao do pacote", () => {
    const l = montarLinhas(entrada({ agreedPriceCents: 700_000, itens: [extra()] }))!;
    expect(totalDasLinhas(l)).toBe(850_000);
  });

  it("os extras sobem o limite do cliente na hora e descem quando acabam", () => {
    const wa = { quantity: 1, addsWhatsappConnections: 1, addsUsers: 0, startedOn: "2026-10-01", endedOn: null as string | null };
    expect(limitesAcrescentadosPelosExtras([wa], "2026-10-15")).toEqual({ whatsapp: 1, utilizadores: 0 });
    expect(limitesAcrescentadosPelosExtras([{ ...wa, quantity: 2 }], "2026-10-15").whatsapp).toBe(2);
    expect(limitesAcrescentadosPelosExtras([{ ...wa, endedOn: "2026-10-14" }], "2026-10-15").whatsapp).toBe(0);
    expect(limitesAcrescentadosPelosExtras([{ ...wa, startedOn: "2026-10-20" }], "2026-10-15").whatsapp).toBe(0);
    expect(limitesAcrescentadosPelosExtras([], "2026-10-15")).toEqual({ whatsapp: 0, utilizadores: 0 });
  });
});

describe("quando emitir", () => {
  const base = { inicio: "2026-10-10", ativaDesde: "2026-10-01", jaEmitidos: new Set<string>() };

  it("a primeira sai logo, no dia do início", () => {
    expect(indicesAEmitir({ ...base, hoje: "2026-10-10" })).toEqual([0]);
  });

  it("a seguinte sai 5 dias antes de começar — nem antes", () => {
    const emitidos = new Set(["2026-10-10"]);
    expect(indicesAEmitir({ ...base, jaEmitidos: emitidos, hoje: "2026-11-04" })).toEqual([]);
    expect(indicesAEmitir({ ...base, jaEmitidos: emitidos, hoje: "2026-11-05" })).toEqual([1]);
  });

  it("idempotente: o que já foi emitido não volta", () => {
    const emitidos = new Set(["2026-10-10", "2026-11-10"]);
    expect(indicesAEmitir({ ...base, jaEmitidos: emitidos, hoje: "2026-11-08" })).toEqual([]);
  });

  it("ligar a facturação não cobra o passado: só períodos que começam depois da activação", () => {
    // cliente desde 10 de Setembro; facturação ligada a 8 de Outubro.
    // O período de Setembro (10/09 a 09/10) já corria: não se cobra.
    // O de 10 de Outubro começa depois da activação: cobra-se, e emite-se já.
    const r = indicesAEmitir({ inicio: "2026-09-10", ativaDesde: "2026-10-08", jaEmitidos: new Set(), hoje: "2026-10-08" });
    expect(r).toEqual([1]);
    expect(periodoDaFatura("2026-09-10", 1).inicio).toBe("2026-10-10");
    // com o de Outubro já emitido, o seguinte só sai 5 dias antes de 10 de Novembro
    const emitidos = new Set(["2026-10-10"]);
    expect(indicesAEmitir({ inicio: "2026-09-10", ativaDesde: "2026-10-08", jaEmitidos: emitidos, hoje: "2026-11-04" })).toEqual([]);
    expect(indicesAEmitir({ inicio: "2026-09-10", ativaDesde: "2026-10-08", jaEmitidos: emitidos, hoje: "2026-11-05" })).toEqual([2]);
  });

  it("assinatura terminada não emite períodos que começam depois do fim", () => {
    expect(indicesAEmitir({ ...base, hoje: "2027-03-01", fim: "2026-11-20", jaEmitidos: new Set(["2026-10-10"]) })).toEqual([1]);
  });

  it("relógio parado: recupera todos os períodos devidos, por ordem", () => {
    expect(indicesAEmitir({ ...base, hoje: "2026-12-06" })).toEqual([0, 1, 2]);
  });

  it("vencimento: o início do período; a primeira ganha 5 dias a contar de hoje", () => {
    expect(vencimentoDaFatura({ indice: 2, inicioDoPeriodo: "2026-12-10", hoje: "2026-12-05" })).toBe("2026-12-10");
    expect(vencimentoDaFatura({ indice: 0, inicioDoPeriodo: "2026-10-10", hoje: "2026-10-10" })).toBe("2026-10-15");
    expect(vencimentoDaFatura({ indice: 0, inicioDoPeriodo: "2026-10-10", hoje: "2026-10-12" })).toBe("2026-10-17");
  });
});

describe("a régua de atraso — lembrete, aviso aos 3 dias, suspensão aos 7", () => {
  const venc = "2026-11-10";
  const em = (hoje: string, h = 8) => new Date(`${hoje}T${String(h).padStart(2, "0")}:00:00+02:00`);
  const r = (hoje: string, sobre: { remindedAt?: Date | null; warnedAt?: Date | null } = {}, hora = 8) =>
    acaoDaRegua({ hoje, agora: em(hoje, hora), vencimento: venc, remindedAt: null, warnedAt: null, ...sobre });

  it("antes do vencimento não há nada a fazer", () => {
    expect(r("2026-11-09")).toBeNull();
  });

  it("no vencimento: lembrete, uma vez só", () => {
    expect(r("2026-11-10")).toBe("lembrar");
    expect(r("2026-11-11", { remindedAt: em("2026-11-10") })).toBeNull();
  });

  it("aos 3 dias de atraso: aviso final", () => {
    expect(r("2026-11-13", { remindedAt: em("2026-11-10") })).toBe("avisar");
  });

  it("o aviso não se repete", () => {
    expect(r("2026-11-14", { remindedAt: em("2026-11-10"), warnedAt: em("2026-11-13") })).toBeNull();
  });

  it("aos 7 dias, com aviso há mais de 48 h: suspende", () => {
    expect(r("2026-11-17", { remindedAt: em("2026-11-10"), warnedAt: em("2026-11-13") })).toBe("suspender");
  });

  it("aos 7 dias, mas o aviso é de há menos de 48 h: espera", () => {
    // aviso a 16/11 às 12:00 → só às 12:00 de 18/11 se completam as 48 h
    expect(r("2026-11-17", { warnedAt: em("2026-11-16", 12) })).toBeNull();
    expect(r("2026-11-18", { warnedAt: em("2026-11-16", 12) }, 8)).toBeNull();
    expect(r("2026-11-18", { warnedAt: em("2026-11-16", 12) }, 13)).toBe("suspender");
  });

  it("NUNCA suspende quem não foi avisado: relógio parado → o aviso sai primeiro", () => {
    expect(r("2026-11-30")).toBe("avisar");
    expect(r("2026-11-30", { remindedAt: em("2026-11-10") })).toBe("avisar");
  });

  it("quando será suspensa: o que vier depois — dia 7 ou aviso + 48 h", () => {
    expect(dataPrevistaDaSuspensao(venc, em("2026-11-13"), em("2026-11-13"))).toBe("2026-11-17");
    // relógio parado: aviso só hoje (30/11) → suspensão a 2/12
    expect(dataPrevistaDaSuspensao(venc, null, em("2026-11-30"))).toBe("2026-12-02");
  });
});
