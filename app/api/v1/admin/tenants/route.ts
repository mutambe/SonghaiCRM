import { type NextRequest } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit, hashEmail } from "@/lib/audit";
import { inviteOrResolveOwner } from "@/lib/admin/invite-tenant-owner";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const querySchema = z.object({
  q: z.string().optional(),
  status: z.enum(["active", "suspended", "onboarding", "redacted"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const createSchema = z.object({
  display_name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  legal_name: z.string().min(2).max(255).optional(),
  nuit: z.string().optional(),
  plan_id: z.string().uuid(),
  owner_email: z.string().email(),
});

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

interface CursorPayload {
  created_at: string;
  id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as CursorPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/tenants
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const requestId = randomUUID();

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return fail("validation_error", "Invalid query params", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { q, status, cursor, limit } = parsed.data;
  const admin = createAdminClient();
  const cursorPayload = cursor ? decodeCursor(cursor) : null;

  let query = admin
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
      user_count:user_organizations(count),
      conversations_count:conversations(count)
    `,
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (status === "onboarding") {
    // Estado derivado: ativo no banco, onboarding ainda não concluído.
    query = query.eq("status", "active").is("onboarded_at", null);
  } else if (status) {
    query = query.eq("status", status);
  }

  if (q) {
    query = query.or(
      `display_name.ilike.%${q}%,slug::text.ilike.%${q}%,nuit.ilike.%${q}%`,
    );
  }

  if (cursorPayload) {
    query = query.or(
      `created_at.lt.${cursorPayload.created_at},and(created_at.eq.${cursorPayload.created_at},id.lt.${cursorPayload.id})`,
    );
  }

  const { data, error } = await query;

  if (error) {
    return fail("internal_error", "Query failed", 500, {
      requestId,
      details: error.message,
    });
  }

  const rows = data ?? [];
  const has_more = rows.length > limit;
  const page = has_more ? rows.slice(0, limit) : rows;

  const lastRow = page.at(-1);
  const nextCursor =
    has_more && lastRow
      ? encodeCursor({
          created_at: (lastRow as { created_at: string }).created_at,
          id: lastRow.id,
        })
      : null;

  void audit({
    action: "platform_admin.tenants_listed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    metadata: {
      filters: { status: status ?? null, has_q: !!q },
      result_count: page.length,
    },
  });

  return ok(page, {
    requestId,
    meta: { has_more, cursor: nextCursor },
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/admin/tenants
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

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
    return fail("validation_error", "Invalid JSON body", 400, { requestId });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_error", "Invalid request body", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { display_name, slug, legal_name, nuit, plan_id, owner_email } = parsed.data;
  const admin = createAdminClient();

  // 1) Plano precisa existir e estar ativo — falha ANTES de convidar ninguém.
  const { data: plan } = await admin
    .from("plans")
    .select("id, is_active")
    .eq("id", plan_id)
    .maybeSingle();
  if (!plan || !plan.is_active) {
    return fail("plan_inactive", "Pacote inexistente ou inativo", 409, { requestId });
  }

  // 2) Convite do owner — chamada de rede à Auth API, fica FORA da transação
  // SQL que vem a seguir (trigger nunca faz HTTP; o mesmo raciocínio vale
  // para um handler que precisa da resposta da rede antes de decidir).
  // redirectTo aponta para /auth/confirm com type=invite explícito: o link
  // que o Supabase gera para convite não inclui `type` na query (mesmo
  // motivo documentado em requestPasswordReset.ts para recovery), então
  // precisamos afirmá-lo aqui para /auth/confirm saber que não deve
  // provisionar uma organization nova para este usuário.
  //
  // Spec (docs/superpowers/specs/2026-09-09-licenciamento-por-tenant-design.md,
  // "Tratamento de erros e casos-limite"): e-mail que já é dono de outra conta
  // não é uma falha — GoTrue recusa reconvidar um usuário já confirmado
  // (`email_exists`, normalmente HTTP 422). inviteOrResolveOwner resolve o
  // user_id existente nesse caso e segue o fluxo como "adicionar membership".
  const invite = await inviteOrResolveOwner(admin, owner_email);
  if (!invite.ok) {
    return fail(
      "internal_error",
      "Falha ao convidar o responsável pelo tenant",
      500,
      { requestId, details: invite.message },
    );
  }
  const ownerId = invite.userId;
  if (invite.wasInvited) {
    void audit({
      action: "tenant.owner_invited",
      actorUserId: adminCtx.user.id,
      actingAsPlatformAdmin: true,
      requestId,
      metadata: { owner_email_hash: hashEmail(owner_email) },
    });
  }

  // 3) Organization
  const { data: org, error: insertError } = await admin
    .from("organizations")
    .insert({
      display_name,
      slug,
      legal_name: legal_name ?? null,
      nuit: nuit ?? null,
      status: "active",
      created_by: adminCtx.user.id,
    })
    .select("id, slug, display_name")
    .single();

  if (insertError || !org) {
    if (insertError?.code === "23505") {
      return fail("tenant_already_exists", "Slug already exists", 409, { requestId });
    }
    return fail("internal_error", "Failed to create tenant", 500, {
      requestId,
      details: insertError?.message,
    });
  }

  // 4) Membership do owner (role admin). Sem transação SQL disponível via
  // client Supabase — se este passo falhar depois da organization já criada,
  // ela ficaria órfã (sem dono) e o slug "tomado" pra sempre (retry bateria
  // em tenant_already_exists). Compensa desfazendo a organization
  // (best-effort) antes de devolver o erro, mesmo padrão do PATCH
  // .../subscription (Task 9).
  const { error: memberError } = await admin.from("user_organizations").insert({
    organization_id: org.id,
    user_id: ownerId,
    role: "admin",
    accepted_at: null,
  });
  if (memberError) {
    const { error: compensateError } = await admin
      .from("organizations")
      .delete()
      .eq("id", org.id);
    return fail("internal_error", "Falha ao vincular o responsável pelo tenant", 500, {
      requestId,
      details: compensateError
        ? {
            member_error: memberError.message,
            compensate_error: compensateError.message,
            inconsistent_organization_id: org.id,
          }
        : memberError.message,
    });
  }

  // 5) Assinatura inicial. Mesma lógica de compensação: se falhar aqui, a
  // organization (e sua membership, via ON DELETE CASCADE) é desfeita — sem
  // isso a org sobreviveria SEM assinatura, e `limitesDoTenant()` devolve
  // `null` pra ela, isentando-a de qualquer limite de plano (fail-open).
  const { error: subError } = await admin.from("organization_subscriptions").insert({
    organization_id: org.id,
    plan_id,
    status: "active",
    assigned_by: adminCtx.user.id,
  });
  if (subError) {
    const { error: compensateError } = await admin
      .from("organizations")
      .delete()
      .eq("id", org.id);
    return fail("internal_error", "Falha ao atribuir o plano ao tenant", 500, {
      requestId,
      details: compensateError
        ? {
            sub_error: subError.message,
            compensate_error: compensateError.message,
            inconsistent_organization_id: org.id,
          }
        : subError.message,
    });
  }

  void audit({
    action: "tenant.subscription_assigned",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    organizationId: org.id,
    resourceType: "organization_subscription",
    requestId,
    metadata: { plan_id },
  });

  void audit({
    action: "tenant.created_by_platform_admin",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: org.id,
    resourceType: "organization",
    resourceId: org.id,
    requestId,
    metadata: { slug: org.slug, display_name: org.display_name, plan_id },
  });

  return ok(
    { id: org.id, slug: org.slug, display_name: org.display_name },
    { status: 201, requestId },
  );
}
