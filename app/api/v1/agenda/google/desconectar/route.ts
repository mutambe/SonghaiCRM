/**
 * DELETE /api/v1/agenda/google/desconectar — desliga a agenda do Google.
 *
 * Adaptado do upstream DeskcommCRM. Apaga:
 *
 * 1. Os TOKENS (`calendar_connections`) — marcar `status` e deixar o segredo
 *    no banco seria desconectar de mentira.
 * 2. Os CALENDÁRIOS (`calendar_connection_calendars`) — cascade pela FK.
 *
 * (A Fase 2 vai ter que resolver o mesmo cuidado do upstream com eventos
 * externos já sincronizados — não existe essa tabela ainda nesta fase.)
 *
 * A própria pessoa desconecta a dela com `agent`. Desconectar a de OUTRO
 * membro exige `manager` — é o caminho de saída de quem deixou o time: sem
 * isto, a agenda pessoal de quem saiu fica no banco sem via de produto que a
 * apague.
 *
 * `organization_id` vem SEMPRE da sessão, nunca do corpo. O corpo carrega no
 * máximo o `user_id` ALVO, validado pelo papel — não é o que decide o tenant.
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { PROVEDOR_GOOGLE } from "@/lib/agenda/tipos";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpo = z.object({
  /** Ausente = a própria conexão de quem chamou. Presente = exige `manager`. */
  user_id: z.string().uuid().optional(),
});

export async function DELETE(req: NextRequest): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? undefined;

  const autorizado = await requireRole("agent", { requestId, resource: "calendar_connections" });
  if (!autorizado.ok) return autorizado.response;
  const { user, org } = autorizado;

  let alvo = user.id;
  const bruto = await req.json().catch(() => ({}));
  const lido = corpo.safeParse(bruto);
  if (!lido.success) {
    return fail("validation_failed", "Corpo inválido para desconectar.", 422, { requestId });
  }
  if (lido.data.user_id && lido.data.user_id !== user.id) {
    const podeDesconectarOutro = await requireRole("manager", { requestId, resource: "calendar_connections" });
    if (!podeDesconectarOutro.ok) return podeDesconectarOutro.response;
    alvo = lido.data.user_id;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("calendar_connections")
    .delete()
    .eq("organization_id", org.orgId)
    .eq("user_id", alvo)
    .eq("provider", PROVEDOR_GOOGLE);

  if (error) {
    await audit({
      actorUserId: user.id,
      action: "agenda.google.conexao_falhou",
      organizationId: org.orgId,
      metadata: { reason: "delete_falhou", detalhe: error.message, alvo_user_id: alvo },
    });
    return fail("internal_error", "Não consegui desconectar a agenda.", 500, { requestId });
  }

  await audit({
    actorUserId: user.id,
    action: "agenda.google.desconectada",
    organizationId: org.orgId,
    metadata: { alvo_user_id: alvo },
  });

  return ok({ disconnected: true });
}
