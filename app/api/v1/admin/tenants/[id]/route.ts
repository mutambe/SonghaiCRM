import { type NextRequest } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { computeTenantCounts } from "@/lib/admin/tenant-counts";
import { resolveTenantOwner } from "@/lib/admin/tenant-owner";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// GET /api/v1/admin/tenants/[id]
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const admin = createAdminClient();

  // Load the organization (service-role bypasses RLS — intentional cross-tenant)
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select(
      `
      id,
      slug,
      display_name,
      legal_name,
      nuit,
      status,
      onboarded_at,
      suspended_at,
      created_at,
      settings
    `,
    )
    .eq("id", id)
    .single();

  if (orgError || !org) {
    return fail("not_found", "Tenant not found", 404, { requestId });
  }

  // Contadores + assinatura em paralelo — service role, cross-tenant intencional.
  // `llm_calls` e não `ai_invocations`: a migration 0130 deixou a segunda sem
  // nenhum escritor (`lib/ai/log-invocation.ts` passou a gravar na primeira).
  // Lendo a tabela morta, este contador viraria ZERO em 30 dias para todo
  // tenant — com o dinheiro saindo. computeTenantCounts já reflete isso.
  const [counts, subscriptionRes, owner] = await Promise.all([
    computeTenantCounts(admin, id),
    admin
      .from("organization_subscriptions")
      .select("plan_id, status, started_at, plans(display_name, price_cents, currency)")
      .eq("organization_id", id)
      .is("ended_at", null)
      .maybeSingle(),
    resolveTenantOwner(admin, id),
  ]);

  // Audit lightweight — fire-and-forget
  void audit({
    action: "platform_admin.tenant_viewed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "organization",
    resourceId: id,
    requestId,
    metadata: { tenant_slug: org.slug },
  });

  const subscriptionPlan = subscriptionRes.data
    ? (Array.isArray(subscriptionRes.data.plans)
        ? subscriptionRes.data.plans[0]
        : subscriptionRes.data.plans)
    : null;
  const subscription =
    subscriptionRes.data && subscriptionPlan
      ? {
          plan_id: subscriptionRes.data.plan_id,
          plan_display_name: subscriptionPlan.display_name,
          status: subscriptionRes.data.status,
          started_at: subscriptionRes.data.started_at,
        }
      : null;

  return ok(
    {
      organization: org,
      counts,
      subscription,
      owner: { status: owner.status, email: owner.email, accepted_at: owner.acceptedAt },
    },
    { requestId },
  );
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/tenants/[id]
// ---------------------------------------------------------------------------

const patchSchema = z
  .object({
    display_name: z.string().min(2).max(120).optional(),
    legal_name: z.string().min(2).max(255).nullable().optional(),
    nuit: z.string().min(1).nullable().optional(),
    slug: z
      .string()
      .min(2)
      .max(40)
      .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens")
      .optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, { message: "Informe ao menos um campo" });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail("validation_error", "Invalid JSON body", 400, { requestId });
  }
  const parsed = patchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_error", "Invalid request body", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const changes = parsed.data;

  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("id, slug, display_name, legal_name, nuit, status")
    .eq("id", id)
    .maybeSingle();
  if (!org) {
    return fail("not_found", "Tenant not found", 404, { requestId });
  }
  if (org.status === "redacted") {
    return fail("tenant_redacted", "Tenant redigido — edição não disponível", 409, {
      requestId,
    });
  }

  const { data: updated, error: updateError } = await admin
    .from("organizations")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, slug, display_name, legal_name, nuit")
    .single();

  if (updateError) {
    if (updateError.code === "23505") {
      return fail("tenant_already_exists", "Slug already exists", 409, { requestId });
    }
    return fail("internal_error", "Failed to update tenant", 500, {
      requestId,
      details: updateError.message,
    });
  }

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of Object.keys(changes) as Array<keyof typeof changes>) {
    before[key] = org[key];
    after[key] = changes[key];
  }

  void audit({
    action: "tenant.updated_by_platform_admin",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "organization",
    resourceId: id,
    requestId,
    metadata: { before, after },
  });

  return ok(updated, { requestId });
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/admin/tenants/[id]
// ---------------------------------------------------------------------------

const deleteSchema = z.object({ slug_confirmation: z.string() });

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail("validation_error", "Invalid JSON body", 400, { requestId });
  }
  const parsed = deleteSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_error", "Confirmação obrigatória (slug_confirmation)", 422, {
      requestId,
    });
  }

  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("id, slug, display_name")
    .eq("id", id)
    .maybeSingle();
  if (!org) {
    return fail("not_found", "Tenant not found", 404, { requestId });
  }
  if (parsed.data.slug_confirmation !== org.slug) {
    return fail("confirmation_mismatch", "O slug digitado não confere.", 422, { requestId });
  }

  // Guard: só apaga tenant com TUDO zerado. `counts.user_count` conta QUALQUER
  // linha de user_organizations — inclusive convite pendente nunca aceite,
  // que é exatamente o caso que este DELETE existe para limpar (o e-mail
  // errado da criação). Por isso o guard usa membros ACEITES, não a contagem
  // crua: um convite pendente não é "uso real" do tenant.
  const [counts, acceptedRes] = await Promise.all([
    computeTenantCounts(admin, id),
    admin
      .from("user_organizations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", id)
      .not("accepted_at", "is", null),
  ]);
  const acceptedMembers = acceptedRes.count ?? 0;
  const hasData =
    acceptedMembers > 0 ||
    counts.conversations_count > 0 ||
    counts.messages_count > 0 ||
    counts.leads_count > 0 ||
    counts.orders_count > 0 ||
    counts.waha_sessions_count > 0;
  if (hasData) {
    return fail(
      "tenant_has_data",
      "Tenant tem dado real (usuário ativo, conversa, lead ou pedido) — use Suspender, não Deletar.",
      409,
      { requestId, details: { ...counts, accepted_members: acceptedMembers } },
    );
  }

  // Junta os user_ids ANTES de apagar a organization — o cascade some com as
  // linhas de user_organizations, e sem isto não sobraria como limpar contas
  // órfãs de convite (o e-mail errado que motivou o delete, por exemplo).
  const { data: memberRows } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", id);
  const memberUserIds = (memberRows ?? []).map((r: { user_id: string }) => r.user_id);

  const { error: deleteError } = await admin.from("organizations").delete().eq("id", id);
  if (deleteError) {
    return fail("internal_error", "Failed to delete tenant", 500, {
      requestId,
      details: deleteError.message,
    });
  }

  // organizationId omitido de propósito: a FK de api_audit_log.organization_id
  // aponta pra organizations com ON DELETE SET NULL — não existe mais linha
  // pra referenciar. O slug/nome vivem no metadata; resourceId guarda o id.
  void audit({
    action: "tenant.deleted_by_platform_admin",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "organization",
    resourceId: id,
    requestId,
    metadata: { slug: org.slug, display_name: org.display_name },
  });

  // Best-effort: apaga contas de auth órfãs (convite pendente que nunca foi
  // aceite, sem NENHUMA outra membership) — sem isto sobra uma conta fantasma
  // pendurada no e-mail que motivou o delete. Falha aqui não derruba a
  // resposta: o tenant já foi apagado, que é o que foi pedido.
  for (const userId of memberUserIds) {
    const { count } = await admin
      .from("user_organizations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (!count) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  }

  return ok({ id, deleted: true }, { requestId });
}
