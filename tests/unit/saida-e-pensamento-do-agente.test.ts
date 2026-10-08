/**
 * SonghaiCRM, 08/10/2026: dois riscos do agente que nasce no Haiku 5.5.
 *
 *  1. LIMITE DE SAÍDA — o AI SDK instalado não conhece `claude-haiku-5-5`,
 *     `claude-opus-5` nem `claude-opus-5-5` e envia `max_tokens: 4096`. Com o
 *     pensamento adaptativo ligado por omissão (e contado no limite), a resposta
 *     do agente pode ser cortada sem erro.
 *  2. PENSAMENTO NO CHECKPOINT — o fechamento do turno é um segundo pedido, sem
 *     as ferramentas do primeiro; reenviar um bloco de pensamento assinado ali é
 *     400 nos modelos novos, em contas criadas a partir de 31/08/2026.
 *
 * Os pedidos são medidos NO `fetch` (o corpo HTTP que sairia para a API), com o
 * `runModelCall` de verdade. Sem rede e sem chave.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { semBlocosDePensamento } from "@/lib/agent-engine/agent/sem-pensamento";
import { runModelCall } from "@/lib/agent-engine/edge/llm/run-model-call";
import { LIMITE_DE_SAIDA_DO_AGENTE, limiteDeSaidaDoSdkDesconhecido } from "@/lib/ai/limite-de-saida";

const ORG = "22222222-2222-4222-8222-222222222222";

// ─── um Anthropic de verdade, com o `fetch` capturado ────────────────────────

function respostaDaApi(content: unknown[], parou: "end_turn" | "tool_use" = "end_turn", modelo = "x") {
  return new Response(
    JSON.stringify({
      id: "m",
      type: "message",
      role: "assistant",
      model: modelo,
      content,
      stop_reason: parou,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function anthropicQueCaptura(
  responder: (n: number, corpo: Record<string, unknown>) => Response = () => respostaDaApi([{ type: "text", text: "ok" }]),
) {
  const corpos: Array<Record<string, unknown>> = [];
  const fetchFalso = (async (_url: unknown, init?: { body?: unknown }) => {
    const corpo = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    corpos.push(corpo);
    return responder(corpos.length, corpo);
  }) as unknown as typeof fetch;
  return { provedor: createAnthropic({ apiKey: "sk-teste", fetch: fetchFalso }), corpos };
}

// ─── 1. o limite de saída ────────────────────────────────────────────────────

function poolDoMotor(params: Record<string, unknown> = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("settings->'llm'")) {
      return {
        rows: [
          {
            llm: { provider: "anthropic", default_model: "claude-haiku-5-5", params, enabled_models: [], monthly_budget_cents: null },
          },
        ],
      };
    }
    if (sql.includes("insert into llm_calls")) return { rows: [{ id: "call-1" }] };
    return { rows: [] };
  });
  return { query } as never;
}

async function pedidoDoAgente(
  modelId: string,
  opcoes: { params?: Record<string, unknown>; effort?: string | null } = {},
) {
  const { provedor, corpos } = anthropicQueCaptura();
  const fabrica = (_chave: string, id: string) => provedor(id);
  await runModelCall(
    poolDoMotor(opcoes.params),
    { anthropicApiKey: "sk-teste", cacheTtl: "1h" as const },
    {
      tenantId: ORG,
      purpose: "agent_turn",
      model: modelId,
      messages: [{ role: "user", content: "oi" }],
      llmOverride: { provider: "anthropic", credentialId: null, effort: opcoes.effort ?? null },
    } as never,
    { registry: { anthropic: fabrica, openai: fabrica, google: fabrica, openrouter: fabrica } as never },
  );
  return corpos[0]!;
}

describe("o limite de saída do agente", () => {
  it.each(["claude-haiku-5-5", "claude-opus-5-5", "claude-opus-5"])(
    "%s: o SDK sozinho mandaria 4096; o motor manda o piso explícito",
    async (id) => {
      // A prova de que o defeito existe: SEM o motor, o SDK manda 4096.
      const { provedor, corpos } = anthropicQueCaptura();
      await generateText({ model: provedor(id), prompt: "oi" });
      expect(corpos[0]?.max_tokens, `o SDK já conhece ${id}: o piso deixou de ser necessário`).toBe(4096);

      const corpo = await pedidoDoAgente(id);
      expect(corpo.max_tokens).toBe(LIMITE_DE_SAIDA_DO_AGENTE);
      expect(LIMITE_DE_SAIDA_DO_AGENTE).toBeGreaterThanOrEqual(16_000);
    },
  );

  it.each([
    ["claude-sonnet-5", 128_000],
    ["claude-sonnet-5-5", 128_000],
    ["claude-fable-5-1", 128_000],
    ["claude-sonnet-4-6", 128_000],
    ["claude-haiku-4-5", 64_000],
  ])("%s: o SDK acerta e o motor NÃO mexe (%i)", async (id, esperado) => {
    const corpo = await pedidoDoAgente(id);
    expect(corpo.max_tokens).toBe(esperado);
  });

  it("o que a organização configurou vence o piso", async () => {
    const corpo = await pedidoDoAgente("claude-haiku-5-5", { params: { maxOutputTokens: 2000 } });
    expect(corpo.max_tokens).toBe(2000);
  });

  it("a regra pura: só Anthropic, só as famílias que o SDK subestima", () => {
    expect(limiteDeSaidaDoSdkDesconhecido("anthropic", "claude-haiku-5-5")).toBe(16_000);
    expect(limiteDeSaidaDoSdkDesconhecido("anthropic", "anthropic/claude-opus-5-5")).toBe(16_000);
    expect(limiteDeSaidaDoSdkDesconhecido("anthropic", "claude-sonnet-5")).toBeUndefined();
    expect(limiteDeSaidaDoSdkDesconhecido("anthropic", "claude-haiku-4-5")).toBeUndefined();
    expect(limiteDeSaidaDoSdkDesconhecido("openai", "claude-haiku-5-5")).toBeUndefined();
    expect(limiteDeSaidaDoSdkDesconhecido("anthropic", null)).toBeUndefined();
  });

  it("o esforço do AGENTE chega ao corpo HTTP, e sem temperatura", async () => {
    const corpo = await pedidoDoAgente("claude-haiku-5-5", {
      effort: "medium",
      params: { temperature: 0.3, topP: 0.9 },
    });
    expect((corpo.output_config as { effort?: string }).effort).toBe("medium");
    expect(corpo).not.toHaveProperty("temperature");
    expect(corpo).not.toHaveProperty("top_p");
  });
});

// ─── 2. o pensamento no checkpoint ───────────────────────────────────────────

/** Um turno com uma ferramenta, em que o modelo devolve pensamento assinado. */
async function turnoComPensamento() {
  const { provedor, corpos } = anthropicQueCaptura((n, corpo) => {
    const temFerramentas = Array.isArray(corpo.tools) && corpo.tools.length > 0;
    if (n === 1 && temFerramentas) {
      return respostaDaApi(
        [
          { type: "thinking", thinking: "", signature: "ASSINATURA-1" },
          { type: "tool_use", id: "tu1", name: "buscar", input: { q: "x" } },
        ],
        "tool_use",
      );
    }
    return respostaDaApi([
      { type: "thinking", thinking: "", signature: "ASSINATURA-2" },
      { type: "text", text: "pronto" },
    ]);
  });
  const model = provedor("claude-haiku-5-5");
  const buscar = tool({ description: "busca", inputSchema: z.object({ q: z.string() }), execute: async () => "r" });
  const turno = await generateText({
    model,
    system: "SYS",
    messages: [{ role: "user", content: "oi" }],
    tools: { buscar },
    stopWhen: stepCountIs(4),
  });
  return { model, corpos, turno };
}

function blocosReenviados(corpo: Record<string, unknown>): string[] {
  const mensagens = corpo.messages as Array<{ role: string; content: unknown }>;
  return mensagens.flatMap((m) =>
    Array.isArray(m.content)
      ? (m.content as Array<{ type: string }>).map((p) => `${m.role}:${p.type}`)
      : [`${m.role}:string`],
  );
}

describe("o checkpoint não reenvia pensamento assinado", () => {
  it("CONTROLE: reenviar response.messages como está leva um bloco thinking, sem as ferramentas", async () => {
    const { model, corpos, turno } = await turnoComPensamento();
    corpos.length = 0;
    await generateText({
      model,
      system: "SYS",
      messages: [{ role: "user", content: "oi" }, ...turno.response.messages, { role: "user", content: "CHECKPOINT" }],
    });
    // É o defeito: pensamento assinado de um prefixo que já não existe (sem tools).
    expect(corpos[0]?.tools ?? []).toEqual([]);
    expect(blocosReenviados(corpos[0]!)).toContain("assistant:thinking");
  });

  it("com semBlocosDePensamento o pedido do checkpoint sai sem nenhum bloco thinking", async () => {
    const { model, corpos, turno } = await turnoComPensamento();
    corpos.length = 0;
    await generateText({
      model,
      system: "SYS",
      messages: [
        { role: "user", content: "oi" },
        ...semBlocosDePensamento(turno.response.messages),
        { role: "user", content: "CHECKPOINT" },
      ],
    });
    const blocos = blocosReenviados(corpos[0]!);
    expect(blocos.some((b) => b.endsWith(":thinking") || b.endsWith(":redacted_thinking"))).toBe(false);
    // O texto que o agente respondeu continua lá: o checkpoint resume o que foi dito.
    expect(blocos).toContain("assistant:text");
  });

  it("tira só o pensamento: texto, chamadas de ferramenta e resultados ficam", () => {
    const fita: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "", providerOptions: { anthropic: { signature: "S" } } },
          { type: "tool-call", toolCallId: "t1", toolName: "buscar", input: { q: "x" } },
        ],
      },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "t1", toolName: "buscar", output: { type: "text", value: "r" } }] },
      { role: "assistant", content: [{ type: "reasoning", text: "x" }, { type: "text", text: "pronto" }] },
    ];
    const limpa = semBlocosDePensamento(fita);
    expect(limpa).toHaveLength(3);
    expect(JSON.stringify(limpa)).not.toContain("reasoning");
    expect(JSON.stringify(limpa)).toContain("tool-call");
    expect(JSON.stringify(limpa)).toContain("tool-result");
    expect(JSON.stringify(limpa)).toContain("pronto");
  });

  it("mensagem do assistente que só tinha pensamento some (assistente vazio é 400)", () => {
    const fita: ModelMessage[] = [
      { role: "assistant", content: [{ type: "reasoning", text: "" }] },
      { role: "user", content: "oi" },
    ];
    expect(semBlocosDePensamento(fita)).toEqual([{ role: "user", content: "oi" }]);
  });

  it("não altera o que não é do assistente, nem muda os objetos de entrada", () => {
    const fita: ModelMessage[] = [
      { role: "user", content: "oi" },
      { role: "assistant", content: "texto simples" },
    ];
    expect(semBlocosDePensamento(fita)).toEqual(fita);
    const original: ModelMessage[] = [{ role: "assistant", content: [{ type: "reasoning", text: "a" }, { type: "text", text: "b" }] }];
    const copia = JSON.parse(JSON.stringify(original));
    semBlocosDePensamento(original);
    expect(original).toEqual(copia);
  });

  it("o motor do agente usa a função no checkpoint", () => {
    const fonte = readFileSync(join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"), "utf8");
    expect(fonte).toContain("...semBlocosDePensamento(responseMessages),");
    expect(fonte).not.toMatch(/\.\.\.responseMessages,/);
  });
});
