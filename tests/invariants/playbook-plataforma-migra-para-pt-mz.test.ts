/**
 * Migration 9002 (SonghaiCRM): a camada plataforma que manda escrever em
 * "português do Brasil" é trocada pela de Moçambique — e SÓ ela.
 *
 * Roda o bloco REAL do `supabase/songhai.sql` (o que o kit aplica) num banco
 * com o baseline, cada caso dentro de begin/rollback:
 *   - ponteiro na versão brasileira → versão nova com o platform.md, ponteiro movido;
 *   - reaplicar → nenhuma versão a mais (idempotente);
 *   - camada escrita à mão, sem o texto brasileiro → intocada;
 *   - sem ponteiro (instalação nova) → nada gravado: quem semeia é o worker.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

const SONGHAI = readFileSync(join(process.cwd(), "supabase", "songhai.sql"), "utf8");
const PLATFORM = readFileSync(join(process.cwd(), "lib", "agent-engine", "playbooks", "platform.md"), "utf8");

const ROTULO = "-- ---- Camada plataforma do playbook em português de Moçambique (migration 9002) ----";

function blocoDa0502(): string {
  const inicio = SONGHAI.indexOf(ROTULO);
  if (inicio === -1) throw new Error("rótulo da 9002 não encontrado no songhai.sql");
  const fim = SONGHAI.indexOf("\n-- ---- ", inicio + ROTULO.length);
  if (fim === -1) throw new Error("fim do bloco da 9002 não encontrado");
  return SONGHAI.slice(inicio, fim);
}

const MARCA = "SONDA|";

/** Roda `preparo` + o bloco (N vezes) + sondas, tudo desfeito no fim. */
function rodar(preparo: string, vezes: number): { versoes: number; ativo: string | null } {
  const bloco = blocoDa0502();
  const saida = sql(`begin;
delete from public.playbook_pointers where organization_id is null and layer = 'platform';
${preparo}
create temporary table sonda_antes as
  select count(*)::int as n from public.playbook_versions where organization_id is null and layer = 'platform';
${Array.from({ length: vezes }, () => bloco).join("\n")}
select '${MARCA}versoes|' || ((select count(*) from public.playbook_versions where organization_id is null and layer = 'platform') - (select n from sonda_antes));
select '${MARCA}ativo|' || coalesce(replace(encode(convert_to(v.content, 'UTF8'), 'base64'), chr(10), ''), '') -- base64 do pg quebra a cada 76
  from public.playbook_pointers p join public.playbook_versions v on v.id = p.version_id
 where p.organization_id is null and p.layer = 'platform';
rollback;`);
  const linhas = saida.split("\n").filter((l) => l.startsWith(MARCA)).map((l) => l.slice(MARCA.length));
  /** Versões criadas PELO BLOCO (a do preparo já está em sonda_antes). */
  const versoes = Number(linhas.find((l) => l.startsWith("versoes|"))?.split("|")[1]);
  const ativo64 = linhas.find((l) => l.startsWith("ativo|"))?.slice("ativo|".length);
  return {
    versoes,
    ativo: ativo64 === undefined ? null : Buffer.from(ativo64.replace(/\s/g, ""), "base64").toString("utf8"),
  };
}

/** Publica uma versão plataforma e aponta para ela. */
const apontarPara = (conteudo: string) => `
with v as (
  insert into public.playbook_versions (organization_id, layer, content)
  values (null, 'platform', $c$${conteudo}$c$) returning id
)
insert into public.playbook_pointers (organization_id, layer, version_id) select null, 'platform', id from v;`;

/** Onde dois textos começam a divergir — para a falha dizer o quê, não só "diferente". */
function divergencia(a: string | null, b: string): string {
  if (a === null) return "nenhuma versão ativa";
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const cod = (s: string) => [...s.slice(i, i + 3)].map((c) => c.codePointAt(0)!.toString(16)).join(" ");
  return `tamanhos ${a.length}/${b.length}; diverge em ${i}: gravado [${cod(a)}] × arquivo [${cod(b)}] — «${b.slice(Math.max(0, i - 20), i + 10)}»`;
}

const BRASILEIRA ="## Identidade\n\nVocê conversa por WhatsApp, sempre em\nportuguês do Brasil, com naturalidade.\n";
const ESCRITA_A_MAO = "## Identidade\n\nFale como a nossa loja de Nampula fala.\n";

describe("migration 9002 — camada plataforma em português de Moçambique", () => {
  it("versão brasileira ativa: publica o platform.md e move o ponteiro", () => {
    const r = rodar(apontarPara(BRASILEIRA), 1);
    expect(r.versoes).toBe(1); // versões NOVAS: só a do platform.md
    expect(r.ativo, divergencia(r.ativo, PLATFORM)).toBe(PLATFORM);
  });

  it("reaplicar não publica outra versão", () => {
    const r = rodar(apontarPara(BRASILEIRA), 3);
    expect(r.versoes).toBe(1);
    expect(r.ativo, divergencia(r.ativo, PLATFORM)).toBe(PLATFORM);
  });

  it("camada escrita à mão, sem o texto brasileiro, fica intocada", () => {
    const r = rodar(apontarPara(ESCRITA_A_MAO), 1);
    expect(r.versoes).toBe(0);
    expect(r.ativo).toBe(ESCRITA_A_MAO);
  });

  it("sem ponteiro (instalação nova): nada é gravado — quem semeia é o worker", () => {
    const r = rodar("", 1);
    expect(r.versoes).toBe(0);
    expect(r.ativo).toBeNull();
  });
});
