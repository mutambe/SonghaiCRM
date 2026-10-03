/**
 * O agente fala português de Moçambique (SonghaiCRM).
 *
 * O upstream mandava o modelo escrever "sempre em português do Brasil" em três
 * lugares: a camada plataforma do playbook (à frente de TODO agente), o prompt
 * padrão de agente novo e o prompt do agente de prospecção. E a instalação que
 * já existia nunca receberia um platform.md novo, porque o seed não move
 * ponteiro: a migration 9002 publica a versão nova — e ela precisa ser o
 * arquivo byte a byte, senão instalação nova e antiga falam de jeitos
 * diferentes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { agentCreateSchema } from "@/lib/ai/guardrails-schema";
import { validatePlaybookLayerContent } from "@/lib/agent-engine/agent/playbook";
import { prospectingAgentPrompt } from "@/lib/prospecting/agent-setup";

const ler = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8");
const PLATFORM = ler("lib", "agent-engine", "playbooks", "platform.md");

/** O conteúdo entre os delimitadores do bloco da 9002. */
function conteudoDaMigration(sql: string): string {
  const abre = "$playbook_mz$";
  const i = sql.indexOf(abre);
  const f = sql.indexOf(abre, i + abre.length);
  if (i < 0 || f < 0) throw new Error("bloco $playbook_mz$ não encontrado");
  return sql.slice(i + abre.length, f);
}

describe("o modelo é mandado escrever em português de Moçambique", () => {
  it("a camada plataforma diz Moçambique e não diz Brasil", () => {
    expect(PLATFORM).toMatch(/sempre em\s+português de Moçambique/);
    expect(PLATFORM).not.toMatch(/Brasil/);
    expect(PLATFORM).toMatch(/«telemóvel» \(não\s+«celular»\)/);
    validatePlaybookLayerContent(PLATFORM);
  });

  it("o prompt padrão de agente novo e o do agente de prospecção também", () => {
    const padrao = agentCreateSchema.parse({ name: "Loja" }).system_prompt;
    expect(padrao).toContain("português de Moçambique");
    const prospeccao = prospectingAgentPrompt({
      name: "Ana",
      tone: "cordial",
      instruction: "x",
    } as Parameters<typeof prospectingAgentPrompt>[0]);
    expect(prospeccao).toContain("português de Moçambique");
    expect(`${padrao} ${prospeccao}`).not.toMatch(/Brasil/);
  });
});

describe("a migration 9002 publica o platform.md byte a byte", () => {
  it("na migration versionada", () => {
    const sql = ler("supabase", "migrations", "20261001100000_9002_playbook_plataforma_em_pt_mz.sql");
    expect(conteudoDaMigration(sql)).toBe(PLATFORM);
  });

  it("no apêndice da distribuição (o que o kit aplica)", () => {
    const sql = ler("supabase", "songhai.sql");
    expect(sql).toContain("(migration 9002)");
    expect(conteudoDaMigration(sql)).toBe(PLATFORM);
  });
});
