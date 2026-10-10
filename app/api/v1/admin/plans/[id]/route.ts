/**
 * PATCH /api/v1/admin/plans/[id] — o preço GLOBAL de um pacote (SonghaiCRM, 9010).
 *
 * Vale para todos os clientes que seguem o preço do pacote (sem preço acordado),
 * a partir da PRÓXIMA factura: nenhuma factura já emitida é tocada. A resposta
 * diz quantos clientes serão afectados, para a tela mostrar o alcance do clique.
 *
 * `price_cents: null` = sob consulta (Enterprise): sem preço acordado não se factura.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { alterarPrecoDoPacote } from "@/lib/billing/admin";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const centimos = z.number().int().min(0).max(1_000_000_000);
const bodySchema = z
  .object({ price_cents: centimos.nullable().optional(), setup_fee_cents: centimos.nullable().optional() })
  .refine((v) => v.price_cents !== undefined || v.setup_fee_cents !== undefined, { message: "Nada a alterar." });

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

  const r = await alterarPrecoDoPacote(createAdminClient(), id, parsed.data);
  if (!r.ok) {
    if (r.erro === "plano_nao_encontrado") return fail("not_found", "Pacote não encontrado.", 404, { requestId });
    return fail("internal_error", "Não foi possível alterar o preço.", 500, { requestId });
  }

  void audit({
    action: "billing.plan_price_changed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "plan",
    resourceId: id,
    requestId,
    metadata: { before: r.dados!.antes, after: r.dados!.depois, clients_affected: r.dados!.clientesAfetados },
  });

  return ok({ depois: r.dados!.depois, clientes_afetados: r.dados!.clientesAfetados }, { requestId });
}
