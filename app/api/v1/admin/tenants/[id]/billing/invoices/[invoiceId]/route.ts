/**
 * PATCH /api/v1/admin/tenants/[id]/billing/invoices/[invoiceId] — dar prazo ou
 * anular UMA factura em aberto (SonghaiCRM, 9010).
 *
 *   { "due_date": "AAAA-MM-DD" }  adia o vencimento (até 60 dias) e recomeça a
 *                                 régua dessa factura; se a conta estava
 *                                 suspensa por falta de pagamento, volta na hora
 *   { "void": true }              anula (engano, acordo)
 *   { "paid_via": "transferencia" }  dá como paga uma transferência bancária que
 *                                 entrou (o PaySuite confirma sozinho os outros
 *                                 meios, mas não vê o banco). Reactiva a conta,
 *                                 agradece ao cliente e regista quem o fez
 *
 * Paga não se mexe: é dinheiro que entrou. `organization_id` vem do path e toda
 * leitura o filtra.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { anularFatura, darPrazo } from "@/lib/billing/admin";
import { lerConfigDaFaturacao } from "@/lib/billing/config";
import { dependenciasReais } from "@/lib/billing/dependencias";
import { COLUNAS_DA_FATURA, reativarSePago, registrarPagamentoDeFatura, type FaturaAberta } from "@/lib/billing/executar";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({ due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ void: z.literal(true) }).strict(),
  z.object({ paid_via: z.literal("transferencia"), reference: z.string().trim().max(100).optional() }).strict(),
]);

const MENSAGENS: Record<string, { status: number; code: string; message: string }> = {
  fatura_nao_encontrada: { status: 404, code: "not_found", message: "Factura não encontrada neste cliente." },
  fatura_nao_aberta: { status: 409, code: "invoice_not_open", message: "Só se mexe numa factura em aberto." },
  data_invalida: { status: 400, code: "validation_failed", message: "Data inválida." },
  data_no_passado: { status: 400, code: "validation_failed", message: "A nova data não pode estar no passado." },
  prazo_demasiado_longo: { status: 400, code: "validation_failed", message: "O prazo pode ir até 60 dias de cada vez." },
  prazo_nao_avanca: { status: 409, code: "deadline_not_extended", message: "A nova data tem de ser depois do vencimento actual." },
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; invoiceId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id, invoiceId } = await params;

  const suporte = await requireSupportWrite(id);
  if (suporte) return suporte;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdminEscrita>>;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(invoiceId).success) {
    return fail("validation_failed", "Identificador inválido.", 400, { requestId });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Pedido inválido.", 400, { requestId });

  const db = createAdminClient();

  // Transferência bancária que entrou: dá-se a factura como paga pela MESMA via que o PaySuite
  // usa (reactiva a conta, agradece, audita com `via` e quem a marcou), não por uma cópia.
  if ("paid_via" in parsed.data) {
    const cfg = await lerConfigDaFaturacao(db);
    if (!cfg) return fail("billing_disabled", "Ligue a faturação em Admin › Faturação primeiro.", 409, { requestId });
    const { data: fatura } = await db
      .from("billing_invoices")
      .select(COLUNAS_DA_FATURA)
      .eq("id", invoiceId)
      .eq("organization_id", id)
      .maybeSingle();
    if (!fatura) return fail("not_found", "Factura não encontrada neste cliente.", 404, { requestId });
    try {
      const mudou = await registrarPagamentoDeFatura(
        await dependenciasReais(db, cfg),
        fatura as unknown as FaturaAberta,
        undefined,
        "transferencia",
        { ator: adminCtx.user.id, referencia: parsed.data.reference },
      );
      if (!mudou) return fail("invoice_not_open", "Só se mexe numa factura em aberto.", 409, { requestId });
    } catch {
      return fail("internal_error", "Não foi possível dar a factura como paga.", 500, { requestId });
    }
    return ok({ id: invoiceId, paga: true }, { requestId });
  }

  const anular = "void" in parsed.data;
  const r = anular ? await anularFatura(db, id, invoiceId) : await darPrazo(db, id, invoiceId, (parsed.data as { due_date: string }).due_date);
  if (!r.ok) {
    const m = MENSAGENS[r.erro ?? ""];
    if (m) return fail(m.code, m.message, m.status, { requestId });
    return fail("internal_error", "Não foi possível alterar a factura.", 500, { requestId });
  }

  void audit({
    action: anular ? "billing.invoice_voided" : "billing.invoice_extended",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "billing_invoice",
    resourceId: invoiceId,
    requestId,
    metadata: parsed.data,
  });

  // A conta estava parada por esta dívida? Volta já, sem esperar pela rodada de hora a hora.
  // Só se não houver outra factura vencida: `reativarSePago` confere.
  let reativada = false;
  try {
    const cfg = await lerConfigDaFaturacao(db);
    if (cfg) {
      const { data: antes } = await db.from("organizations").select("status").eq("id", id).maybeSingle();
      await reativarSePago(await dependenciasReais(db, cfg), id);
      const { data: depois } = await db.from("organizations").select("status").eq("id", id).maybeSingle();
      reativada = (antes as { status?: string } | null)?.status === "suspended" && (depois as { status?: string } | null)?.status === "active";
    }
  } catch {
    // A rodada de hora a hora reactiva na mesma; a mudança da factura já está feita.
  }

  return ok({ id: invoiceId, reativada }, { requestId });
}
