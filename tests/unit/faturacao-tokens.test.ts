/**
 * SonghaiCRM — a quota de tokens de IA por conta (lib/billing/tokens.ts).
 *
 * O que o site promete — «cada pacote tem uma quantidade de tokens, ligada a cada
 * conta de WhatsApp» — como contas que se conferem à mão.
 */
import { describe, expect, it } from "vitest";

import {
  estadoDosTokens,
  janelaDeTokens,
  nivelAtingido,
  percentagemDeTokens,
  periodoQueContem,
  quotaDeTokens,
  tokensLegiveis,
} from "@/lib/billing/tokens";

describe("o período da quota é o ciclo de facturação", () => {
  it("contém o dia de hoje, do início ao fim, inclusive", () => {
    expect(periodoQueContem("2026-10-10", "2026-10-10")).toEqual({ inicio: "2026-10-10", fim: "2026-11-09" });
    expect(periodoQueContem("2026-10-10", "2026-11-09")).toEqual({ inicio: "2026-10-10", fim: "2026-11-09" });
    // a conta renova no dia 10: a quota recomeça com ela
    expect(periodoQueContem("2026-10-10", "2026-11-10")).toEqual({ inicio: "2026-11-10", fim: "2026-12-09" });
  });

  it("atravessa o fim do ano e vários meses", () => {
    expect(periodoQueContem("2026-10-10", "2027-03-25")).toEqual({ inicio: "2027-03-10", fim: "2027-04-09" });
  });

  it("âncora no dia 31: o ciclo encosta no fim do mês e volta ao 31", () => {
    expect(periodoQueContem("2026-01-31", "2026-03-01")).toEqual({ inicio: "2026-02-28", fim: "2026-03-30" });
    expect(periodoQueContem("2026-01-31", "2026-03-31")).toEqual({ inicio: "2026-03-31", fim: "2026-04-29" });
  });

  it("antes da âncora, vale o primeiro período", () => {
    expect(periodoQueContem("2026-10-10", "2026-09-01")).toEqual({ inicio: "2026-10-10", fim: "2026-11-09" });
  });

  it("sem ciclo de facturação, vale o mês do calendário", () => {
    expect(janelaDeTokens("2026-02-14", null)).toEqual({ inicio: "2026-02-01", fim: "2026-02-28" });
    expect(janelaDeTokens("2028-02-14", null)).toEqual({ inicio: "2028-02-01", fim: "2028-02-29" });
    expect(janelaDeTokens("2026-12-31", null)).toEqual({ inicio: "2026-12-01", fim: "2026-12-31" });
  });
});

describe("a quota", () => {
  it("é tokens por conta × contas de WhatsApp: duas contas, o dobro", () => {
    expect(quotaDeTokens({ porConta: 100_000, contas: 1, override: null })).toEqual({ quota: 100_000, origem: "pacote" });
    expect(quotaDeTokens({ porConta: 100_000, contas: 2, override: null })).toEqual({ quota: 200_000, origem: "pacote" });
  });

  it("o valor acordado com o cliente vence o do pacote", () => {
    expect(quotaDeTokens({ porConta: 100_000, contas: 3, override: 50_000 })).toEqual({ quota: 50_000, origem: "acordado" });
  });

  it("sem tokens definidos não há limite — nunca zero", () => {
    expect(quotaDeTokens({ porConta: null, contas: 2, override: null })).toEqual({ quota: null, origem: "sem_limite" });
  });

  it("zero contas conta como uma", () => {
    expect(quotaDeTokens({ porConta: 100_000, contas: 0, override: null }).quota).toBe(100_000);
  });
});

describe("os limiares: 80% e 100%", () => {
  it("o nível é o maior limiar já atingido", () => {
    expect(nivelAtingido(79_999, 100_000)).toBe(0);
    expect(nivelAtingido(80_000, 100_000)).toBe(80);
    expect(nivelAtingido(99_999, 100_000)).toBe(80);
    expect(nivelAtingido(100_000, 100_000)).toBe(100);
    expect(nivelAtingido(250_000, 100_000)).toBe(100);
  });

  it("sem quota nunca há aviso", () => {
    expect(nivelAtingido(10_000_000, null)).toBe(0);
    expect(percentagemDeTokens(5, null)).toBeNull();
  });

  it("a percentagem arredonda para baixo, para 79,9% não parecer 80", () => {
    expect(percentagemDeTokens(79_999, 100_000)).toBe(79);
    expect(percentagemDeTokens(150_000, 100_000)).toBe(150);
  });

  it("os números lêem-se com espaço nos milhares", () => {
    expect(tokensLegiveis(1_234_567)).toBe("1 234 567");
    expect(tokensLegiveis(950)).toBe("950");
  });
});

// ─── a leitura do estado de uma organização ─────────────────────────────────

type Linha = Record<string, unknown>;

function banco(opts: {
  assinatura: Linha | null;
  extras?: Linha[];
  sessoes?: number;
  consumo?: number;
  erroNaSoma?: boolean;
}) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const db = {
    from(tabela: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        is: () => b,
        maybeSingle: async () => ({ data: opts.assinatura, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          const data =
            tabela === "subscription_items"
              ? (opts.extras ?? [])
              : tabela === "channel_sessions"
                ? Array.from({ length: opts.sessoes ?? 0 }, (_, i) => ({ id: `s${i}` }))
                : [];
          return Promise.resolve({ data, error: null }).then(ok);
        },
      };
      return b;
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      return opts.erroNaSoma ? { data: null, error: { message: "banco fora" } } : { data: opts.consumo ?? 0, error: null };
    },
  };
  return { db: db as never, chamadas };
}

const AGORA = new Date("2026-10-20T08:00:00+02:00");
const assinatura = (limits: Linha, sobre: Linha = {}) => ({
  started_at: "2026-10-10T06:00:00Z",
  billing_anchor: "2026-10-10",
  ai_tokens_override: null,
  plan: { limits },
  ...sobre,
});
const SIMPLES = { max_users: 20, max_whatsapp_connections: 1, ai_tokens_per_account: 100_000 };

describe("o estado dos tokens de uma organização", () => {
  it("Simples com 85% consumido: quota 100 000, nível 80", async () => {
    const { db } = banco({ assinatura: assinatura(SIMPLES), consumo: 85_000 });
    const e = await estadoDosTokens(db, "org-1", AGORA);
    expect(e).toMatchObject({ quota: 100_000, origem: "pacote", contas: 1, consumidos: 85_000, percentagem: 85, nivel: 80 });
  });

  it("um número de WhatsApp a mais SOBE a quota na hora: o mesmo consumo deixa de ser aviso", async () => {
    const extra = { quantity: 1, adds_whatsapp_connections: 1, adds_users: 0, started_on: "2026-10-15", ended_on: null };
    const { db } = banco({ assinatura: assinatura(SIMPLES), extras: [extra], consumo: 85_000 });
    const e = await estadoDosTokens(db, "org-1", AGORA);
    expect(e).toMatchObject({ quota: 200_000, contas: 2, percentagem: 42, nivel: 0 });
  });

  it("o extra que já acabou não conta", async () => {
    const extra = { quantity: 1, adds_whatsapp_connections: 1, adds_users: 0, started_on: "2026-09-01", ended_on: "2026-10-01" };
    const { db } = banco({ assinatura: assinatura(SIMPLES), extras: [extra], consumo: 1 });
    expect((await estadoDosTokens(db, "org-1", AGORA))?.quota).toBe(100_000);
  });

  it("a quota acordada com o cliente vence a do pacote", async () => {
    const { db } = banco({ assinatura: assinatura(SIMPLES, { ai_tokens_override: 40_000 }), consumo: 40_000 });
    expect(await estadoDosTokens(db, "org-1", AGORA)).toMatchObject({ quota: 40_000, origem: "acordado", nivel: 100 });
  });

  it("pacote sem tokens definidos: sem limite, e o consumo mostra-se na mesma", async () => {
    const { db } = banco({ assinatura: assinatura({ max_whatsapp_connections: 1 }), consumo: 9_000_000 });
    expect(await estadoDosTokens(db, "org-1", AGORA)).toMatchObject({ quota: null, origem: "sem_limite", consumidos: 9_000_000, nivel: 0, percentagem: null });
  });

  it("pacote sem teto de números (Enterprise) conta as contas que existem", async () => {
    const { db } = banco({ assinatura: assinatura({ ai_tokens_per_account: 100_000 }), sessoes: 3 });
    expect(await estadoDosTokens(db, "org-1", AGORA)).toMatchObject({ contas: 3, quota: 300_000 });
  });

  it("organização sem assinatura não tem quota", async () => {
    const { db } = banco({ assinatura: null });
    expect(await estadoDosTokens(db, "org-1", AGORA)).toBeNull();
  });

  it("soma o ciclo certo, em hora de Maputo: do dia 10 às 00:00 ao dia 10 seguinte às 00:00", async () => {
    const { db, chamadas } = banco({ assinatura: assinatura(SIMPLES), consumo: 1 });
    await estadoDosTokens(db, "org-1", AGORA);
    expect(chamadas).toEqual([
      {
        nome: "fn_tokens_de_ia_no_periodo",
        args: { p_org: "org-1", p_from: "2026-10-09T22:00:00.000Z", p_to: "2026-11-09T22:00:00.000Z" },
      },
    ]);
  });

  it("o banco recusar a soma lança — quem chama decide, e nada vira zero em silêncio", async () => {
    const { db } = banco({ assinatura: assinatura(SIMPLES), erroNaSoma: true });
    await expect(estadoDosTokens(db, "org-1", AGORA)).rejects.toThrow(/banco fora/);
  });
});
