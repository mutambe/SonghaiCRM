/**
 * GET/POST /api/v1/cron/billing — a rodada da faturação dos pacotes (SonghaiCRM, 9010).
 *
 * De hora a hora. Emite as facturas devidas, cria os links de pagamento,
 * confere no PaySuite o que já foi pago, aplica a régua (lembrete, aviso final,
 * suspensão) e reactiva quem pagou. Cada passo é idempotente: repetir a rodada
 * não repete nada, e uma rodada perdida é apanhada pela seguinte. O desenho
 * inteiro está em `lib/billing/executar.ts`.
 *
 * Sem organização que recebe configurada, a faturação está DESLIGADA e a rodada
 * sai na hora (200, `desligada`) — nunca emite nem suspende às cegas.
 *
 * Auditoria: quem audita é o motor, linha a linha e só quando há EFEITO
 * (factura emitida, aviso enviado, conta suspensa). Esta borda não audita
 * rodada vazia (`tests/unit/cron-audita-so-quando-ha-efeito.test.ts`).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { lerConfigDaFaturacao } from "@/lib/billing/config";
import { dependenciasReais } from "@/lib/billing/dependencias";
import { rodarFaturacao } from "@/lib/billing/executar";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const db = createAdminClient();
  const cfg = await lerConfigDaFaturacao(db);
  if (!cfg) return ok({ status: "desligada" }, { requestId });

  try {
    const resumo = await rodarFaturacao(await dependenciasReais(db, cfg));
    return ok({ status: "ok", ...resumo }, { requestId });
  } catch (erro) {
    logger.error("[cron.billing] falhou", { requestId, detalhe: erro instanceof Error ? erro.message : String(erro) });
    return fail("internal_error", "A rodada da faturação falhou.", 500, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
