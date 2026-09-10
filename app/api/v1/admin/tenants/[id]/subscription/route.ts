/**
 * PATCH /api/v1/admin/tenants/[id]/subscription
 *
 * Troca o plano de um tenant já existente. Nunca faz UPDATE do plano em si:
 * fecha a linha vigente de `organization_subscriptions` (`ended_at = now()`)
 * e insere uma nova — histórico versionado, igual ao que a Task 7 já faz na
 * atribuição inicial. `uq_organization_subscriptions_one_current` garante no
 * banco que só existe 1 linha aberta por organização.
 */
import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";

const patchSchema = z.object({
  plan_id: z.string().uuid(),
  notes: z.string().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id: organizationId } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "Invalid JSON body", 400, { requestId });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Invalid request body", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const { plan_id, notes } = parsed.data;
  const admin = createAdminClient();

  const { data: plan } = await admin
    .from("plans")
    .select("id, display_name, is_active")
    .eq("id", plan_id)
    .maybeSingle();
  if (!plan || !plan.is_active) {
    return fail("plan_inactive", "Pacote inexistente ou inativo", 409, { requestId });
  }

  // Fecha a linha vigente (se houver — tenant pode não ter assinatura ainda
  // em bancos migrados de um estado anterior a esta feature).
  const { data: current } = await admin
    .from("organization_subscriptions")
    .select("id")
    .eq("organization_id", organizationId)
    .is("ended_at", null)
    .maybeSingle();

  if (current) {
    const { error: closeError } = await admin
      .from("organization_subscriptions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", current.id);
    if (closeError) {
      return fail("internal_error", "Falha ao fechar a assinatura vigente", 500, {
        requestId,
        details: closeError.message,
      });
    }
  }

  const { data: created, error: insertError } = await admin
    .from("organization_subscriptions")
    .insert({
      organization_id: organizationId,
      plan_id,
      status: "active",
      assigned_by: adminCtx.user.id,
      notes: notes ?? null,
    })
    .select("plan_id, status, started_at")
    .single();

  if (insertError || !created) {
    return fail("internal_error", "Falha ao atribuir o novo plano", 500, {
      requestId,
      details: insertError?.message,
    });
  }

  void audit({
    action: "tenant.subscription_changed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId,
    resourceType: "organization_subscription",
    resourceId: organizationId,
    requestId,
    metadata: { new_plan_id: plan_id, previous_subscription_id: current?.id ?? null },
  });

  return ok(
    { plan_id: created.plan_id, plan_display_name: plan.display_name, status: created.status, started_at: created.started_at },
    { requestId },
  );
}
