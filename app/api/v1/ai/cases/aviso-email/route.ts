/**
 * /api/v1/ai/cases/aviso-email — quem recebe POR E-MAIL o aviso de caso aberto
 * pela IA (SonghaiCRM, 9012).
 *
 * Canal ADICIONAL ao aviso no WhatsApp, que guarda um único número. Aqui vai uma
 * lista de até 10 e-mails e um interruptor. Só o `admin` da organização lê e
 * escreve (o mesmo papel do aviso no WhatsApp: manda dado de cliente para fora).
 *
 * `organization_id` vem da sessão (`requireRole`), nunca do corpo. A lista é
 * validada pelo servidor: um item que não é e-mail recusa tudo, e nada se grava
 * pela metade.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MAXIMO_DE_EMAILS_DO_FORNECEDOR, lerEmails } from "@/lib/billing/config";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ emails: z.array(z.string().trim().max(200)).max(MAXIMO_DE_EMAILS_DO_FORNECEDOR), ligado: z.boolean() })
  .strict();

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "case_alert_email" });
  if (!authz.ok) return authz.response;

  const { data } = await createAdminClient()
    .from("config_aviso_de_caso_email")
    .select("emails, ligado")
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  const c = data as { emails: string[]; ligado: boolean } | null;
  return ok({ emails: c?.emails ?? [], ligado: c?.ligado ?? false }, { requestId });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("admin", { requestId, resource: "case_alert_email" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const suporte = await requireSupportWrite(orgId);
  if (suporte) return suporte;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", `Até ${MAXIMO_DE_EMAILS_DO_FORNECEDOR} e-mails.`, 400, { requestId });
  }
  const pedidos = parsed.data.emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  const validos = lerEmails(pedidos.join(" "));
  if (validos.length !== new Set(pedidos).size) {
    return fail("validation_failed", "Algum dos endereços não é um e-mail válido.", 400, { requestId });
  }
  if (parsed.data.ligado && validos.length === 0) {
    return fail("validation_failed", "Para ligar o aviso, indique pelo menos um e-mail.", 400, { requestId });
  }

  const { error } = await createAdminClient()
    .from("config_aviso_de_caso_email")
    .upsert(
      {
        organization_id: orgId,
        emails: validos,
        ligado: parsed.data.ligado,
        atualizado_por: authz.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );
  if (error) return fail("internal_error", "Não foi possível guardar.", 500, { requestId });

  void audit({
    action: "ai.case_email_alert_config_changed",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "organization",
    resourceId: orgId,
    requestId,
    metadata: { ligado: parsed.data.ligado, destinatarios: validos.length },
  });

  return ok({ emails: validos, ligado: parsed.data.ligado }, { requestId });
}
