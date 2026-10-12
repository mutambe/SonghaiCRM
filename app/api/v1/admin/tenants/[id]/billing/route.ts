/**
 * /api/v1/admin/tenants/[id]/billing — os termos comerciais de UM cliente (SonghaiCRM, 9010).
 *
 * GET: o pacote, o preço acordado, o piloto, os extras e as facturas dele.
 * PATCH: preço e setup acordados só com este cliente, e o piloto (que só se muda
 * antes da primeira factura). Não mexe em nenhuma factura emitida; vale para as
 * que ainda vão ser emitidas.
 *
 * `organization_id` vem sempre do path, e toda leitura o filtra explicitamente.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { alterarTermosDoCliente } from "@/lib/billing/admin";
import { estadoDosTokens } from "@/lib/billing/tokens";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const centimos = z.number().int().min(0).max(1_000_000_000);
const patchSchema = z
  .object({
    agreed_price_cents: centimos.nullable().optional(),
    agreed_setup_cents: centimos.nullable().optional(),
    is_pilot: z.boolean().optional(),
    ai_tokens_override: z.number().int().min(1).max(100_000_000_000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nada a alterar." });

const MENSAGENS: Record<string, { status: number; code: string; message: string }> = {
  sem_assinatura: { status: 409, code: "no_subscription", message: "Este cliente não tem pacote atribuído." },
  piloto_ja_nao_se_aplica: {
    status: 409,
    code: "pilot_locked",
    message: "O piloto já não se pode mudar: a primeira factura deste cliente já foi emitida.",
  },
  nada_a_alterar: { status: 400, code: "validation_failed", message: "Nada a alterar." },
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail("validation_failed", "Organização inválida.", 400, { requestId });

  const db = createAdminClient();
  const { data: org } = await db.from("organizations").select("id").eq("id", id).maybeSingle();
  if (!org) return fail("not_found", "Organização não encontrada.", 404, { requestId });

  const [{ data: assinatura }, { data: extras }, { data: faturas }, { data: catalogo }] = await Promise.all([
    db
      .from("organization_subscriptions")
      .select("id, agreed_price_cents, agreed_setup_cents, is_pilot, billing_anchor, ai_tokens_override, plan:plans(display_name, price_cents, setup_fee_cents, currency, limits)")
      .eq("organization_id", id)
      .is("ended_at", null)
      .maybeSingle(),
    db
      .from("subscription_items")
      .select("id, description, unit_price_cents, quantity, recurrence, adds_whatsapp_connections, adds_users, started_on, ended_on, billed_invoice_id")
      .eq("organization_id", id)
      .order("started_on", { ascending: false }),
    db
      .from("billing_invoices")
      .select("id, period_start, due_date, amount_cents, currency, status, checkout_url, paid_at")
      .eq("organization_id", id)
      .order("period_start", { ascending: false })
      .limit(12),
    db.from("billing_addons").select("id, slug, description, unit_price_cents, recurrence").eq("is_active", true).order("sort", { ascending: true }),
  ]);

  // O consumo de tokens deste período. Falhar a medi-lo não pode esconder o resto do cartão.
  let tokens = null;
  try {
    tokens = await estadoDosTokens(db, id);
  } catch {
    tokens = null;
  }

  return ok({ assinatura: assinatura ?? null, extras: extras ?? [], faturas: faturas ?? [], catalogo: catalogo ?? [], tokens }, { requestId });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const suporte = await requireSupportWrite(id);
  if (suporte) return suporte;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdminEscrita>>;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  if (!z.string().uuid().safeParse(id).success) return fail("validation_failed", "Organização inválida.", 400, { requestId });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Campos inválidos.", 400, { requestId, details: parsed.error.flatten() });

  const r = await alterarTermosDoCliente(createAdminClient(), id, parsed.data);
  if (!r.ok) {
    const m = MENSAGENS[r.erro ?? ""];
    if (m) return fail(m.code, m.message, m.status, { requestId });
    return fail("internal_error", "Não foi possível alterar os termos.", 500, { requestId });
  }

  void audit({
    action: "billing.agreement_changed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "organization_subscription",
    resourceId: r.dados!.assinaturaId,
    requestId,
    metadata: parsed.data,
  });

  return ok({ assinatura_id: r.dados!.assinaturaId }, { requestId });
}
