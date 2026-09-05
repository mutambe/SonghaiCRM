/**
 * GET/POST /api/v1/cron/licensing-refresh — busca o token de licença na
 * instância central 1x/dia e cacheia em `licensing_client_state`. Mesmo
 * contrato de auth dos demais crons (Bearer INTERNAL_CRON_SECRET|
 * INTERNAL_SECRET). Instalação sem `LICENSE_KEY`/`LICENSING_CENTRAL_URL`
 * configurados (ex.: a própria instância central, ou um clone que ainda não
 * recebeu licença) é NO-OP — não é erro, o gate (Task 11) trata "nunca
 * contactou" como bloqueio, o que é o comportamento certo para uma
 * instalação sem licença configurada.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLicenseToken } from "@/lib/licensing/central-client";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  if (!env.LICENSE_KEY || !env.LICENSING_CENTRAL_URL) {
    return ok({ skipped: true }, { requestId });
  }

  try {
    const token = await fetchLicenseToken(env.LICENSING_CENTRAL_URL, env.LICENSE_KEY);
    const admin = createAdminClient();
    await admin.from("licensing_client_state").upsert({
      id: "singleton",
      token,
      fetched_at: new Date().toISOString(),
    });
    return ok({ refreshed: true }, { requestId });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn("[licensing-refresh] falha ao contactar a central — mantendo cache anterior", {
      error: detail,
      requestId,
    });
    return ok({ refreshed: false, reason: detail }, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
