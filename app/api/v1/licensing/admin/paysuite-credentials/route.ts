/**
 * GET/POST /api/v1/licensing/admin/paysuite-credentials — credencial do
 * PaySuite da instância CENTRAL (platform admin only).
 *
 * Mesmo padrão de `app/api/v1/integrations/paysuite/route.ts` (credenciais
 * de tenant): cola o token e o webhook secret pegos no dashboard do
 * PaySuite (Settings > API Access), esta rota cifra os dois
 * (`fn_encrypt_oauth`, mesma infra) e nunca devolve o segredo de volta —
 * nem cifrado. `licensing_paysuite_credentials` é singleton (`id='singleton'`):
 * só existe UMA conta PaySuite da Central, ao contrário do `payment_credentials`
 * por-organização.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";

const SaveSchema = z.object({
  api_token: z.string().min(10),
  webhook_secret: z.string().min(10),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();

  const user = await loadAuthUser();
  if (!user?.is_platform_admin) {
    return fail("forbidden", "Só platform admin acessa credenciais de licenciamento.", 403, { requestId });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("licensing_paysuite_credentials")
    .select("status, updated_at")
    .eq("id", "singleton")
    .maybeSingle();

  if (!data) {
    return ok({ configured: false }, { requestId });
  }

  const row = data as { status: string; updated_at: string };
  return ok({ configured: true, status: row.status, updated_at: row.updated_at }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const user = await loadAuthUser();
  if (!user?.is_platform_admin) {
    return fail("forbidden", "Só platform admin acessa credenciais de licenciamento.", 403, { requestId });
  }

  const parsed = SaveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();
  const [tokenEnc, secretEnc] = await Promise.all([
    encryptWebhookSecret(admin, parsed.data.api_token),
    encryptWebhookSecret(admin, parsed.data.webhook_secret),
  ]);

  if (!tokenEnc || !secretEnc) {
    return fail(
      "internal_error",
      "Não consegui cifrar as credenciais — verifique a configuração de criptografia do servidor.",
      500,
      { requestId },
    );
  }

  const { error: upsertErr } = await admin.from("licensing_paysuite_credentials").upsert({
    id: "singleton",
    api_token_encrypted: tokenEnc,
    webhook_secret_encrypted: secretEnc,
    status: "healthy",
  });

  if (upsertErr) {
    return fail("internal_error", upsertErr.message, 500, { requestId });
  }

  return ok({ configured: true, status: "healthy" }, { status: 201, requestId });
}
