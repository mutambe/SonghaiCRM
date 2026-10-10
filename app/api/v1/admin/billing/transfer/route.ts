/**
 * PUT /api/v1/admin/billing/transfer — os dados para pagar por transferência
 * bancária (SonghaiCRM, 9010).
 *
 * Texto livre que o operador escreve (banco, titular, NIB/IBAN) e que o cliente lê
 * na página de facturação, nas facturas e nos e-mails que pedem pagamento. O
 * sistema não o interpreta nem o valida. Vazio ou `null` apaga.
 *
 * O PaySuite confirma sozinho M-Pesa, e-Mola e cartão; a transferência não: quem
 * a dá como paga é uma pessoa, na factura do cliente.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { TAMANHO_MAXIMO_DAS_INSTRUCOES, gravarInstrucoesDeTransferencia } from "@/lib/billing/config";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ instructions: z.string().max(TAMANHO_MAXIMO_DAS_INSTRUCOES).nullable() }).strict();

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

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", `O texto pode ter até ${TAMANHO_MAXIMO_DAS_INSTRUCOES} caracteres.`, 400, { requestId });
  }

  if (!(await gravarInstrucoesDeTransferencia(createAdminClient(), parsed.data.instructions, adminCtx.user.id))) {
    return fail("internal_error", "Não foi possível guardar os dados da transferência.", 500, { requestId });
  }

  void audit({
    action: "billing.transfer_instructions_changed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    // O conteúdo (dados de conta) não vai para a auditoria: só o facto e o tamanho.
    metadata: { cleared: !parsed.data.instructions?.trim(), length: parsed.data.instructions?.trim().length ?? 0 },
  });

  return ok({ guardado: true }, { requestId });
}
