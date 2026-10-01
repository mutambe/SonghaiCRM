/**
 * POST /api/v1/leads/[id]/charge — gera um link de cobrança PaySuite para o
 * negócio (SonghaiCRM: M-Pesa, e-Mola, cartão).
 *
 * Botão manual "Cobrar" no dossiê do negócio: a pessoa (ou a IA) decide QUANDO
 * cobrar; esta rota só faz o passo técnico. Escrita é agent+ — o mesmo nível de
 * quem edita o negócio.
 *
 * O valor padrão é `crm_leads.value_cents` do momento, mas ele FICA gravado em
 * `payments`: se o negócio mudar de valor depois, o pagamento continua dizendo o
 * que foi cobrado. O PaySuite só cobra em METICAIS — negócio noutra moeda é
 * recusado em vez de ser cobrado como se fosse metical.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";
import { createPayment, PaySuiteApiError } from "@/lib/payments/paysuite/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { basePublicaDaInstalacao } from "@/lib/webhooks/url-publica";

export const dynamic = "force-dynamic";

/** A única moeda que o PaySuite cobra. */
const MOEDA_DO_PAYSUITE = "MZN";

const chargeSchema = z.object({
  amount_cents: z.number().int().positive().optional(),
  method: z.enum(["mpesa", "emola", "credit_card"]).optional(),
  description: z.string().max(125).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "payments" });
  if (!authz.ok) return authz.response;
  const { user } = authz;
  const orgId = authz.org.orgId;

  let rawBody: unknown = {};
  try {
    const text = await req.text();
    rawBody = text ? JSON.parse(text) : {};
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = chargeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }
  const input = parsed.data;

  // Negócio pelo client de sessão: a RLS só o devolve se for da organização ativa.
  const supabase = await createClient();
  const { data: lead, error: leadErr } = await supabase
    .from("crm_leads")
    .select("id, title, value_cents, currency, contact_id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (leadErr) return fail("internal_error", "Erro ao buscar o negócio.", 500, { requestId });
  if (!lead) return fail("not_found", "Negócio não encontrado nesta organização.", 404, { requestId });

  const negocio = lead as { title: string; value_cents: number | null; currency: string | null; contact_id: string | null };
  const moeda = negocio.currency ?? MOEDA_DO_PAYSUITE;
  if (moeda !== MOEDA_DO_PAYSUITE) {
    return fail(
      "invalid_request",
      `O PaySuite só cobra em meticais (MTn), e este negócio está em ${moeda}. Mude a moeda do negócio para cobrar por aqui.`,
      422,
      { requestId },
    );
  }

  const amountCents = input.amount_cents ?? negocio.value_cents;
  if (!amountCents || amountCents <= 0) {
    return fail("invalid_request", "O negócio não tem valor definido — informe o valor a cobrar.", 422, { requestId });
  }

  const suporte = await requireSupportWrite(orgId);
  if (suporte) return suporte;

  const admin = createAdminClient();
  const { data: cred, error: credErr } = await admin
    .from("payment_credentials")
    .select("api_token_encrypted, webhook_path_token")
    .eq("organization_id", orgId)
    .eq("provider", "paysuite")
    .maybeSingle();
  if (credErr) return fail("internal_error", "Erro ao buscar as credenciais de pagamento.", 500, { requestId });
  if (!cred) {
    return fail("invalid_request", "O PaySuite não está configurado. Configure em Integrações › PaySuite.", 422, { requestId });
  }

  const { api_token_encrypted: tokenCifrado, webhook_path_token: pathToken } = cred as {
    api_token_encrypted: string;
    webhook_path_token: string;
  };
  const apiToken = await decryptWebhookSecret(admin, tokenCifrado);
  if (!apiToken) {
    return fail("internal_error", "Não consegui decifrar o token do PaySuite — reconfigure a integração.", 500, { requestId });
  }

  const reference = randomUUID();
  let criado;
  try {
    criado = await createPayment(apiToken, {
      amount: (amountCents / 100).toFixed(2),
      reference,
      method: input.method,
      description: (input.description ?? `Cobrança: ${negocio.title}`).slice(0, 125),
      webhook_url: `${basePublicaDaInstalacao(req)}/api/v1/webhooks/payments/paysuite/${pathToken}`,
    });
  } catch (err) {
    const message = err instanceof PaySuiteApiError ? err.message : "Falha ao contactar o PaySuite.";
    logger.error("[leads.charge] PaySuite createPayment falhou", { organizationId: orgId, leadId, error: message });
    return fail("upstream_unavailable", message, 502, { requestId });
  }

  const { data: pagamento, error: insertErr } = await admin
    .from("payments")
    .insert({
      organization_id: orgId,
      lead_id: leadId,
      provider: "paysuite",
      provider_payment_id: criado.id,
      reference,
      method: input.method ?? null,
      amount_cents: amountCents,
      currency: MOEDA_DO_PAYSUITE,
      status: "pending",
      checkout_url: criado.checkoutUrl,
      created_by_user_id: user.id,
    })
    .select("id, checkout_url, status")
    .single();

  if (insertErr || !pagamento) {
    logger.error("[leads.charge] cobrança criada no PaySuite mas sem registo local", {
      organizationId: orgId,
      leadId,
      providerPaymentId: criado.id,
      error: insertErr?.message,
    });
    return fail(
      "internal_error",
      `A cobrança foi criada no PaySuite, mas não consegui registá-la aqui. Guarde o link antes de tentar de novo: ${criado.checkoutUrl}`,
      500,
      { requestId },
    );
  }
  const linha = pagamento as { id: string; checkout_url: string; status: string };

  await emitLeadActivity(supabase, {
    organizationId: orgId,
    leadId,
    contactId: negocio.contact_id,
    type: "payment_charge_created",
    sourceModule: "payments",
    sourceId: linha.id,
    actor: { type: "user", id: user.id },
    reason: `Link de pagamento gerado: ${formatCents(amountCents, MOEDA_DO_PAYSUITE)}`,
    payload: { payment_id: linha.id, method: input.method ?? null },
  });

  void audit({
    action: "payment.charge_created",
    actorUserId: user.id,
    organizationId: orgId,
    resourceType: "payment",
    resourceId: linha.id,
    metadata: { lead_id: leadId, amount_cents: amountCents, currency: MOEDA_DO_PAYSUITE, method: input.method ?? null },
    requestId,
    bypassedRls: true,
  });

  return ok({ id: linha.id, checkout_url: linha.checkout_url, status: linha.status }, { status: 201, requestId });
}
