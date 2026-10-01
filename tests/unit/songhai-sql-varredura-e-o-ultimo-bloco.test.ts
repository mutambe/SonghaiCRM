/**
 * O APÊNDICE DA DISTRIBUIÇÃO (`supabase/songhai.sql`) SEGUE AS REGRAS DO BASELINE.
 *
 * Ele roda DEPOIS do `baseline.sql`, na mesma chamada do psql — e portanto
 * depois da varredura de anon do upstream. Toda função que ele criar nasce com
 * EXECUTE para anon (o `ALTER DEFAULT PRIVILEGES` do corpo do baseline), e só a
 * varredura do FIM deste arquivo a cura. O mesmo raciocínio de
 * `varredura-anon-e-o-ultimo-bloco.test.ts`, aplicado ao nosso arquivo.
 *
 * E cada bloco nomeia a migration de onde veio: sem o arquivo correspondente
 * em `supabase/migrations/`, quem aplica a cadeia pela CLI do Supabase não
 * receberia a mudança (tripla de migration do CLAUDE.md).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const SQL = readFileSync(join(RAIZ, "supabase", "songhai.sql"), "utf8");
const MARCADOR = /^-- ---- VARREDURA anon do apêndice da distribuição/m;
const CRIA_FUNCAO = /^[ \t]*create[ \t]+(?:or[ \t]+replace[ \t]+)?function/gim;
const BLOCO = /^-- ---- .+\(migration (\d{4})\) ----$/gm;

describe("supabase/songhai.sql", () => {
  it("tem a varredura de anon, e ela é o último bloco", () => {
    const pos = MARCADOR.exec(SQL)?.index ?? -1;
    expect(pos, "varredura do apêndice não encontrada").toBeGreaterThan(-1);
    const blocosDepois = [...SQL.matchAll(/^-- ---- /gm)].filter((m) => m.index > pos);
    expect(blocosDepois, "bloco depois da varredura do apêndice").toEqual([]);
  });

  it("nenhuma função é criada depois da varredura", () => {
    const pos = MARCADOR.exec(SQL)?.index ?? -1;
    const depois = [...SQL.matchAll(CRIA_FUNCAO)].filter((m) => m.index > pos);
    expect(depois).toEqual([]);
  });

  it("cada bloco tem o arquivo da migration em supabase/migrations/", () => {
    const migrations = readdirSync(join(RAIZ, "supabase", "migrations"));
    const blocos = [...SQL.matchAll(BLOCO)].map((m) => m[1]!);
    expect(blocos.length, "nenhum bloco com cabeçalho de migration").toBeGreaterThan(0);
    const semArquivo = blocos.filter((n) => !migrations.some((f) => f.includes(`_${n}_`)));
    expect(semArquivo).toEqual([]);
  });

  it("o kit aplica o apêndice na mesma chamada do baseline", () => {
    const comum = readFileSync(join(RAIZ, "hostgator-setup-kit", "_common.sh"), "utf8");
    expect(comum).toContain("songhai.sql");
    expect(comum).toMatch(/-f \/b\.sql -f \/s\.sql/);
    const install = readFileSync(join(RAIZ, "hostgator-setup-kit", "install.sh"), "utf8");
    expect(install).toContain("songhai.sql");
    expect(existsSync(join(RAIZ, "supabase", "songhai.sql"))).toBe(true);
  });
});
