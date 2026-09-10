/**
 * E2E — fluxo completo do licenciamento por tenant (plano
 * `.superpowers/sdd/2026-09-09-licenciamento-por-tenant`, task 13), provado
 * pela TELA como a doutrina de QA Visual do CLAUDE.md exige:
 *
 *   1. platform admin (`e2e-dono`, TOTP obrigatório) cria um tenant novo em
 *      /admin/tenants/new — formulário real da Task 8, catálogo de planos
 *      real via GET /api/v1/plans (sem hardcode de plano)
 *   2. a tela de detalhe do tenant mostra a assinatura recém-criada (Task 9)
 *   3. o e-mail de convite do responsável (disparado por
 *      `admin.auth.admin.inviteUserByEmail` em POST /api/v1/admin/tenants)
 *      chega no Mailpit local; o owner segue o link, define senha e loga
 *
 * ═══ QUEM É O DONO AQUI ═══
 *
 * `e2e-dono` (platform_admins), o MESMO usuário dedicado que
 * tests/e2e/system-update.spec.ts usa — ver o cabeçalho daquele arquivo para
 * o porquê de NÃO ser o `e2e-admin` compartilhado por 10 outras specs
 * (promoção contamina navegação/gates de admin de tenant compartilhado).
 * Reaproveitamos o MESMO seed (`scripts/seed-e2e-system-update.ts`) — não é
 * um helper novo, é a promoção já existente no repo.
 *
 * ═══ O E-MAIL DE CONVITE DO OWNER NÃO É O CONVITE DE EQUIPE ═══
 *
 * `tests/e2e/invite-lifecycle.spec.ts` testa o convite APP-LEVEL
 * (`user_invites` + `signInviteToken`, tela /team/accept-invite) — mecanismo
 * diferente. O convite do owner de um tenant novo usa
 * `admin.auth.admin.inviteUserByEmail`, o convite NATIVO do Supabase Auth
 * (app/api/v1/admin/tenants/route.ts). Capturamos esse e-mail pelo Mailpit
 * local (supabase/config.toml, porta 54324) com o MESMO helper que
 * password-recovery.spec.ts e signup-journey.spec.ts já usam
 * (tests/e2e/helpers/auth.ts) — reuso de infra real, não um mock novo.
 *
 * ⚠️ RISCO DOCUMENTADO (não é um mock, é uma lacuna real já registrada no
 * código): ao contrário de confirmation.html/recovery.html, NÃO existe
 * `supabase/templates/invite.html` nem `[auth.email.template.invite]` em
 * `supabase/config.toml` — o convite do owner sai com o template PADRÃO do
 * Supabase. `app/auth/confirm/route.ts:10-49` documenta que o template
 * padrão gera um link `code` (não `token_hash`), passando primeiro pelo
 * `/auth/v1/verify` hospedado do GoTrue. Se este passo falhar na primeira
 * execução real com um erro do tipo "link com token_hash não encontrado" ou
 * de troca de code/PKCE, a causa mais provável é essa lacuna pré-existente
 * (falta de template customizado para `invite`) — não um erro de sintaxe
 * deste spec. Corrigi-la é trabalho de produto (criar o template), fora do
 * escopo da task 13 (só escrever o E2E).
 *
 * Pré-requisitos: Supabase local com Mailpit + app `next start` (mesmo setup
 * do restante da suíte — ver playwright.config.ts). `.e2e-creds.json` é
 * gerado sozinho se ausente/incompleto (mesmo padrão de
 * tests/e2e/system-update.spec.ts).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import { generateTotp, msUntilNextTotpWindow } from "./utils/totp";
import { waitForEmail, extractAuthConfirmLink } from "./helpers/auth";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

interface E2ECreds {
  password: string;
  users: Record<string, { id: string; email: string; role: string }>;
  dono_totp?: { factor_id: string; secret: string };
}

function loadCreds(): E2ECreds {
  const needsSeed = (): boolean => {
    if (!fs.existsSync(CREDS_PATH)) return true;
    const c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as E2ECreds;
    return !c.users?.dono || !c.dono_totp?.secret;
  };
  if (needsSeed()) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
  }
  // Promove `dono` a platform_admin (mesmo seed que
  // tests/e2e/system-update.spec.ts usa) — idempotente. O reset de
  // system_version/system_update_runs que ele também faz é um efeito
  // colateral inofensivo aqui (este spec não lê nenhum dos dois).
  execFileSync("npx", ["tsx", "scripts/seed-e2e-system-update.ts"], { stdio: "inherit" });
  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as E2ECreds;
}

const creds: E2ECreds = loadCreds();

/** Mesmo padrão de tests/e2e/system-update.spec.ts — login do dono do servidor. */
async function loginPlatformAdminComTotp(page: Page): Promise<void> {
  const { email } = creds.users.dono!;
  const secret = creds.dono_totp!.secret;

  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/login\/mfa/);

  // Até 2 tentativas: um código pode expirar na borda da janela de 30s.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (msUntilNextTotpWindow() < 3_000) {
      await page.waitForTimeout(msUntilNextTotpWindow() + 200);
    }
    const code = generateTotp(secret);
    const firstDigit = page.locator('input[aria-label="Dígito 1"]');
    await firstDigit.click();
    await page.keyboard.type(code, { delay: 40 });
    try {
      await page.waitForURL(/\/app\//, { timeout: 8_000 });
      return;
    } catch {
      await page.waitForTimeout(msUntilNextTotpWindow() + 200);
    }
  }
  throw new Error("MFA challenge failed after 2 TOTP attempts");
}

test("admin cria tenant, owner aceita convite e loga", async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);

  // 1) Login como platform admin.
  await loginPlatformAdminComTotp(page);

  // 2) Formulário real de /admin/tenants/new (app/admin/(protected)/tenants/new/_form.tsx,
  // Task 8): catálogo de planos via GET /api/v1/plans, sem hardcode de valor.
  const ownerEmail = `owner-${Date.now()}@e2e.test`;
  await page.goto("/admin/tenants/new");

  await page.getByLabel("Nome de exibição").fill("E2E Tenant");
  // Slug é auto-gerado a partir do nome de exibição (slugify em onChange) —
  // não precisa ser preenchido à mão.
  await page.getByLabel("E-mail do responsável").fill(ownerEmail);

  await page.getByLabel("Pacote").click();
  await page.getByRole("option").first().click();

  await page.getByRole("button", { name: "Criar tenant" }).click();
  await expect(page).toHaveURL(/\/admin\/tenants\/[0-9a-f-]+$/);

  // 3) Prova visual da assinatura (Task 9): o plano real aparece como badge
  // na tela de detalhe (components/admin/tenants/TenantOverview.tsx —
  // subscription.plan_display_name), um dos 4 pacotes seedados em
  // supabase/baseline.sql ("Agente Simples/Médio/Avançado" ou "Enterprise").
  await expect(page.getByText(/Agente|Enterprise/)).toBeVisible();

  // 4) Convite do owner — efeito colateral externo real (não mock): o
  // handler chama admin.auth.admin.inviteUserByEmail, o Mailpit local
  // captura o e-mail de verdade. Sessão separada (novo browser context) —
  // o owner é uma pessoa/dispositivo diferente do platform admin.
  const html = await waitForEmail(ownerEmail, "");
  const link = extractAuthConfirmLink(html, baseURL!);

  const ownerContext = await context.browser()!.newContext();
  const ownerPage = await ownerContext.newPage();
  try {
    await ownerPage.goto(link);
    // app/auth/confirm/route.ts, branch type === "invite": reusa a tela de
    // nova senha da recuperação (não provisiona organization nova — a org e
    // a membership já existem desde o POST /api/v1/admin/tenants).
    await expect(ownerPage).toHaveURL(/\/login\/reset/);

    const newPassword = "SenhaOwnerE2E!123";
    await ownerPage.getByLabel("Nova senha", { exact: true }).fill(newPassword);
    await ownerPage.getByLabel("Confirmar nova senha").fill(newPassword);
    await ownerPage.getByRole("button", { name: "Definir nova senha" }).click();
    await expect(ownerPage).toHaveURL(/\/login\?reset=success/);

    // 5) Login com a senha recém-definida.
    await ownerPage.getByLabel("Email").fill(ownerEmail);
    await ownerPage.getByLabel("Senha").fill(newPassword);
    await ownerPage.getByRole("button", { name: "Entrar" }).click();
    await ownerPage.waitForURL(/\/(app|onboarding)\//, { timeout: 30_000 });
    await expect(ownerPage).not.toHaveURL(/\/login/);
  } finally {
    await ownerContext.close();
  }
});
