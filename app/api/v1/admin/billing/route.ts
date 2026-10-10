/**
 * /api/v1/admin/billing — o painel da faturação dos pacotes (SonghaiCRM, 9010).
 *
 * GET devolve o resumo: o que está configurado, quanto cobra cada pacote, quem
 * deve, quem foi suspenso por dívida e as facturas recentes.
 * PUT escolhe a organização que RECEBE (é a das credenciais do PaySuite) e liga a
 * faturação: sem ela nada se emite nem se suspende.
 *
 * Só admin da plataforma; a escrita exige acesso TOTAL — é o contrato comercial.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { gravarConfigDaFaturacao } from "@/lib/billing/config";
import { resumoDaFaturacao } from "@/lib/billing/resumo";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const putSchema = z.object({ organization_id: z.string().uuid() });

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  return ok(await resumoDaFaturacao(createAdminClient()), { requestId });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const suporte = await requireSupportWrite();
  if (suporte) return suporte;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdminEscrita>>;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Organização inválida.", 400, { requestId });

  const db = createAdminClient();
  const { data: org } = await db.from("organizations").select("id").eq("id", parsed.data.organization_id).maybeSingle();
  if (!org) return fail("not_found", "Organização não encontrada.", 404, { requestId });

  if (!(await gravarConfigDaFaturacao(db, parsed.data.organization_id, adminCtx.user.id))) {
    return fail("internal_error", "Não foi possível gravar a configuração.", 500, { requestId });
  }

  void audit({
    action: "billing.settings_changed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: parsed.data.organization_id,
    resourceType: "organization",
    resourceId: parsed.data.organization_id,
    requestId,
    metadata: { receiving_organization_id: parsed.data.organization_id },
  });

  return ok(await resumoDaFaturacao(db), { requestId });
}
