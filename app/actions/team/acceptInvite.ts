"use server";
/**
 * Server Action: accept a team invite token.
 *
 * Steps:
 *   1. Verify HMAC token (signature + expiry).
 *   2. Get current authenticated user from cookie session.
 *   3. Email mismatch → return error (UI tells user to sign out / use the right account).
 *   4. INSERT user_organizations (organization_id, user_id, role, accepted_at, invited_by=null).
 *      If a revoked row already exists for (user, org), reactivate it instead.
 *   5. Audit `member.accepted` and redirect to /app/inbox.
 */
import { redirect } from "next/navigation";

import { audit } from "@/lib/audit";
import { verifyInviteToken } from "@/lib/auth/invite-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { limitesDoTenant } from "@/lib/plans/limiteDoTenant";

export type AcceptInviteResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "invalid_or_expired"
        | "email_mismatch"
        | "not_authenticated"
        | "internal_error"
        | "plan_limit_reached";
      message?: string;
      expectedEmail?: string;
    };

export async function acceptInviteAction(token: string): Promise<AcceptInviteResult> {
  const payload = verifyInviteToken(token);
  if (!payload) return { ok: false, error: "invalid_or_expired" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_authenticated" };

  const userEmail = (user.email ?? "").trim().toLowerCase();
  const inviteEmail = payload.email.trim().toLowerCase();
  if (userEmail !== inviteEmail) {
    return { ok: false, error: "email_mismatch", expectedEmail: payload.email };
  }

  // Reactivate or insert. RLS em user_organizations exige admin da org para
  // INSERT/UPDATE (user_orgs_insert/update) — o convidado ainda NÃO é membro, então
  // não pode se auto-inserir. A escrita da membership usa o service role. Autorização:
  // token HMAC verificado + email do usuário autenticado === email do convite; org e
  // role vêm do token assinado (fonte confiável), nunca do body.
  const db = createAdminClient();
  const { data: existing, error: fetchErr } = await db
    .from("user_organizations")
    .select("id, revoked_at")
    .eq("user_id", user.id)
    .eq("organization_id", payload.organization_id)
    .maybeSingle();
  if (fetchErr) {
    return { ok: false, error: "internal_error", message: fetchErr.message };
  }

  // Reconta max_users NO MOMENTO DO ACEITE, não só no envio (Task 10). O envio
  // só via o snapshot de assentos ocupados naquele instante — um admin a
  // 19/20 podia disparar 20 convites individuais (cada um passa "19+1<=20"
  // isolado) e todos aceitarem, estourando o pacote. Um aceite que REATIVA
  // uma membership revogada ou CRIA uma nova consome um assento de verdade;
  // um aceite que só reafirma uma membership já ativa (revoked_at null) não
  // consome nada a mais — não bloqueia esse caso.
  const consomeAssentoNovo = !existing?.id || !!existing.revoked_at;
  if (consomeAssentoNovo) {
    const limites = await limitesDoTenant(payload.organization_id);
    if (limites) {
      const { count, error: countErr } = await db
        .from("user_organizations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", payload.organization_id)
        .is("revoked_at", null);
      if (countErr) {
        return { ok: false, error: "internal_error", message: countErr.message };
      }
      if ((count ?? 0) >= limites.maxUsers) {
        return {
          ok: false,
          error: "plan_limit_reached",
          message: `O pacote ${limites.planDisplayName} permite até ${limites.maxUsers} usuários. Fale com o admin do tenant.`,
        };
      }
    }
  }

  const nowIso = new Date().toISOString();

  if (existing?.id) {
    const { error: updErr } = await db
      .from("user_organizations")
      .update({
        role: payload.role,
        revoked_at: null,
        accepted_at: existing.revoked_at ? nowIso : (nowIso),
        updated_at: nowIso,
      })
      .eq("id", existing.id);
    if (updErr) return { ok: false, error: "internal_error", message: updErr.message };

    await audit({
      action: "member.accepted",
      actorUserId: user.id,
      organizationId: payload.organization_id,
      resourceType: "membership",
      resourceId: existing.id,
      metadata: { invite_id: payload.invite_id, role: payload.role, reactivated: !!existing.revoked_at },
    });
  } else {
    const { data: inserted, error: insErr } = await db
      .from("user_organizations")
      .insert({
        user_id: user.id,
        organization_id: payload.organization_id,
        role: payload.role,
        invited_at: new Date(payload.exp * 1000 - 24 * 60 * 60 * 1000).toISOString(),
        accepted_at: nowIso,
      })
      .select("id")
      .single();
    if (insErr) return { ok: false, error: "internal_error", message: insErr.message };

    await audit({
      action: "member.accepted",
      actorUserId: user.id,
      organizationId: payload.organization_id,
      resourceType: "membership",
      resourceId: inserted.id,
      metadata: { invite_id: payload.invite_id, role: payload.role },
    });
  }

  redirect("/app/inbox");
}
