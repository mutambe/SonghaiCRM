/**
 * A MOEDA DA ORGANIZAÇÃO — PROVA PELA TELA (DoD item 12).
 *
 * SonghaiCRM: a organização nasce em METICAL (MZN, `supabase/songhai.sql`), e as
 * moedas servidas são MZN, USD, ZAR e EUR (`MOEDAS_SERVIDAS`, lib/money.ts). O
 * spec do upstream provava BRL → peso mexicano; aqui prova o mesmo contrato com
 * as moedas de Moçambique.
 *
 * Os testes unitários provam que `formatCents` deriva o formato certo e que a
 * rota ignora a moeda do corpo. Isto prova o que um dono de loja em Maputo faz
 * de verdade: abre Configurações, vê Metical, cadastra um produto e lê o preço
 * na tela — não um mock de `Intl`, o `next start` real contra o Postgres real.
 *
 * Dois atos:
 *   1. Configurações › Organização: mudar para dólar, salvar, RECARREGAR a
 *      página e confirmar que persistiu — não só que o formulário aceitou.
 *   2. Produtos: em metical, cadastrar um preço e ler `249,90 MTn` na lista —
 *      vírgula decimal, símbolo depois do número; nunca `R$`.
 *
 * Devolve a organização para Metical no final: outros specs que compartilham
 * este banco local presumem MZN.
 *
 * Pré-requisito: `.e2e-creds.json` (gerado por scripts/seed-e2e-credentials.ts).
 */
import { mkdirSync } from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "./helpers/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

let creds = lerCreds();
// ⚠️ `evidence/`, não `.superpowers/evidence/` — a segunda é gitignored de
// propósito. Escrever nela fazia o journey map citar caminho que `git
// ls-files` não conhece (reprova em `tests/unit/evidencia-citada.test.ts`) e,
// mais grave: um rerun deste spec não atualizava a evidência que o mapa cita,
// porque as duas pastas divergem. Mesmo padrão de `agente-novo-e-uso.spec.ts`,
// `followup-linguagem.spec.ts` e outros ~15 specs.
const EVIDENCE = path.join(process.cwd(), "evidence", "moeda-da-organizacao");
mkdirSync(EVIDENCE, { recursive: true });

async function loginAdmin(page: Page): Promise<void> {
  creds = await loginComoAdmin(page, creds);
}

/** Código único por execução — reruns num banco compartilhado ficam verdes. */
const SUFIXO = Date.now().toString(36);

// Dois casos, cada um com `loginComoAdmin`. O helper espera a janela TOTP
// virar quando o código da suíte já foi usado — e essa espera sozinha come os
// 30 s do teto global. Medido no CI: o primeiro caso passou em 7,9 s; o segundo
// estourou 30 s esperando a linha do produto, enquanto o `afterEach` já tinha
// navegado de volta para Configurações. Mesmo padrão de `navegacao.spec.ts` e
// `prova-painel-provedores.spec.ts`.
test.describe.configure({ timeout: 90_000 });

test.describe("moeda da organização", () => {
  test.afterEach(async ({ page }) => {
    // Devolve o padrão para não vazar estado a outros specs do mesmo banco.
    await page.goto("/app/settings/tenant");
    const moeda = page.locator("#currency");
    if (await moeda.isVisible().catch(() => false)) {
      await moeda.click();
      await page.getByRole("option", { name: /^Metical/ }).click();
      await page.getByRole("button", { name: /salvar/i }).click();
      await expect(page.getByText(/organiza..o atualizada/i)).toBeVisible({ timeout: 10_000 });
    }
  });

  test("mudar para dólar americano persiste depois de recarregar", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/app/settings/tenant");

    const moeda = page.locator("#currency");
    await expect(moeda).toBeVisible();
    // Estado inicial: a única organização deste banco local nasce em metical.
    await expect(moeda).toContainText("Metical (MTn)");

    await page.screenshot({ path: path.join(EVIDENCE, "moeda-01-antes.png") });

    await moeda.click();
    await page.getByRole("option", { name: /^Dólar americano/ }).click();
    await page.getByRole("button", { name: /salvar/i }).click();
    await expect(page.getByText(/organiza..o atualizada/i)).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: path.join(EVIDENCE, "moeda-02-usd-salvo.png") });

    // ⚠️ O TESTE É O RELOAD, não o toast. Um formulário que só atualiza o
    // estado local em memória mostraria "salvo" e a tela recarregada voltaria
    // à moeda antiga — foi exatamente o defeito que o seletor de idioma do perfil teve
    // meses antes desta feature.
    await page.reload();
    await expect(page.locator("#currency")).toContainText("Dólar americano (US$)");

    await page.screenshot({ path: path.join(EVIDENCE, "moeda-03-usd-apos-reload.png") });
  });

  test("produto em metical mostra o preço como se lê em Moçambique", async ({ page }) => {
    await loginAdmin(page);

    // Precondição: a organização em metical para este produto herdar.
    await page.goto("/app/settings/tenant");
    await page.locator("#currency").click();
    await page.getByRole("option", { name: /^Metical/ }).click();
    await page.getByRole("button", { name: /salvar/i }).click();
    await expect(page.getByText(/organiza..o atualizada/i)).toBeVisible({ timeout: 10_000 });

    await page.goto("/app/products");
    await expect(page.getByTestId("tela-produtos")).toBeVisible();
    await page.getByTestId("novo-produto").click();
    await expect(page.getByTestId("form-produto")).toBeVisible();

    const codigo = `E2E-MZN-${SUFIXO}`;
    await page.getByTestId("produto-codigo").fill(codigo);
    await page.getByLabel(/^Nome$/).fill("Produto de teste MZN");
    await page.getByTestId("produto-preco").fill("249,90");
    await page.getByTestId("salvar-produto").click();
    await expect(page.getByText(/produto cadastrado/i)).toBeVisible({ timeout: 15_000 });

    const linha = page.getByTestId(`produto-${codigo}`);
    await expect(linha).toBeVisible({ timeout: 15_000 });

    // ⚠️ A ASSERÇÃO É O NÚMERO, não a presença da linha: os mesmos dígitos com
    // o símbolo errado ("R$ 249,90", "MZN 249,90") passariam num teste que só
    // checasse "o preço apareceu". O espaço entre número e símbolo pode ser o
    // inseparável do Intl, por isso a expressão aceita qualquer espaço.
    await expect(linha).toContainText(/249,90\sMTn/);
    await expect(linha).not.toContainText("R$");

    await page.screenshot({ path: path.join(EVIDENCE, "moeda-04-produto-mzn.png") });
  });
});
