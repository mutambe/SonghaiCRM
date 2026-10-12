/**
 * SonghaiCRM — o aviso de caso também por e-mail (lib/escalacao/aviso-por-email.ts).
 *
 * Canal adicional e independente do aviso no WhatsApp. Cada caso é uma situação em
 * que o e-mail deve sair, ou deve ficar quieto.
 */
import { describe, expect, it, vi } from "vitest";

import type { CasoDoAviso } from "@/lib/escalacao/aviso-ao-suporte";
import {
  ADIAMENTO_DO_DRENO_EM_REQUEST_MS,
  ADIAMENTO_DO_EMAIL_MS,
  aplicaAvisoPorEmail,
  type AvisoPorEmailDeps,
  type ConfigDoAvisoPorEmail,
} from "@/lib/escalacao/aviso-por-email";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG = "org-1";
const CASO = "caso-1";
const AGORA = new Date("2026-10-20T10:00:00Z");

const evento = (sobre: Partial<EventRow> = {}): EventRow => ({
  id: "ev-1",
  organization_id: ORG,
  event_type: "ai.case_opened",
  entity_kind: "agent_case",
  entity_id: CASO,
  payload: { case_id: CASO, contact_id: "contato-1" },
  metadata: {},
  consumed_by: [],
  attempts: 0,
  created_at: new Date(AGORA.getTime() - 60_000).toISOString(),
  ...sobre,
});

const caso = (sobre: Partial<CasoDoAviso> = {}): CasoDoAviso => ({
  id: CASO,
  organization_id: ORG,
  conversation_id: "conv-1",
  kind: "payment",
  source: "agent",
  status: "awaiting_human",
  title: "Desconto acima da política",
  summary: "O cliente pede 15% de desconto no plano anual",
  blocker: "a política permite até 10%",
  ...sobre,
});

interface Mundo {
  config: ConfigDoAvisoPorEmail | null;
  caso: CasoDoAviso | null;
  anonimizado: boolean;
  enviados: Array<{ para: string[]; assunto: string; texto: string; html: string }>;
  auditoria: Array<Record<string, unknown>>;
  saiu: boolean | "lanca";
  origem: "worker" | "request";
  url: string | null;
  leituras: string[];
}

function mundo(sobre: Partial<Mundo> = {}): Mundo {
  return {
    config: { organization_id: ORG, emails: ["phill@songhai.cc", "gestor@songhai.cc"], ligado: true },
    caso: caso(),
    anonimizado: false,
    enviados: [],
    auditoria: [],
    saiu: true,
    origem: "worker",
    url: "https://crm.songhai.cc",
    leituras: [],
    ...sobre,
  };
}

function deps(m: Mundo): AvisoPorEmailDeps {
  return {
    db: {
      carregaConfigEmail: async () => (m.leituras.push("config"), m.config),
      carregaCaso: async () => (m.leituras.push("caso"), m.caso),
      contatoAnonimizado: async () => m.anonimizado,
      nomeDoContato: async () => "Maria Silva",
      marcaDaOrganizacao: async () => ({ nome: "Songhai", idioma: "pt-MZ" as never }),
    },
    enviarEmail: async (para, msg) => {
      if (m.saiu === "lanca") throw new Error("smtp fora");
      m.enviados.push({ para, ...msg });
      return m.saiu;
    },
    clock: () => AGORA,
    urlPublica: m.url,
    origemDoDreno: () => m.origem,
    audita: (e) => void m.auditoria.push(e),
  };
}

describe("quando o e-mail sai", () => {
  it("caso aberto pela IA: um e-mail para TODA a lista, com o assunto e o link do caso", async () => {
    const m = mundo();
    const r = await aplicaAvisoPorEmail(deps(m), evento());

    expect(r).toEqual({ status: "ok", detail: "para=2" });
    expect(m.enviados).toHaveLength(1);
    expect(m.enviados[0]!.para).toEqual(["phill@songhai.cc", "gestor@songhai.cc"]);
    expect(m.enviados[0]!.assunto).toBe("Songhai: novo caso à espera de uma pessoa");
    expect(m.enviados[0]!.texto).toContain("https://crm.songhai.cc/app/ai/cases?caso=caso-1");
    expect(m.enviados[0]!.texto).toContain("Desconto acima da política");
  });

  it("só o PRIMEIRO nome do cliente vai no e-mail", async () => {
    const m = mundo();
    await aplicaAvisoPorEmail(deps(m), evento());
    expect(m.enviados[0]!.texto).toContain("Maria");
    expect(m.enviados[0]!.texto).not.toContain("Silva");
  });

  it("o HTML tem o link clicável e não deixa passar marcação escrita pelo cliente", async () => {
    const m = mundo({ caso: caso({ title: "<script>alert(1)</script>" }) });
    await aplicaAvisoPorEmail(deps(m), evento());
    expect(m.enviados[0]!.html).toContain('<a href="https://crm.songhai.cc/app/ai/cases?caso=caso-1">');
    expect(m.enviados[0]!.html).not.toContain("<script>");
  });

  it("audita o aviso (quantos destinatários) — sem os endereços", async () => {
    const m = mundo();
    await aplicaAvisoPorEmail(deps(m), evento());
    expect(m.auditoria).toEqual([{ organizationId: ORG, caseId: CASO, metadata: { destinatarios: 2 } }]);
  });

  it("aceita também o caso de origem 'guardrail_autofallback' e o que espera o cliente", async () => {
    const m = mundo({ caso: caso({ source: "guardrail_autofallback", status: "awaiting_lead" }) });
    expect((await aplicaAvisoPorEmail(deps(m), evento())).status).toBe("ok");
  });
});

describe("quando fica quieto", () => {
  it("organização que nunca ligou isto: uma leitura, zero rede — o caminho de quase todas", async () => {
    const m = mundo({ config: null });
    expect(await aplicaAvisoPorEmail(deps(m), evento())).toEqual({ status: "skipped", detail: "sem_configuracao" });
    expect(m.leituras).toEqual(["config"]);
    expect(m.enviados).toHaveLength(0);
  });

  it("desligado, ou ligado com a lista vazia", async () => {
    for (const c of [
      { organization_id: ORG, emails: ["a@x.cc"], ligado: false },
      { organization_id: ORG, emails: [], ligado: true },
    ]) {
      const m = mundo({ config: c });
      expect((await aplicaAvisoPorEmail(deps(m), evento())).detail).toBe("sem_configuracao");
      expect(m.enviados).toHaveLength(0);
    }
  });

  it("só o caso ABERTO avisa: o fecho, o payload sem caso e outros eventos são ignorados", async () => {
    const m = mundo();
    expect((await aplicaAvisoPorEmail(deps(m), evento({ event_type: "ai.case_closed" }))).detail).toBe("evento_ignorado");
    expect((await aplicaAvisoPorEmail(deps(m), evento({ payload: {} }))).detail).toBe("payload_incompleto");
    expect(m.enviados).toHaveLength(0);
  });

  it("caso que já não espera ninguém, de origem estranha ou inexistente não avisa", async () => {
    for (const [c, motivo] of [
      [caso({ status: "resolved" }), "caso_fechado:resolved"],
      [caso({ source: "manual" }), "origem_nao_aceita:manual"],
      [null, "caso_inexistente"],
    ] as const) {
      const m = mundo({ caso: c });
      expect((await aplicaAvisoPorEmail(deps(m), evento())).detail).toBe(motivo);
      expect(m.enviados).toHaveLength(0);
    }
  });

  it("evento com mais de 30 minutos é ruído: não avisa", async () => {
    const m = mundo();
    const velho = evento({ created_at: new Date(AGORA.getTime() - 31 * 60_000).toISOString() });
    expect((await aplicaAvisoPorEmail(deps(m), velho)).detail).toBe("evento_velho");
    expect(m.enviados).toHaveLength(0);
  });

  it("o titular que pediu para ser esquecido não é avisado", async () => {
    const m = mundo({ anonimizado: true });
    expect((await aplicaAvisoPorEmail(deps(m), evento())).detail).toBe("titular_anonimizado");
    expect(m.enviados).toHaveLength(0);
  });

  it("sem endereço público utilizável o link não abriria noutro computador: não avisa", async () => {
    for (const url of [null, "https://placeholder.invalid", "http://localhost:3000"]) {
      const m = mundo({ url });
      expect((await aplicaAvisoPorEmail(deps(m), evento())).detail, String(url)).toBe("sem_endereco_publico");
      expect(m.enviados).toHaveLength(0);
    }
  });
});

describe("quando adia", () => {
  it("dreno dentro de uma requisição HTTP não toca a rede: adia 15 s", async () => {
    const m = mundo({ origem: "request" });
    const r = await aplicaAvisoPorEmail(deps(m), evento());
    expect(r.status).toBe("retry");
    expect(Date.parse(r.retry_at!) - AGORA.getTime()).toBe(ADIAMENTO_DO_DRENO_EM_REQUEST_MS);
    expect(m.enviados).toHaveLength(0);
  });

  it("e-mail que não saiu volta a tentar daí a 5 minutos — nunca 'error', que mataria o evento", async () => {
    const m = mundo({ saiu: false });
    const r = await aplicaAvisoPorEmail(deps(m), evento());
    expect(r.status).toBe("retry");
    expect(Date.parse(r.retry_at!) - AGORA.getTime()).toBe(ADIAMENTO_DO_EMAIL_MS);
    expect(m.auditoria).toHaveLength(0);
  });

  it("o transporte lançar também é 'não saiu'", async () => {
    const m = mundo({ saiu: "lanca" });
    const r = await aplicaAvisoPorEmail(deps(m), evento());
    expect(r.status).toBe("retry");
  });

  it("a insistência acaba sozinha: passados 30 minutos o evento é velho e o e-mail desiste", async () => {
    const m = mundo({ saiu: false });
    const e = evento({ created_at: new Date(AGORA.getTime() - 29 * 60_000).toISOString() });
    expect((await aplicaAvisoPorEmail(deps(m), e)).status).toBe("retry");
    const tarde = evento({ created_at: new Date(AGORA.getTime() - 31 * 60_000).toISOString() });
    expect((await aplicaAvisoPorEmail(deps(m), tarde)).status).toBe("skipped");
  });
});

describe("o canal é independente do WhatsApp", () => {
  it("o módulo não importa nada do transporte do WhatsApp nem da ingestão de mensagens", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("lib/escalacao/aviso-por-email.ts", "utf8");
    expect(fonte).not.toMatch(/numero-interno-de-aviso|lib\/channels|TransporteDoAviso|pacing/);
  });

  it("o consumidor está classificado como 'pula' numa organização parada", async () => {
    const { avisoDeCasoPorEmailHandler } = await import("@/lib/escalacao/aviso-por-email.handler");
    expect(avisoDeCasoPorEmailHandler.naOrgParada).toBe("pula");
    expect(avisoDeCasoPorEmailHandler.events).toEqual(["ai.case_opened"]);
  });
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
