/**
 * GET/POST /api/v1/integrations/paysuite — credenciais PaySuite da organização
 * (SonghaiCRM: M-Pesa, e-Mola, cartão).
 *
 * Sem fluxo OAuth (o PaySuite não tem): o admin cola o Bearer token e o segredo
 * de webhook que pegou no painel deles (Settings › API Access); esta rota cifra
 * os dois (`fn_encrypt_oauth`, a mesma infra das integrações) e devolve a URL de
 * webhook para colar de volta no PaySuite.
 *
 * Nunca devolve o token nem o segredo — nem cifrados. `payment_credentials` não
 * tem privilégio para anon/authenticated (migration 9003): só esta rota, com
 * service role, lê e decifra.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { basePublicaDaInstalacao } from "@/lib/webhooks/url-publica";

export const dynamic = "force-dynamic";

const saveSchema = z.object({
  api_token: z.string().trim().min(10),
  webhook_secret: z.string().trim().min(10),
});

function urlDoWebhook(req: NextRequest, pathToken: string): string {
  return `${basePublicaDaInstalacao(req)}/api/v1/webhooks/payments/paysuite/${pathToken}`;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "payment_credentials" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payment_credentials")
    .select("status, status_reason, webhook_path_token, updated_at")
    .eq("organization_id", authz.org.orgId)
    .eq("provider", "paysuite")
    .maybeSingle();

  if (error) return fail("internal_error", "Erro ao consultar a configuração.", 500, { requestId });
  if (!data) return ok({ configured: false }, { requestId });

  const row = data as { status: string; status_reason: string | null; webhook_path_token: string; updated_at: string };
  return ok(
    {
      configured: true,
      status: row.status,
      status_reason: row.status_reason,
      webhook_url: urlDoWebhook(req, row.webhook_path_token),
      updated_at: row.updated_at,
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "payment_credentials" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = saveSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }

  // Suporte temporário só observa: guarda de EFEITO, antes de gravar.
  const suporte = await requireSupportWrite(orgId);
  if (suporte) return suporte;

  const admin = createAdminClient();
  const [tokenEnc, secretEnc] = await Promise.all([
    encryptWebhookSecret(admin, parsed.data.api_token),
    encryptWebhookSecret(admin, parsed.data.webhook_secret),
  ]);
  if (!tokenEnc || !secretEnc) {
    return fail(
      "internal_error",
      "Não consegui cifrar as credenciais — confira a configuração de criptografia do servidor.",
      500,
      { requestId },
    );
  }

  const { data: existente } = await admin
    .from("payment_credentials")
    .select("id")
    .eq("organization_id", orgId)
    .eq("provider", "paysuite")
    .maybeSingle();

  const { error: gravarErr } = existente
    ? await admin
        .from("payment_credentials")
        .update({ api_token_encrypted: tokenEnc, webhook_secret_encrypted: secretEnc, status: "healthy", status_reason: null })
        .eq("id", (existente as { id: string }).id)
        .eq("organization_id", orgId)
    : await admin.from("payment_credentials").insert({
        organization_id: orgId,
        provider: "paysuite",
        api_token_encrypted: tokenEnc,
        webhook_secret_encrypted: secretEnc,
        status: "healthy",
      });
  if (gravarErr) return fail("internal_error", "Erro ao guardar a configuração.", 500, { requestId });

  const { data: gravado } = await admin
    .from("payment_credentials")
    .select("id, webhook_path_token")
    .eq("organization_id", orgId)
    .eq("provider", "paysuite")
    .maybeSingle();
  const linha = gravado as { id: string; webhook_path_token: string } | null;

  void audit({
    action: "payment.credentials_saved",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "payment_credentials",
    resourceId: linha?.id ?? null,
    metadata: { provider: "paysuite", substituiu: !!existente },
    requestId,
    bypassedRls: true,
  });

  return ok(
    { configured: true, status: "healthy", webhook_url: urlDoWebhook(req, linha?.webhook_path_token ?? "") },
    { status: 201, requestId },
  );
}
