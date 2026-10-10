/**
 * SonghaiCRM — o aviso de tokens de IA aos 80% e aos 100% (lib/billing/executar.ts).
 *
 * «Quando o limite terminar, eu devo receber uma notificação e o cliente também; e
 * a 80% deve informar.» Cada caso é uma situação dessa frase.
 */
import { describe, expect, it } from "vitest";

import { vigiarTokens, type DependenciasDaRodada, type ResumoDaRodada } from "@/lib/billing/executar";

type Linha = Record<string, unknown>;

const SONGHAI = "11111111-1111-4111-8111-111111111111";
const CLINICA = "22222222-2222-4222-8222-222222222222";
const LOJA = "33333333-3333-4333-8333-333333333333";

interface Mundo {
  consumo: Record<string, number>;
  alertas: Linha[];
  emails: Array<{ para: string[]; assunto: string }>;
  auditoria: Array<{ action: string; organizationId: string; metadata?: Record<string, unknown> }>;
  orgs: Linha[];
  subs: Linha[];
  extras: Linha[];
  semAdmins?: boolean;
  semFornecedor?: boolean;
  falhaEm?: string;
  agora: Date;
}

const sub = (org: string, limits: Linha, sobre: Linha = {}): Linha => ({
  organization_id: org,
  started_at: "2026-10-10T06:00:00Z",
  billing_anchor: "2026-10-10",
  ai_tokens_override: null,
  plan: { limits },
  ...sobre,
});

function mundo(sobre: Partial<Mundo> = {}): Mundo {
  return {
    consumo: { [CLINICA]: 0, [LOJA]: 0 },
    alertas: [],
    emails: [],
    auditoria: [],
    orgs: [
      { id: SONGHAI, status: "active", display_name: "Songhai" },
      { id: CLINICA, status: "active", display_name: "Clínica Sol" },
      { id: LOJA, status: "active", display_name: "Loja Mar" },
    ],
    subs: [
      sub(CLINICA, { max_whatsapp_connections: 1, ai_tokens_per_account: 100_000 }),
      sub(LOJA, { max_whatsapp_connections: 1, ai_tokens_per_account: 100_000 }),
    ],
    extras: [],
    agora: new Date("2026-10-20T08:00:00+02:00"),
    ...sobre,
  };
}

function db(m: Mundo) {
  return {
    from(tabela: string) {
      let orgDoFiltro: string | null = null;
      let ids: string[] | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: string) => (c === "organization_id" && (orgDoFiltro = v), b),
        is: () => b,
        in: (_c: string, v: string[]) => ((ids = v), b),
        upsert: (linha: Linha) => {
          const existe = m.alertas.some(
            (a) => a.organization_id === linha.organization_id && a.window_start === linha.window_start && a.level === linha.level,
          );
          if (!existe) m.alertas.push(linha);
          return { select: async () => ({ data: existe ? [] : [{ id: "novo" }], error: null }) };
        },
        maybeSingle: async () => ({
          data: tabela === "organization_subscriptions" ? (m.subs.find((s) => s.organization_id === orgDoFiltro) ?? null) : null,
          error: null,
        }),
        then: (ok: (v: unknown) => unknown) => {
          let data: Linha[] = [];
          if (tabela === "organization_subscriptions") data = m.subs.map((s) => ({ organization_id: s.organization_id }));
          if (tabela === "organizations") data = m.orgs.filter((o) => ids?.includes(o.id as string));
          if (tabela === "subscription_items") data = m.extras.filter((e) => e.organization_id === orgDoFiltro);
          return Promise.resolve({ data, error: null }).then(ok);
        },
      };
      return b;
    },
    rpc: async (_nome: string, a: { p_org: string }) =>
      m.falhaEm === a.p_org ? { data: null, error: { message: "banco fora" } } : { data: m.consumo[a.p_org] ?? 0, error: null },
  } as never;
}

function deps(m: Mundo): DependenciasDaRodada {
  return {
    db: db(m),
    cfg: { organizationId: SONGHAI, ativaDesde: "2026-10-01", instrucoesDeTransferencia: null, emailsDoFornecedor: [] },
    agora: m.agora,
    gateway: null,
    emailsDosAdmins: async () => (m.semAdmins ? [] : ["dono@cliente.co.mz"]),
    emailsDoFornecedor: m.semFornecedor ? undefined : async () => ["phill@songhai.cc"],
    enviarEmail: async (para, msg) => (m.emails.push({ para, assunto: msg.assunto }), true),
    suporte: null,
    auditar: (e) => void m.auditoria.push(e),
  };
}

const ZERO: ResumoDaRodada = { emitidas: 0, links: 0, pagas: 0, lembretes: 0, avisos: 0, suspensas: 0, reativadas: 0, avisosDeTokens: 0, erros: 0 };
const correr = async (m: Mundo) => {
  const resumo = { ...ZERO };
  await vigiarTokens(deps(m), resumo);
  return resumo;
};

describe("aos 80%: informa o cliente e o fornecedor", () => {
  it("abaixo de 80% não diz nada", async () => {
    const m = mundo({ consumo: { [CLINICA]: 79_999 } });
    expect((await correr(m)).avisosDeTokens).toBe(0);
    expect(m.emails).toHaveLength(0);
    expect(m.alertas).toHaveLength(0);
  });

  it("a 85%: um e-mail ao cliente e outro ao fornecedor, com os números", async () => {
    const m = mundo({ consumo: { [CLINICA]: 85_000 } });
    expect((await correr(m)).avisosDeTokens).toBe(1);

    const cliente = m.emails.find((e) => e.para.includes("dono@cliente.co.mz"))!;
    const fornecedor = m.emails.find((e) => e.para.includes("phill@songhai.cc"))!;
    expect(cliente.assunto).toBe("Consumo de IA a 85% do limite deste período");
    expect(fornecedor.assunto).toBe("Clínica Sol: tokens de IA a 85%");
    expect(m.emails).toHaveLength(2);
    expect(m.alertas).toHaveLength(1);
    expect(m.auditoria).toEqual([expect.objectContaining({ action: "billing.tokens_alert", organizationId: CLINICA, metadata: expect.objectContaining({ level: 80, consumed_tokens: 85_000, quota_tokens: 100_000 }) })]);
  });

  it("só uma vez por período, por muitas rodadas que corram", async () => {
    const m = mundo({ consumo: { [CLINICA]: 85_000 } });
    for (let i = 0; i < 5; i++) await correr(m);
    expect(m.emails).toHaveLength(2);
    expect(m.alertas).toHaveLength(1);
  });
});

describe("ao chegar ao limite: informa de novo", () => {
  it("passa de 80 a 100: o aviso do limite sai, e o de 80 não se repete", async () => {
    const m = mundo({ consumo: { [CLINICA]: 85_000 } });
    await correr(m);
    m.emails.length = 0;

    m.consumo[CLINICA] = 100_000;
    expect((await correr(m)).avisosDeTokens).toBe(1);
    expect(m.emails.map((e) => e.assunto).sort()).toEqual(["Clínica Sol: limite de tokens de IA atingido", "Limite de tokens de IA atingido"]);
    expect(m.alertas.map((a) => a.level)).toEqual([80, 100]);
  });

  it("salto de 50% para 120% numa hora: os dois níveis ficam registados, mas só UMA mensagem (a do limite)", async () => {
    const m = mundo({ consumo: { [CLINICA]: 120_000 } });
    expect((await correr(m)).avisosDeTokens).toBe(1);
    expect(m.alertas.map((a) => a.level)).toEqual([80, 100]);
    expect(m.emails.filter((e) => e.para.includes("dono@cliente.co.mz"))).toHaveLength(1);
    expect(m.emails.find((e) => e.para.includes("dono@cliente.co.mz"))!.assunto).toBe("Limite de tokens de IA atingido");
    // e na rodada seguinte, nada de novo
    m.emails.length = 0;
    await correr(m);
    expect(m.emails).toHaveLength(0);
  });
});

describe("renovação: a quota recomeça com a conta", () => {
  it("no ciclo seguinte volta a avisar, porque o período é outro", async () => {
    const m = mundo({ consumo: { [CLINICA]: 90_000 } });
    await correr(m);
    expect(m.alertas).toHaveLength(1);

    // dia 10 de Novembro: a conta renovou, a janela mudou; o consumo do novo período volta a subir
    m.agora = new Date("2026-11-25T08:00:00+02:00");
    m.consumo[CLINICA] = 90_000;
    await correr(m);
    expect(m.alertas).toHaveLength(2);
    expect(m.alertas[1]!.window_start).toBe("2026-11-10");
    expect(m.emails.filter((e) => e.para.includes("dono@cliente.co.mz"))).toHaveLength(2);
  });
});

describe("quem NÃO é avisado", () => {
  it("pacote sem tokens definidos: sem limite, sem aviso, por muito que gaste", async () => {
    const m = mundo({
      subs: [sub(CLINICA, { max_whatsapp_connections: 1 })],
      consumo: { [CLINICA]: 99_000_000 },
    });
    expect((await correr(m)).avisosDeTokens).toBe(0);
  });

  it("um número de WhatsApp a mais sobe a quota: o mesmo consumo deixa de ser aviso", async () => {
    const m = mundo({
      consumo: { [CLINICA]: 85_000 },
      extras: [{ organization_id: CLINICA, quantity: 1, adds_whatsapp_connections: 1, adds_users: 0, started_on: "2026-10-15", ended_on: null }],
    });
    expect((await correr(m)).avisosDeTokens).toBe(0);
  });

  it("a quota acordada com o cliente vence a do pacote", async () => {
    const m = mundo({
      subs: [sub(CLINICA, { max_whatsapp_connections: 1, ai_tokens_per_account: 100_000 }, { ai_tokens_override: 20_000 })],
      consumo: { [CLINICA]: 20_000 },
    });
    await correr(m);
    expect(m.alertas.map((a) => a.level)).toEqual([80, 100]);
  });

  it("organização anonimizada ou encerrada não é avisada; a que recebe também não", async () => {
    const m = mundo({ consumo: { [CLINICA]: 99_000, [LOJA]: 99_000 } });
    m.orgs[1]!.status = "redacted";
    m.orgs[2]!.status = "archived";
    m.subs.push(sub(SONGHAI, { ai_tokens_per_account: 1 }));
    m.consumo[SONGHAI] = 999;
    expect((await correr(m)).avisosDeTokens).toBe(0);
  });

  it("uma conta suspensa por dívida continua a ser medida (continua a gastar)", async () => {
    const m = mundo({ consumo: { [CLINICA]: 85_000 } });
    m.orgs[1]!.status = "suspended";
    expect((await correr(m)).avisosDeTokens).toBe(1);
  });
});

describe("quando algo falta ou falha", () => {
  it("sem e-mail de administrador no cliente, o fornecedor é avisado na mesma", async () => {
    const m = mundo({ consumo: { [CLINICA]: 85_000 }, semAdmins: true });
    await correr(m);
    expect(m.emails.map((e) => e.para)).toEqual([["phill@songhai.cc"]]);
  });

  it("sem destinatário do fornecedor, só o cliente é avisado", async () => {
    const m = mundo({ consumo: { [CLINICA]: 85_000 }, semFornecedor: true });
    await correr(m);
    expect(m.emails.map((e) => e.para)).toEqual([["dono@cliente.co.mz"]]);
  });

  it("medir um cliente falhar não impede os outros, e conta como erro", async () => {
    const m = mundo({ consumo: { [LOJA]: 90_000 }, falhaEm: CLINICA });
    const r = await correr(m);
    expect(r.erros).toBe(1);
    expect(r.avisosDeTokens).toBe(1);
    expect(m.auditoria[0]!.organizationId).toBe(LOJA);
  });

  it("cada cliente é medido pela SUA organização: o consumo de um não aparece no outro", async () => {
    const m = mundo({ consumo: { [CLINICA]: 95_000, [LOJA]: 10_000 } });
    await correr(m);
    expect(m.alertas.map((a) => a.organization_id)).toEqual([CLINICA]);
  });
});
