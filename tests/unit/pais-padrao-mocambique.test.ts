/**
 * SonghaiCRM — o país padrão é Moçambique (`PAIS_PADRAO`), e o código que
 * embarca não escreve "BR" como valor de reserva.
 *
 * Achado pelo e2e do main (2026-10-02): a tela Configurações › Organização
 * abria com `country: row.country ?? "BR"`. Como a organização nasce com o país
 * vazio (vazio = país padrão), TODA gravação desta tela — nome, fuso, moeda,
 * retenção — voltava "País sem perfil revisado: BR", porque o Brasil não está
 * no registro de países desta distribuição. Nenhuma organização conseguia
 * salvar as próprias configurações.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PAIS_PADRAO, paisesOferecidos } from "@/lib/legal/perfil-do-pais";

const RAIZ = path.resolve(__dirname, "../..");

function arquivos(dir: string): string[] {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return [];
  const saida: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) saida.push(...arquivos(rel));
    else if (/\.(ts|tsx)$/.test(rel) && !/\.test\.tsx?$/.test(rel)) saida.push(rel);
  }
  return saida;
}

describe("país padrão de Moçambique", () => {
  it("o país padrão é MZ e é um dos países oferecidos (a gravação aceita)", () => {
    expect(PAIS_PADRAO).toBe("MZ");
    expect(paisesOferecidos().map((p) => p.codigo)).toContain(PAIS_PADRAO);
  });

  it('nenhum "BR" como valor no código que embarca (fora de comentário)', () => {
    const culpados: string[] = [];
    for (const dir of ["app", "components", "hooks", "lib", "workers"]) {
      for (const f of arquivos(dir)) {
        fs.readFileSync(path.join(RAIZ, f), "utf8")
          .split("\n")
          .forEach((linha, i) => {
            if (/["']BR["']/.test(linha) && !/^\s*(\/\/|\*|\/\*)/.test(linha)) culpados.push(`${f}:${i + 1}`);
          });
      }
    }
    expect(culpados, "Use PAIS_PADRAO (lib/legal/perfil-do-pais.ts).").toEqual([]);
  });

  it("a tela de configurações da organização cai no país padrão", () => {
    const pagina = fs.readFileSync(path.join(RAIZ, "app/app/settings/tenant/page.tsx"), "utf8");
    expect(pagina).toContain("row.country ?? PAIS_PADRAO");
  });
});
