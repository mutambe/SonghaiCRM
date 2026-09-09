import { createAdminClient } from "@/lib/supabase/admin";

export interface LimitesDoPlano {
  planSlug: string;
  planDisplayName: string;
  maxUsers: number;
  maxWhatsappConnections: number;
}

interface PlanRow {
  slug: string;
  display_name: string;
  limits: Record<string, number>;
}

/**
 * Limites vigentes de uma organization, via organization_subscriptions →
 * plans. Chave ausente em `limits` (caso do Enterprise) = sem limite
 * (Infinity), nunca zero — zero bloquearia toda criação.
 */
export async function limitesDoTenant(organizationId: string): Promise<LimitesDoPlano | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organization_subscriptions")
    .select("plan:plans(slug, display_name, limits)")
    .eq("organization_id", organizationId)
    .is("ended_at", null)
    .maybeSingle();

  if (error || !data) return null;
  const plan = (data as unknown as { plan: PlanRow | null }).plan;
  if (!plan) return null;

  return {
    planSlug: plan.slug,
    planDisplayName: plan.display_name,
    maxUsers: plan.limits.max_users ?? Infinity,
    maxWhatsappConnections: plan.limits.max_whatsapp_connections ?? Infinity,
  };
}
