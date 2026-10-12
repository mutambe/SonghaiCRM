/**
 * PUT /api/v1/admin/billing/notices — quem recebe os avisos do FORNECEDOR
 * (SonghaiCRM, 9011): hoje, os avisos de tokens de IA a 80% e ao limite.
 *
 * Uma lista de e-mails que o operador escreve e altera quando quiser. Lista vazia
 * apaga — e os avisos voltam a ir para os administradores da plataforma, para
 * nunca haver um aviso sem destinatário. Um item que não é e-mail recusa a lista
 * inteira: nada se grava pela metade.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { MAXIMO_DE_EMAILS_DO_FORNECEDOR, gravarEmailsDoFornecedor } from "@/lib/billing/config";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ emails: z.array(z.string().trim().max(200)).max(MAXIMO_DE_EMAILS_DO_FORNECEDOR) }).strict();

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const suporte = await requireSupportWrite();
  if (suporte) return suporte;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdminEscrita>>;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", `Até ${MAXIMO_DE_EMAILS_DO_FORNECEDOR} e-mails.`, 400, { requestId });
  }
  const emails = parsed.data.emails.filter((e) => e !== "");

  if (!(await gravarEmailsDoFornecedor(createAdminClient(), emails, adminCtx.user.id))) {
    return fail("validation_failed", "Algum dos endereços não é um e-mail válido.", 400, { requestId });
  }

  void audit({
    action: "billing.provider_emails_changed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    metadata: { count: emails.length },
  });

  return ok({ guardado: true, total: emails.length }, { requestId });
}
