/**
 * GET /api/v1/agenda/google/calendarios — a conexão do Google da PESSOA
 * logada, e o calendário primário registrado nela.
 *
 * Fase 1: simplificado em relação ao upstream (sem seleção de múltiplos
 * calendários, sem `access_role`/`sync_coverage` — isso é Fase 2). Só diz "a
 * sua agenda está conectada, com esta conta, neste estado".
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "calendar_connections" });
  if (!auth.ok) return auth.response;

  const db = await createClient();
  const { data: connections, error } = await db
    .from("calendar_connections")
    .select("id, account_email, status, last_sync_error, created_at")
    .eq("organization_id", auth.org.orgId)
    .eq("user_id", auth.user.id)
    .eq("provider", "google_calendar")
    .order("created_at", { ascending: false });

  if (error) {
    return fail("internal_error", "Não foi possível carregar a sua conexão com o Google.", 500, {
      requestId,
    });
  }
  if (!connections?.length) {
    return ok({ connections: [], calendars: [] }, { requestId });
  }

  const { data: calendars, error: erroCalendarios } = await db
    .from("calendar_connection_calendars")
    .select("id, connection_id, name, time_zone, is_primary")
    .eq("organization_id", auth.org.orgId)
    .in(
      "connection_id",
      connections.map((c) => c.id),
    )
    .order("is_primary", { ascending: false });

  if (erroCalendarios) {
    return fail("internal_error", "Não foi possível carregar a sua conexão com o Google.", 500, {
      requestId,
    });
  }

  return ok({ connections, calendars: calendars ?? [] }, { requestId });
}
