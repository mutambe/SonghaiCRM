/**
 * SonghaiCRM, migration 9005: os modelos atuais da Anthropic chegam ao seletor
 * E à contabilidade de custo. Um sem o outro é o defeito que a tabela de preços
 * já pagou: modelo escolhível com custo NULL não conta no teto de orçamento.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { precoDoModelo } from "@/lib/agent-engine/edge/llm/pricing";
import { AGENT_MODELS } from "@/lib/ai/guardrails-schema";

const MODELOS = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;

const raiz = process.cwd();
const songhai = readFileSync(join(raiz, "supabase/songhai.sql"), "utf8");
const migration = readFileSync(
  join(raiz, "supabase/migrations/20261008090000_9005_modelos_claude_5_5.sql"),
  "utf8",
);

describe("modelos Claude 5.5 (migration 9005)", () => {
  it.each(MODELOS)("%s entra no catálogo e no preço, na migration e no songhai.sql", (id) => {
    for (const sql of [migration, songhai]) {
      expect(sql).toContain(`('anthropic', '${id}'`);
      expect(sql).toContain(`('${id}',`);
    }
  });

  it("o bloco do songhai.sql vem antes da varredura de anon", () => {
    const bloco = songhai.indexOf("(migration 9005)");
    const varredura = songhai.indexOf("-- ---- VARREDURA anon");
    expect(bloco).toBeGreaterThan(0);
    expect(bloco).toBeLessThan(varredura);
  });

  it("os preços batem com a Anthropic", () => {
    expect(precoDoModelo("claude-fable-5-1")).toMatchObject({ input: 10, output: 50 });
    expect(precoDoModelo("claude-opus-5-5")).toMatchObject({ input: 4, output: 20 });
    expect(precoDoModelo("claude-sonnet-5-5")).toMatchObject({ input: 2, output: 10 });
    expect(precoDoModelo("claude-haiku-5-5")).toMatchObject({ input: 0.1, output: 0.5, cacheRead: 0.01 });
    expect(precoDoModelo("claude-sonnet-5-5")).toMatchObject({ cacheRead: 0.1 });
    expect(precoDoModelo("anthropic/claude-sonnet-5-5")).toMatchObject({ input: 2, output: 10 });
  });

  it.each(MODELOS)("%s aparece no editor de agente", (id) => {
    expect(AGENT_MODELS).toContain(`anthropic/${id}`);
  });
});
