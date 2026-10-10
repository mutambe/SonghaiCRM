/**
 * DELETE /api/v1/admin/tenants/[id]/billing/items/[itemId] — acaba um extra
 * (SonghaiCRM, 9010). Nunca apaga: a história das facturas aponta para ele. O
 * recorrente deixa de ser cobrado a partir do período seguinte e o teto do
 * cliente desce na hora; o pontual por facturar fica sem efeito.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { terminarExtra } from "@/lib/billing/admin";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MENSAGENS: Record<string, { status: number; code: string; message: string }> = {
  extra_nao_encontrado: { status: 404, code: "not_found", message: "Extra não encontrado neste cliente." },
  extra_ja_terminado: { status: 409, code: "already_ended", message: "Este extra já terminou." },
  extra_ja_facturado: { status: 409, code: "already_billed", message: "Este extra pontual já foi facturado e não se desfaz aqui." },
};

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id, itemId } = await params;

  const suporte = await requireSupportWrite(id);
  if (suporte) return suporte;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdminEscrita>>;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(itemId).success) {
    return fail("validation_failed", "Identificador inválido.", 400, { requestId });
  }

  const r = await terminarExtra(createAdminClient(), id, itemId);
  if (!r.ok) {
    const m = MENSAGENS[r.erro ?? ""];
    if (m) return fail(m.code, m.message, m.status, { requestId });
    return fail("internal_error", "Não foi possível acabar o extra.", 500, { requestId });
  }

  void audit({
    action: "billing.item_ended",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "subscription_item",
    resourceId: itemId,
    requestId,
  });

  return ok({ id: itemId }, { requestId });
}
