/**
 * SonghaiCRM — o texto segue o Acordo Ortográfico (1990, com o protocolo de 1992):
 * «fatura», não «factura»; «atualizar», não «actualizar»; «ação», não «acção»;
 * «direção», «projeto», «seção», «exato». Consoante que não se pronuncia não se
 * escreve. Fica de fora o que mantém a consoante pronunciada («contacto», «facto»).
 *
 * Decisão do dono do produto (2026-11-04). A cerca varre os ficheiros que a
 * distribuição escreve (faturação, subscrição por webhook, administração, avisos
 * de conta suspensa). O resto do produto passa pela camada `lib/i18n/pt-mz.ts`.
 * Espanhol e vocabulário de deteção (`factura` é palavra espanhola ali) não entram.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../..");

const PASTAS = [
  "lib/billing",
  "lib/subscricoes",
  "app/admin",
  "components/admin",
  "app/account-suspended",
  "app/app/settings/billing",
  "app/api/v1/admin/billing",
  "app/api/v1/admin/tenants",
  "app/api/v1/webhooks/subscricoes",
  "docs/songhai-faturacao.md",
  "docs/subscricoes-webhook.md",
];

/** Grafia anterior ao Acordo, em palavra inteira. `extra_ja_facturado` é código de erro estável. */
const ANTIGA =
  /(?<![\w_])(factur\w*|actualiz\w*|activ(?:ar|ad[oa]s?)|acç\w+|direcç\w+|projecto\w*|secç\w+|exacto\w*|óptim\w+|objecto\w*|efectu\w+)(?![\w_])/giu;

function ficheiros(rel: string): string[] {
  const abs = path.join(RAIZ, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? ficheiros(path.posix.join(rel, e.name)) : [path.posix.join(rel, e.name)]))
    .filter((f) => /\.(ts|tsx|md)$/.test(f) && !/\.test\./.test(f));
}

describe("ortografia do Acordo", () => {
  it("os ficheiros da distribuição não escrevem consoante muda (factura, actualizar, acção…)", () => {
    const culpados: string[] = [];
    for (const f of PASTAS.flatMap(ficheiros)) {
      fs.readFileSync(path.join(RAIZ, f), "utf8")
        .split("\n")
        .forEach((linha, i) => {
          const limpa = linha.replace(/extra_ja_facturado/g, "");
          for (const m of limpa.matchAll(ANTIGA)) culpados.push(`${f}:${i + 1} «${m[0]}»`);
        });
    }
    expect(culpados, "Grafia do Acordo Ortográfico: fatura, atualizar, ação, direção, projeto, seção, exato.").toEqual([]);
  });
});
