import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/ai/agents/:id/publish  body: { version_id }
 *
 * Atomic flip via fn_publish_ai_agent_version (Spec 10 §4.5):
 *   - prev published version → 'superseded'
 *   - target version → 'published'
 *   - ai_agents.published_version_id → target
 * Validates credential, channel_session, model and tool_ids before commit.
 *
 * Maps validation errors to 422 with stable codes (PublishErrorCode).
 * Emits event_log 'ai_agent.published' fire-and-forget after commit.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishSchema, PUBLISH_ERROR_CODES } from "@/lib/ai/agents/validation";
import { VALID_TOOL_IDS } from "@/lib/mcp/tools";
import { publishAgentVersion } from "@/lib/ai/agents/publish";
import { traduzir } from "@/lib/i18n/dicionario";
import { avisarTrocaNaPublicacao } from "@/lib/ai/aviso-de-troca-de-modelo";
import { avisoDeAmostragemDaOrganizacao } from "@/lib/ai/avisos-do-modelo";
import { ehEsforco, recusaDoEsforco } from "@/lib/ai/esforco";

const VALID_TOOL_IDS_RUNTIME = new Set<string>(VALID_TOOL_IDS as readonly string[]);

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) {
    return fail("invalid_request", "id inválido.", 400, { requestId });
  }

  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user: authUser, org: activeOrg } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", t("Body JSON inválido."), 400, { requestId });
  }

  const parsed = publishSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const admin = createAdminClient();

  // Pre-flight: tool_ids do target version são válidos no catálogo MCP atual?
  // (catálogo evolui — validar à hora do publish, fora da transação SQL.)
  const { data: targetV } = await admin
    .from("ai_agent_versions")
    .select("id, agent_id, organization_id, tool_ids, status, provider, model, effort")
    .eq("id", parsed.data.version_id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (!targetV || targetV.agent_id !== id) {
    return fail("version_not_found", t("Version não encontrada."), 404, { requestId });
  }

  const tools = (targetV.tool_ids ?? []) as string[];
  const invalid = tools.filter((t) => !VALID_TOOL_IDS_RUNTIME.has(t));
  if (invalid.length > 0) {
    return fail("tool_id_invalid", t("tool_ids contém ids inexistentes no catálogo MCP."), 422, {
      requestId,
      details: { invalid },
    });
  }

  // O esforço precisa ser um que ESTE modelo aceita (SonghaiCRM, 9007). A
  // edição do rascunho pode trocar só o modelo; é aqui que o par é conferido.
  const recusa = recusaDoEsforco(
    targetV.provider as string,
    targetV.model as string,
    ehEsforco(targetV.effort) ? targetV.effort : null,
  );
  if (recusa) return fail("esforco_nao_suportado", t(recusa), 422, { requestId });

  const result = await publishAgentVersion(admin, {
    orgId: activeOrg.orgId,
    agentId: id,
    versionId: parsed.data.version_id,
  });

  if (!result.ok) {
    if (PUBLISH_ERROR_CODES.has(result.code as string)) {
      const status = result.code === "agent_not_found" || result.code === "version_not_found"
        ? 404
        : 422;
      return fail(result.code, t("Validação de publish falhou."), status, { requestId });
    }
    return fail("internal_error", "Erro ao publicar.", 500, { requestId });
  }

  // event_log + audit fire-and-forget.
  void admin
    .from("event_log")
    .insert({
      organization_id: activeOrg.orgId,
      event_type: "ai_agent.published",
      // NOT NULL sem default — ver `tests/unit/evento-de-publicacao-tem-dono.test.ts`.
      entity_kind: "ai_agent",
      payload: {
        agent_id: result.agent_id,
        version_id: result.version_id,
        previous_version_id: result.previous_version_id,
        published_at: result.published_at,
      },
    })
    .then(({ error }) => {
      if (error) console.error("[ai_agents/publish] event_log error", error.message);
    });

  // SonghaiCRM: quem troca o modelo ou o esforço do agente deixa aviso na
  // Central para quem administra. Primeira publicação não é troca.
  await avisarTrocaNaPublicacao(admin, {
    organizationId: activeOrg.orgId,
    agentId: id,
    previousVersionId: result.previous_version_id,
    quem: authUser.full_name || authUser.email,
    depois: {
      provider: targetV.provider as string,
      model: targetV.model as string,
      effort: (targetV.effort as string | null) ?? null,
    },
  });

  void audit({
    action: "ai_agent.published",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "ai_agent",
    resourceId: id,
    requestId,
    metadata: {
      version_id: result.version_id,
      previous_version_id: result.previous_version_id,
    },
  });

  // SonghaiCRM: a organização tem amostragem configurada e o modelo publicado a
  // recusa? Avisa (sem bloquear): ela será retirada dos pedidos.
  const avisoDeAmostragem = await avisoDeAmostragemDaOrganizacao(
    admin,
    activeOrg.orgId,
    targetV.provider as string,
    targetV.model as string,
  );

  return ok(
    {
      agent_id: result.agent_id,
      version_id: result.version_id,
      previous_version_id: result.previous_version_id,
      published_at: result.published_at,
      avisos: avisoDeAmostragem ? [t(avisoDeAmostragem)] : [],
    },
    { requestId },
  );
}
