/**
 * SonghaiCRM — os campos que o operador edita para a quota de tokens, e o que o
 * cliente vê: nada escrito no código, tudo configurável.
 */
import { describe, expect, it } from "vitest";

import { alterarConteudoDoPacote, alterarTermosDoCliente } from "@/lib/billing/admin";
import { MAXIMO_DE_EMAILS_DO_FORNECEDOR, gravarEmailsDoFornecedor, lerConfigDaFaturacao, lerEmails } from "@/lib/billing/config";
import { montarEmail, type DadosDoEmail } from "@/lib/billing/emails";
import { avisoDeTokensAtual } from "@/lib/billing/tokens";

type Linha = Record<string, unknown>;
type Tabelas = Record<string, Linha[]>;

/** PostgREST mínimo: select/eq/is/in, update, upsert, delete, maybeSingle. */
function banco(t: Tabelas) {
  return {
    from(nome: string) {
      const filtros: Array<(l: Linha) => boolean> = [];
      let modo: "select" | "update" | "delete" = "select";
      let valores: Linha = {};
      const lista = () => ((t[nome] ??= []) as Linha[]);
      const b: Record<string, unknown> = {
        select: () => b,
        update: (v: Linha) => ((modo = "update"), (valores = v), b),
        delete: () => ((modo = "delete"), b),
        eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), b),
        is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), b),
        in: (c: string, v: unknown[]) => (filtros.push((l) => v.includes(l[c])), b),
        upsert: async (linhas: Linha | Linha[]) => {
          for (const l of Array.isArray(linhas) ? linhas : [linhas]) {
            const i = lista().findIndex((x) => x.chave === l.chave);
            if (i >= 0) lista()[i] = { ...lista()[i], ...l };
            else lista().push(l);
          }
          return { error: null };
        },
        maybeSingle: async () => ({ data: lista().filter((l) => filtros.every((f) => f(l)))[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          const achadas = lista().filter((l) => filtros.every((f) => f(l)));
          if (modo === "update") for (const l of achadas) Object.assign(l, valores);
          if (modo === "delete") t[nome] = lista().filter((l) => !achadas.includes(l));
          return Promise.resolve({ data: achadas, error: null }).then(ok);
        },
      };
      return b;
    },
  } as never;
}

describe("os e-mails do fornecedor", () => {
  it("lê por vírgula, ponto e vírgula, espaço ou linha; descarta o que não é e-mail; sem repetidos", () => {
    expect(lerEmails("a@x.cc, B@X.cc;c@x.cc\nnão-é-email  a@x.cc")).toEqual(["a@x.cc", "b@x.cc", "c@x.cc"]);
    expect(lerEmails("")).toEqual([]);
    expect(lerEmails(null)).toEqual([]);
  });

  it("grava a lista, e ela faz parte da configuração da faturação", async () => {
    const t: Tabelas = { platform_config: [{ chave: "BILLING_ORGANIZATION_ID", valor: "11111111-1111-4111-8111-111111111111" }] };
    expect(await gravarEmailsDoFornecedor(banco(t), ["phill@songhai.cc", "gestor@songhai.cc"], "u1")).toBe(true);
    const cfg = await lerConfigDaFaturacao({
      from: () => ({
        select: () => ({
          in: async () => ({ data: t.platform_config, error: null }),
        }),
      }),
    } as never);
    expect(cfg?.emailsDoFornecedor).toEqual(["phill@songhai.cc", "gestor@songhai.cc"]);
  });

  it("lista vazia apaga (os avisos voltam aos administradores da plataforma)", async () => {
    const t: Tabelas = { platform_config: [{ chave: "BILLING_PROVIDER_EMAILS", valor: "a@x.cc" }] };
    expect(await gravarEmailsDoFornecedor(banco(t), [], "u1")).toBe(true);
    expect(t.platform_config).toHaveLength(0);
  });

  it("um endereço inválido recusa a lista inteira e nada se grava", async () => {
    const t: Tabelas = { platform_config: [] };
    expect(await gravarEmailsDoFornecedor(banco(t), ["a@x.cc", "isto não é email"], "u1")).toBe(false);
    expect(t.platform_config).toHaveLength(0);
  });

  it("mais do que o máximo é recusado", async () => {
    const t: Tabelas = { platform_config: [] };
    const muitos = Array.from({ length: MAXIMO_DE_EMAILS_DO_FORNECEDOR + 1 }, (_, i) => `u${i}@x.cc`);
    expect(await gravarEmailsDoFornecedor(banco(t), muitos, "u1")).toBe(false);
  });
});

describe("tokens por conta no pacote", () => {
  const mundo = (): Tabelas => ({
    plans: [{ id: "p1", limits: { max_users: 20, max_whatsapp_connections: 1 } }],
    organization_subscriptions: [{ id: "s1", plan_id: "p1", ended_at: null }],
  });

  it("define a quota por conta sem perder as outras chaves", async () => {
    const t = mundo();
    expect((await alterarConteudoDoPacote(banco(t), "p1", { ai_tokens_per_account: 500_000 })).ok).toBe(true);
    expect(t.plans![0]!.limits).toEqual({ max_users: 20, max_whatsapp_connections: 1, ai_tokens_per_account: 500_000 });
  });

  it("null tira a quota: o pacote deixa de ter limite (e de avisar)", async () => {
    const t = mundo();
    await alterarConteudoDoPacote(banco(t), "p1", { ai_tokens_per_account: 500_000 });
    await alterarConteudoDoPacote(banco(t), "p1", { ai_tokens_per_account: null });
    expect("ai_tokens_per_account" in (t.plans![0]!.limits as Linha)).toBe(false);
  });

  it("recusa zero, negativo e fracção", async () => {
    const t = mundo();
    for (const mau of [0, -5, 1.5]) {
      expect((await alterarConteudoDoPacote(banco(t), "p1", { ai_tokens_per_account: mau })).erro, String(mau)).toBe("limite_invalido");
    }
  });
});

describe("quota acordada com um cliente", () => {
  const mundo = (): Tabelas => ({
    organization_subscriptions: [{ id: "s1", organization_id: "o1", ended_at: null, is_pilot: false, ai_tokens_override: null }],
    billing_invoices: [],
  });

  it("fixa a quota só deste cliente, e null volta à do pacote", async () => {
    const t = mundo();
    expect((await alterarTermosDoCliente(banco(t), "o1", { ai_tokens_override: 250_000 })).ok).toBe(true);
    expect(t.organization_subscriptions![0]!.ai_tokens_override).toBe(250_000);
    expect((await alterarTermosDoCliente(banco(t), "o1", { ai_tokens_override: null })).ok).toBe(true);
    expect(t.organization_subscriptions![0]!.ai_tokens_override).toBeNull();
  });

  it("recusa zero e fracção, e não grava nada", async () => {
    const t = mundo();
    for (const mau of [0, 2.5, -1]) {
      expect((await alterarTermosDoCliente(banco(t), "o1", { ai_tokens_override: mau })).erro, String(mau)).toBe("limite_invalido");
    }
    expect(t.organization_subscriptions![0]!.ai_tokens_override).toBeNull();
  });

  it("pode mudar-se depois da primeira factura (ao contrário do piloto)", async () => {
    const t = mundo();
    t.billing_invoices!.push({ id: "f1", organization_id: "o1" });
    expect((await alterarTermosDoCliente(banco(t), "o1", { ai_tokens_override: 100_000 })).ok).toBe(true);
  });
});

describe("o aviso que o cliente vê no topo da aplicação", () => {
  const AGORA = new Date("2026-10-20T08:00:00+02:00");
  const com = (linha: Linha | null, erro = false) =>
    ({
      from: () => {
        const b: Record<string, unknown> = {};
        for (const m of ["select", "eq", "gte", "lte", "order", "limit"]) b[m] = () => b;
        b.maybeSingle = async () => {
          if (erro) throw new Error("banco fora");
          return { data: linha, error: null };
        };
        return b;
      },
    }) as never;

  it("devolve o aviso mais alto do período, com o dia em que renova", async () => {
    const a = await avisoDeTokensAtual(com({ level: 100, consumed_tokens: 100_000, quota_tokens: 100_000, window_end: "2026-11-09" }), "o1", AGORA);
    expect(a).toEqual({ nivel: 100, consumidos: 100_000, quota: 100_000, renovaA: "2026-11-10" });
  });

  it("sem aviso registado, não há banner", async () => {
    expect(await avisoDeTokensAtual(com(null), "o1", AGORA)).toBeNull();
  });

  it("nível desconhecido é ignorado, e uma falha do banco nunca derruba a tela", async () => {
    expect(await avisoDeTokensAtual(com({ level: 50, consumed_tokens: 1, quota_tokens: 2, window_end: "2026-11-09" }), "o1", AGORA)).toBeNull();
    expect(await avisoDeTokensAtual(com(null, true), "o1", AGORA)).toBeNull();
  });
});

describe("as mensagens de tokens", () => {
  const dados: DadosDoEmail = {
    organizacao: "Clínica Sol",
    amountCents: 0,
    currency: "MZN",
    vencimento: "2026-11-09",
    periodo: "2026-10-10",
    tokens: { consumidos: 85_000, quota: 100_000, percentagem: 85, renovaA: "2026-11-10" },
  };

  it("aos 80%: diz quanto gastou, de quanto, e quando renova", () => {
    const m = montarEmail("tokens_80", dados);
    expect(m.assunto).toBe("Consumo de IA a 85% do limite deste período");
    expect(m.texto).toContain("85 000 de 100 000 tokens");
    expect(m.texto).toContain("10/11/2026");
  });

  it("no limite: diz que foi atingido e como aumentar, sem prometer que o serviço pára ou continua", () => {
    const m = montarEmail("tokens_100", dados);
    expect(m.assunto).toBe("Limite de tokens de IA atingido");
    expect(m.texto).toContain("fale com a equipa");
    expect(m.texto).not.toMatch(/pausad|suspens|deixa de funcionar|continua a funcionar/i);
  });

  it("ao fornecedor: identifica o cliente no assunto", () => {
    expect(montarEmail("fornecedor_tokens_80", dados).assunto).toBe("Clínica Sol: tokens de IA a 85%");
    expect(montarEmail("fornecedor_tokens_100", dados).assunto).toBe("Clínica Sol: limite de tokens de IA atingido");
  });

  it("nenhuma mensagem de tokens traz botão de pagamento", () => {
    for (const tipo of ["tokens_80", "tokens_100", "fornecedor_tokens_80", "fornecedor_tokens_100"] as const) {
      expect(montarEmail(tipo, { ...dados, linkDePagamento: "https://pagar.exemplo/x" }).html, tipo).not.toContain("pagar.exemplo");
    }
  });
});
