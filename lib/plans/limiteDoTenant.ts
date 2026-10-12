/**
 * SonghaiCRM — os limites do plano vigente de uma organização (migration 9004).
 * Sem assinatura vigente devolve `null`, e quem chama NÃO bloqueia: é o estado
 * de toda instalação nova e de quem ainda não recebeu plano.
 */
import { dataEmMaputo, limitesAcrescentadosPelosExtras } from "@/lib/billing/calculo";
import { funcionalidadesDosLimites, type FuncionalidadeDoPlano } from "@/lib/plans/funcionalidades";
import { createAdminClient } from "@/lib/supabase/admin";

export interface LimitesDoPlano {
  planSlug: string;
  planDisplayName: string;
  maxUsers: number;
  maxWhatsappConnections: number;
  /** O que o pacote inclui além do agente e do WhatsApp (`plans.limits.features`; ausente = todas). */
  funcionalidades: readonly FuncionalidadeDoPlano[];
}

interface PlanRow {
  slug: string;
  display_name: string;
  limits: Record<string, unknown>;
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

  // Os EXTRAS do cliente (um número de WhatsApp a mais, p. ex.) sobem o limite do
  // pacote na hora em que são contratados e descem quando acabam. Sem teto no
  // pacote (Infinity) não há o que somar. Falha ao ler os extras = só o pacote.
  const extras = await extrasDeLimites(organizationId);
  const teto = (base: unknown, mais: number) => (typeof base === "number" ? base + mais : Infinity);

  return {
    planSlug: plan.slug,
    planDisplayName: plan.display_name,
    maxUsers: teto(plan.limits.max_users, extras.utilizadores),
    maxWhatsappConnections: teto(plan.limits.max_whatsapp_connections, extras.whatsapp),
    funcionalidades: funcionalidadesDosLimites(plan.limits),
  };
}

interface LinhaDoExtra {
  quantity: number;
  adds_whatsapp_connections: number;
  adds_users: number;
  started_on: string;
  ended_on: string | null;
}

async function extrasDeLimites(organizationId: string): Promise<{ whatsapp: number; utilizadores: number }> {
  try {
    const { data } = await createAdminClient()
      .from("subscription_items")
      .select("quantity, adds_whatsapp_connections, adds_users, started_on, ended_on")
      .eq("organization_id", organizationId);
    const linhas = Array.isArray(data) ? (data as LinhaDoExtra[]) : [];
    return limitesAcrescentadosPelosExtras(
      linhas.map((l) => ({
        quantity: l.quantity,
        addsWhatsappConnections: l.adds_whatsapp_connections,
        addsUsers: l.adds_users,
        startedOn: l.started_on,
        endedOn: l.ended_on,
      })),
      dataEmMaputo(new Date()),
    );
  } catch {
    return { whatsapp: 0, utilizadores: 0 };
  }
}
