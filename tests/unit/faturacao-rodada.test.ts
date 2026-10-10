/**
 * SonghaiCRM — a rodada da faturação, do primeiro dia à suspensão e à volta.
 *
 * Um banco em memória replica as quatro funções SQL (emitir, marcar paga,
 * suspender, reactivar) com a mesma regra do `songhai.sql`; o PaySuite e o
 * e-mail são dublês que registam o que lhes pediram. O que se prova aqui é o
 * ENCADEAMENTO: quem é cobrado, quando, quanto, quem é avisado, e que ninguém
 * tem de lembrar de nada.
 *
 * Limite honesto: o SQL em si só se prova com `pnpm test:db` (Postgres real).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dataEmMaputo } from "@/lib/billing/calculo";
import {
  registrarPagamentoDeFatura,
  rodarFaturacao,
  type DependenciasDaRodada,
  type Gateway,
} from "@/lib/billing/executar";

type Linha = Record<string, unknown>;
const ORG_SONGHAI = "11111111-1111-4111-8111-111111111111";
const CLIENTE = "22222222-2222-4222-8222-222222222222";
const OUTRO = "33333333-3333-4333-8333-333333333333";

const MEDIO = { display_name: "Agente Médio", price_cents: 800_000, setup_fee_cents: 300_000, currency: "MZN" };

/** 10 de Outubro de 2026, 08:00 em Maputo, mais `dias`. */
const emDia = (dias: number, hora = 8) => new Date(Date.UTC(2026, 9, 10 + dias, hora - 2, 0, 0));

interface Mundo {
  t: Record<string, Linha[]>;
  emails: Array<{ para: string[]; assunto: string }>;
  pagamentosCriados: Array<{ amountCents: number; reference: string }>;
  consultas: Record<string, "pending" | "paid" | "failed">;
  auditoria: string[];
  agora: Date;
  gateway: Gateway | null;
  emailEntrega: boolean;
}

function criarBanco(m: Mundo) {
  let seq = 0;
  const consulta = (nome: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let modo: "select" | "update" = "select";
    let valores: Linha = {};
    let ordem: { col: string; asc: boolean } | null = null;
    let limite = Infinity;
    const executar = () => {
      const tabela = (m.t[nome] ??= []);
      let achadas = tabela.filter((l) => filtros.every((f) => f(l)));
      if (modo === "update") {
        for (const l of achadas) Object.assign(l, valores);
        return achadas;
      }
      if (ordem) {
        const { col, asc } = ordem;
        achadas = [...achadas].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      return achadas.slice(0, limite);
    };
    const b: Record<string, unknown> = {
      select: () => b,
      update: (v: Linha) => ((modo = "update"), (valores = v), b),
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), b),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), b),
      in: (c: string, v: unknown[]) => (filtros.push((l) => v.includes(l[c])), b),
      lt: (c: string, v: string) => (filtros.push((l) => String(l[c]) < v), b),
      lte: (c: string, v: string) => (filtros.push((l) => String(l[c]) <= v), b),
      gt: (c: string, v: number) => (filtros.push((l) => Number(l[c]) > v), b),
      not: (c: string, _op: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) !== v), b),
      order: (col: string, o?: { ascending?: boolean }) => ((ordem = { col, asc: o?.ascending ?? true }), b),
      limit: (n: number) => ((limite = n), b),
      maybeSingle: async () => ({ data: executar()[0] ?? null, error: null }),
      single: async () => ({ data: executar()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: executar(), error: null }).then(ok),
    };
    return b;
  };

  const rpc = async (nome: string, a: Record<string, unknown>) => {
    const faturas = (m.t.billing_invoices ??= []);
    if (nome === "fn_emitir_fatura") {
      if (faturas.some((f) => f.organization_id === a.p_org && f.period_start === a.p_period_start)) {
        return { data: null, error: null };
      }
      const linhas = a.p_lines as Array<{ amount_cents: number; item_id: string | null }>;
      const total = Math.max(0, linhas.reduce((s, l) => s + l.amount_cents, 0));
      const id = `fat-${++seq}`;
      faturas.push({
        id, organization_id: a.p_org, subscription_id: a.p_sub, period_start: a.p_period_start,
        due_date: a.p_due, amount_cents: total, currency: a.p_currency, status: "open", reference: a.p_reference,
        provider_payment_id: null, checkout_url: null, reminded_at: null, warned_at: null, suspended_at: null,
        lines: linhas,
      });
      for (const l of linhas) {
        const item = (m.t.subscription_items ?? []).find((i) => i.id === l.item_id && i.recurrence === "once");
        if (item) item.billed_invoice_id = id;
      }
      return { data: id, error: null };
    }
    if (nome === "fn_marcar_fatura_paga") {
      const f = faturas.find((x) => x.id === a.p_invoice && x.status === "open");
      if (!f) return { data: { changed: false }, error: null };
      f.status = "paid";
      f.paid_at = m.agora.toISOString();
      return { data: { changed: true, organization_id: f.organization_id }, error: null };
    }
    // Os tokens de IA (9011): estes casos não gastam nada, e a soma é zero.
    if (nome === "fn_tokens_de_ia_no_periodo") return { data: 0, error: null };
    const org = (m.t.organizations ?? []).find((o) => o.id === a.p_org);
    if (nome === "fn_suspender_organizacao") {
      if (!org) return { data: null, error: { message: "organization_not_found" } };
      if (org.status === "suspended") {
        return { data: { changed: false, motivo: org.suspended_kind === "administrativa" ? "administrativa_prevalece" : "ja_suspensa" }, error: null };
      }
      org.status = "suspended";
      org.suspended_kind = a.p_kind;
      return { data: { changed: true }, error: null };
    }
    if (nome === "fn_reativar_organizacao") {
      if (!org || org.status !== "suspended") return { data: { changed: false, motivo: "nao_suspensa" }, error: null };
      if (org.suspended_kind !== a.p_kind_exigido) return { data: { changed: false, motivo: "suspensao_administrativa" }, error: null };
      org.status = "active";
      org.suspended_kind = null;
      return { data: { changed: true }, error: null };
    }
    return { data: null, error: { message: `rpc desconhecida: ${nome}` } };
  };

  return { from: consulta, rpc } as never;
}

function mundo(sobre: Partial<Mundo> = {}): Mundo {
  return {
    t: {
      organizations: [
        { id: ORG_SONGHAI, status: "active", suspended_kind: null, display_name: "Songhai" },
        { id: CLIENTE, status: "active", suspended_kind: null, display_name: "Clínica Sol" },
      ],
      organization_subscriptions: [
        {
          id: "sub-1", organization_id: CLIENTE, started_at: "2026-10-10T06:00:00Z", billing_anchor: "2026-10-10",
          agreed_price_cents: null, agreed_setup_cents: null, is_pilot: false, status: "active", ended_at: null, plan: { ...MEDIO },
        },
      ],
      subscription_items: [],
      billing_invoices: [],
    },
    emails: [],
    pagamentosCriados: [],
    consultas: {},
    auditoria: [],
    agora: emDia(0),
    emailEntrega: true,
    gateway: null,
    ...sobre,
  };
}

function gatewayFalso(m: Mundo): Gateway {
  let n = 0;
  return {
    criar: async (e) => {
      m.pagamentosCriados.push({ amountCents: e.amountCents, reference: e.reference });
      return { id: `pay-${++n}`, checkoutUrl: `https://pagar.exemplo/${e.reference}` };
    },
    consultar: async (id) => m.consultas[id] ?? "pending",
  };
}

function deps(m: Mundo): DependenciasDaRodada {
  return {
    db: criarBanco(m),
    cfg: { organizationId: ORG_SONGHAI, ativaDesde: "2026-10-01", instrucoesDeTransferencia: null, emailsDoFornecedor: [] },
    agora: m.agora,
    gateway: m.gateway,
    emailsDosAdmins: async () => ["dono@clinicasol.co.mz"],
    enviarEmail: async (para, msg) => {
      m.emails.push({ para, assunto: msg.assunto });
      return m.emailEntrega;
    },
    suporte: "ajuda@songhai.cc",
    auditar: (e) => void m.auditoria.push(e.action),
  };
}

const rodar = (m: Mundo, dia: number) => {
  m.agora = emDia(dia);
  return rodarFaturacao(deps(m));
};
const faturas = (m: Mundo) => m.t.billing_invoices as Linha[];

beforeEach(() => vi.clearAllMocks());

describe("a primeira factura", () => {
  it("cliente novo: emite mensalidade + setup, com link de pagamento e e-mail ao dono", async () => {
    const m = mundo();
    m.gateway = gatewayFalso(m);
    const r = await rodar(m, 0);

    expect(r).toMatchObject({ emitidas: 1, links: 1, erros: 0 });
    const f = faturas(m)[0]!;
    expect(f.amount_cents).toBe(1_100_000); // 8.000 + 3.000 MZN
    expect(f.due_date).toBe("2026-10-15"); // a primeira dá 5 dias
    expect(f.checkout_url).toMatch(/^https:\/\/pagar\.exemplo\//);
    expect(m.pagamentosCriados).toEqual([{ amountCents: 1_100_000, reference: `fat-22222222-2026-10-10` }]);
    expect(m.emails).toHaveLength(1);
    expect(m.emails[0]!.para).toEqual(["dono@clinicasol.co.mz"]);
    expect(m.emails[0]!.assunto).toContain("Nova factura");
    expect(m.auditoria).toContain("billing.invoice_issued");
  });

  it("PILOTO: o sistema aplica sozinho — 4.000 MZN em vez de 11.000, sem ninguém corrigir à mão", async () => {
    const m = mundo();
    (m.t.organization_subscriptions as Linha[])[0]!.is_pilot = true;
    m.gateway = gatewayFalso(m);
    await rodar(m, 0);
    expect(faturas(m)[0]!.amount_cents).toBe(400_000);
  });

  it("repetir a rodada não duplica nada: nem factura, nem link, nem e-mail", async () => {
    const m = mundo();
    m.gateway = gatewayFalso(m);
    await rodar(m, 0);
    const r = await rodar(m, 0);
    expect(r).toMatchObject({ emitidas: 0, links: 0, lembretes: 0 });
    expect(faturas(m)).toHaveLength(1);
    expect(m.pagamentosCriados).toHaveLength(1);
    expect(m.emails).toHaveLength(1);
  });

  it("a organização que recebe nunca é facturada, mesmo que tenha assinatura", async () => {
    const m = mundo();
    (m.t.organization_subscriptions as Linha[]).push({
      id: "sub-s", organization_id: ORG_SONGHAI, started_at: "2026-10-10T06:00:00Z", billing_anchor: "2026-10-10",
      agreed_price_cents: null, agreed_setup_cents: null, is_pilot: false, status: "active", ended_at: null, plan: { ...MEDIO },
    });
    await rodar(m, 0);
    expect(faturas(m).map((f) => f.organization_id)).toEqual([CLIENTE]);
  });

  it("organização encerrada ou anonimizada não é facturada", async () => {
    const m = mundo();
    (m.t.organizations as Linha[])[1]!.status = "redacted";
    await rodar(m, 0);
    expect(faturas(m)).toHaveLength(0);
  });

  it("Enterprise sem preço nenhum: fica isenta, nada é emitido", async () => {
    const m = mundo();
    (m.t.organization_subscriptions as Linha[])[0]!.plan = { ...MEDIO, price_cents: null, setup_fee_cents: null };
    await rodar(m, 0);
    expect(faturas(m)).toHaveLength(0);
  });
});

describe("preço por cliente e extras", () => {
  it("o preço acordado vence o do pacote — e mudar o do pacote não mexe em factura já emitida", async () => {
    const m = mundo();
    (m.t.organization_subscriptions as Linha[])[0]!.agreed_price_cents = 650_000;
    await rodar(m, 0);
    expect(faturas(m)[0]!.amount_cents).toBe(650_000 + 300_000);

    // o preço GLOBAL do pacote sobe; a factura já emitida fica como estava
    ((m.t.organization_subscriptions as Linha[])[0]!.plan as Linha).price_cents = 999_000;
    await rodar(m, 1);
    expect(faturas(m)[0]!.amount_cents).toBe(950_000);
  });

  it("o preço global novo vale na PRÓXIMA factura de quem não tem preço acordado", async () => {
    const m = mundo();
    await rodar(m, 0);
    ((m.t.organization_subscriptions as Linha[])[0]!.plan as Linha).price_cents = 900_000;
    await rodar(m, 31); // 5 dias antes de 10 de Novembro já passou
    const segunda = faturas(m).find((f) => f.period_start === "2026-11-10")!;
    expect(segunda.amount_cents).toBe(900_000);
  });

  it("um número de WhatsApp a mais entra na factura seguinte, todos os meses", async () => {
    const m = mundo();
    await rodar(m, 0);
    (m.t.subscription_items as Linha[]).push({
      id: "it-1", organization_id: CLIENTE, description: "Número de WhatsApp adicional", unit_price_cents: 150_000,
      quantity: 1, recurrence: "monthly", started_on: "2026-10-20", ended_on: null, billed_invoice_id: null,
    });
    await rodar(m, 31);
    expect(faturas(m).find((f) => f.period_start === "2026-11-10")!.amount_cents).toBe(950_000);
    await rodar(m, 62);
    expect(faturas(m).find((f) => f.period_start === "2026-12-10")!.amount_cents).toBe(950_000);
  });

  it("extra pontual cobra-se uma vez", async () => {
    const m = mundo();
    await rodar(m, 0);
    (m.t.subscription_items as Linha[]).push({
      id: "it-2", organization_id: CLIENTE, description: "Formação extra", unit_price_cents: 40_000,
      quantity: 1, recurrence: "once", started_on: "2026-10-20", ended_on: null, billed_invoice_id: null,
    });
    await rodar(m, 31);
    await rodar(m, 62);
    expect(faturas(m).find((f) => f.period_start === "2026-11-10")!.amount_cents).toBe(840_000);
    expect(faturas(m).find((f) => f.period_start === "2026-12-10")!.amount_cents).toBe(800_000);
  });

  it("factura a zero (cliente isento) fecha-se sozinha, sem link nem e-mail", async () => {
    const m = mundo();
    (m.t.organization_subscriptions as Linha[])[0]!.agreed_price_cents = 0;
    (m.t.organization_subscriptions as Linha[])[0]!.agreed_setup_cents = 0;
    m.gateway = gatewayFalso(m);
    await rodar(m, 0);
    expect(faturas(m)[0]!.status).toBe("paid");
    expect(m.pagamentosCriados).toHaveLength(0);
    expect(m.emails).toHaveLength(0);
  });
});

describe("quando o PaySuite está fora", () => {
  it("a factura sai sem link; quando o PaySuite volta, o link nasce e o cliente é avisado", async () => {
    const m = mundo();
    await rodar(m, 0);
    expect(faturas(m)[0]!.checkout_url).toBeNull();

    m.gateway = gatewayFalso(m);
    const r = await rodar(m, 0);
    expect(r.links).toBe(1);
    expect(faturas(m)[0]!.checkout_url).toBeTruthy();
    expect(m.emails.filter((e) => e.assunto.includes("Nova factura"))).toHaveLength(2); // uma sem link, uma com
  });

  it("criar o link falhar não derruba a rodada nem a factura", async () => {
    const m = mundo();
    m.gateway = { criar: async () => { throw new Error("502"); }, consultar: async () => "pending" };
    const r = await rodar(m, 0);
    expect(r).toMatchObject({ emitidas: 1, links: 0, erros: 0 });
  });
});

describe("a régua, do vencimento à suspensão e à volta — sem ninguém lembrar de nada", () => {
  async function ate(m: Mundo, dia: number) {
    for (let d = 0; d <= dia; d++) await rodar(m, d);
  }

  it("linha do tempo completa: lembrete, aviso aos 3 dias, suspensão aos 7, pagamento e reactivação", async () => {
    const m = mundo();
    m.gateway = gatewayFalso(m);

    await rodar(m, 0); // emitida a 10/10, vence a 15/10
    await ate(m, 4);
    expect(m.emails.map((e) => e.assunto).filter((a) => a.includes("vence hoje"))).toHaveLength(0);

    await rodar(m, 5); // 15/10: vencimento → lembrete
    expect(m.emails.some((e) => e.assunto.includes("vence hoje"))).toBe(true);

    await ate(m, 7);
    expect((m.t.organizations as Linha[])[1]!.status).toBe("active"); // ainda a tempo

    await rodar(m, 8); // 18/10: 3 dias de atraso → aviso final
    const aviso = m.emails.find((e) => e.assunto.includes("Aviso final"));
    expect(aviso).toBeTruthy();
    expect(aviso!.assunto).toContain("22/10/2026"); // 15/10 + 7 dias

    await rodar(m, 11); // 21/10: 6 dias — nada
    expect((m.t.organizations as Linha[])[1]!.status).toBe("active");

    await rodar(m, 12); // 22/10: 7 dias e aviso há > 48h → suspende
    const org = (m.t.organizations as Linha[])[1]!;
    expect(org.status).toBe("suspended");
    expect(org.suspended_kind).toBe("cobranca");
    expect(m.emails.some((e) => e.assunto.includes("suspensa"))).toBe(true);

    // o cliente paga pelo M-Pesa: o PaySuite diz "paid" na próxima rodada
    const f = faturas(m)[0]!;
    m.consultas[f.provider_payment_id as string] = "paid";
    await rodar(m, 13);
    expect(f.status).toBe("paid");
    expect(org.status).toBe("active");
    expect(org.suspended_kind).toBeNull();
    expect(m.emails.some((e) => e.assunto.includes("Pagamento recebido"))).toBe(true);
    expect(m.emails.some((e) => e.assunto.includes("reativada"))).toBe(true);
    expect(m.auditoria).toEqual(
      expect.arrayContaining(["billing.reminder_sent", "billing.warning_sent", "billing.org_suspended", "billing.invoice_paid", "billing.org_reactivated"]),
    );
  });

  it("cada aviso sai UMA vez, por muitas rodadas que corram", async () => {
    const m = mundo();
    m.gateway = gatewayFalso(m);
    await ate(m, 11);
    for (let i = 0; i < 5; i++) await rodar(m, 11);
    expect(m.emails.filter((e) => e.assunto.includes("vence hoje"))).toHaveLength(1);
    expect(m.emails.filter((e) => e.assunto.includes("Aviso final"))).toHaveLength(1);
  });

  it("paga a tempo: nunca há lembrete nem suspensão", async () => {
    const m = mundo();
    m.gateway = gatewayFalso(m);
    await rodar(m, 0);
    m.consultas[faturas(m)[0]!.provider_payment_id as string] = "paid";
    await ate(m, 20);
    expect(faturas(m)[0]!.status).toBe("paid");
    expect(m.emails.some((e) => e.assunto.includes("Aviso final") || e.assunto.includes("suspensa"))).toBe(false);
    expect((m.t.organizations as Linha[])[1]!.status).toBe("active");
  });

  it("relógio parado 30 dias: o aviso sai primeiro e só 48 h depois a suspensão — nunca sem aviso", async () => {
    const m = mundo();
    m.gateway = gatewayFalso(m);
    await rodar(m, 0);
    await rodar(m, 30); // ninguém correu a régua até hoje
    expect((m.t.organizations as Linha[])[1]!.status).toBe("active");
    expect(m.emails.some((e) => e.assunto.includes("Aviso final"))).toBe(true);
    await rodar(m, 31);
    expect((m.t.organizations as Linha[])[1]!.status).toBe("active");
    m.agora = emDia(32, 12);
    await rodarFaturacao(deps(m));
    expect((m.t.organizations as Linha[])[1]!.status).toBe("suspended");
  });

  it("e-mail que não sai (sem transporte) não impede a régua: a conta continua protegida e a marcação fica", async () => {
    const m = mundo({ emailEntrega: false });
    m.gateway = gatewayFalso(m);
    await ate(m, 12);
    expect((m.t.organizations as Linha[])[1]!.status).toBe("suspended");
  });

  it("dívida de outra factura mantém a suspensão: pagar uma não reactiva se outra continua vencida", async () => {
    const m = mundo();
    m.gateway = gatewayFalso(m);
    await ate(m, 12);
    (m.t.billing_invoices as Linha[]).push({
      id: "fat-velha", organization_id: CLIENTE, subscription_id: "sub-1", period_start: "2026-09-10", due_date: "2026-10-01",
      amount_cents: 800_000, currency: "MZN", status: "open", reference: "x", provider_payment_id: null, checkout_url: null,
      reminded_at: null, warned_at: null, suspended_at: null,
    });
    const f = faturas(m)[0]!;
    m.consultas[f.provider_payment_id as string] = "paid";
    await rodar(m, 13);
    expect(f.status).toBe("paid");
    expect((m.t.organizations as Linha[])[1]!.status).toBe("suspended");
  });
});

describe("suspensão administrativa é de uma pessoa", () => {
  it("a régua não sobrepõe uma suspensão administrativa, e o pagamento não a levanta", async () => {
    const m = mundo();
    m.gateway = gatewayFalso(m);
    await rodar(m, 0);
    const org = (m.t.organizations as Linha[])[1]!;
    org.status = "suspended";
    org.suspended_kind = "administrativa";

    for (let d = 1; d <= 14; d++) await rodar(m, d);
    expect(org.suspended_kind).toBe("administrativa");

    m.consultas[faturas(m)[0]!.provider_payment_id as string] = "paid";
    await rodar(m, 15);
    expect(faturas(m)[0]!.status).toBe("paid");
    expect(org.status).toBe("suspended");
    expect(org.suspended_kind).toBe("administrativa");
  });
});

describe("o webhook e a reconciliação dizem a mesma coisa", () => {
  it("registrar o pagamento duas vezes só conta uma", async () => {
    const m = mundo();
    m.gateway = gatewayFalso(m);
    await rodar(m, 0);
    const f = faturas(m)[0]! as never as Parameters<typeof registrarPagamentoDeFatura>[1];
    const d = deps(m);
    expect(await registrarPagamentoDeFatura(d, f)).toBe(true);
    expect(await registrarPagamentoDeFatura(d, f)).toBe(false);
    expect(m.emails.filter((e) => e.assunto.includes("Pagamento recebido"))).toHaveLength(1);
  });

  it("a data de hoje que a rodada usa é a de Maputo", () => {
    expect(dataEmMaputo(new Date("2026-10-09T23:30:00Z"))).toBe("2026-10-10");
  });
});

describe("um passo que falha não derruba os outros", () => {
  it("consultar o PaySuite falhar não impede a régua de correr", async () => {
    const m = mundo();
    m.gateway = { ...gatewayFalso(m), consultar: async () => { throw new Error("timeout"); } };
    await rodar(m, 0);
    await rodar(m, 5);
    expect(m.emails.some((e) => e.assunto.includes("vence hoje"))).toBe(true);
  });
});

describe("pagamento que falhou no PaySuite", () => {
  it("o link morto é largado e um novo nasce na mesma rodada, com outra referência", async () => {
    const m = mundo();
    m.gateway = gatewayFalso(m);
    await rodar(m, 0);
    const f = faturas(m)[0]!;
    const primeiro = f.provider_payment_id as string;
    const refAntiga = f.reference as string;

    m.consultas[primeiro] = "failed";
    await rodar(m, 1);

    expect(f.provider_payment_id).not.toBe(primeiro);
    expect(f.provider_payment_id).toBeTruthy();
    expect(f.reference).not.toBe(refAntiga);
    expect((f.reference as string).length).toBeLessThanOrEqual(50);
    expect(m.pagamentosCriados).toHaveLength(2);
    // o cliente recebe o link novo
    expect(m.emails.filter((e) => e.assunto.includes("Nova factura")).length).toBeGreaterThanOrEqual(2);
  });
});
