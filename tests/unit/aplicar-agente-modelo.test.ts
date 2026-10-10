/**
 * SonghaiCRM — aplicar um agente-modelo a um cliente (Fase B da spec 19).
 *
 * A pergunta que esta suíte responde: a cópia leva o que é do MODELO e deixa
 * para trás tudo o que é de OUTRA organização? Um banco falso em memória faz as
 * leituras e as escritas de verdade, e os casos olham o que foi gravado.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { aplicarAgenteModelo, ITENS_A_CONFIGURAR } from "@/lib/ai/agents/aplicar-modelo";

type Linha = Record<string, unknown>;
interface Tabelas {
  ai_agents: Linha[];
  ai_agent_versions: Linha[];
  channel_sessions: Linha[];
  ai_provider_credentials: Linha[];
  [outra: string]: Linha[];
}

/** Mínimo de PostgREST: select/eq/is/order/limit, insert, update, maybeSingle/single. */
function bancoFalso(tabelas: Tabelas, falhaEm?: string) {
  let seq = 0;
  const consulta = (nome: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let ordem: { col: string; asc: boolean } | null = null;
    let modo: "select" | "insert" | "update" = "select";
    let valores: Linha = {};
    const executar = () => {
      const t = (tabelas[nome] ??= []) as Linha[];
      if (modo === "insert") {
        if (falhaEm === nome) return { data: null, error: { message: `falha em ${nome}` } };
        const l = { id: `${nome}-${++seq}`, ...valores };
        t.push(l);
        return { data: [l], error: null };
      }
      let achadas = t.filter((l) => filtros.every((f) => f(l)));
      if (modo === "update") {
        for (const l of achadas) Object.assign(l, valores);
        return { data: achadas, error: null };
      }
      if (ordem) {
        const { col, asc } = ordem;
        achadas = [...achadas].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      return { data: achadas, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (v: Linha) => ((modo = "insert"), (valores = v), b),
      update: (v: Linha) => ((modo = "update"), (valores = v), b),
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), b),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), b),
      not: (c: string, _op: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) !== v), b),
      order: (col: string, o?: { ascending?: boolean }) => ((ordem = { col, asc: o?.ascending ?? true }), b),
      maybeSingle: async () => {
        const r = executar();
        return { data: (r.data as Linha[] | null)?.[0] ?? null, error: r.error };
      },
      single: async () => {
        const r = executar();
        return { data: (r.data as Linha[] | null)?.[0] ?? null, error: r.error };
      },
      then: (ok: (v: unknown) => unknown) => Promise.resolve(executar()).then(ok),
    };
    return b;
  };
  return { from: consulta } as never;
}

const MODELOS = "org-modelos";
const CLIENTE = "org-cliente";
const ATOR = "user-operador";

function cenario(sobre: { versao?: Linha; agente?: Linha; sessoes?: Linha[]; credenciais?: Linha[] } = {}) {
  const tabelas: Tabelas = {
    ai_agents: [
      {
        id: "ag-modelo",
        organization_id: MODELOS,
        name: "Clínica — recepção",
        description: "Modelo de clínica",
        kind: "mcp_agent",
        priority: 2,
        model: "anthropic/claude-haiku-5-5",
        system_prompt: "Você atende a clínica.",
        config: { temperature: 0.3 },
        guardrails: [],
        active_kb_version_id: "kb-do-modelo",
        published_version_id: "ver-modelo",
        archived_at: null,
        ...sobre.agente,
      },
    ],
    ai_agent_versions: [
      {
        id: "ver-modelo",
        organization_id: MODELOS,
        agent_id: "ag-modelo",
        version_number: 7,
        status: "published",
        system_prompt: "Você atende a clínica.",
        provider: "anthropic",
        model: "claude-haiku-5-5",
        effort: "medium",
        credential_id: "cred-do-modelo",
        tool_ids: ["crm_find_free_slots"],
        trigger_config: { events: ["message"] },
        channel_session_id: "sessao-do-modelo",
        max_steps: 10,
        token_budget: 50000,
        cost_budget_cents: 50,
        pipeline_ids: ["funil-do-modelo"],
        knowledge_source_ids: ["fonte-do-modelo"],
        followup: { enabled: true, flow_pointer_ids: ["fluxo-do-modelo"], callback_enabled: false },
        handoff_keywords: ["atendente"],
        ...sobre.versao,
      },
    ],
    ai_provider_credentials: sobre.credenciais ?? [],
    channel_sessions: sobre.sessoes ?? [
      { id: "sessao-cliente", organization_id: CLIENTE, status: "WORKING", created_at: "2026-10-01" },
    ],
  };
  return { tabelas, db: bancoFalso(tabelas) };
}

const aplicar = (db: never, over: Partial<Parameters<typeof aplicarAgenteModelo>[1]> = {}) =>
  aplicarAgenteModelo(db, {
    sourceOrgId: MODELOS,
    sourceAgentId: "ag-modelo",
    targetOrgId: CLIENTE,
    actorUserId: ATOR,
    ...over,
  });

describe("aplicar agente-modelo — o que atravessa e o que fica", () => {
  it("cria o agente NA ORGANIZAÇÃO DO CLIENTE, rascunho v1, com a origem registada", async () => {
    const { tabelas, db } = cenario();
    const r = await aplicar(db);
    expect(r.ok).toBe(true);

    const agente = tabelas.ai_agents.find((a) => a.organization_id === CLIENTE)!;
    expect(agente.name).toBe("Clínica — recepção");
    expect(agente.source_agent_id).toBe("ag-modelo");
    expect(agente.source_version_id).toBe("ver-modelo");
    expect(agente.created_by).toBe(ATOR);
    // fora do ar: nada publicado, não é o padrão do cliente
    expect(agente.published_version_id ?? null).toBeNull();
    expect(agente.is_default).toBe(false);

    const versao = tabelas.ai_agent_versions.find((v) => v.organization_id === CLIENTE)!;
    expect(versao.agent_id).toBe(agente.id);
    expect(versao.status).toBe("draft");
    expect(versao.version_number).toBe(1);
  });

  it("leva o conteúdo do modelo: prompt, ferramentas, orçamento, esforço, handoff", async () => {
    const { tabelas, db } = cenario();
    await aplicar(db);
    const v = tabelas.ai_agent_versions.find((x) => x.organization_id === CLIENTE)!;
    expect(v.system_prompt).toBe("Você atende a clínica.");
    expect(v.tool_ids).toEqual(["crm_find_free_slots"]);
    expect(v.effort).toBe("medium");
    expect(v.cost_budget_cents).toBe(50);
    expect(v.handoff_keywords).toEqual(["atendente"]);
  });

  it("NADA que seja do modelo atravessa: sessão, credencial, funis, conhecimento, follow-up", async () => {
    const { tabelas, db } = cenario();
    await aplicar(db);
    const v = tabelas.ai_agent_versions.find((x) => x.organization_id === CLIENTE)!;
    expect(v.channel_session_id).toBe("sessao-cliente");
    expect(v.credential_id).toBeNull();
    expect(v.pipeline_ids).toEqual([]);
    expect(v.knowledge_source_ids).toEqual([]);
    expect(v.followup).toEqual({ enabled: false, flow_pointer_ids: [], callback_enabled: false });
    const a = tabelas.ai_agents.find((x) => x.organization_id === CLIENTE)!;
    expect(a.active_kb_version_id).toBeNull();

    // varredura geral: nenhum id do modelo em nenhuma linha do cliente
    const doCliente = JSON.stringify([
      ...tabelas.ai_agents.filter((x) => x.organization_id === CLIENTE),
      ...tabelas.ai_agent_versions.filter((x) => x.organization_id === CLIENTE),
    ]);
    for (const idDoModelo of ["sessao-do-modelo", "cred-do-modelo", "funil-do-modelo", "fonte-do-modelo", "fluxo-do-modelo", "kb-do-modelo"]) {
      expect(doCliente, idDoModelo).not.toContain(idDoModelo);
    }
  });

  it("o modelo fica intacto", async () => {
    const { tabelas, db } = cenario();
    const antes = JSON.stringify([tabelas.ai_agents[0], tabelas.ai_agent_versions[0]]);
    await aplicar(db);
    expect(JSON.stringify([tabelas.ai_agents[0], tabelas.ai_agent_versions[0]])).toBe(antes);
  });

  it("o cliente SEM chave do provedor: a versão nasce sem credencial e a lista diz que falta", async () => {
    const { tabelas, db } = cenario();
    const r = await aplicar(db);
    expect(tabelas.ai_agent_versions.find((v) => v.organization_id === CLIENTE)!.credential_id).toBeNull();
    expect(r.ok && r.a_configurar).toEqual(["credencial_de_ia", ...ITENS_A_CONFIGURAR]);
  });

  it("o cliente COM chave activa e validada do provedor: liga a DELE e a lista não a pede", async () => {
    const { tabelas, db } = cenario({
      credenciais: [{ id: "cred-cliente", organization_id: CLIENTE, provider: "anthropic", is_active: true, validated_at: "2026-10-01", created_at: "2026-10-01" }],
    });
    const r = await aplicar(db);
    expect(tabelas.ai_agent_versions.find((v) => v.organization_id === CLIENTE)!.credential_id).toBe("cred-cliente");
    expect(r.ok && r.a_configurar).toEqual(ITENS_A_CONFIGURAR);
  });

  it("só serve a chave que publica: activa, validada, do provedor certo e do próprio cliente", async () => {
    const base = { provider: "anthropic", is_active: true, validated_at: "2026-10-01", created_at: "2026-10-01" };
    const { tabelas, db } = cenario({
      credenciais: [
        { id: "inactiva", organization_id: CLIENTE, ...base, is_active: false },
        { id: "nao-validada", organization_id: CLIENTE, ...base, validated_at: null },
        { id: "outro-provedor", organization_id: CLIENTE, ...base, provider: "openai" },
        { id: "de-outro-cliente", organization_id: "org-outro", ...base },
        { id: "do-modelo", organization_id: MODELOS, ...base },
      ],
    });
    const r = await aplicar(db);
    expect(tabelas.ai_agent_versions.find((v) => v.organization_id === CLIENTE)!.credential_id).toBeNull();
    expect(r.ok && r.a_configurar).toContain("credencial_de_ia");
  });

  it("com várias chaves boas, vale a mais recente", async () => {
    const base = { organization_id: CLIENTE, provider: "anthropic", is_active: true, validated_at: "2026-09-01" };
    const { tabelas, db } = cenario({
      credenciais: [
        { id: "velha", ...base, created_at: "2026-09-01" },
        { id: "nova", ...base, created_at: "2026-10-05" },
      ],
    });
    await aplicar(db);
    expect(tabelas.ai_agent_versions.find((v) => v.organization_id === CLIENTE)!.credential_id).toBe("nova");
  });

  it("nunca leva a chave do MODELO para dentro do cliente", async () => {
    const { tabelas, db } = cenario({
      credenciais: [{ id: "cred-do-modelo", organization_id: MODELOS, provider: "anthropic", is_active: true, validated_at: "2026-10-01", created_at: "2026-10-01" }],
    });
    await aplicar(db);
    expect(JSON.stringify(tabelas.ai_agent_versions.filter((v) => v.organization_id === CLIENTE))).not.toContain("cred-do-modelo");
  });
});

describe("aplicar agente-modelo — recusas", () => {
  it("o cliente sem WhatsApp ligado não recebe agente nenhum", async () => {
    const { tabelas, db } = cenario({ sessoes: [] });
    const r = await aplicar(db);
    expect(r).toEqual({ ok: false, error: "target_has_no_channel_session" });
    expect(tabelas.ai_agents.filter((a) => a.organization_id === CLIENTE)).toHaveLength(0);
  });

  it("a sessão que atende vence a que está a arrancar ou falhou", async () => {
    const { tabelas, db } = cenario({
      sessoes: [
        { id: "falhou", organization_id: CLIENTE, status: "FAILED", created_at: "2026-09-01" },
        { id: "a-arrancar", organization_id: CLIENTE, status: "STARTING", created_at: "2026-09-02" },
        { id: "a-trabalhar", organization_id: CLIENTE, status: "WORKING", created_at: "2026-09-03" },
        { id: "de-outro", organization_id: "org-outro", status: "WORKING", created_at: "2026-08-01" },
      ],
    });
    await aplicar(db);
    expect(tabelas.ai_agent_versions.find((v) => v.organization_id === CLIENTE)!.channel_session_id).toBe("a-trabalhar");
  });

  it("modelo sem versão publicada é recusado: rascunho nunca é modelo", async () => {
    const { tabelas, db } = cenario({ agente: { published_version_id: null } });
    expect(await aplicar(db)).toEqual({ ok: false, error: "source_not_published" });
    expect(tabelas.ai_agents.filter((a) => a.organization_id === CLIENTE)).toHaveLength(0);
  });

  it("versão publicada apontada por outra organização não conta", async () => {
    const { db } = cenario({ versao: { organization_id: "org-outro" } });
    expect(await aplicar(db)).toEqual({ ok: false, error: "source_not_published" });
  });

  it("o agente só vale na organização que o dono declarou", async () => {
    const { db } = cenario();
    expect(await aplicar(db, { sourceOrgId: "org-outro" })).toEqual({ ok: false, error: "source_not_found" });
  });

  it("agente arquivado não é modelo", async () => {
    const { db } = cenario({ agente: { archived_at: "2026-01-01" } });
    expect(await aplicar(db)).toEqual({ ok: false, error: "source_not_found" });
  });

  it("agente antigo de base de conhecimento não é modelo", async () => {
    const { db } = cenario({ agente: { kind: "rag_bot" } });
    expect(await aplicar(db)).toEqual({ ok: false, error: "unsupported_kind" });
  });

  it("copiar para a própria organização é recusado (para isso existe Duplicar)", async () => {
    const { db } = cenario();
    expect(await aplicar(db, { targetOrgId: MODELOS })).toEqual({ ok: false, error: "same_organization" });
  });

  it("se a versão não grava, o agente criado é arquivado (nada de casca)", async () => {
    const { tabelas } = cenario();
    const db = bancoFalso(tabelas, "ai_agent_versions");
    const r = await aplicar(db);
    expect(r).toMatchObject({ ok: false, error: "version_insert_failed" });
    const doCliente = tabelas.ai_agents.filter((a) => a.organization_id === CLIENTE);
    expect(doCliente).toHaveLength(1);
    expect(doCliente[0]?.archived_at).toBeTruthy();
  });
});

describe("o banco e a rota", () => {
  const raiz = process.cwd();
  const migration = readFileSync(join(raiz, "supabase/migrations/20261008130000_9009_origem_do_agente_modelo.sql"), "utf8");
  const songhai = readFileSync(join(raiz, "supabase/songhai.sql"), "utf8");

  it("a origem é registo, não dependência: on delete set null, idempotente, no songhai.sql antes da varredura", () => {
    expect(migration.split("\n")[0]).toMatch(/^-- manifest: /);
    expect(migration.match(/references public\.\w+\(id\) on delete set null/g)).toHaveLength(2);
    expect(migration.match(/add column if not exists/g)).toHaveLength(2);
    const bloco = songhai.indexOf("(migration 9009)");
    expect(bloco).toBeGreaterThan(0);
    expect(bloco).toBeLessThan(songhai.indexOf("VARREDURA anon"));
  });

  it("a rota declara o guarda de suporte ANTES do efeito e exige admin de plataforma com escrita", () => {
    const rota = readFileSync(join(raiz, "app/api/v1/admin/tenants/[id]/package/route.ts"), "utf8");
    expect(rota.indexOf("requireSupportWrite(")).toBeGreaterThan(0);
    expect(rota.indexOf("requireSupportWrite(")).toBeLessThan(rota.indexOf("requirePlatformAdminEscrita()"));
    expect(rota.indexOf("requirePlatformAdminEscrita()")).toBeLessThan(rota.indexOf("aplicarAgenteModelo("));
    expect(rota).toContain("audit(");
  });
});
