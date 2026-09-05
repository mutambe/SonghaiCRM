/**
 * POST /api/v1/licensing/webhooks/paysuite — confirmação da renovação (Task
 * 7). Mesmo algoritmo de assinatura do webhook de pagamentos de tenant
 * (`app/api/v1/webhooks/payments/paysuite/[token]/route.ts`), reaproveitado
 * via `verifyInboundSignature` — não reescrito.
 *
 * Idempotência: o `.eq("status", "pending")` no UPDATE é o claim atómico —
 * uma reentrega do mesmo evento (o PaySuite reenvia em timeout) já encontra
 * `status='success'` e não casa a condição, então `maybeSingle()` devolve
 * null e a extensão do período NÃO roda de novo.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { verifyInboundSignature } from "@/lib/webhooks/inbound";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PaySuiteWebhookBody {
  event?: string;
  data?: { id?: string };
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const rawBody = await req.text();

  const admin = createAdminClient();
  const { data: credentials } = await admin
    .from("licensing_paysuite_credentials")
    .select("webhook_secret_encrypted")
    .eq("id", "singleton")
    .maybeSingle();
  const secretEnc = (credentials as { webhook_secret_encrypted: string } | null)?.webhook_secret_encrypted;
  const webhookSecret = secretEnc ? await decryptWebhookSecret(admin, secretEnc) : null;

  if (!webhookSecret || !verifyInboundSignature(rawBody, req.headers.get("x-signature"), webhookSecret)) {
    return fail("unauthorized", "Assinatura inválida.", 401, { requestId });
  }

  let body: PaySuiteWebhookBody;
  try {
    body = JSON.parse(rawBody) as PaySuiteWebhookBody;
  } catch {
    return fail("invalid_request", "Corpo não é JSON válido.", 400, { requestId });
  }

  if (body.event !== "payment.success" && body.event !== "payment.failed") {
    return ok({ status: "ignored" }, { requestId });
  }
  const paymentId = body.data?.id;
  if (!paymentId) {
    return ok({ status: "ignored" }, { requestId });
  }

  const novoStatus = body.event === "payment.success" ? "success" : "failed";

  const { data: payment, error: updErr } = await admin
    .from("licensing_payments")
    .update({ status: novoStatus, paid_at: novoStatus === "success" ? new Date().toISOString() : null })
    .eq("paysuite_payment_id", paymentId)
    .eq("status", "pending")
    .select("id, license_id, amount_cents")
    .maybeSingle();

  if (updErr) {
    logger.error("[licensing.webhooks.paysuite] falha ao atualizar pagamento", {
      error: updErr.message,
      requestId,
    });
    return fail("internal_error", "Falha ao gravar confirmação.", 500, { requestId });
  }

  if (!payment) {
    return ok({ status: "ignored", reason: "pagamento_nao_encontrado" }, { requestId });
  }

  if (novoStatus === "success") {
    const row = payment as { id: string; license_id: string; amount_cents: number };
    const { data: license } = await admin
      .from("licensing_licenses")
      .select("id, current_period_end, plan_interval_days")
      .eq("id", row.license_id)
      .single();

    if (license) {
      const lic = license as { id: string; current_period_end: string; plan_interval_days: number };
      const base = Math.max(new Date(lic.current_period_end).getTime(), Date.now());
      const novoFim = new Date(base + lic.plan_interval_days * 24 * 60 * 60 * 1000).toISOString();
      await admin
        .from("licensing_licenses")
        .update({ status: "active", current_period_end: novoFim })
        .eq("id", lic.id);
    }
  }

  return ok({ status: "processed" }, { requestId });
}
