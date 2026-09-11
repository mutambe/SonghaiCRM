/**
 * POST /api/v1/admin/tenants/[id]/owner
 *
 * "Resetar o acesso" do responsável do tenant a partir do painel de
 * plataforma. Cobre o caso que não tinha conserto sem SQL manual: admin cria
 * o tenant e erra o e-mail do owner — o convite fica pendente (ou, se a
 * membership nem chegou a existir, o tenant fica com 0 em "Usuários" para
 * sempre).
 *
 *   - resend: reconvida o MESMO e-mail (convite pendente que não chegou/expirou).
 *   - change_email: substitui quem é o owner. Só age se ninguém aceitou ainda
 *     (sem membership OU convite pendente) — com dono já ativo, 409:
 *     `reset_password` é o caminho certo ali, não trocar identidade.
 *   - reset_password: dispara o e-mail de recovery pro e-mail atual, só com
 *     dono já aceite.
 *
 * Idempotency-Key OBRIGATÓRIO (POST de criação — convida/apaga auth.users).
 */
import { type NextRequest } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit, hashEmail } from "@/lib/audit";
import { inviteOrResolveOwner } from "@/lib/admin/invite-tenant-owner";
import { resolveTenantOwner } from "@/lib/admin/tenant-owner";
import { sendPasswordRecoveryEmail } from "@/lib/supabase/public-auth";
import { env } from "@/lib/env";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resend") }),
  z.object({ action: z.literal("change_email"), email: z.string().email() }),
  z.object({ action: z.literal("reset_password") }),
]);

interface OwnerMembership {
  id: string;
  user_id: string;
  accepted_at: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id: tenantId } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const idempotencyKey =
    req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return fail("missing_idempotency_key", "Header Idempotency-Key é obrigatório.", 422, {
      requestId,
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail("validation_failed", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_failed", "Parâmetros inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const body = parsed.data;

  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("id, slug, status")
    .eq("id", tenantId)
    .maybeSingle();
  if (!org) {
    return fail("not_found", "Tenant not found", 404, { requestId });
  }
  if (org.status === "redacted") {
    return fail("tenant_redacted", "Tenant redigido — ação não disponível", 409, { requestId });
  }

  // Idempotência — este POST convida/apaga auth.users, um duplo-clique não
  // pode virar dois convites ou um usuário apagado duas vezes.
  const endpoint = `/api/v1/admin/tenants/${tenantId}/owner`;
  const requestHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const { data: existingKey } = await admin
    .from("idempotency_keys")
    .select("id, response_body, status_code")
    .eq("organization_id", tenantId)
    .eq("key", idempotencyKey)
    .eq("endpoint", endpoint)
    .maybeSingle();
  if (existingKey) {
    return ok(existingKey.response_body as Record<string, unknown>, { requestId, status: 200 });
  }

  const owner = await resolveTenantOwner(admin, tenantId);
  const membership: OwnerMembership | null =
    owner.status === "none"
      ? null
      : { id: owner.membershipId!, user_id: owner.userId!, accepted_at: owner.acceptedAt };
  const currentEmail = owner.email;

  let responseBody: Record<string, unknown>;

  if (body.action === "resend") {
    if (!membership || membership.accepted_at) {
      return fail(
        "owner_not_pending",
        "Não há convite pendente para reenviar — o dono já aceitou ou não existe.",
        409,
        { requestId },
      );
    }
    if (!currentEmail) {
      return fail("internal_error", "Não foi possível resolver o e-mail do convite.", 500, {
        requestId,
      });
    }
    const invite = await inviteOrResolveOwner(admin, currentEmail);
    if (!invite.ok) {
      return fail("internal_error", "Falha ao reenviar o convite.", 500, {
        requestId,
        details: invite.message,
      });
    }
    void audit({
      action: "tenant.owner_invite_resent",
      actorUserId: adminCtx.user.id,
      actingAsPlatformAdmin: true,
      organizationId: tenantId,
      resourceType: "organization",
      resourceId: tenantId,
      requestId,
      metadata: { owner_email_hash: hashEmail(currentEmail) },
    });
    responseBody = { status: "invite_resent", email: currentEmail };
  } else if (body.action === "change_email") {
    if (membership?.accepted_at) {
      return fail(
        "owner_already_active",
        "O responsável já aceitou o convite — use reset_password, não change_email.",
        409,
        { requestId },
      );
    }
    const newEmail = body.email;
    const invite = await inviteOrResolveOwner(admin, newEmail);
    if (!invite.ok) {
      return fail("internal_error", "Falha ao convidar o novo responsável.", 500, {
        requestId,
        details: invite.message,
      });
    }
    const now = new Date().toISOString();
    const { error: insertError } = await admin.from("user_organizations").insert({
      organization_id: tenantId,
      user_id: invite.userId,
      role: "admin",
      invited_by: adminCtx.user.id,
      invited_at: now,
      accepted_at: null,
    });
    if (insertError) {
      return fail("internal_error", "Falha ao vincular o novo responsável.", 500, {
        requestId,
        details: insertError.message,
      });
    }

    if (membership) {
      await admin
        .from("user_organizations")
        .update({ revoked_at: now })
        .eq("id", membership.id);

      // O convite antigo era enganado (e-mail errado) — se ninguém mais
      // usa esse auth.users (nenhuma outra membership ativa), apagamos para
      // não deixar uma conta fantasma pendurada num e-mail de terceiro que
      // nunca pediu para ser convidado.
      if (membership.user_id !== invite.userId) {
        const { count } = await admin
          .from("user_organizations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", membership.user_id)
          .is("revoked_at", null);
        if (!count) {
          await admin.auth.admin.deleteUser(membership.user_id).catch(() => undefined);
        }
      }
    }

    void audit({
      action: "tenant.owner_changed_by_platform_admin",
      actorUserId: adminCtx.user.id,
      actingAsPlatformAdmin: true,
      organizationId: tenantId,
      resourceType: "organization",
      resourceId: tenantId,
      requestId,
      metadata: {
        old_owner_email_hash: currentEmail ? hashEmail(currentEmail) : null,
        new_owner_email_hash: hashEmail(newEmail),
      },
    });
    responseBody = { status: "owner_changed", email: newEmail };
  } else {
    // reset_password
    if (!membership || !membership.accepted_at) {
      return fail(
        "owner_not_active",
        "O responsável ainda não aceitou o convite — use change_email, não reset_password.",
        409,
        { requestId },
      );
    }
    if (!currentEmail) {
      return fail("internal_error", "Não foi possível resolver o e-mail do responsável.", 500, {
        requestId,
      });
    }
    // ?type=recovery sobrevive ao redirect do GoTrue (mesmo motivo de
    // requestPasswordReset.ts) — sem isto /auth/confirm não sabe que é recovery.
    const { error: resetError } = await sendPasswordRecoveryEmail(
      currentEmail,
      `${env.NEXT_PUBLIC_APP_URL}/auth/confirm?type=recovery`,
    );
    if (resetError) {
      return fail("internal_error", "Falha ao enviar o e-mail de redefinição.", 500, {
        requestId,
        details: resetError.message,
      });
    }
    void audit({
      action: "tenant.owner_password_reset_sent",
      actorUserId: adminCtx.user.id,
      actingAsPlatformAdmin: true,
      organizationId: tenantId,
      resourceType: "organization",
      resourceId: tenantId,
      requestId,
      metadata: { owner_email_hash: hashEmail(currentEmail) },
    });
    responseBody = { status: "reset_email_sent", email: currentEmail };
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await admin
    .from("idempotency_keys")
    .insert({
      organization_id: tenantId,
      key: idempotencyKey,
      endpoint,
      request_hash: requestHash,
      response_body: responseBody,
      status_code: 200,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  return ok(responseBody, { requestId, status: 200 });
}
