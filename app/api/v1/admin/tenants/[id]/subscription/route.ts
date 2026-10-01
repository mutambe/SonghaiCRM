/**
 * GET/PATCH /api/v1/admin/tenants/[id]/subscription — o plano de uma
 * organização (SonghaiCRM, migration 0504).
 *
 * GET devolve a assinatura vigente (ou `null`), o histórico e o catálogo à venda
 * — o que a tela do admin precisa para trocar de plano.
 * PATCH troca o plano: `fn_trocar_plano_da_organizacao` encerra a vigente e abre
 * a nova numa só transação (o histórico fica; nunca há duas vigentes).
 *
 * Só admin da plataforma com acesso TOTAL — plano é contrato comercial.
 */
import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { mfaEmDivida } from "@/lib/auth/server";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  plan_id: z.string().uuid(),
  notes: z.string().trim().max(500).optional(),
});

const SELECT_ASSINATURA = "id, status, billing_mode, notes, started_at, ended_at, plan:plans(id, slug, display_name, price_cents, currency, limits)";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const { id: organizationId } = await params;
  try {
    await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("id").eq("id", organizationId).maybeSingle();
  if (!org) return fail("not_found", "Organização não encontrada.", 404, { requestId });

  const [{ data: assinaturas, error }, { data: catalogo }] = await Promise.all([
    admin
      .from("organization_subscriptions")
      .select(SELECT_ASSINATURA)
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: false })
      .limit(20),
    admin
      .from("plans")
      .select("id, slug, display_name, price_cents, setup_fee_cents, currency, limits")
      .eq("is_active", true)
      .order("price_cents", { ascending: true, nullsFirst: false }),
  ]);
  if (error) return fail("internal_error", "Erro ao consultar a assinatura.", 500, { requestId });

  const lista = (assinaturas ?? []) as Array<{ ended_at: string | null }>;
  return ok(
    { vigente: lista.find((a) => a.ended_at === null) ?? null, historico: lista, catalogo: catalogo ?? [] },
    { requestId },
  );
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: organizationId } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  if (adminCtx.platformAdmin.scope !== "full") {
    return fail("forbidden", "Seu acesso de suporte não permite mudar o plano de uma organização.", 403, { requestId });
  }
  if (await mfaEmDivida()) return fail("mfa_required", "Confirme a verificação em duas etapas.", 403, { requestId });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 400, { requestId, details: parsed.error.flatten() });
  }
  const { plan_id, notes } = parsed.data;

  const admin = createAdminClient();
  const { data: assinaturaId, error } = await admin.rpc("fn_trocar_plano_da_organizacao", {
    p_org: organizationId,
    p_plan: plan_id,
    p_actor: adminCtx.user.id,
    p_notes: notes ?? null,
  });
  if (error) {
    if (error.code === "P0002") return fail("not_found", "Organização não encontrada.", 404, { requestId });
    if (error.code === "22023") return fail("plan_inactive", "Pacote inexistente ou fora de venda.", 409, { requestId });
    if (error.code === "23505") {
      return fail("conflict", "Outra troca de plano aconteceu ao mesmo tempo. Recarregue e tente de novo.", 409, { requestId });
    }
    return fail("internal_error", "Não foi possível mudar o plano.", 500, { requestId });
  }

  const { data: vigente } = await admin
    .from("organization_subscriptions")
    .select(SELECT_ASSINATURA)
    .eq("id", assinaturaId as string)
    .maybeSingle();

  void audit({
    action: "tenant.subscription_changed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId,
    resourceType: "organization_subscription",
    resourceId: assinaturaId as string,
    requestId,
    metadata: { plan_id, notes: notes ?? null },
  });

  return ok({ vigente }, { requestId });
}
