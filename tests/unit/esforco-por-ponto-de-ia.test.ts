/**
 * SonghaiCRM, migration 9006: o esforço do modelo por ponto de IA.
 *
 * Quatro coisas precisam concordar, e cada uma tem o seu caso aqui:
 *   1. a regra — que níveis cada modelo aceita (`lib/ai/esforco.ts`);
 *   2. o resolvedor — só a escolha do painel traz esforço;
 *   3. a chamada — o esforço CHEGA ao provedor, sem apagar o cacheControl;
 *   4. a rota — recusa nível que o modelo não aceita e grava o que aceita.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { esforcoEfetivo, niveisDeEsforco } from "@/lib/ai/esforco";
import { comEsforco } from "@/lib/ai/esforco-no-modelo";
import { decidirBinding } from "@/lib/ai/pontos/resolver";
import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";

describe("a regra: que níveis cada modelo aceita", () => {
  it("os modelos atuais aceitam os cinco níveis", () => {
    for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-opus-4-8"]) {
      expect(niveisDeEsforco("anthropic", id)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    }
  });

  it("4.6 sem xhigh, Opus 4.5 só três, Haiku 4.5 nenhum", () => {
    expect(niveisDeEsforco("anthropic", "claude-sonnet-4-6")).not.toContain("xhigh");
    expect(niveisDeEsforco("anthropic", "claude-opus-4-5")).toEqual(["low", "medium", "high"]);
    expect(niveisDeEsforco("anthropic", "claude-haiku-4-5")).toEqual([]);
  });

  it("aceita o prefixo anthropic/ e o sufixo de data; outros provedores não têm esforço", () => {
    expect(niveisDeEsforco("anthropic", "anthropic/claude-opus-5-5")).toHaveLength(5);
    expect(niveisDeEsforco("anthropic", "claude-opus-4-5-20251101")).toHaveLength(3);
    expect(niveisDeEsforco("openai", "gpt-5.6-terra")).toEqual([]);
  });

  it("esforço gravado que o modelo não aceita não vai na chamada", () => {
    expect(esforcoEfetivo("anthropic", "claude-opus-5-5", "xhigh")).toBe("xhigh");
    expect(esforcoEfetivo("anthropic", "claude-sonnet-4-6", "xhigh")).toBeNull();
    expect(esforcoEfetivo("anthropic", "claude-haiku-4-5", "low")).toBeNull();
    expect(esforcoEfetivo("anthropic", "claude-opus-5-5", "turbo")).toBeNull();
    expect(esforcoEfetivo("anthropic", "claude-opus-5-5", null)).toBeNull();
  });
});

describe("o resolvedor: só a escolha do painel traz esforço", () => {
  const padraoDaOrganizacao = { provider: "anthropic", defaultModel: "claude-sonnet-5" };

  it("binding com esforço → a decisão leva o esforço", () => {
    const decisao = decidirBinding({
      pontoId: "stage_classifier",
      binding: {
        purpose: "stage_classifier",
        provider: "anthropic",
        credential_id: null,
        model_id: "claude-opus-5-5",
        base_url: null,
        is_enabled: true,
        effort: "low",
      },
      agentePublicado: null,
      modeloDeAmbiente: undefined,
      padraoDaOrganizacao,
    });
    expect(decisao.origem).toBe("binding");
    expect(decisao.esforco).toBe("low");
  });

  it("sem binding (padrão da organização) → sem esforço", () => {
    const decisao = decidirBinding({
      pontoId: "stage_classifier",
      binding: null,
      agentePublicado: null,
      modeloDeAmbiente: undefined,
      padraoDaOrganizacao,
    });
    expect(decisao.esforco ?? null).toBeNull();
  });
});

describe("a chamada: o esforço chega ao provedor", () => {
  function modeloQueGrava() {
    const recebido: { providerOptions?: unknown }[] = [];
    const modelo = new MockLanguageModelV4({
      doGenerate: async (opcoes) => {
        recebido.push({ providerOptions: opcoes.providerOptions });
        return {
          content: [{ type: "text", text: "ok" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        };
      },
    });
    return { modelo, recebido };
  }

  it("com esforço: vai em providerOptions.anthropic.effort, e o cacheControl fica", async () => {
    const { modelo, recebido } = modeloQueGrava();
    await generateText({
      model: comEsforco(modelo, "high"),
      prompt: "oi",
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" } } },
    });
    expect(recebido[0]?.providerOptions).toEqual({
      anthropic: { effort: "high", cacheControl: { type: "ephemeral", ttl: "5m" } },
    });
  });

  it("sem esforço: o modelo passa intacto", () => {
    const { modelo } = modeloQueGrava();
    expect(comEsforco(modelo, null)).toBe(modelo);
  });
});

describe("a rota: PUT /api/v1/ai/providers", () => {
  let gravado: Record<string, unknown> | null;
  let anterior: Record<string, unknown> | null;
  let avisos: Record<string, unknown>[];

  beforeEach(() => {
    gravado = null;
    anterior = null;
    avisos = [];
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "dona@exemplo.co.mz",
        full_name: "Ana Macuácua",
        idioma: "pt-MZ",
      } as AuthUser,
      org: { orgId: ORG_ID, role: "admin" },
    } as unknown as Awaited<ReturnType<typeof requireRole>>);
    vi.mocked(createClient).mockResolvedValue({
      from(tabela: string) {
        if (tabela === "ai_models") {
          const cadeia = {
            select: () => cadeia,
            eq: () => cadeia,
            is: () => cadeia,
            maybeSingle: async () => ({
              data: { model_id: "x", supports_tools: true, supports_vision: true },
              error: null,
            }),
          };
          return cadeia;
        }
        if (tabela === "ai_purpose_bindings") {
          const leitura = {
            select: () => leitura,
            eq: () => leitura,
            maybeSingle: async () => ({ data: anterior, error: null }),
            upsert(payload: Record<string, unknown>) {
              gravado = payload;
              return {
                select: () => ({ maybeSingle: async () => ({ data: { id: "b1", ...payload }, error: null }) }),
              };
            },
          };
          return leitura;
        }
        throw new Error(`tabela inesperada: ${tabela}`);
      },
    } as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(createAdminClient).mockReturnValue({
      from(tabela: string) {
        if (tabela === "organizations") {
          const cadeia = {
            select: () => cadeia,
            eq: () => cadeia,
            maybeSingle: async () => ({
              data: { settings: { llm: { provider: "anthropic", default_model: "claude-sonnet-5" } } },
              error: null,
            }),
          };
          return cadeia;
        }
        if (tabela === "agent_inbox_items") {
          return {
            insert: async (linha: Record<string, unknown>) => {
              avisos.push(linha);
              return { error: null };
            },
          };
        }
        throw new Error(`tabela inesperada (admin): ${tabela}`);
      },
    } as unknown as ReturnType<typeof createAdminClient>);
  });

  function put(corpo: Record<string, unknown>) {
    return new NextRequest("http://localhost/api/v1/ai/providers", {
      method: "PUT",
      body: JSON.stringify({ purpose: "stage_classifier", provider: "anthropic", ...corpo }),
      headers: { "content-type": "application/json" },
    });
  }

  it("grava o esforço que o modelo aceita", async () => {
    const { PUT } = await import("@/app/api/v1/ai/providers/route");
    const res = await PUT(put({ model_id: "claude-opus-5-5", effort: "xhigh" }));
    expect(res.status).toBe(200);
    expect(gravado?.effort).toBe("xhigh");
  });

  it("sem esforço grava nulo (padrão do modelo)", async () => {
    const { PUT } = await import("@/app/api/v1/ai/providers/route");
    const res = await PUT(put({ model_id: "claude-opus-5-5" }));
    expect(res.status).toBe(200);
    expect(gravado?.effort).toBeNull();
  });

  it("recusa nível que o modelo não aceita, sem gravar nem avisar", async () => {
    const { PUT } = await import("@/app/api/v1/ai/providers/route");
    const res = await PUT(put({ model_id: "claude-haiku-4-5", effort: "low" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("esforco_nao_suportado");
    expect(gravado).toBeNull();
    expect(avisos).toHaveLength(0);
  });

  it("recusa valor fora da lista", async () => {
    const { PUT } = await import("@/app/api/v1/ai/providers/route");
    const res = await PUT(put({ model_id: "claude-opus-5-5", effort: "turbo" }));
    expect(res.status).toBe(422);
    expect(gravado).toBeNull();
  });

  it("trocar o esforço deixa aviso na Central com quem, o quê, de quê para quê", async () => {
    anterior = { provider: "anthropic", model_id: "claude-opus-5-5", effort: "low" };
    const { PUT } = await import("@/app/api/v1/ai/providers/route");
    const res = await PUT(put({ model_id: "claude-opus-5-5", effort: "max" }));
    expect(res.status).toBe(200);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ organization_id: ORG_ID, kind: "other", severity: "info" });
    expect(String(avisos[0]?.body)).toContain("Ana Macuácua");
    expect(String(avisos[0]?.body)).toContain("esforço Baixo → Máximo");
  });

  it("primeira escolha num ponto que seguia o padrão também avisa (modelo do padrão → escolhido)", async () => {
    const { PUT } = await import("@/app/api/v1/ai/providers/route");
    await PUT(put({ model_id: "claude-haiku-5-5", effort: "medium" }));
    expect(avisos).toHaveLength(1);
    expect(String(avisos[0]?.body)).toContain("modelo claude-sonnet-5 → claude-haiku-5-5");
  });

  it("salvar sem mudar nada não avisa", async () => {
    anterior = { provider: "anthropic", model_id: "claude-opus-5-5", effort: "high" };
    const { PUT } = await import("@/app/api/v1/ai/providers/route");
    await PUT(put({ model_id: "claude-opus-5-5", effort: "high" }));
    expect(avisos).toHaveLength(0);
  });
});

describe("o schema: migration 9006 e o apêndice da distribuição", () => {
  const raiz = process.cwd();
  const songhai = readFileSync(join(raiz, "supabase/songhai.sql"), "utf8");
  const migration = readFileSync(
    join(raiz, "supabase/migrations/20261008100000_9006_esforco_por_ponto_de_ia.sql"),
    "utf8",
  );

  it("a coluna e o CHECK estão nos dois, antes da varredura de anon", () => {
    for (const sql of [migration, songhai]) {
      expect(sql).toContain("add column if not exists effort text");
      expect(sql).toContain("check (effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max'))");
    }
    expect(songhai.indexOf("(migration 9006)")).toBeLessThan(songhai.indexOf("-- ---- VARREDURA anon"));
  });
});
