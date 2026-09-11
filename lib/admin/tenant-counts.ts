/**
 * Contadores de volume de um tenant — extraído de
 * app/api/v1/admin/tenants/[id]/route.ts (GET) para ser reaproveitado pelo
 * guard de DELETE (só apaga tenant com TUDO zerado; qualquer contador > 0
 * vira 409, e quem tem dado real usa Suspender, não Deletar).
 */
import { type SupabaseClient } from "@supabase/supabase-js";

export interface TenantCounts {
  user_count: number;
  conversations_count: number;
  messages_count: number;
  leads_count: number;
  orders_count: number;
  lgpd_requests_pending: number;
  ai_invocations_30d: number;
  waha_sessions_count: number;
}

export async function computeTenantCounts(
  admin: SupabaseClient,
  organizationId: string,
): Promise<TenantCounts> {
  const [usersRes, conversationsRes, messagesRes, leadsRes, ordersRes, lgpdRes, aiRes, wahaRes] =
    await Promise.all([
      admin
        .from("user_organizations")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      admin
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      admin
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      admin
        .from("crm_leads")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      admin
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      // `pending` não existe em lgpd_requests_status_check — mesmo raciocínio
      // do GET: pendente = tudo que ainda não fechou (completed/failed).
      admin
        .from("lgpd_requests")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .not("status", "in", "(completed,failed)"),
      admin
        .from("llm_calls")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      admin
        .from("channel_sessions")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId),
    ]);

  return {
    user_count: usersRes.count ?? 0,
    conversations_count: conversationsRes.count ?? 0,
    messages_count: messagesRes.count ?? 0,
    leads_count: leadsRes.count ?? 0,
    orders_count: ordersRes.count ?? 0,
    lgpd_requests_pending: lgpdRes.count ?? 0,
    ai_invocations_30d: aiRes.count ?? 0,
    waha_sessions_count: wahaRes.count ?? 0,
  };
}
