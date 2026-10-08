/**
 * SonghaiCRM, 08/10/2026: temperature / top_p / top_k só vão a quem os aceita,
 * e quem escolheu o modelo é avisado na Central.
 *
 * Os modelos novos da Anthropic (Haiku 5.5, Sonnet 5.5 e 5, Opus 5.5, 5, 4.8 e
 * 4.7, Fable 5 e 5.1) devolvem 400 a qualquer valor fora do padrão. Antes disto,
 * o motor mandava o que `organizations.settings.llm.params` tivesse, e o worker
 * de clima mandava SEMPRE `temperature: 0` — a chamada morria e, no worker, o
 * `catch` só fazia `console.warn`.
 *
 * Regra do dono: o sistema NUNCA troca de modelo sozinho. Retira só o que o
 * modelo recusa, e AVISA.
 *
 * Cinco coisas, cada uma com o seu caso:
 *   1. a regra (`lib/ai/amostragem.ts`);
 *   2. o motor (`runModelCall`) — o que chega ao modelo, e o aviso;
 *   3. o worker de clima — o que o AI SDK manda de verdade à API da Anthropic;
 *   4. a deduplicação do aviso;
 *   5. a cerca: `temperature:` literal só onde a regra manda.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { describe, expect, it, vi } from "vitest";

import { runModelCall } from "@/lib/agent-engine/edge/llm/run-model-call";
import { aceitaAmostragem, amostragemDaChamada, avisoDaAmostragemNaEscolha } from "@/lib/ai/amostragem";
import {
  abrirAvisoPorPg,
  abrirAvisoPorSupabase,
  avisoDeModeloARecusar,
  ehErroDeTamanho,
} from "@/lib/ai/avisos-do-modelo";
import { opcoesDaClassificacao } from "@/lib/ai/classificacao-do-modelo";
import { provedorDoModelo } from "@/lib/ai/esforco-no-modelo";
import { classificarComLlm } from "@/workers/ai-sentiment-worker";

const ORG = "22222222-2222-4222-8222-222222222222";

// ─── 1. a regra ──────────────────────────────────────────────────────────────

describe("a regra: quem aceita temperature / top_p / top_k", () => {
  it.each([
    "claude-haiku-5-5",
    "claude-sonnet-5-5",
    "claude-sonnet-5",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-fable-5-1",
    "claude-fable-5",
    "claude-mythos-5-1",
  ])("%s não recebe amostragem", (id) => {
    expect(aceitaAmostragem("anthropic", id)).toBe(false);
  });

  it.each([
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-sonnet-4",
    "claude-sonnet-4-20250514",
    "claude-opus-4-6",
    "claude-opus-4-5-20251101",
    "claude-opus-4-1",
    "claude-opus-4",
    "claude-3-5-haiku-20241022",
    "claude-3-7-sonnet-latest",
  ])("%s ainda recebe", (id) => {
    expect(aceitaAmostragem("anthropic", id)).toBe(true);
  });

  it("o prefixo anthropic/ não muda a resposta", () => {
    expect(aceitaAmostragem("anthropic", "anthropic/claude-haiku-5-5")).toBe(false);
    expect(aceitaAmostragem("anthropic", "anthropic/claude-sonnet-4-6")).toBe(true);
  });

  it("modelo desconhecido da Anthropic NÃO recebe: a negação é o padrão", () => {
    expect(aceitaAmostragem("anthropic", "claude-haiku-6-0")).toBe(false);
    expect(aceitaAmostragem("anthropic", "claude-qualquer-coisa")).toBe(false);
    expect(aceitaAmostragem("anthropic", "")).toBe(false);
    expect(aceitaAmostragem("anthropic", null)).toBe(false);
    // claude-sonnet-40 não pode casar com claude-sonnet-4 só por prefixo.
    expect(aceitaAmostragem("anthropic", "claude-sonnet-40")).toBe(false);
  });

  it("outros provedores: inalterado", () => {
    expect(aceitaAmostragem("openai", "gpt-5.6-terra")).toBe(true);
    expect(aceitaAmostragem("google", "gemini-3.5-flash")).toBe(true);
    expect(aceitaAmostragem("openrouter", "anthropic/claude-haiku-5-5")).toBe(true);
  });

  it("amostragemDaChamada retira os três e diz o que retirou", () => {
    const pedida = { temperature: 0.2, topP: 0.9, topK: 40 };
    expect(amostragemDaChamada("anthropic", "claude-haiku-5-5", pedida)).toEqual({
      enviar: {},
      retirados: ["temperature", "top_p", "top_k"],
    });
    expect(amostragemDaChamada("anthropic", "claude-sonnet-4-6", pedida)).toEqual({ enviar: pedida, retirados: [] });
    expect(amostragemDaChamada("anthropic", "claude-haiku-5-5", {})).toEqual({ enviar: {}, retirados: [] });
  });

  it("o aviso na escolha: só quando a organização TEM amostragem e o modelo a recusa", () => {
    const params = { temperature: 0.3, topP: 0.8 };
    expect(avisoDaAmostragemNaEscolha("anthropic", "claude-haiku-5-5", params)).toMatch(/temperature, top_p/);
    expect(avisoDaAmostragemNaEscolha("anthropic", "claude-sonnet-4-6", params)).toBeNull();
    expect(avisoDaAmostragemNaEscolha("anthropic", "claude-haiku-5-5", {})).toBeNull();
    expect(avisoDaAmostragemNaEscolha("anthropic", "claude-haiku-5-5", undefined)).toBeNull();
  });
});

// ─── 2. o motor ──────────────────────────────────────────────────────────────

type Insercao = { sql: string; params: unknown[] };

/** Um `pg` falso que emula a deduplicação do `insert … where not exists` do aviso. */
function poolDoMotor(opcoes: { params?: Record<string, unknown>; binding?: Record<string, unknown> | null } = {}) {
  const avisos: Insercao[] = [];
  const vistos = new Set<string>();
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("settings->'llm'")) {
      return {
        rows: [
          {
            llm: {
              provider: "anthropic",
              default_model: "claude-haiku-5-5",
              params: opcoes.params ?? {},
              enabled_models: [],
              monthly_budget_cents: null,
            },
          },
        ],
      };
    }
    if (sql.includes("from ai_purpose_bindings")) return { rows: opcoes.binding ? [opcoes.binding] : [] };
    if (sql.includes("from ai_provider_credentials")) return { rows: [] };
    if (sql.includes("insert into agent_inbox_items")) {
      // $1 = organização, $3 = título: a mesma chave do `where not exists`.
      const chave = `${String(params[0])}|${String(params[2])}`;
      if (vistos.has(chave)) return { rows: [], rowCount: 0 };
      vistos.add(chave);
      avisos.push({ sql, params });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("insert into llm_calls")) return { rows: [{ id: "call-1" }] };
    return { rows: [] };
  });
  return { pool: { query } as never, avisos };
}

function registryQueGrava(modelo: { aoGerar?: (opcoes: Record<string, unknown>) => void; falha?: unknown }) {
  const recebidos: Array<Record<string, unknown>> = [];
  const fabrica = (_chave: string, modelId: string) =>
    ({
      specificationVersion: "v3",
      provider: "anthropic",
      modelId,
      supportedUrls: {},
      doGenerate: async (opcoes: Record<string, unknown>) => {
        recebidos.push(opcoes);
        modelo.aoGerar?.(opcoes);
        if (modelo.falha) throw modelo.falha;
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
    }) as never;
  return { registry: { anthropic: fabrica, openai: fabrica, google: fabrica, openrouter: fabrica }, recebidos };
}

const cfg = { anthropicApiKey: "sk-teste-amostragem", cacheTtl: "1h" as const };
const AMOSTRAGEM_DA_ORG = { temperature: 0.2, topP: 0.9, topK: 40 };

async function chamar(
  pool: never,
  registry: ReturnType<typeof registryQueGrava>["registry"],
  extra: Record<string, unknown> = {},
) {
  return runModelCall(
    pool,
    cfg,
    { tenantId: ORG, purpose: "stage_classifier", messages: [{ role: "user", content: "oi" }], ...extra } as never,
    { registry },
  );
}

describe("o motor: o que chega ao modelo", () => {
  it("Haiku 5.5 (padrão da org) NÃO recebe os três, e a organização é avisada", async () => {
    const { pool, avisos } = poolDoMotor({ params: AMOSTRAGEM_DA_ORG });
    const { registry, recebidos } = registryQueGrava({});
    await chamar(pool, registry);
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0]?.temperature).toBeUndefined();
    expect(recebidos[0]?.topP).toBeUndefined();
    expect(recebidos[0]?.topK).toBeUndefined();
    expect(avisos).toHaveLength(1);
    expect(String(avisos[0]?.params[3])).toMatch(/nada foi alterado no modelo/i);
    expect(String(avisos[0]?.params[3])).toContain("temperature, top_p, top_k");
  });

  it("modelo antigo (Sonnet 4.6) continua a receber a afinação, sem aviso", async () => {
    const { pool, avisos } = poolDoMotor({ params: AMOSTRAGEM_DA_ORG });
    const { registry, recebidos } = registryQueGrava({});
    await chamar(pool, registry, { model: "claude-sonnet-4-6" });
    expect(recebidos[0]?.temperature).toBe(0.2);
    expect(recebidos[0]?.topP).toBe(0.9);
    expect(recebidos[0]?.topK).toBe(40);
    expect(avisos).toHaveLength(0);
  });

  it("organização sem afinação: nada a retirar, nenhum aviso", async () => {
    const { pool, avisos } = poolDoMotor();
    const { registry, recebidos } = registryQueGrava({});
    await chamar(pool, registry);
    expect(recebidos[0]?.temperature).toBeUndefined();
    expect(avisos).toHaveLength(0);
  });

  it("o sistema não troca de modelo: o id que chega é o configurado", async () => {
    const { pool } = poolDoMotor({ params: AMOSTRAGEM_DA_ORG });
    const { registry } = registryQueGrava({});
    const ids: string[] = [];
    const comEspia = {
      ...registry,
      anthropic: ((chave: string, modelId: string) => {
        ids.push(modelId);
        return (registry.anthropic as never as (a: string, b: string) => never)(chave, modelId);
      }) as never,
    };
    await chamar(pool, comEspia);
    expect(ids).toEqual(["claude-haiku-5-5"]);
  });
});

describe("o motor: 400 num modelo escolhido abre aviso — e só nele", () => {
  const erro400 = Object.assign(new Error("temperature: non-default values are not supported"), { statusCode: 400 });
  const binding = {
    purpose: "stage_classifier",
    provider: "anthropic",
    credential_id: null,
    model_id: "claude-opus-5-5",
    base_url: null,
    is_enabled: true,
    effort: null,
  };

  it("origem binding + 400 → aviso com o rótulo do ponto e o caminho para corrigir", async () => {
    const { pool, avisos } = poolDoMotor({ binding });
    const { registry } = registryQueGrava({ falha: erro400 });
    await expect(chamar(pool, registry)).rejects.toBe(erro400);
    expect(avisos).toHaveLength(1);
    expect(String(avisos[0]?.params[2])).toContain("está a recusar os pedidos");
    expect(String(avisos[0]?.params[3])).toContain("IA › Provedores");
    expect(String(avisos[0]?.params[3])).toContain("não troca de modelo sozinho");
  });

  it("uma rajada de falhas vira UM aviso (deduplicado pelo título)", async () => {
    const { pool, avisos } = poolDoMotor({ binding });
    const { registry } = registryQueGrava({ falha: erro400 });
    for (let i = 0; i < 5; i += 1) await chamar(pool, registry).catch(() => undefined);
    expect(avisos).toHaveLength(1);
  });

  it("origem agente_publicado + 400 → aviso que manda para IA › Agentes", async () => {
    const { pool, avisos } = poolDoMotor();
    const { registry } = registryQueGrava({ falha: erro400 });
    await chamar(pool, registry, {
      purpose: "agent_turn",
      model: "claude-haiku-5-5",
      llmOverride: { provider: "anthropic", credentialId: null },
    }).catch(() => undefined);
    expect(avisos).toHaveLength(1);
    expect(String(avisos[0]?.params[3])).toContain("IA › Agentes");
  });

  it("400 de TAMANHO (prompt maior que a janela) NÃO vira «o modelo recusa»", async () => {
    const { pool, avisos } = poolDoMotor({ binding });
    const grande = Object.assign(new Error("prompt is too long: 1200000 tokens > 1000000 maximum"), { statusCode: 400 });
    const { registry } = registryQueGrava({ falha: grande });
    await chamar(pool, registry).catch(() => undefined);
    expect(avisos).toHaveLength(0);
    expect(ehErroDeTamanho(grande)).toBe(true);
    expect(ehErroDeTamanho(erro400)).toBe(false);
    expect(ehErroDeTamanho(new Error("max_tokens: 200000 > 128000, which is the maximum allowed"))).toBe(true);
    expect(ehErroDeTamanho(new Error("temperature: non-default values are not supported"))).toBe(false);
  });

  it("padrão da organização + 400 NÃO abre aviso (ninguém escolheu esse modelo para o ponto)", async () => {
    const { pool, avisos } = poolDoMotor();
    const { registry } = registryQueGrava({ falha: erro400 });
    await chamar(pool, registry).catch(() => undefined);
    expect(avisos).toHaveLength(0);
  });

  it("falha que não é 400 (rede, 401, 529) NÃO abre aviso de modelo", async () => {
    const { pool, avisos } = poolDoMotor({ binding });
    for (const status of [401, 429, 500, 529]) {
      const { registry } = registryQueGrava({ falha: Object.assign(new Error("x"), { statusCode: status }) });
      await chamar(pool, registry).catch(() => undefined);
    }
    expect(avisos).toHaveLength(0);
  });

  it("aviso que não grava não esconde o erro original", async () => {
    const { pool } = poolDoMotor({ binding });
    const original = (pool as unknown as { query: (s: string, p?: unknown[]) => Promise<unknown> }).query;
    (pool as unknown as { query: unknown }).query = vi.fn(async (sql: string, p?: unknown[]) => {
      if (sql.includes("insert into agent_inbox_items")) throw new Error("banco indisponível");
      return original(sql, p);
    });
    const { registry } = registryQueGrava({ falha: erro400 });
    await expect(chamar(pool, registry)).rejects.toBe(erro400);
  });
});

// ─── 3. o worker de clima ────────────────────────────────────────────────────

/**
 * Um `fetch` falso devolve uma resposta mínima da API de mensagens da Anthropic
 * e guarda o CORPO do pedido: é a prova do que o AI SDK manda de verdade, sem
 * rede e sem chave.
 */
const SAIDA_DO_CLIMA = { sentiment_score: 0.4, reasoning_short: "cliente satisfeito" };

function anthropicQueCaptura() {
  const corpos: Array<Record<string, unknown>> = [];
  const fetchFalso = (async (_url: unknown, init?: { body?: unknown }) => {
    const corpo = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    corpos.push(corpo);
    const usouFerramenta = Array.isArray(corpo.tools) && corpo.tools.length > 0;
    const json = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: String(corpo.model),
      content: usouFerramenta
        ? [{ type: "tool_use", id: "t1", name: "json", input: SAIDA_DO_CLIMA }]
        : [{ type: "text", text: JSON.stringify(SAIDA_DO_CLIMA) }],
      stop_reason: usouFerramenta ? "tool_use" : "end_turn",
      usage: { input_tokens: 10, output_tokens: 8 },
    };
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const provedor = createAnthropic({ apiKey: "sk-teste", fetch: fetchFalso });
  return { provedor, corpos };
}

async function medirClima(modelId: string, esforcoEscolhido: "low" | "high" | null = null) {
  const { provedor, corpos } = anthropicQueCaptura();
  const resultado = await classificarComLlm(
    { model: provedor(modelId), modelId, esforcoEscolhido },
    "O cliente disse que está muito satisfeito.",
  );
  return { corpo: corpos[0]!, resultado };
}

describe("o worker de clima: o que o AI SDK manda de verdade à Anthropic", () => {
  it.each(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"])(
    "%s: sem temperature, saída estruturada nativa (sem ferramenta forçada) e esforço low",
    async (id) => {
      const { corpo, resultado } = await medirClima(id);
      expect(corpo).not.toHaveProperty("temperature");
      expect(corpo).not.toHaveProperty("top_p");
      expect(corpo).not.toHaveProperty("top_k");
      // O Opus 5.5 e o Fable 5.1 devolvem 400 a tool_choice forçado: nenhum
      // destes pedidos pode levar ferramenta nem escolha de ferramenta.
      expect(corpo).not.toHaveProperty("tool_choice");
      expect(corpo.tools ?? []).toEqual([]);
      const saida = corpo.output_config as { effort?: string; format?: { type?: string } };
      expect(saida.format?.type).toBe("json_schema");
      expect(saida.effort).toBe("low");
      expect(corpo.max_tokens).toBe(1024);
      expect(resultado.score).toBeCloseTo(0.4);
    },
  );

  it("o esforço que o painel escolheu para o ponto vence o padrão do sistema", async () => {
    const { corpo } = await medirClima("claude-haiku-5-5", "high");
    // Este modelo já vem do resolvedor com o esforço do painel embutido; aqui
    // o resolvedor é simulado, então o que se prova é que o worker NÃO põe `low`.
    const saida = corpo.output_config as { effort?: string };
    expect(saida.effort).not.toBe("low");
  });

  it("modelo antigo (Haiku 4.5) mantém o comportamento de sempre: temperature 0 e 256", async () => {
    const { corpo } = await medirClima("claude-haiku-4-5");
    expect(corpo.temperature).toBe(0);
    expect(corpo.max_tokens).toBe(256);
    const saida = corpo.output_config as { effort?: string } | undefined;
    expect(saida?.effort).toBeUndefined();
  });

  it("modelo em STRING (gateway): o provedor vem do prefixo do id, e a temperatura NÃO volta", () => {
    // O caminho de `resolveLanguageModel` com o gateway ativo devolve o id puro.
    expect(provedorDoModelo("anthropic/claude-sonnet-5", "anthropic/claude-sonnet-5")).toBe("anthropic");
    expect(provedorDoModelo("openai/gpt-5.6-terra", "openai/gpt-5.6-terra")).toBe("openai");
    // Sem prefixo, `claude-…` é da Anthropic; id sem pista não diz de quem é.
    expect(provedorDoModelo("claude-haiku-5-5")).toBe("anthropic");
    expect(provedorDoModelo("modelo-misterioso")).toBeNull();
    // O modelo já instanciado continua a dizer pelo próprio SDK.
    expect(provedorDoModelo(createAnthropic({ apiKey: "x" })("claude-haiku-5-5"))).toBe("anthropic");

    for (const id of ["anthropic/claude-sonnet-5", "anthropic/claude-haiku-5-5", "claude-opus-5-5"]) {
      const opcoes = opcoesDaClassificacao({
        provider: provedorDoModelo(id, id),
        modelId: id,
        esforcoEscolhido: null,
      });
      expect(opcoes, id).not.toHaveProperty("temperature");
      expect(opcoes.maxOutputTokens, id).toBe(1024);
    }
    // E o modelo antigo em string continua a receber a de sempre.
    const antigo = opcoesDaClassificacao({
      provider: provedorDoModelo("anthropic/claude-haiku-4-5", null),
      modelId: "anthropic/claude-haiku-4-5",
      esforcoEscolhido: null,
    });
    expect(antigo.temperature).toBe(0);
  });

  it("as opções, sem rede: Anthropic moderna × antiga × outro provedor", () => {
    expect(opcoesDaClassificacao({ provider: "anthropic", modelId: "claude-haiku-5-5", esforcoEscolhido: null })).toEqual({
      maxOutputTokens: 1024,
      esforcoPadrao: "low",
      providerOptions: { anthropic: { structuredOutputMode: "outputFormat" } },
    });
    expect(opcoesDaClassificacao({ provider: "anthropic", modelId: "claude-haiku-4-5", esforcoEscolhido: null })).toEqual({
      temperature: 0,
      maxOutputTokens: 256,
      esforcoPadrao: null,
    });
    expect(opcoesDaClassificacao({ provider: "openai", modelId: "gpt-5.6-luna", esforcoEscolhido: null })).toEqual({
      temperature: 0,
      maxOutputTokens: 256,
      esforcoPadrao: null,
    });
  });
});

// ─── 4. a deduplicação do aviso (caminho Supabase, o do worker) ──────────────

function supabaseFalso() {
  const linhas: Array<Record<string, unknown>> = [];
  const admin = {
    from(tabela: string) {
      if (tabela !== "agent_inbox_items") throw new Error(`tabela inesperada: ${tabela}`);
      const filtros: Array<[string, unknown]> = [];
      const leitura = {
        select: () => leitura,
        eq(coluna: string, valor: unknown) {
          filtros.push([coluna, valor]);
          return leitura;
        },
        limit: () => leitura,
        maybeSingle: async () => ({
          data: linhas.find((l) => filtros.every(([c, v]) => l[c] === v && l.status === "open")) ?? null,
        }),
        insert: async (linha: Record<string, unknown>) => {
          linhas.push({ ...linha, status: "open" });
          return { error: null };
        },
      };
      return leitura;
    },
  };
  return { admin: admin as never, linhas };
}

describe("o aviso é deduplicado", () => {
  const aviso = avisoDeModeloARecusar({
    rotuloDoPonto: "Medir o clima da conversa",
    modelId: "claude-opus-5-5",
    origem: "binding",
  });

  it("duas falhas seguidas no worker dão UM aviso", async () => {
    const { admin, linhas } = supabaseFalso();
    expect(await abrirAvisoPorSupabase(admin, ORG, aviso)).toBe(true);
    expect(await abrirAvisoPorSupabase(admin, ORG, aviso)).toBe(false);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ kind: "other", organization_id: ORG });
  });

  it("organização diferente não herda o aviso aberto de outra", async () => {
    const { admin, linhas } = supabaseFalso();
    await abrirAvisoPorSupabase(admin, ORG, aviso);
    await abrirAvisoPorSupabase(admin, "33333333-3333-4333-8333-333333333333", aviso);
    expect(linhas).toHaveLength(2);
  });

  it("o SQL do motor deduplica pelo título aberto, por organização", async () => {
    const consultas: string[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        consultas.push(sql);
        return { rowCount: 1, rows: [] };
      }),
    };
    await abrirAvisoPorPg(db as never, ORG, aviso);
    expect(consultas[0]).toMatch(/where not exists/);
    expect(consultas[0]).toMatch(/organization_id = \$1 and kind = 'other' and title = \$3 and status = 'open'/);
  });

  it("falha ao gravar vira só log: devolve false e não lança", async () => {
    const db = { query: vi.fn(async () => Promise.reject(new Error("banco indisponível"))) };
    const log = { warn: vi.fn() };
    await expect(abrirAvisoPorPg(db as never, ORG, aviso, log)).resolves.toBe(false);
    expect(log.warn).toHaveBeenCalledOnce();
  });
});

// ─── 5. a cerca ──────────────────────────────────────────────────────────────

/**
 * `temperature:` como chave de objeto só pode existir onde a regra manda. Quem
 * escreve `temperature: 0` direto numa chamada a modelo volta ao defeito
 * original. Exceções NOMEADAS — a lista só encolhe, e cada uma diz por que não
 * é uma chamada a modelo com valor fixo.
 */
describe("a cerca: `temperature:` literal só onde a regra manda", () => {
  const raiz = process.cwd();
  const PASTAS = ["app", "lib", "workers"];

  /** arquivo → linhas (aparadas) permitidas, com o motivo. */
  const EXCECOES: Record<string, { motivo: string; linhas: RegExp[] }> = {
    "lib/ai/amostragem.ts": { motivo: "a própria regra", linhas: [/.*/] },
    "lib/ai/classificacao-do-modelo.ts": {
      motivo: "monta temperature 0 SÓ quando aceitaAmostragem",
      linhas: [/^temperature\?: 0;$/, /^\.\.\.\(aceita \? \{ temperature: 0 as const \} : \{\}\),$/],
    },
    "lib/agent-engine/edge/llm/run-model-call.ts": {
      motivo: "esquema dos params da org e entrega do que a regra devolveu",
      linhas: [
        /^temperature: z\.number\(\)\.optional\(\),$/,
        /^\.\.\.\(parsedParams\.data\.temperature !== undefined \? \{ temperature: parsedParams\.data\.temperature \} : \{\}\),$/,
        /^temperature: amostragem\.enviar\.temperature,$/,
      ],
    },
    "workers/ai-sentiment-worker.ts": {
      motivo: "entrega o que classificacao-do-modelo decidiu",
      linhas: [/^\.\.\.\(opcoes\.temperature !== undefined \? \{ temperature: opcoes\.temperature \} : \{\}\),$/],
    },
    "lib/ai/guardrails-schema.ts": {
      motivo: "campo de configuração do editor legado (rag_bot); nenhum chamador o envia a um modelo",
      linhas: [/^temperature: /],
    },
  };

  function arquivos(dir: string): string[] {
    const saida: string[] = [];
    for (const nome of readdirSync(dir)) {
      if (nome === "node_modules" || nome === ".next") continue;
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
      else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.(ts|tsx)$/.test(nome)) saida.push(caminho);
    }
    return saida;
  }

  it("nenhuma chamada a modelo escreve temperature: fora das exceções nomeadas", () => {
    const violacoes: string[] = [];
    for (const pasta of PASTAS) {
      for (const arquivo of arquivos(join(raiz, pasta))) {
        const rel = relative(raiz, arquivo).split("\\").join("/");
        const linhas = readFileSync(arquivo, "utf8").split("\n");
        linhas.forEach((linha, i) => {
          const t = linha.trim();
          if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
          if (!/\btemperature\s*:/.test(t)) return;
          const permitidas = EXCECOES[rel]?.linhas ?? [];
          if (!permitidas.some((r) => r.test(t))) violacoes.push(`${rel}:${i + 1}: ${t}`);
        });
      }
    }
    expect(violacoes, `temperature: literal fora da regra (lib/ai/amostragem.ts):\n${violacoes.join("\n")}`).toEqual([]);
  });

  it("cada exceção ainda existe (a lista só encolhe, nunca apodrece)", () => {
    for (const rel of Object.keys(EXCECOES)) {
      const texto = readFileSync(join(raiz, rel), "utf8");
      expect(/\btemperature\b/.test(texto), `${rel} já não usa temperature: tire a exceção`).toBe(true);
    }
  });
});
