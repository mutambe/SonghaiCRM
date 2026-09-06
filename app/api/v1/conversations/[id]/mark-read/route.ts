/**
 * POST /api/v1/conversations/[id]/mark-read — o agente abriu (ou respondeu)
 * a conversa: mensagens do CLIENTE (inbound) pendentes viram lidas no CRM.
 *
 * Não é o ack do canal (esse é sobre o que NÓS enviamos e o cliente leu do
 * lado dele) — é o agente lendo o que o cliente mandou, dentro do CRM.
 * `messages.read_at` é reaproveitado pra isso porque, pra inbound, nunca era
 * escrito por outro caminho.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const supabase = await createClient();

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const user = authz.user;

  const { data, error } = await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", id)
    .eq("organization_id", authz.org.orgId)
    .eq("direction", "inbound")
    .is("read_at", null)
    .select("id");

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  const markedCount = data?.length ?? 0;
  if (markedCount > 0) {
    await audit({
      action: "conversation.messages_marked_read",
      actorUserId: user.id,
      organizationId: authz.org.orgId,
      resourceType: "conversation",
      resourceId: id,
      requestId,
      metadata: { marked_count: markedCount },
    });
  }

  return ok({ marked_count: markedCount }, { requestId });
}
