/**
 * SUBSCRIÇÃO DOS TENANTS POR WEBHOOK — a prova real (SonghaiCRM).
 *
 * O contrato está em `docs/subscricoes-webhook.md` e as recusas da rota em
 * `tests/unit/subscricoes-webhook.test.ts` (com o serviço simulado). Esta spec fecha a
 * metade que o teste unitário não alcança: a rota REAL, no `next start`, com o banco REAL
 * e as funções do administrador da plataforma por trás.
 *
 *   1. sem assinatura, ou com a assinatura de outro segredo: 401, e nada é criado;
 *   2. `occurred_at` fora de ±10 minutos: 400;
 *   3. `subscription.created` cria a organização, põe o pacote como assinatura vigente e
 *      devolve 201; o MESMO `event_id` outra vez devolve 200 com a MESMA organização
 *      (idempotência: o reenvio de um site nunca cria dois tenants);
 *   4. o dono do servidor VÊ o tenant no painel (`/admin/tenants/[id]`);
 *   5. `subscription.plan_changed` troca o pacote vigente;
 *   6. `subscription.cancelled` suspende a organização (reversível, nada é apagado).
 *
 * O segredo vem do `.env.e2e` (`scripts/gerar-env-e2e.sh`); a rota fica desligada (404)
 * sem ele, e é isso que protege uma instalação que não o configurou.
 */
import { createHmac, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { expect, test } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

test.describe.configure({ timeout: 180_000, mode: "serial" });

const CAMINHO = "/api/v1/webhooks/subscricoes";
const SEGREDO = process.env.SUBSCRICOES_WEBHOOK_SECRET ?? "";

const db = createClient(credenciaisSupabaseDeTeste().url, credenciaisSupabaseDeTeste().serviceRole, {
  auth: { persistSession: false },
});

function assinar(bruto: string, segredo = SEGREDO): string {
  return createHmac("sha256", segredo).update(bruto).digest("hex");
}

const sufixo = randomUUID().slice(0, 8);
const nuit = String(400_000_000 + (Date.now() % 90_000_000));
const nome = `Clínica Webhook ${sufixo}`;
const dono = `dono.${sufixo}@example.test`;
const idDoEvento = `evt_e2e_${sufixo}`;

function criacao(extra: Record<string, unknown> = {}) {
  return {
    event: "subscription.created",
    event_id: idDoEvento,
    occurred_at: new Date().toISOString(),
    data: {
      plan: "agente_simples",
      organization: { display_name: nome, legal_name: `${nome}, Lda`, nuit },
      owner: { email: dono },
    },
    ...extra,
  };
}

let organizationId = "";
let slug = "";

test.beforeAll(() => {
  // Sem o segredo no ambiente o teste não mede nada: falha alto em vez de passar vazio.
  expect(SEGREDO.length, "SUBSCRICOES_WEBHOOK_SECRET ausente do .env.e2e").toBeGreaterThanOrEqual(32);
});

test("recusa sem assinatura, com a assinatura de outro segredo e com o relógio fora da janela", async ({ request }) => {
  const corpo = JSON.stringify(criacao({ event_id: `evt_e2e_recusa_${sufixo}` }));

  const semAssinatura = await request.post(CAMINHO, { headers: { "content-type": "application/json" }, data: corpo });
  expect(semAssinatura.status()).toBe(401);

  const outroSegredo = await request.post(CAMINHO, {
    headers: { "content-type": "application/json", "x-signature": assinar(corpo, "x".repeat(40)) },
    data: corpo,
  });
  expect(outroSegredo.status()).toBe(401);

  const antigo = JSON.stringify(criacao({ event_id: `evt_e2e_antigo_${sufixo}`, occurred_at: "2020-01-01T00:00:00Z" }));
  const foraDaJanela = await request.post(CAMINHO, {
    headers: { "content-type": "application/json", "x-signature": assinar(antigo) },
    data: antigo,
  });
  expect(foraDaJanela.status()).toBe(400);

  // Nada disto pode ter criado organização.
  const { count } = await db.from("organizations").select("id", { count: "exact", head: true }).eq("display_name", nome);
  expect(count).toBe(0);
});

test("subscription.created cria o tenant com o pacote, e o reenvio do mesmo evento é idempotente", async ({ request }) => {
  const corpo = JSON.stringify(criacao());
  const cabecalhos = { "content-type": "application/json", "x-signature": assinar(corpo) };

  const primeira = await request.post(CAMINHO, { headers: cabecalhos, data: corpo });
  expect(primeira.status(), await primeira.text()).toBe(201);
  const dados = ((await primeira.json()) as { data: { organization_id: string; slug: string; created: boolean } }).data;
  expect(dados.created).toBe(true);
  organizationId = dados.organization_id;
  slug = dados.slug;

  const { data: assinatura, error } = await db
    .from("organization_subscriptions")
    .select("status, plans(slug)")
    .eq("organization_id", organizationId)
    .is("ended_at", null)
    .single();
  expect(error).toBeNull();
  expect(assinatura?.status).toBe("active");
  expect((assinatura as unknown as { plans: { slug: string } }).plans.slug).toBe("agente_simples");

  const segunda = await request.post(CAMINHO, { headers: cabecalhos, data: corpo });
  expect(segunda.status(), await segunda.text()).toBe(200);
  const repetido = ((await segunda.json()) as { data: { organization_id: string; created: boolean } }).data;
  expect(repetido.organization_id).toBe(organizationId);
  expect(repetido.created).toBe(false);

  const { count } = await db.from("organizations").select("id", { count: "exact", head: true }).eq("display_name", nome);
  expect(count, "o reenvio não pode criar uma segunda organização").toBe(1);
});

test("o dono do servidor vê o tenant criado no painel de administração", async ({ page }) => {
  expect(organizationId, "o teste anterior tem de ter criado o tenant").not.toBe("");
  await afirmarDonoDoServidor(lerCreds().users.dono!.email);
  await loginComoDono(page, lerCreds());

  await page.goto(`/admin/tenants/${organizationId}`);
  await expect(page.getByText(nome).first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: "evidence/subscricoes-webhook/tenant-no-painel.png", fullPage: true });
});

test("subscription.plan_changed troca o pacote vigente e subscription.cancelled suspende, sem apagar", async ({ request }) => {
  expect(slug, "o tenant tem de existir").not.toBe("");

  const troca = JSON.stringify({
    event: "subscription.plan_changed",
    event_id: `evt_e2e_troca_${sufixo}`,
    occurred_at: new Date().toISOString(),
    data: { organization_slug: slug, plan: "agente_medio" },
  });
  const r1 = await request.post(CAMINHO, { headers: { "content-type": "application/json", "x-signature": assinar(troca) }, data: troca });
  expect(r1.status(), await r1.text()).toBe(200);

  const { data: vigente } = await db
    .from("organization_subscriptions")
    .select("plans(slug)")
    .eq("organization_id", organizationId)
    .is("ended_at", null)
    .single();
  expect((vigente as unknown as { plans: { slug: string } }).plans.slug).toBe("agente_medio");

  const cancela = JSON.stringify({
    event: "subscription.cancelled",
    event_id: `evt_e2e_cancela_${sufixo}`,
    occurred_at: new Date().toISOString(),
    data: { organization_slug: slug, reason: "Cliente cancelou o contrato (prova e2e)" },
  });
  const r2 = await request.post(CAMINHO, { headers: { "content-type": "application/json", "x-signature": assinar(cancela) }, data: cancela });
  expect(r2.status(), await r2.text()).toBe(200);

  const { data: org } = await db.from("organizations").select("status").eq("id", organizationId).single();
  expect(org?.status, "suspensa, e não apagada").toBe("suspended");
});
