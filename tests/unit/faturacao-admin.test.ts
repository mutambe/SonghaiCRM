/**
 * SonghaiCRM — mudar preços sem esforço e sem estragar o que já foi cobrado
 * (lib/billing/admin.ts).
 *
 * Os três níveis — global, por cliente, extras — e a regra comum a todos:
 * nenhuma factura já emitida é tocada.
 */
import { describe, expect, it } from "vitest";

import {
  adicionarExtra,
  alterarConteudoDoPacote,
  alterarExtraDoCatalogo,
  anularFatura,
  darPrazo,
  alterarPrecoDoPacote,
  alterarTermosDoCliente,
  terminarExtra,
} from "@/lib/billing/admin";

type Linha = Record<string, unknown>;
type Tabelas = Record<string, Linha[]>;

/** PostgREST mínimo: select/eq/is/in/limit/order, insert, update. */
function banco(t: Tabelas) {
  let seq = 0;
  return {
    from(nome: string) {
      const filtros: Array<(l: Linha) => boolean> = [];
      let modo: "select" | "update" | "insert" = "select";
      let valores: Linha = {};
      let limite = Infinity;
      const executar = () => {
        const tabela = (t[nome] ??= []);
        if (modo === "insert") {
          const l = { id: `${nome}-${++seq}`, ...valores };
          tabela.push(l);
          return [l];
        }
        const achadas = tabela.filter((l) => filtros.every((f) => f(l)));
        if (modo === "update") {
          for (const l of achadas) Object.assign(l, valores);
          return achadas;
        }
        return achadas.slice(0, limite);
      };
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (v: Linha) => ((modo = "insert"), (valores = v), b),
        update: (v: Linha) => ((modo = "update"), (valores = v), b),
        eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), b),
        is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), b),
        limit: (n: number) => ((limite = n), b),
        maybeSingle: async () => ({ data: executar()[0] ?? null, error: null }),
        single: async () => ({ data: executar()[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: executar(), error: null }).then(ok),
      };
      return b;
    },
  } as never;
}

const ORG = "org-cliente";
const HOJE = "2026-10-20";

function mundo(): Tabelas {
  return {
    plans: [
      { id: "plano-medio", price_cents: 800_000, setup_fee_cents: 300_000 },
      { id: "plano-simples", price_cents: 500_000, setup_fee_cents: 200_000 },
    ],
    organization_subscriptions: [
      { id: "sub-1", organization_id: ORG, plan_id: "plano-medio", ended_at: null, agreed_price_cents: null, is_pilot: false },
      { id: "sub-2", organization_id: "outro-1", plan_id: "plano-medio", ended_at: null, agreed_price_cents: null, is_pilot: false },
      { id: "sub-3", organization_id: "outro-2", plan_id: "plano-medio", ended_at: null, agreed_price_cents: 600_000, is_pilot: false },
      { id: "sub-4", organization_id: "outro-3", plan_id: "plano-simples", ended_at: null, agreed_price_cents: null, is_pilot: false },
      { id: "sub-velha", organization_id: "outro-4", plan_id: "plano-medio", ended_at: "2026-01-01", agreed_price_cents: null, is_pilot: false },
    ],
    billing_invoices: [],
    subscription_items: [],
    billing_addons: [
      { id: "ad-wa", slug: "whatsapp_extra", description: "Número de WhatsApp adicional", kind: "whatsapp_extra", unit_price_cents: 150_000, recurrence: "monthly", adds_whatsapp_connections: 1, adds_users: 0, is_active: true },
      { id: "ad-sem-preco", slug: "crm_adicional", description: "CRM adicional", kind: "custom", unit_price_cents: null, recurrence: "monthly", adds_whatsapp_connections: 0, adds_users: 0, is_active: true },
      { id: "ad-off", slug: "velho", description: "Velho", kind: "custom", unit_price_cents: 1, recurrence: "once", adds_whatsapp_connections: 0, adds_users: 0, is_active: false },
    ],
  };
}

describe("preço GLOBAL do pacote", () => {
  it("muda o preço e diz quantos clientes serão afectados — só os sem preço acordado e com assinatura vigente", async () => {
    const t = mundo();
    const r = await alterarPrecoDoPacote(banco(t), "plano-medio", { price_cents: 900_000 });
    expect(r.ok).toBe(true);
    expect(t.plans![0]!.price_cents).toBe(900_000);
    expect(t.plans![0]!.setup_fee_cents).toBe(300_000); // o que não foi pedido fica
    // sub-1 e sub-2 (sem acordo, vigentes). Fora: sub-3 (tem acordo), sub-4 (outro pacote), sub-velha (terminada)
    expect(r.dados!.clientesAfetados).toBe(2);
    expect(r.dados!.antes.price_cents).toBe(800_000);
    expect(r.dados!.depois.price_cents).toBe(900_000);
  });

  it("não toca em facturas já emitidas", async () => {
    const t = mundo();
    t.billing_invoices!.push({ id: "f1", amount_cents: 800_000, status: "open" });
    await alterarPrecoDoPacote(banco(t), "plano-medio", { price_cents: 999_000 });
    expect(t.billing_invoices![0]!.amount_cents).toBe(800_000);
  });

  it("setup também se muda; pacote inexistente e pedido vazio são recusados", async () => {
    const t = mundo();
    expect((await alterarPrecoDoPacote(banco(t), "plano-medio", { setup_fee_cents: 350_000 })).ok).toBe(true);
    expect(t.plans![0]!.setup_fee_cents).toBe(350_000);
    expect((await alterarPrecoDoPacote(banco(t), "nao-existe", { price_cents: 1 })).erro).toBe("plano_nao_encontrado");
    expect((await alterarPrecoDoPacote(banco(t), "plano-medio", {})).erro).toBe("nada_a_alterar");
  });

  it("o preço do extra no catálogo muda para todos os clientes futuros", async () => {
    const t = mundo();
    const r = await alterarExtraDoCatalogo(banco(t), "ad-wa", { unit_price_cents: 180_000 });
    expect(r.ok).toBe(true);
    expect(t.billing_addons![0]!.unit_price_cents).toBe(180_000);
    expect((await alterarExtraDoCatalogo(banco(t), "nao-existe", { unit_price_cents: 1 })).erro).toBe("extra_nao_encontrado");
  });
});

describe("preço POR CLIENTE", () => {
  it("preço e setup acordados só mexem na assinatura DESTE cliente", async () => {
    const t = mundo();
    const r = await alterarTermosDoCliente(banco(t), ORG, { agreed_price_cents: 650_000, agreed_setup_cents: 100_000 });
    expect(r.ok).toBe(true);
    expect(t.organization_subscriptions![0]).toMatchObject({ agreed_price_cents: 650_000, agreed_setup_cents: 100_000 });
    expect(t.organization_subscriptions![1]!.agreed_price_cents).toBeNull(); // o outro cliente não mexe
    expect(t.plans![0]!.price_cents).toBe(800_000); // nem o preço global
  });

  it("voltar ao preço do pacote: acordado nulo", async () => {
    const t = mundo();
    t.organization_subscriptions![0]!.agreed_price_cents = 650_000;
    await alterarTermosDoCliente(banco(t), ORG, { agreed_price_cents: null });
    expect(t.organization_subscriptions![0]!.agreed_price_cents).toBeNull();
  });

  it("zero é um preço válido (cliente isento)", async () => {
    const t = mundo();
    await alterarTermosDoCliente(banco(t), ORG, { agreed_price_cents: 0 });
    expect(t.organization_subscriptions![0]!.agreed_price_cents).toBe(0);
  });

  it("piloto liga-se antes da primeira factura e depois já não se muda", async () => {
    const t = mundo();
    expect((await alterarTermosDoCliente(banco(t), ORG, { is_pilot: true })).ok).toBe(true);
    expect(t.organization_subscriptions![0]!.is_pilot).toBe(true);

    t.billing_invoices!.push({ id: "f1", organization_id: ORG, status: "open" });
    expect((await alterarTermosDoCliente(banco(t), ORG, { is_pilot: false })).erro).toBe("piloto_ja_nao_se_aplica");
    expect(t.organization_subscriptions![0]!.is_pilot).toBe(true);
    // mas o preço continua a poder mudar depois da primeira factura
    expect((await alterarTermosDoCliente(banco(t), ORG, { agreed_price_cents: 700_000 })).ok).toBe(true);
  });

  it("cliente sem assinatura não tem termos", async () => {
    const t = mundo();
    expect((await alterarTermosDoCliente(banco(t), "sem-sub", { agreed_price_cents: 1 })).erro).toBe("sem_assinatura");
  });
});

describe("EXTRAS por cliente", () => {
  it("um número de WhatsApp a mais: usa o preço do catálogo e traz o limite que acrescenta", async () => {
    const t = mundo();
    const r = await adicionarExtra(banco(t), ORG, { addon_slug: "whatsapp_extra" }, "user-1", HOJE);
    expect(r.ok).toBe(true);
    expect(t.subscription_items![0]).toMatchObject({
      organization_id: ORG,
      description: "Número de WhatsApp adicional",
      unit_price_cents: 150_000,
      quantity: 1,
      recurrence: "monthly",
      adds_whatsapp_connections: 1,
      started_on: HOJE,
      created_by: "user-1",
    });
  });

  it("preço combinado só com este cliente: vence o do catálogo, e o catálogo fica igual", async () => {
    const t = mundo();
    await adicionarExtra(banco(t), ORG, { addon_slug: "whatsapp_extra", unit_price_cents: 100_000 }, "u", HOJE);
    expect(t.subscription_items![0]!.unit_price_cents).toBe(100_000);
    expect(t.billing_addons![0]!.unit_price_cents).toBe(150_000);
  });

  it("extra com preço por definir NÃO se vende (nunca vira zero em silêncio)", async () => {
    const t = mundo();
    expect((await adicionarExtra(banco(t), ORG, { addon_slug: "crm_adicional" }, "u", HOJE)).erro).toBe("preco_por_definir");
    expect(t.subscription_items).toHaveLength(0);
    // com o preço dado na hora, vende-se
    expect((await adicionarExtra(banco(t), ORG, { addon_slug: "crm_adicional", unit_price_cents: 100_000 }, "u", HOJE)).ok).toBe(true);
  });

  it("extra desactivado ou inexistente é recusado", async () => {
    const t = mundo();
    expect((await adicionarExtra(banco(t), ORG, { addon_slug: "velho" }, "u", HOJE)).erro).toBe("extra_desativado");
    expect((await adicionarExtra(banco(t), ORG, { addon_slug: "nao-existe" }, "u", HOJE)).erro).toBe("extra_nao_encontrado");
  });

  it("extra à medida: pede descrição, preço e recorrência", async () => {
    const t = mundo();
    expect((await adicionarExtra(banco(t), ORG, { description: "Integração com o ERP deles" }, "u", HOJE)).erro).toBe("extra_incompleto");
    const r = await adicionarExtra(
      banco(t),
      ORG,
      { description: "Integração com o ERP deles", unit_price_cents: 300_000, recurrence: "once" },
      "u",
      HOJE,
    );
    expect(r.ok).toBe(true);
    expect(t.subscription_items![0]).toMatchObject({ kind: "custom", adds_whatsapp_connections: 0, recurrence: "once" });
  });

  it("cliente sem assinatura não contrata extras", async () => {
    const t = mundo();
    expect((await adicionarExtra(banco(t), "sem-sub", { addon_slug: "whatsapp_extra" }, "u", HOJE)).erro).toBe("sem_assinatura");
  });

  it("acabar um extra recorrente: termina ONTEM (o teto desce já) e não se apaga", async () => {
    const t = mundo();
    await adicionarExtra(banco(t), ORG, { addon_slug: "whatsapp_extra" }, "u", "2026-10-01");
    const id = t.subscription_items![0]!.id as string;
    const r = await terminarExtra(banco(t), ORG, id, HOJE);
    expect(r.ok).toBe(true);
    expect(t.subscription_items).toHaveLength(1);
    expect(t.subscription_items![0]!.ended_on).toBe("2026-10-19");
    expect((await terminarExtra(banco(t), ORG, id, HOJE)).erro).toBe("extra_ja_terminado");
  });

  it("extra de hoje, acabado hoje, nunca fica com fim antes do início", async () => {
    const t = mundo();
    await adicionarExtra(banco(t), ORG, { addon_slug: "whatsapp_extra" }, "u", HOJE);
    await terminarExtra(banco(t), ORG, t.subscription_items![0]!.id as string, HOJE);
    expect(t.subscription_items![0]!.ended_on).toBe(HOJE);
  });

  it("pontual ainda por facturar fica sem efeito; já facturado não se desfaz", async () => {
    const t = mundo();
    t.subscription_items!.push(
      { id: "p1", organization_id: ORG, recurrence: "once", started_on: "2026-10-10", ended_on: null, billed_invoice_id: null },
      { id: "p2", organization_id: ORG, recurrence: "once", started_on: "2026-10-10", ended_on: null, billed_invoice_id: "fat-1" },
    );
    expect((await terminarExtra(banco(t), ORG, "p1", HOJE)).ok).toBe(true);
    expect(t.subscription_items![0]!.ended_on).toBe("2026-10-10");
    expect((await terminarExtra(banco(t), ORG, "p2", HOJE)).erro).toBe("extra_ja_facturado");
  });

  it("um cliente não acaba extras de outro", async () => {
    const t = mundo();
    t.subscription_items!.push({ id: "x", organization_id: "outro-1", recurrence: "monthly", started_on: "2026-10-01", ended_on: null, billed_invoice_id: null });
    expect((await terminarExtra(banco(t), ORG, "x", HOJE)).erro).toBe("extra_nao_encontrado");
    expect(t.subscription_items![0]!.ended_on).toBeNull();
  });
});

describe("DAR PRAZO e ANULAR uma factura", () => {
  function comFatura(sobre: Linha = {}): Tabelas {
    const t = mundo();
    t.billing_invoices!.push({
      id: "f1", organization_id: ORG, status: "open", due_date: "2026-10-15",
      reminded_at: "2026-10-15T08:00:00Z", warned_at: "2026-10-18T08:00:00Z", suspended_at: "2026-10-22T08:00:00Z", ...sobre,
    });
    return t;
  }

  it("adia o vencimento e a régua da factura recomeça do zero", async () => {
    const t = comFatura();
    const r = await darPrazo(banco(t), ORG, "f1", "2026-11-05", HOJE);
    expect(r.ok).toBe(true);
    expect(t.billing_invoices![0]).toMatchObject({ due_date: "2026-11-05", reminded_at: null, warned_at: null, suspended_at: null });
  });

  it("limites: nunca no passado, nunca mais de 60 dias, e a data tem de avançar", async () => {
    const t = comFatura();
    expect((await darPrazo(banco(t), ORG, "f1", "2026-10-19", HOJE)).erro).toBe("data_no_passado");
    expect((await darPrazo(banco(t), ORG, "f1", "2026-12-20", HOJE)).erro).toBe("prazo_demasiado_longo");
    expect((await darPrazo(banco(t), ORG, "f1", "amanhã", HOJE)).erro).toBe("data_invalida");
    // vencimento ainda no futuro: pedir a mesma data (ou antes) não adia nada
    const futura = comFatura({ due_date: "2026-10-25" });
    expect((await darPrazo(banco(futura), ORG, "f1", "2026-10-25", HOJE)).erro).toBe("prazo_nao_avanca");
    expect((await darPrazo(banco(futura), ORG, "f1", "2026-10-22", HOJE)).erro).toBe("prazo_nao_avanca");
    expect(t.billing_invoices![0]!.due_date).toBe("2026-10-15");
    expect(futura.billing_invoices![0]!.due_date).toBe("2026-10-25");
  });

  it("60 dias exactos ainda é permitido", async () => {
    const t = comFatura();
    expect((await darPrazo(banco(t), ORG, "f1", "2026-12-19", HOJE)).ok).toBe(true);
  });

  it("factura paga ou anulada não se mexe; de outro cliente também não", async () => {
    const paga = comFatura({ status: "paid" });
    expect((await darPrazo(banco(paga), ORG, "f1", "2026-11-05", HOJE)).erro).toBe("fatura_nao_aberta");
    expect((await anularFatura(banco(paga), ORG, "f1")).erro).toBe("fatura_nao_aberta");
    const t = comFatura();
    expect((await darPrazo(banco(t), "outro-cliente", "f1", "2026-11-05", HOJE)).erro).toBe("fatura_nao_encontrada");
    expect((await anularFatura(banco(t), "outro-cliente", "f1")).erro).toBe("fatura_nao_encontrada");
    expect(t.billing_invoices![0]!.status).toBe("open");
  });

  it("anular marca como anulada e não apaga", async () => {
    const t = comFatura();
    expect((await anularFatura(banco(t), ORG, "f1")).ok).toBe(true);
    expect(t.billing_invoices).toHaveLength(1);
    expect(t.billing_invoices![0]!.status).toBe("void");
  });
});

describe("O QUE O PACOTE INCLUI (funcionalidades e limites)", () => {
  function comLimites(limits: Linha): Tabelas {
    const t = mundo();
    t.plans![0]!.limits = limits;
    return t;
  }

  it("define as funcionalidades e diz quantos clientes são afectados — todos os vigentes do pacote", async () => {
    const t = comLimites({ max_users: 50, max_whatsapp_connections: 2, features: ["agenda"] });
    const r = await alterarConteudoDoPacote(banco(t), "plano-medio", { features: ["agenda", "crm", "mpesa"] });
    expect(r.ok).toBe(true);
    expect((t.plans![0]!.limits as Linha).features).toEqual(["agenda", "crm", "mpesa"]);
    // sub-1, sub-2 e sub-3 estão no plano Médio e vigentes (a sub-velha terminou)
    expect(r.dados!.clientesAfetados).toBe(3);
  });

  it("as outras chaves do pacote não se perdem", async () => {
    const t = comLimites({ max_users: 50, max_whatsapp_connections: 2, features: ["agenda"] });
    await alterarConteudoDoPacote(banco(t), "plano-medio", { features: [] });
    expect(t.plans![0]!.limits).toEqual({ max_users: 50, max_whatsapp_connections: 2, features: [] });
  });

  it("lista vazia é 'nenhuma extra' (Simples); null é 'todas' e a chave sai", async () => {
    const t = comLimites({ features: ["agenda"] });
    await alterarConteudoDoPacote(banco(t), "plano-medio", { features: [] });
    expect((t.plans![0]!.limits as Linha).features).toEqual([]);
    await alterarConteudoDoPacote(banco(t), "plano-medio", { features: null });
    expect("features" in (t.plans![0]!.limits as Linha)).toBe(false);
  });

  it("limites: número inteiro ≥ 1 fixa o teto; null tira o teto", async () => {
    const t = comLimites({ max_users: 20, max_whatsapp_connections: 1 });
    await alterarConteudoDoPacote(banco(t), "plano-medio", { max_whatsapp_connections: 3, max_users: null });
    expect(t.plans![0]!.limits).toEqual({ max_whatsapp_connections: 3 });
  });

  it("recusa funcionalidade desconhecida e limite inválido — e não grava nada", async () => {
    const t = comLimites({ max_users: 20 });
    expect((await alterarConteudoDoPacote(banco(t), "plano-medio", { features: ["agenda", "voo_espacial"] })).erro).toBe("funcionalidade_desconhecida");
    for (const mau of [0, -1, 1.5]) {
      expect((await alterarConteudoDoPacote(banco(t), "plano-medio", { max_users: mau })).erro, String(mau)).toBe("limite_invalido");
    }
    expect(t.plans![0]!.limits).toEqual({ max_users: 20 });
  });

  it("repetidas contam uma vez", async () => {
    const t = comLimites({});
    await alterarConteudoDoPacote(banco(t), "plano-medio", { features: ["crm", "crm", "agenda"] });
    expect((t.plans![0]!.limits as Linha).features).toEqual(["crm", "agenda"]);
  });

  it("pedido vazio e pacote inexistente são recusados; o preço nunca é tocado", async () => {
    const t = comLimites({});
    expect((await alterarConteudoDoPacote(banco(t), "plano-medio", {})).erro).toBe("nada_a_alterar");
    expect((await alterarConteudoDoPacote(banco(t), "nao-existe", { features: [] })).erro).toBe("plano_nao_encontrado");
    await alterarConteudoDoPacote(banco(t), "plano-medio", { features: [] });
    expect(t.plans![0]!.price_cents).toBe(800_000);
  });
});
