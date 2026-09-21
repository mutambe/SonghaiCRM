/**
 * Resolve quem é o responsável (role=admin) de um tenant — usado pelo GET de
 * detalhe (mostrar na tela) e pelo POST .../owner (decidir resend/change/reset).
 *
 * "none": nenhuma membership admin (o caso do tenant criado com o e-mail
 * errado — a membership nunca chegou a existir). "pending": convite existe,
 * ninguém aceitou. "accepted": dono ativo.
 */
import { type SupabaseClient } from "@supabase/supabase-js";

export interface TenantOwner {
  status: "none" | "pending" | "accepted";
  membershipId: string | null;
  userId: string | null;
  email: string | null;
  invitedAt: string | null;
  acceptedAt: string | null;
}

export async function resolveTenantOwner(
  admin: SupabaseClient,
  organizationId: string,
): Promise<TenantOwner> {
  const { data: membership } = await admin
    .from("user_organizations")
    .select("id, user_id, accepted_at, invited_at")
    .eq("organization_id", organizationId)
    .eq("role", "admin")
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return {
      status: "none",
      membershipId: null,
      userId: null,
      email: null,
      invitedAt: null,
      acceptedAt: null,
    };
  }

  const { data: userRes } = await admin.auth.admin.getUserById(membership.user_id);

  return {
    status: membership.accepted_at ? "accepted" : "pending",
    membershipId: membership.id,
    userId: membership.user_id,
    email: userRes?.user?.email ?? null,
    invitedAt: membership.invited_at,
    acceptedAt: membership.accepted_at,
  };
}
