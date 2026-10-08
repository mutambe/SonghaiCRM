/**
 * SonghaiCRM, migration 9007: o esforço do modelo por agente, o padrão do
 * agente novo (Haiku 5.5 / Médio) e o aviso na Central quando alguém troca
 * modelo ou esforço.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildState } from "@/app/app/ai/agents/[id]/_components/AgentForm";
import { MODELO_DO_AGENTE_NOVO, padraoDoAgenteNovo } from "@/lib/ai/agents/padrao-do-agente-novo";
import { versionCreateSchema, versionPatchSchema } from "@/lib/ai/agents/validation";
import { descreverTroca } from "@/lib/ai/aviso-de-troca-de-modelo";
import { esforcoDaChamada, recusaDoEsforco } from "@/lib/ai/esforco";

const t = (s: string) => s;

describe("agente novo nasce com Haiku 5.5 e esforço Médio", () => {
  it("o padrão é Haiku 5.5 / medium, só na Anthropic", () => {
    expect(MODELO_DO_AGENTE_NOVO).toEqual({ provider: "anthropic", model: "claude-haiku-5-5", effort: "medium" });
    expect(padraoDoAgenteNovo("anthropic")).toEqual({ model: "claude-haiku-5-5", effort: "medium" });
    expect(padraoDoAgenteNovo("openai")).toBeNull();
  });

  it("o formulário de agente novo abre com Haiku 5.5 e Médio", () => {
    const estado = buildState({ version: null, t, provedorPadrao: "anthropic" });
    expect(estado.model).toBe("claude-haiku-5-5");
    expect(estado.effort).toBe("medium");
  });

  it("agente que já tem versão mostra o que tem — o padrão não toca agentes existentes", () => {
    const estado = buildState({
      version: { provider: "anthropic", model: "claude-sonnet-5", effort: null } as never,
      t,
      provedorPadrao: "anthropic",
    });
    expect(estado.model).toBe("claude-sonnet-5");
    expect(estado.effort).toBeNull();
  });

  it("o par padrão é aceite pela regra de esforço", () => {
    expect(recusaDoEsforco("anthropic", "claude-haiku-5-5", "medium")).toBeNull();
  });
});

describe("a versão do agente aceita e valida o esforço", () => {
  const base = {
    system_prompt: "Atenda os clientes com cordialidade.",
    provider: "anthropic",
    model: "claude-haiku-5-5",
    credential_id: null,
    channel_session_id: "33333333-3333-4333-8333-333333333333",
  };

  it("sem esforço = nulo; com esforço válido passa; valor inventado reprova", () => {
    expect(versionCreateSchema.parse(base).effort).toBeNull();
    expect(versionCreateSchema.parse({ ...base, effort: "high" }).effort).toBe("high");
    expect(versionCreateSchema.safeParse({ ...base, effort: "turbo" }).success).toBe(false);
  });

  it("o PATCH só mexe no esforço quando ele vem", () => {
    expect(versionPatchSchema.parse({ system_prompt: base.system_prompt }).effort).toBeUndefined();
    expect(versionPatchSchema.parse({ effort: null }).effort).toBeNull();
  });

  it("modelo que não aceita o nível é recusado", () => {
    expect(recusaDoEsforco("anthropic", "claude-haiku-4-5", "medium")).toMatch(/não permite/);
    expect(recusaDoEsforco("anthropic", "claude-sonnet-4-6", "xhigh")).toMatch(/não aceita/);
    expect(recusaDoEsforco("anthropic", "claude-haiku-4-5", null)).toBeNull();
  });
});

describe("de onde vem o esforço da chamada", () => {
  const comum = { provider: "anthropic", modelId: "claude-haiku-5-5" };

  it("modelo do agente → esforço do agente", () => {
    expect(esforcoDaChamada({ ...comum, origem: "agente_publicado", doPainel: "max", doAgente: "medium" })).toBe("medium");
    expect(esforcoDaChamada({ ...comum, origem: "herdado_de_quem_chamou", doPainel: null, doAgente: "low" })).toBe("low");
  });

  it("modelo do painel → esforço do painel", () => {
    expect(esforcoDaChamada({ ...comum, origem: "binding", doPainel: "high", doAgente: "low" })).toBe("high");
  });

  it("padrão da organização ou ambiente → nenhum", () => {
    expect(esforcoDaChamada({ ...comum, origem: "padrao_da_organizacao", doPainel: "high", doAgente: "low" })).toBeNull();
    expect(esforcoDaChamada({ ...comum, origem: "variavel_de_ambiente", doPainel: "high", doAgente: "low" })).toBeNull();
  });

  it("o operador com modelo que não aceita o nível do agente não recebe esforço", () => {
    expect(
      esforcoDaChamada({ provider: "anthropic", modelId: "claude-haiku-4-5", origem: "agente_publicado", doPainel: null, doAgente: "medium" }),
    ).toBeNull();
  });
});

describe("o texto do aviso na Central", () => {
  it("diz o modelo e o esforço, de quê para quê", () => {
    const troca = descreverTroca(
      { provider: "anthropic", model: "claude-sonnet-5", effort: null },
      { provider: "anthropic", model: "claude-haiku-5-5", effort: "medium" },
    );
    expect(troca?.texto).toBe("modelo claude-sonnet-5 → claude-haiku-5-5; esforço padrão do modelo → Médio");
  });

  it("o prefixo anthropic/ não conta como troca", () => {
    expect(
      descreverTroca(
        { provider: "anthropic", model: "anthropic/claude-haiku-5-5", effort: "low" },
        { provider: "anthropic", model: "claude-haiku-5-5", effort: "low" },
      ),
    ).toBeNull();
  });

  it("primeira publicação (sem anterior) não é troca", () => {
    expect(descreverTroca(null, { provider: "anthropic", model: "claude-haiku-5-5", effort: "medium" })).toBeNull();
  });
});

describe("as peças que ligam o agente ao esforço", () => {
  const raiz = process.cwd();
  const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

  it("a coluna nasce na migration 9007 e no apêndice da distribuição, antes da varredura", () => {
    const songhai = ler("supabase/songhai.sql");
    for (const sql of [ler("supabase/migrations/20261008110000_9007_esforco_do_agente.sql"), songhai]) {
      expect(sql).toContain("alter table public.ai_agent_versions");
      expect(sql).toContain("check (effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max'))");
    }
    expect(songhai.indexOf("(migration 9007)")).toBeLessThan(songhai.indexOf("-- ---- VARREDURA anon"));
  });

  it("o motor lê o esforço da versão e o passa no turno, no checkpoint e no operador", () => {
    expect(ler("lib/agent-engine/agent/agent-config.ts")).toContain("v.effort,");
    expect(ler("lib/agent-engine/agent/inbound-turn.ts").match(/effort: agentConfig\.effort/g)).toHaveLength(2);
    expect(ler("lib/agent-engine/agent/operator-turn.ts")).toContain("effort: agentConfig.effort");
  });

  it("publicar avisa quando o modelo ou o esforço mudam — pela rota E pela tela", () => {
    expect(ler("app/api/v1/ai/agents/[id]/publish/route.ts")).toContain("avisarTrocaNaPublicacao(admin");
    const acoes = ler("app/app/ai/agents/[id]/_actions.ts");
    // publicar + reverter: os dois trocam o modelo em vigor.
    expect(acoes.match(/avisarTrocaNaPublicacao\(admin/g)).toHaveLength(2);
  });

  it("as ações da tela gravam o esforço em TODO caminho que grava versão e validam o par", () => {
    const acoes = ler("app/app/ai/agents/[id]/_actions.ts");
    // rascunho novo, agente novo, reverter.
    expect(acoes).toContain("effort: v.effort,");
    expect(acoes.match(/effort: v\.effort,/g)).toHaveLength(2);
    expect(acoes).toContain("effort: src.effort ?? null,");
    // salvar, publicar e criar recusam esforço que o modelo não aceita.
    expect(acoes.match(/recusaDoEsforco\(/g)).toHaveLength(3);
    // O SELECT da versão traz a coluna — senão o editor reabre sem o esforço
    // e o próximo salvamento o apaga.
    expect(acoes).toMatch(/provisioning_origin,inbound_debounce_ms,effort"/);
    expect(ler("app/app/ai/agents/[id]/page.tsx")).toMatch(/provisioning_origin,inbound_debounce_ms,effort"/);
  });

  it("duplicar um agente leva o esforço", () => {
    expect(ler("lib/ai/agents/duplicate.ts")).toContain("effort: src.effort ?? null,");
  });
});
