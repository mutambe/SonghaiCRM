import { type NextRequest } from "next/server";
import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdmin,
  requirePlatformAdminEscrita,
} from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { colunasDaEdicao, edicaoDaOrganizacaoSchema, organizacaoTemUso } from "@/lib/admin/edicao-da-organizacao";

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
      cnpj,
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

  // Run counts in parallel — service role, all cross-tenant reads are intentional
  const [
    usersRes,
    conversationsRes,
    messagesRes,
    leadsRes,
    ordersRes,
    lgpdRes,
    aiRes,
    wahaRes,
    integrationRes,
  ] = await Promise.all([
    admin
      .from("user_organizations")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    admin
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    admin
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    admin
      .from("crm_leads")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    admin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    admin
      .from("lgpd_requests")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id)
      // `pending` não existe em `lgpd_requests_status_check`
      // (received/processing/completed/failed/expired), então este contador era
      // sempre 0 e a tela jurava que o tenant não devia nada à LGPD. Aqui
      // pendente = TUDO que ainda não fechou, sem recorte de prazo. O KPI de
      // plataforma (`app/api/v1/admin/dashboard/kpis/route.ts`) parte do mesmo
      // "não fechado" mas soma só o que vence nos próximos 5 dias — os dois
      // números divergem de propósito: este é o total do tenant, aquele é a
      // fila de SLA da plataforma.
      .not("status", "in", "(completed,failed)"),
    // `llm_calls` e não `ai_invocations`: a migration 0130 deixou a segunda sem
    // nenhum escritor (`lib/ai/log-invocation.ts` passou a gravar na primeira).
    // Lendo a tabela morta, este contador viraria ZERO em 30 dias para todo
    // tenant — com o dinheiro saindo. É o mesmo sintoma que a 0130 veio matar.
    admin
      .from("llm_calls")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id)
      .gte(
        "created_at",
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      ),
    admin
      .from("channel_sessions")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    admin
      .from("tenant_integrations")
      // `connected_at` não existe: a linha passa a existir quando a integração
      // é conectada, então `created_at` é essa mesma data com o nome real.
      .select("id, provider, status, created_at")
      .eq("organization_id", id)
      .eq("provider", "nuvemshop")
      .limit(1),
  ]);

  const counts = {
    user_count: usersRes.count ?? 0,
    conversations_count: conversationsRes.count ?? 0,
    messages_count: messagesRes.count ?? 0,
    leads_count: leadsRes.count ?? 0,
    orders_count: ordersRes.count ?? 0,
    lgpd_requests_pending: lgpdRes.count ?? 0,
    ai_invocations_30d: aiRes.count ?? 0,
    waha_sessions_count: wahaRes.count ?? 0,
  };

  const nuvemshopIntegration =
    integrationRes.data && integrationRes.data.length > 0
      ? integrationRes.data[0]
      : null;

  const integrations = {
    nuvemshop_status: nuvemshopIntegration?.status ?? null,
    // Nome de SAÍDA preservado: é o que TenantOverview já lê. Só a coluna de
    // origem estava errada.
    nuvemshop_connected_at: nuvemshopIntegration?.created_at ?? null,
  };

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

  return ok({ organization: org, counts, integrations }, { requestId });
}

// ---------------------------------------------------------------------------
// SonghaiCRM — PATCH (editar) e DELETE (apagar organização sem uso). Porte do
// `b1b1eb812` do fork. Regras em `lib/admin/edicao-da-organizacao.ts`.
// ---------------------------------------------------------------------------

/** Quem chama já passou por `requireSupportWrite` — o gate a quer em cada handler. */
async function adminComAcessoTotal(requestId: string) {
  try {
    // Escrita de platform admin: scope `full` e MFA em dia (helper do upstream, #2078).
    const ctx = await requirePlatformAdminEscrita();
    return { ok: true, ctx } as const;
  } catch (err) {
    return { ok: false, negado: falhaDaEscritaDePlatformAdmin(err, requestId) } as const;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite((await params).id);
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await params;
  const auth = await adminComAcessoTotal(requestId);
  if (!auth.ok) return auth.negado;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("validation_error", "Invalid JSON body", 400, { requestId });
  }
  const parsed = edicaoDaOrganizacaoSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_error", "Dados inválidos.", 400, { requestId, details: parsed.error.flatten() });
  }
  const colunas = colunasDaEdicao(parsed.data);

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id, slug, display_name, legal_name, cnpj, status")
    .eq("id", id)
    .maybeSingle();
  if (!org) return fail("not_found", "Tenant not found", 404, { requestId });
  if (org.status === "redacted") {
    return fail("state_conflict", "Organização anonimizada — edição não disponível.", 409, { requestId });
  }

  const { data: atualizada, error } = await admin
    .from("organizations")
    .update({ ...colunas, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, slug, display_name, legal_name, cnpj")
    .single();
  if (error) {
    if (error.code === "23505") {
      return fail("conflict", "Já existe uma organização com este slug ou NUIT.", 409, { requestId });
    }
    return fail("internal_error", "Não foi possível guardar a organização.", 500, { requestId });
  }

  const antes: Record<string, unknown> = {};
  for (const coluna of Object.keys(colunas)) antes[coluna] = (org as Record<string, unknown>)[coluna];
  await audit({
    action: "tenant.updated_by_platform_admin",
    actorUserId: auth.ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "organization",
    resourceId: id,
    requestId,
    metadata: { before: antes, after: colunas },
  });

  return ok(atualizada, { requestId });
}

const apagarSchema = z.object({ slug_confirmation: z.string() });

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite((await params).id);
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await params;
  const auth = await adminComAcessoTotal(requestId);
  if (!auth.ok) return auth.negado;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("validation_error", "Invalid JSON body", 400, { requestId });
  }
  const parsed = apagarSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_error", "Escreva o slug da organização para confirmar.", 400, { requestId });
  }

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id, slug, display_name, created_by")
    .eq("id", id)
    .maybeSingle();
  if (!org) return fail("not_found", "Tenant not found", 404, { requestId });
  if (parsed.data.slug_confirmation.trim().toLowerCase() !== String(org.slug).toLowerCase()) {
    return fail("validation_error", "O slug escrito não confere.", 422, { requestId });
  }

  const contar = (tabela: string) =>
    admin.from(tabela).select("*", { count: "exact", head: true }).eq("organization_id", id);
  let membros = admin
    .from("user_organizations")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", id)
    .is("revoked_at", null)
    .not("accepted_at", "is", null);
  if (org.created_by) membros = membros.neq("user_id", org.created_by as string);
  const [m, c, msg, l, o, s] = await Promise.all([
    membros,
    contar("conversations"),
    contar("messages"),
    contar("crm_leads"),
    contar("orders"),
    contar("channel_sessions"),
  ]);
  if ([m, c, msg, l, o, s].some((r) => r.error)) {
    return fail("internal_error", "Não foi possível verificar o uso da organização.", 500, { requestId });
  }
  const uso = {
    membros_ativos: m.count ?? 0,
    conversas: c.count ?? 0,
    mensagens: msg.count ?? 0,
    negocios: l.count ?? 0,
    pedidos: o.count ?? 0,
    canais: s.count ?? 0,
  };
  if (organizacaoTemUso(uso)) {
    return fail(
      "state_conflict",
      "A organização já tem uso real (membros, conversas, negócios ou canais). Suspenda-a em vez de apagar.",
      409,
      { requestId, details: uso },
    );
  }

  const { error } = await admin.from("organizations").delete().eq("id", id);
  if (error) {
    logger.error("[admin.tenants] organização não apagada", { organizationId: id, error: error.message });
    return fail("internal_error", "Não foi possível apagar a organização.", 500, { requestId });
  }

  // Sem `organizationId`: a linha deixou de existir (a FK da auditoria é ON
  // DELETE SET NULL). Slug e nome ficam no metadata; o id em `resourceId`.
  await audit({
    action: "tenant.deleted_by_platform_admin",
    actorUserId: auth.ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "organization",
    resourceId: id,
    requestId,
    metadata: { slug: org.slug, display_name: org.display_name },
  });

  return ok({ id, deleted: true }, { requestId });
}
