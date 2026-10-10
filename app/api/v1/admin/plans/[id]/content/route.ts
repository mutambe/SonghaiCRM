/**
 * PATCH /api/v1/admin/plans/[id]/content — o que um pacote INCLUI (SonghaiCRM, 9010):
 * as funcionalidades e os limites de utilizadores e de números de WhatsApp.
 *
 * Ao contrário do preço, vale NA HORA para todos os clientes do pacote: o plano
 * é lido a cada pedido. A resposta diz quantos clientes são. Nenhum dado se
 * apaga — a funcionalidade que sai só fica indisponível, e volta se for posta de novo.
 *
 * `features: null` = todas; `max_*: null` = sem limite.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { alterarConteudoDoPacote } from "@/lib/billing/admin";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { FUNCIONALIDADES_DO_PLANO } from "@/lib/plans/funcionalidades";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    features: z.array(z.enum(FUNCIONALIDADES_DO_PLANO)).max(FUNCIONALIDADES_DO_PLANO.length).nullable().optional(),
    max_users: z.number().int().min(1).max(100_000).nullable().optional(),
    max_whatsapp_connections: z.number().int().min(1).max(1_000).nullable().optional(),
    ai_tokens_per_account: z.number().int().min(1).max(100_000_000_000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nada a alterar." });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();

  const suporte = await requireSupportWrite();
  if (suporte) return suporte;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdminEscrita>>;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail("validation_failed", "Pacote inválido.", 400, { requestId });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Campos inválidos.", 400, { requestId, details: parsed.error.flatten() });

  const r = await alterarConteudoDoPacote(createAdminClient(), id, parsed.data);
  if (!r.ok) {
    if (r.erro === "plano_nao_encontrado") return fail("not_found", "Pacote não encontrado.", 404, { requestId });
    return fail("internal_error", "Não foi possível alterar o pacote.", 500, { requestId });
  }

  void audit({
    action: "billing.plan_content_changed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "plan",
    resourceId: id,
    requestId,
    metadata: { change: parsed.data, clients_affected: r.dados!.clientesAfetados },
  });

  return ok({ limites: r.dados!.limites, clientes_afetados: r.dados!.clientesAfetados }, { requestId });
}
