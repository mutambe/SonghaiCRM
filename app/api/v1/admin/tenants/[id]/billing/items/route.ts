/**
 * POST /api/v1/admin/tenants/[id]/billing/items — contrata um extra a um cliente
 * (SonghaiCRM, 9010): um número de WhatsApp a mais, um utilizador, um CRM adicional…
 *
 * Do catálogo (`addon_slug`) ou à medida (descrição + preço + recorrência). O
 * preço pode ser só deste cliente. Os limites que o extra acrescenta sobem na
 * hora; o preço entra na factura seguinte — sem segundo passo.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { adicionarExtra } from "@/lib/billing/admin";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  addon_slug: z.string().regex(/^[a-z0-9_]{2,40}$/).optional(),
  description: z.string().trim().min(2).max(120).optional(),
  unit_price_cents: z.number().int().min(0).max(1_000_000_000).optional(),
  quantity: z.number().int().min(1).max(1000).optional(),
  recurrence: z.enum(["monthly", "once"]).optional(),
});

const MENSAGENS: Record<string, { status: number; code: string; message: string }> = {
  sem_assinatura: { status: 409, code: "no_subscription", message: "Este cliente não tem pacote atribuído." },
  extra_nao_encontrado: { status: 404, code: "not_found", message: "Esse extra não existe no catálogo." },
  extra_desativado: { status: 409, code: "addon_inactive", message: "Esse extra está desactivado no catálogo." },
  extra_incompleto: { status: 400, code: "validation_failed", message: "Um extra à medida precisa de descrição, preço e recorrência." },
  preco_por_definir: {
    status: 409,
    code: "price_undefined",
    message: "Esse extra ainda não tem preço. Defina-o no catálogo, ou indique o preço para este cliente.",
  },
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const suporte = await requireSupportWrite(id);
  if (suporte) return suporte;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdminEscrita>>;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  if (!z.string().uuid().safeParse(id).success) return fail("validation_failed", "Organização inválida.", 400, { requestId });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Campos inválidos.", 400, { requestId, details: parsed.error.flatten() });

  const db = createAdminClient();
  const { data: org } = await db.from("organizations").select("id").eq("id", id).maybeSingle();
  if (!org) return fail("not_found", "Organização não encontrada.", 404, { requestId });

  const r = await adicionarExtra(db, id, parsed.data, adminCtx.user.id);
  if (!r.ok) {
    const m = MENSAGENS[r.erro ?? ""];
    if (m) return fail(m.code, m.message, m.status, { requestId });
    return fail("internal_error", "Não foi possível contratar o extra.", 500, { requestId });
  }

  void audit({
    action: "billing.item_added",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "subscription_item",
    resourceId: r.dados!.id,
    requestId,
    metadata: parsed.data,
  });

  return ok({ id: r.dados!.id }, { status: 201, requestId });
}
