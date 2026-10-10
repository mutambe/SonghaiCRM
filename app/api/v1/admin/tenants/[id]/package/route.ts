/**
 * POST /api/v1/admin/tenants/[id]/package — aplica um agente-modelo a um cliente
 * (SonghaiCRM, Fase B da spec 19).
 *
 * O `[id]` é o CLIENTE (destino). O modelo vem no corpo: a organização que o
 * guarda e o agente. A cópia nasce rascunho, com a sessão de WhatsApp do cliente
 * e sem nada que seja de outra organização — ver `lib/ai/agents/aplicar-modelo.ts`.
 *
 * Só admin da plataforma com acesso TOTAL: copiar prompt entre organizações é
 * ato de operador, nunca de quem é membro de um cliente. As duas organizações
 * são lidas pelo servidor com filtro explícito (o agente só vale na organização
 * que o corpo declarou como dona dele).
 */
import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { aplicarAgenteModelo, type AplicarModeloError } from "@/lib/ai/agents/aplicar-modelo";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  source_organization_id: z.string().uuid(),
  source_agent_id: z.string().uuid(),
});

const RECUSAS: Record<AplicarModeloError, { status: number; code: string; message: string }> = {
  same_organization: {
    status: 400,
    code: "validation_failed",
    message: "O modelo e o cliente são a mesma organização. Para copiar dentro dela, use Duplicar na lista de agentes.",
  },
  source_not_found: { status: 404, code: "not_found", message: "O agente-modelo não existe nessa organização." },
  unsupported_kind: {
    status: 409,
    code: "unsupported_kind",
    message: "Só agentes com ferramentas (MCP) servem de modelo. Este é um agente de base de conhecimento antigo.",
  },
  source_not_published: {
    status: 409,
    code: "source_not_published",
    message: "O agente-modelo não tem versão publicada. Publique-o primeiro: o modelo é sempre a versão revista, nunca um rascunho.",
  },
  target_has_no_channel_session: {
    status: 409,
    code: "target_has_no_channel_session",
    message: "O cliente ainda não ligou o WhatsApp. Peça-lhe para ligar o número no onboarding e aplique o modelo depois.",
  },
  agent_insert_failed: { status: 500, code: "internal_error", message: "Não foi possível criar o agente do cliente." },
  version_insert_failed: { status: 500, code: "internal_error", message: "Não foi possível criar a versão do agente do cliente." },
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();

  const suporte = await requireSupportWrite();
  if (suporte) return suporte;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdminEscrita>>;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return fail("validation_failed", "Id de organização inválido.", 400, { requestId });
  }
  const targetOrgId = parsedParams.data.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 400, { requestId, details: parsed.error.flatten() });
  }
  const { source_organization_id: sourceOrgId, source_agent_id: sourceAgentId } = parsed.data;

  const admin = createAdminClient();

  // As DUAS organizações têm de existir: sem isto, um id errado viraria
  // "modelo não encontrado" e esconderia que o cliente é que não existe.
  const { data: orgs, error: orgsErr } = await admin
    .from("organizations")
    .select("id")
    .in("id", [targetOrgId, sourceOrgId]);
  if (orgsErr) return fail("internal_error", "Não foi possível ler as organizações.", 500, { requestId });
  const existentes = new Set((orgs ?? []).map((o) => (o as { id: string }).id));
  if (!existentes.has(targetOrgId)) return fail("not_found", "Cliente não encontrado.", 404, { requestId });
  if (!existentes.has(sourceOrgId)) return fail("not_found", "Organização do modelo não encontrada.", 404, { requestId });

  const resultado = await aplicarAgenteModelo(admin, {
    sourceOrgId,
    sourceAgentId,
    targetOrgId,
    actorUserId: adminCtx.user.id,
  });
  if (!resultado.ok) {
    const r = RECUSAS[resultado.error];
    return fail(r.code, r.message, r.status, { requestId });
  }

  const agentId = (resultado.agent as { id: string }).id;
  void audit({
    action: "ai_agent.model_applied",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: targetOrgId,
    resourceType: "ai_agent",
    resourceId: agentId,
    requestId,
    metadata: {
      source_organization_id: sourceOrgId,
      source_agent_id: sourceAgentId,
      source_version_id: resultado.sourceVersionId,
      channel_session_id: resultado.channelSessionId,
    },
  });

  return ok(
    {
      agent_id: agentId,
      version_id: (resultado.version as { id: string }).id,
      status: "draft",
      channel_session_id: resultado.channelSessionId,
      source_agent_id: sourceAgentId,
      source_version_id: resultado.sourceVersionId,
      a_configurar: resultado.a_configurar,
    },
    { requestId },
  );
}
