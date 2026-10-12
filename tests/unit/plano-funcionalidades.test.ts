/**
 * SonghaiCRM — as funcionalidades de cada pacote (migration 9008).
 *
 * O medo que esta suíte responde: "quem contrata um pacote menor continua a ver
 * e a usar o que não pagou?". Três camadas — a regra pura, o guarda real
 * (`requireRole` e as outras portas de autenticação) e a COBERTURA: nenhuma
 * rota de uma funcionalidade fica sem guarda, que é como um plano furado nasce.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recusaDoPlanoDaRota } from "@/lib/plans/guarda-da-rota";
import { TOOLS_AGENDAMENTO } from "@/lib/mcp/tools/catalogo/agendamento";
import { TOOLS_FUNIL } from "@/lib/mcp/tools/catalogo/funil";
import { NAV_CATALOG, type NavMetadata } from "@/lib/navigation/catalogo";
import { capacidadesLigadas } from "@/lib/organizacao/capacidades";
import {
  FUNCIONALIDADES_DO_PLANO,
  ROTAS_POR_FUNCIONALIDADE,
  ehFuncionalidadeDoPlano,
  funcionalidadeDaRotaApi,
  funcionalidadesDaOrganizacao,
  funcionalidadesDosLimites,
} from "@/lib/plans/funcionalidades";

const estado = vi.hoisted(() => ({ pathname: null as string | null, features: [] as unknown[] }));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => (k === "x-pathname" ? estado.pathname : null) }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({
              data: { plan: { limits: { features: estado.features } } },
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));

const raiz = process.cwd();

describe("a regra do pacote", () => {
  it("features ausente = todas (Enterprise) e [] = nenhuma", () => {
    expect(funcionalidadesDosLimites({})).toEqual(FUNCIONALIDADES_DO_PLANO);
    expect(funcionalidadesDosLimites(null)).toEqual(FUNCIONALIDADES_DO_PLANO);
    expect(funcionalidadesDosLimites({ features: "agenda" })).toEqual(FUNCIONALIDADES_DO_PLANO);
    expect(funcionalidadesDosLimites({ features: [] })).toEqual([]);
  });

  it("nome desconhecido no banco é ignorado, nunca vira permissão", () => {
    expect(funcionalidadesDosLimites({ features: ["agenda", "voo_espacial", 7] })).toEqual(["agenda"]);
    expect(ehFuncionalidadeDoPlano("voo_espacial")).toBe(false);
  });

  it("o plano entra no canal das capacidades; omitido, a função responde só pela empresa", () => {
    expect(capacidadesLigadas({}, [], [])).toEqual([]);
    expect(capacidadesLigadas({}, [], ["agenda"])).toEqual(["agenda"]);
    expect(capacidadesLigadas({ proposals: { enabled: true } }, ["propostas"], ["crm"])).toEqual(["propostas", "crm"]);
    expect(capacidadesLigadas({}, [])).toEqual([]);
  });
});

describe("o mapa de rotas", () => {
  it("cada rota casa a funcionalidade certa, por segmento", () => {
    expect(funcionalidadeDaRotaApi("/api/v1/agenda/agendamentos/x")).toBe("agenda");
    expect(funcionalidadeDaRotaApi("/api/v1/leads")).toBe("crm");
    expect(funcionalidadeDaRotaApi("/api/v1/reports/tags")).toBe("relatorios");
    expect(funcionalidadeDaRotaApi("/api/v1/metrics/lost")).toBe("analytics");
    expect(funcionalidadeDaRotaApi("/api/v1/integrations/paysuite")).toBe("mpesa");
    expect(funcionalidadeDaRotaApi("/api/v1/leads-extra")).toBeNull();
  });

  it("a ENTRADA do WhatsApp e o atendimento nunca são de nenhuma funcionalidade", () => {
    for (const caminho of [
      "/api/v1/webhooks/waha",
      "/api/v1/webhooks/waha/tok",
      "/api/v1/webhooks/meta/tok",
      "/api/v1/webhooks/channel/tok",
      "/api/v1/webhooks/payments/paysuite/tok",
      "/api/v1/messages",
      "/api/v1/conversations",
      "/api/v1/contacts",
      "/api/v1/channel-sessions",
    ]) {
      expect(funcionalidadeDaRotaApi(caminho), caminho).toBeNull();
    }
  });

  it("nenhum prefixo pertence a duas funcionalidades", () => {
    const todos = FUNCIONALIDADES_DO_PLANO.flatMap((f) => ROTAS_POR_FUNCIONALIDADE[f]);
    expect(new Set(todos).size).toBe(todos.length);
  });
});

describe("o guarda real", () => {
  beforeEach(() => {
    estado.pathname = null;
    estado.features = [];
  });

  it("pacote Simples: a agenda é recusada com 403 plan_feature_required e a mensagem do pacote", async () => {
    estado.pathname = "/api/v1/agenda/tipos";
    const r = await recusaDoPlanoDaRota("org-1", "req-1");
    expect(r?.status).toBe(403);
    const corpo = await r!.json();
    expect(corpo.error.code).toBe("plan_feature_required");
    expect(corpo.error.message).toContain("Agente Médio");
    expect(corpo.error.details).toEqual({ feature: "agenda" });
  });

  it("o pacote que inclui a agenda deixa passar", async () => {
    estado.features = ["agenda"];
    estado.pathname = "/api/v1/agenda/tipos";
    expect(await recusaDoPlanoDaRota("org-1")).toBeNull();
  });

  it("rota do pacote básico nunca é recusada, mesmo com plano vazio", async () => {
    estado.pathname = "/api/v1/conversations";
    expect(await recusaDoPlanoDaRota("org-1")).toBeNull();
    estado.pathname = "/api/v1/webhooks/waha";
    expect(await recusaDoPlanoDaRota("org-1")).toBeNull();
  });

  it("fora de uma requisição (sem cabeçalho) não consulta o plano", async () => {
    estado.pathname = null;
    expect(await recusaDoPlanoDaRota("org-1")).toBeNull();
  });

  it("falha ao ler o plano falha ABERTO: devolve todas", async () => {
    const quebrado = {
      from: () => {
        throw new Error("banco fora");
      },
    };
    expect(await funcionalidadesDaOrganizacao(quebrado as never, "org-1")).toEqual(FUNCIONALIDADES_DO_PLANO);
  });
});

/** Rotas de funcionalidade SEM guarda próprio, e por quê. */
const SEM_GUARDA_PROPRIO: Record<string, string> = {
  "app/api/v1/agenda/google/callback/route.ts": "retorno do OAuth do Google: a organização vem do estado assinado",
  "app/api/v1/integrations/nuvemshop/callback/route.ts": "retorno do OAuth da Nuvemshop (módulo brasileiro, desligado)",
  "app/api/v1/extensions/catalogs/route.ts": "extensões são da INSTALAÇÃO (administrador do servidor)",
  "app/api/v1/extensions/install/route.ts": "idem: instalar pacote é da instalação",
  "app/api/v1/extensions/operations/[id]/cancel/route.ts": "idem",
  "app/api/v1/extensions/[id]/remove/route.ts": "idem",
  "app/api/v1/extensions/[id]/revert/route.ts": "idem",
};
/** Delegam a um arquivo irmão que já tem o guarda. */
const DELEGAM = [
  "app/api/v1/agenda/agendamentos/[id]/google/meet/deliver/route.ts",
  "app/api/v1/agenda/agendamentos/[id]/google/meet/resend/route.ts",
  "app/api/v1/agenda/agendamentos/[id]/google/meet/retry/route.ts",
  "app/api/v1/agenda/agendamentos/[id]/google/retry/route.ts",
];
const GUARDAS = ["requireRole(", "orgAtivaDaApi(", "resolveAuthDual(", "recusaDoPlanoDaRota("];

function rotasSob(dir: string): string[] {
  const saida: string[] = [];
  const andar = (d: string) => {
    for (const nome of readdirSync(d)) {
      const caminho = join(d, nome);
      if (statSync(caminho).isDirectory()) andar(caminho);
      else if (nome === "route.ts") saida.push(relative(raiz, caminho).replaceAll("\\", "/"));
    }
  };
  try {
    andar(join(raiz, dir));
  } catch {
    /* prefixo sem pasta */
  }
  return saida;
}

describe("cobertura: nenhuma rota de funcionalidade sem guarda", () => {
  const rotas = FUNCIONALIDADES_DO_PLANO.flatMap((f) =>
    ROTAS_POR_FUNCIONALIDADE[f].flatMap((p) => rotasSob(p.replace("/api/", "app/api/"))),
  );

  it("há rotas para varrer (a varredura não está cega)", () => {
    expect(rotas.length).toBeGreaterThan(40);
  });

  it.each(rotas)("%s", (rota) => {
    if (rota in SEM_GUARDA_PROPRIO || DELEGAM.includes(rota)) return;
    const fonte = readFileSync(join(raiz, rota), "utf8");
    expect(
      GUARDAS.some((g) => fonte.includes(g)),
      `${rota} não chama nenhum guarda de organização`,
    ).toBe(true);
  });

  it("as exceções declaradas continuam a existir (a lista não apodrece)", () => {
    for (const rota of [...Object.keys(SEM_GUARDA_PROPRIO), ...DELEGAM]) {
      expect(rotas, rota).toContain(rota);
    }
  });

  it("as que delegam, delegam a quem tem guarda", () => {
    for (const f of [
      "app/api/v1/agenda/agendamentos/[id]/google/meet/_action.ts",
      "app/api/v1/agenda/agendamentos/[id]/google/resolver/route.ts",
    ]) {
      expect(readFileSync(join(raiz, f), "utf8")).toContain("requireRole(");
    }
  });
});

describe("o pacote no menu e no agente", () => {
  it("as portas de agenda, CRM, relatórios, analytics, integrações e M-Pesa declaram a funcionalidade", () => {
    const porHref = (h: string) => (NAV_CATALOG as readonly NavMetadata[]).find((d) => d.href === h)?.capacidade;
    expect(porHref("/app/agenda")).toBe("agenda");
    expect(porHref("/app/kanban")).toBe("crm");
    expect(porHref("/app/activities")).toBe("relatorios");
    expect(porHref("/app/metrics")).toBe("analytics");
    expect(porHref("/app/webhooks")).toBe("integracoes");
    expect(porHref("/app/integrations/paysuite")).toBe("mpesa");
  });

  it("o Inbox, os contatos e as conexões — o pacote básico — nunca são do plano", () => {
    for (const h of ["/app/inbox", "/app/contacts", "/app/connections", "/app/ai/agents"]) {
      expect(ehFuncionalidadeDoPlano((NAV_CATALOG as readonly NavMetadata[]).find((d) => d.href === h)?.capacidade), h).toBe(false);
    }
  });

  it("toda ferramenta de agenda e de funil do agente é de uma funcionalidade", () => {
    for (const t of TOOLS_AGENDAMENTO) expect(t.capacidade, t.name).toBe("agenda");
    for (const t of TOOLS_FUNIL) expect(ehFuncionalidadeDoPlano(t.capacidade), t.name).toBe(true);
  });
});

describe("o banco diz o mesmo que o código", () => {
  const migration = readFileSync(
    join(raiz, "supabase/migrations/20261008120000_9008_funcionalidades_por_plano.sql"),
    "utf8",
  );
  const songhai = readFileSync(join(raiz, "supabase/songhai.sql"), "utf8");

  it("a migration tem a descrição no cabeçalho e o bloco está no songhai.sql antes da varredura", () => {
    expect(migration.split("\n")[0]).toMatch(/^-- manifest: /);
    const bloco = songhai.indexOf("(migration 9008)");
    expect(bloco).toBeGreaterThan(0);
    expect(bloco).toBeLessThan(songhai.indexOf("VARREDURA anon"));
  });

  it("só preenche onde a chave ainda não existe (não desfaz edição do admin)", () => {
    expect(migration.match(/not \(limits \? 'features'\)/g)).toHaveLength(3);
  });

  it("Simples não traz nada extra; Médio traz agenda sem M-Pesa; Avançado traz M-Pesa; Enterprise fica sem a chave", () => {
    expect(migration).toMatch(/jsonb_build_object\('features', '\[\]'::jsonb\)\s+where slug = 'agente_simples'/);
    const medio = migration.slice(migration.indexOf("'agente_medio'") - 220, migration.indexOf("'agente_medio'"));
    expect(medio).toContain('"agenda"');
    expect(medio).not.toContain('"mpesa"');
    const avancado = migration.slice(
      migration.indexOf("'agente_avancado'") - 260,
      migration.indexOf("'agente_avancado'"),
    );
    expect(avancado).toContain('"mpesa"');
    expect(migration).not.toMatch(/where slug = 'enterprise'/);
  });

  it("todo nome de funcionalidade no SQL existe no código", () => {
    const nomes = [...migration.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(nomes.length).toBeGreaterThan(5);
    for (const n of nomes) expect(ehFuncionalidadeDoPlano(n), n).toBe(true);
  });
});
