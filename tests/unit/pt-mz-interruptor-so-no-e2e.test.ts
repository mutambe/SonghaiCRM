/**
 * SonghaiCRM — o interruptor `NEXT_PUBLIC_PT_MZ_TEXTO_ORIGINAL` existe SÓ para
 * as specs do upstream no e2e (ver `camadaPtMzDesligada` em lib/i18n/pt-mz.ts).
 *
 * O risco que este arquivo vigia é o interruptor vazar para onde o cliente
 * está: se a imagem publicada, o kit ou um `.env` de exemplo o ligassem, toda
 * instalação voltaria a mostrar português do Brasil sem ninguém perceber — os
 * testes unitários da camada passariam, porque leem a função com o ambiente
 * deles.
 */
import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { fraseEmPortuguesDeMocambique } from "@/lib/i18n/frases-pt-mz";
import { camadaPtMzDesligada, htmlEmPortuguesDeMocambique, paraPortuguesDeMocambique } from "@/lib/i18n/pt-mz";

const VARIAVEL = "NEXT_PUBLIC_PT_MZ_TEXTO_ORIGINAL";
const RAIZ = path.resolve(__dirname, "../..");

afterEach(() => {
  delete process.env[VARIAVEL];
});

describe("interruptor da camada pt-MZ", () => {
  it("por padrão a camada está LIGADA", () => {
    expect(camadaPtMzDesligada()).toBe(false);
    expect(paraPortuguesDeMocambique("Carregando a tela")).not.toBe("Carregando a tela");
    expect(fraseEmPortuguesDeMocambique("Sua reunião está marcada para")).toBe("A sua reunião está marcada para");
  });

  it("com o interruptor, devolve o texto original — nas três portas da camada", () => {
    process.env[VARIAVEL] = "1";
    expect(camadaPtMzDesligada()).toBe(true);
    expect(paraPortuguesDeMocambique("Carregando a tela")).toBe("Carregando a tela");
    expect(htmlEmPortuguesDeMocambique("<p>Carregando a tela</p>")).toBe("<p>Carregando a tela</p>");
    expect(fraseEmPortuguesDeMocambique("Sua reunião está marcada para")).toBeUndefined();
  });

  it("qualquer outro valor não desliga", () => {
    process.env[VARIAVEL] = "true";
    expect(camadaPtMzDesligada()).toBe(false);
  });
});

/** Onde o nome pode aparecer — e nenhum outro lugar que embarque ou instale. */
const PERMITIDOS = new Set([
  "lib/i18n/pt-mz.ts",
  "lib/i18n/frases-pt-mz.ts",
  ".github/workflows/e2e.yml",
  "tests/unit/pt-mz-interruptor-so-no-e2e.test.ts",
]);

const PASTAS = ["app", "components", "hooks", "lib", "workers", "scripts", "hostgator-setup-kit", "docker", ".github", "tests"];
const NA_RAIZ = /^(Dockerfile.*|docker-compose.*\.ya?ml|\.env.*\.example|next\.config\..*|package\.json)$/;

function arquivos(dir: string): string[] {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return [];
  const saida: string[] = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) saida.push(...arquivos(rel));
    else saida.push(rel);
  }
  return saida;
}

describe("o interruptor não chega a quem instala", () => {
  it(`${VARIAVEL} só aparece no e2e e na própria camada`, () => {
    const candidatos = [
      ...PASTAS.flatMap(arquivos),
      ...fs.readdirSync(RAIZ).filter((n) => NA_RAIZ.test(n)),
    ];
    const fora = candidatos.filter(
      (f) => !PERMITIDOS.has(f) && fs.readFileSync(path.join(RAIZ, f), "utf8").includes(VARIAVEL),
    );
    expect(fora).toEqual([]);
  });

  it("o e2e liga o interruptor ANTES do build", () => {
    const e2e = fs.readFileSync(path.join(RAIZ, ".github/workflows/e2e.yml"), "utf8");
    const liga = e2e.indexOf(`${VARIAVEL}=1`);
    const build = e2e.indexOf("run: pnpm e2e:build");
    expect(liga).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(liga);
  });
});
