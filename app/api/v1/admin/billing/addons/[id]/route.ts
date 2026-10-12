/**
 * PATCH /api/v1/admin/billing/addons/[id] — o preço PADRÃO de um extra (SonghaiCRM, 9010).
 *
 * É o preço pré-preenchido ao contratar o extra a um cliente; cada cliente pode
 * ter o seu. `unit_price_cents: null` volta a "por definir" — e um extra por
 * definir não se vende.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { alterarExtraDoCatalogo } from "@/lib/billing/admin";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ unit_price_cents: z.number().int().min(0).max(1_000_000_000).nullable().optional(), is_active: z.boolean().optional() })
  .refine((v) => v.unit_price_cents !== undefined || v.is_active !== undefined, { message: "Nada a alterar." });

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
  if (!z.string().uuid().safeParse(id).success) return fail("validation_failed", "Extra inválido.", 400, { requestId });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Campos inválidos.", 400, { requestId, details: parsed.error.flatten() });

  const r = await alterarExtraDoCatalogo(createAdminClient(), id, parsed.data);
  if (!r.ok) {
    if (r.erro === "extra_nao_encontrado") return fail("not_found", "Extra não encontrado.", 404, { requestId });
    return fail("internal_error", "Não foi possível alterar o extra.", 500, { requestId });
  }

  void audit({
    action: "billing.plan_price_changed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "billing_addon",
    resourceId: id,
    requestId,
    metadata: parsed.data,
  });

  return ok({ id }, { requestId });
}
