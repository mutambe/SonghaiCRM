import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/[id]/mark-read — zera unread_count_for_assignee.
 *
 * Disparado pelo inbox após 1,5s com a conversa em foco (EPIC-03 S-03.10).
 * RLS garante que só conversas visíveis ao ator são atualizadas.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

import { markConversationReadHandler } from "../../_handler";
import { marcarRecebidasComoLidas } from "@/lib/inbox/leitura-das-recebidas";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  const supabase = await createClient();

  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;

  try {
    const conv = await markConversationReadHandler(
      supabase,
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
        idioma: authz.user.idioma,
      },
      id,
    );
    // SonghaiCRM — as mensagens do cliente passam a ficar lidas no CRM (ticks
    // verdes na bolha). Falhar aqui não desfaz o contador já zerado.
    await marcarRecebidasComoLidas(supabase, authz.org.orgId, id).catch((err: unknown) => {
      logger.warn("[mark-read] recebidas não marcadas como lidas", {
        conversationId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return ok(conv, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}
