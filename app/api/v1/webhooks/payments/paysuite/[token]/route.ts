/**
 * POST /api/v1/webhooks/payments/paysuite/[token] — confirmação de pagamento
 * (SonghaiCRM).
 *
 * O token na URL resolve a organização (`payment_credentials.webhook_path_token`):
 * a organização nunca aparece na URL, só um token opaco.
 *
 * Assinatura: o PaySuite manda `X-Signature` = HMAC-SHA256 hex do corpo cru com
 * o segredo de webhook do painel deles — o mesmo algoritmo de
 * `verifyInboundSignature` (webhooks de captação), reaproveitado.
 *
 * Respostas: evento desconhecido, pagamento sem linha e REENTREGA de um estado
 * já gravado respondem 200 — reenviar não resolve nenhum deles, e recusar
 * geraria retry para sempre. Assinatura inválida responde 401 (o token já foi
 * resolvido). Falha de ESCRITA responde 500: aí sim a reentrega ajuda.
 *
 * Idempotência: a linha só é atualizada quando o status MUDA. A reentrega do
 * mesmo `payment.success` não grava um segundo "Pagamento confirmado" no
 * histórico do negócio (o fork antigo gravava).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { lerConfigDaFaturacao } from "@/lib/billing/config";
import { dependenciasReais } from "@/lib/billing/dependencias";
import { COLUNAS_DA_FATURA, registrarPagamentoDeFatura, type FaturaAberta } from "@/lib/billing/executar";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInboundSignature } from "@/lib/webhooks/inbound";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PaySuiteWebhookBody {
  event?: string;
  data?: { id?: string; amount?: number; reference?: string };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { token } = await ctx.params;
  if (!token || token.length < 8) return fail("not_found", "unknown webhook token", 404, { requestId });

  const admin = createAdminClient();
  const { data: cred } = await admin
    .from("payment_credentials")
    .select("organization_id, webhook_secret_encrypted")
    .eq("webhook_path_token", token)
    .eq("provider", "paysuite")
    .maybeSingle();
  if (!cred) return fail("not_found", "unknown webhook token", 404, { requestId });

  const { organization_id: organizationId, webhook_secret_encrypted: segredoCifrado } = cred as {
    organization_id: string;
    webhook_secret_encrypted: string;
  };

  const rawBody = await req.text();
  const segredo = await decryptWebhookSecret(admin, segredoCifrado);
  if (!segredo || !verifyInboundSignature(rawBody, req.headers.get("x-signature"), segredo)) {
    logger.warn("[webhooks.paysuite] assinatura inválida ou segredo indisponível", { organizationId });
    return fail("unauthorized", "assinatura inválida", 401, { requestId });
  }

  let body: PaySuiteWebhookBody;
  try {
    body = JSON.parse(rawBody) as PaySuiteWebhookBody;
  } catch {
    return fail("invalid_request", "corpo não é JSON válido", 400, { requestId });
  }

  if (body.event !== "payment.success" && body.event !== "payment.failed") {
    return ok({ status: "ignored", reason: "evento_desconhecido" }, { requestId });
  }
  const providerPaymentId = body.data?.id;
  if (!providerPaymentId) return ok({ status: "ignored", reason: "sem_id_de_pagamento" }, { requestId });

  const novoStatus = body.event === "payment.success" ? "paid" : "failed";

  // SonghaiCRM (9010): o pagamento pode ser de uma FACTURA de pacote, e não de um
  // negócio. Só vale se o webhook é da organização que recebe — o token da URL
  // resolveu as credenciais dela, e nenhuma outra organização pode fechar factura.
  // `payment.failed` não mexe: a reconciliação renova o link na rodada seguinte.
  const cfgDaFaturacao = await lerConfigDaFaturacao(admin);
  if (cfgDaFaturacao && cfgDaFaturacao.organizationId === organizationId) {
    const { data: fatura } = await admin
      .from("billing_invoices")
      .select(COLUNAS_DA_FATURA)
      .eq("provider_payment_id", providerPaymentId)
      .maybeSingle();
    if (fatura) {
      if (novoStatus === "paid") {
        try {
          await registrarPagamentoDeFatura(await dependenciasReais(admin, cfgDaFaturacao), fatura as unknown as FaturaAberta);
        } catch (erro) {
          logger.error("[webhooks.paysuite] falha ao dar a factura como paga", {
            organizationId,
            detalhe: erro instanceof Error ? erro.message : String(erro),
          });
          return fail("internal_error", "falha ao gravar confirmação", 500, { requestId });
        }
      }
      return ok({ status: "processed", alvo: "factura" }, { requestId });
    }
  }

  // Só muda o que ainda não está no estado novo: a reentrega não acha linha.
  const { data: atualizado, error: updateErr } = await admin
    .from("payments")
    .update({ status: novoStatus, raw_webhook_payload: body })
    .eq("organization_id", organizationId)
    .eq("provider", "paysuite")
    .eq("provider_payment_id", providerPaymentId)
    .neq("status", novoStatus)
    .select("id, lead_id, amount_cents, currency")
    .maybeSingle();

  if (updateErr) {
    logger.error("[webhooks.paysuite] falha ao atualizar pagamento", { organizationId, error: updateErr.message });
    return fail("internal_error", "falha ao gravar confirmação", 500, { requestId });
  }

  if (!atualizado) {
    const { data: existente } = await admin
      .from("payments")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("provider", "paysuite")
      .eq("provider_payment_id", providerPaymentId)
      .maybeSingle();
    if (existente) return ok({ status: "ignored", reason: "ja_processado" }, { requestId });
    logger.warn("[webhooks.paysuite] webhook para pagamento sem linha correspondente", { organizationId, providerPaymentId });
    return ok({ status: "ignored", reason: "pagamento_nao_encontrado" }, { requestId });
  }

  const linha = atualizado as { id: string; lead_id: string | null; amount_cents: number; currency: string };

  // Só regista — não mexe em etapa/funil: quem decide o que fazer com um
  // pagamento confirmado é a pessoa (decisão do dono do produto).
  if (novoStatus === "paid" && linha.lead_id) {
    await emitLeadActivity(admin, {
      organizationId,
      leadId: linha.lead_id,
      type: "payment_confirmed",
      sourceModule: "payments",
      sourceId: linha.id,
      actor: { type: "webhook_source", id: "paysuite" },
      reason: `Pagamento confirmado: ${formatCents(linha.amount_cents, linha.currency)}`,
      payload: { payment_id: linha.id },
    });
  }

  void audit({
    action: "payment.status_changed",
    organizationId,
    resourceType: "payment",
    resourceId: linha.id,
    metadata: { provider: "paysuite", status: novoStatus, lead_id: linha.lead_id },
    requestId,
    bypassedRls: true,
  });

  return ok({ status: "processed" }, { requestId });
}
