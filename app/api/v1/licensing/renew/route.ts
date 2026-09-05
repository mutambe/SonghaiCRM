/**
 * POST /api/v1/licensing/renew — botão "Renovar agora" (Task 12) chama isto
 * através de `lib/licensing/central-client.ts` (Task 9). Cria a cobrança no
 * PaySuite com o valor do PLANO (não pede valor no body — evita que quem
 * chamar a rota diretamente escolha o próprio preço) e devolve o
 * `checkout_url` para o cliente pagar. A confirmação chega depois pelo
 * webhook (Task 8), não por este endpoint.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPayment } from "@/lib/payments/paysuite/client";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({ license_key: z.string().min(10) });

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "license_key ausente ou inválido.", 422, { requestId });
  }

  const admin = createAdminClient();
  const { data: license } = await admin
    .from("licensing_licenses")
    .select("id, plan_amount_cents")
    .eq("license_key", parsed.data.license_key)
    .maybeSingle();

  if (!license) {
    return fail("not_found", "Chave de licença desconhecida.", 404, { requestId });
  }
  const row = license as { id: string; plan_amount_cents: number };

  const { data: credentials } = await admin
    .from("licensing_paysuite_credentials")
    .select("api_token_encrypted")
    .eq("id", "singleton")
    .maybeSingle();
  const apiTokenEnc = (credentials as { api_token_encrypted: string } | null)?.api_token_encrypted;
  const apiToken = apiTokenEnc ? await decryptWebhookSecret(admin, apiTokenEnc) : null;
  if (!apiToken) {
    return fail(
      "licensing_paysuite_not_configured",
      "Credencial do PaySuite não configurada. Cole em /admin/licensing.",
      409,
      { requestId },
    );
  }

  const reference = `lic-${row.id}-${Date.now()}`;
  const amount = (row.plan_amount_cents / 100).toFixed(2);

  let payment: { id: string; checkoutUrl: string };
  try {
    payment = await createPayment(apiToken, {
      amount,
      reference,
      description: "Renovação de assinatura SonghaiCRM",
      webhook_url: `${env.LICENSING_PUBLIC_BASE_URL}/api/v1/licensing/webhooks/paysuite`,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return fail("upstream_unavailable", `PaySuite indisponível: ${detail}`, 502, { requestId });
  }

  const { error: insertErr } = await admin.from("licensing_payments").insert({
    license_id: row.id,
    paysuite_payment_id: payment.id,
    amount_cents: row.plan_amount_cents,
    status: "pending",
    checkout_url: payment.checkoutUrl,
  });
  if (insertErr) {
    return fail("internal_error", insertErr.message, 500, { requestId });
  }

  return ok({ checkout_url: payment.checkoutUrl, payment_id: payment.id }, { status: 201, requestId });
}
