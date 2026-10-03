/**
 * GET/POST /api/v1/admin/tenants/[id]/owner — o responsável de uma organização
 * (SonghaiCRM; porte do `b1b1eb812` do fork sobre o modelo de convite do
 * upstream, `team_invites`).
 *
 * GET devolve o estado (`lib/admin/responsavel-da-organizacao.ts`).
 *
 * POST `{ email }` convida o responsável. Cobre os dois casos que, sem isto,
 * só se resolviam com SQL: o convite da criação venceu (24h) sem ninguém
 * aceitar, e o convite foi para o e-mail ERRADO. Mesmo e-mail → o convite em
 * aberto é renovado (`emitirConvite` reaproveita a linha); e-mail novo → os
 * convites de `admin` em aberto para OUTROS e-mails são revogados antes, para o
 * token do e-mail errado deixar de valer (`aplicarConvite` recusa linha
 * revogada). Com responsável já ativo, 409: aí não se troca identidade pelo
 * painel — quem tem acesso recupera a palavra-passe pelo ecrã de entrada.
 *
 * Idempotente por natureza: repetir o mesmo e-mail renova o mesmo convite.
 */
import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit, hashEmail } from "@/lib/audit";
import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdmin,
  requirePlatformAdminEscrita,
} from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { responsavelDaOrganizacao } from "@/lib/admin/responsavel-da-organizacao";
import { emitirConvite } from "@/lib/team/convites";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const postSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

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

  try {
    return ok(await responsavelDaOrganizacao(admin, organizationId), { requestId });
  } catch {
    return fail("internal_error", "Não foi possível consultar o responsável.", 500, { requestId });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supportDenied = await requireSupportWrite((await params).id);
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: organizationId } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    // Escrita de platform admin exige scope `full` e MFA em dia — o helper do
    // upstream (#2078) recusa `support_readonly` com `forbidden_scope`.
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("validation_error", "Invalid JSON body", 400, { requestId });
  }
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_error", "E-mail inválido.", 400, { requestId, details: parsed.error.flatten() });
  }
  const { email } = parsed.data;

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id, display_name, status")
    .eq("id", organizationId)
    .maybeSingle();
  if (!org) return fail("not_found", "Organização não encontrada.", 404, { requestId });
  if (org.status === "redacted") {
    return fail("state_conflict", "Organização anonimizada — ação não disponível.", 409, { requestId });
  }

  let estado: Awaited<ReturnType<typeof responsavelDaOrganizacao>>;
  try {
    estado = await responsavelDaOrganizacao(admin, organizationId);
  } catch {
    return fail("internal_error", "Não foi possível consultar o responsável.", 500, { requestId });
  }
  if (estado.estado === "ativo") {
    return fail(
      "state_conflict",
      "A organização já tem responsável ativo. Para recuperar o acesso, use «Esqueci a palavra-passe» no ecrã de entrada.",
      409,
      { requestId },
    );
  }

  // O e-mail errado deixa de valer ANTES de o novo sair: se a emissão falhar a
  // meio, a organização fica sem convite em aberto (recuperável repetindo o
  // pedido), nunca com dois.
  const agora = new Date().toISOString();
  const { error: erroDaRevogacao } = await admin
    .from("team_invites")
    .update({ revoked_at: agora, revoked_by: adminCtx.user.id })
    .eq("organization_id", organizationId)
    .eq("role", "admin")
    .neq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (erroDaRevogacao) {
    return fail("internal_error", "Não foi possível revogar o convite anterior.", 500, { requestId });
  }

  let emissao: Awaited<ReturnType<typeof emitirConvite>>;
  try {
    emissao = await emitirConvite(admin, {
      organizationId,
      orgName: org.display_name as string,
      email,
      role: "admin",
      inviterId: adminCtx.user.id,
      inviterName: adminCtx.user.user_metadata?.full_name ?? adminCtx.user.email ?? "Administrador",
      requestId,
    });
  } catch (err) {
    logger.error("[admin.tenants.owner] convite não emitido", {
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail("internal_error", "Não foi possível emitir o convite.", 500, { requestId });
  }

  await audit({
    action: "tenant.owner_invited_by_platform_admin",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId,
    resourceType: "organization",
    resourceId: organizationId,
    requestId,
    metadata: {
      owner_email_hash: hashEmail(email),
      previous_owner_email_hash: estado.estado === "convite_pendente" ? hashEmail(estado.email) : null,
      renewed: emissao.renovado,
    },
  });

  return ok(
    {
      email,
      accept_url: emissao.accept_url,
      expires_at: emissao.convite.expires_at,
      email_dispatched: emissao.email_dispatched,
      email_error: emissao.email_error ?? null,
    },
    { requestId },
  );
}
