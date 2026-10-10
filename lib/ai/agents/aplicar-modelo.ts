/**
 * APLICAR UM AGENTE-MODELO A UM CLIENTE (SonghaiCRM — Fase B da spec 19).
 *
 * O operador mantém, numa organização sua (por exemplo "Modelos"), um agente
 * por nicho. Aplicar copia a versão PUBLICADA dele — a que foi revista — para a
 * organização do cliente, como rascunho. Nada é publicado: quem revê e publica
 * é o operador, dentro do cliente.
 *
 * Por que isto não é `duplicateAgentWithVersion`: aquela copia DENTRO da mesma
 * organização, e quase toda coluna da versão que aponta para algo é de uma
 * organização. Copiar tal e qual leva ids do modelo para dentro do cliente — no
 * melhor caso uma referência morta, no pior um agente do cliente a apontar para
 * dados de outro. Por isso, o que é da organização é reposto aqui:
 *
 * | coluna                           | no cliente                              |
 * |----------------------------------|-----------------------------------------|
 * | `channel_session_id` (NOT NULL)  | a sessão de WhatsApp DO CLIENTE         |
 * | `credential_id`                  | a chave do CLIENTE para o provedor, ou nulo |
 * | `pipeline_ids`                   | vazio — os funis do cliente são outros  |
 * | `knowledge_source_ids`           | vazio — a base de conhecimento é dele   |
 * | `followup.flow_pointer_ids`      | vazio, e o follow-up nasce desligado    |
 * | `ai_agents.active_kb_version_id` | nulo                                    |
 *
 * Prompt, modelo, esforço, ferramentas, orçamentos, janelas e palavras de
 * handoff são o conteúdo do modelo e vão como estão (os tetos do CHECK já
 * valiam no modelo). O que o operador tem de reconfigurar no cliente sai na
 * resposta (`a_configurar`), para a tela dizer em voz alta o que falta.
 *
 * ─── A chave de IA é do CLIENTE ─────────────────────────────────────────────
 * Cada cliente tem a sua chave do provedor (Claude, OpenAI…), obtida no próprio
 * provedor e sem partilha entre clientes. Por isso a cópia liga a credencial
 * DESTE cliente para o provedor da versão, quando ele já tem uma activa e validada.
 * Quando não tem, `credential_id` fica nulo e a credencial entra em `a_configurar`:
 * não é um aviso de cortesia — publicar uma versão sem credencial é recusado pelo
 * banco (`fn_publish_agent_version`: `credential_missing`). A chave comum da
 * instalação serve só ao ensaio, e nunca é o destino de um cliente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DUPLICATE_AGENT_COLUMNS,
  DUPLICATE_VERSION_COLUMNS,
  versionPayloadFrom,
} from "@/lib/ai/agents/duplicate";

export type AplicarModeloError =
  | "same_organization"
  | "source_not_found"
  | "unsupported_kind"
  | "source_not_published"
  | "target_has_no_channel_session"
  | "agent_insert_failed"
  | "version_insert_failed";

/** O que o operador ainda tem de fazer dentro do cliente. */
export type ItemAConfigurar = "credencial_de_ia" | "funis" | "base_de_conhecimento" | "follow_ups";

/** O que SEMPRE falta no cliente: o que é dele e não vai no modelo. */
export const ITENS_A_CONFIGURAR: readonly ItemAConfigurar[] = ["funis", "base_de_conhecimento", "follow_ups"];

export type AplicarModeloResult =
  | {
      ok: true;
      agent: Record<string, unknown>;
      version: Record<string, unknown>;
      sourceVersionId: string;
      channelSessionId: string;
      a_configurar: readonly ItemAConfigurar[];
    }
  | { ok: false; error: AplicarModeloError; message?: string };

/** Quanto mais perto de atender, mais cedo: a sessão que funciona vence a que está a arrancar. */
const ORDEM_DA_SESSAO = ["WORKING", "SCAN_QR_CODE", "STARTING", "STOPPED", "FAILED"];

/** A sessão de WhatsApp do cliente onde o agente vai atender. `null` = ele ainda não ligou nenhuma. */
export async function sessaoDoCliente(admin: SupabaseClient, targetOrgId: string): Promise<string | null> {
  const { data } = await admin
    .from("channel_sessions")
    .select("id, status, created_at")
    .eq("organization_id", targetOrgId)
    .order("created_at", { ascending: true });
  const linhas = (data ?? []) as Array<{ id: string; status: string }>;
  linhas.sort((a, b) => ORDEM_DA_SESSAO.indexOf(a.status) - ORDEM_DA_SESSAO.indexOf(b.status));
  return linhas[0]?.id ?? null;
}

/**
 * A credencial DESTE cliente para o provedor: activa e validada (só essas
 * publicam). Várias: a mais recente. `null` = o cliente ainda não registou a chave.
 */
async function credencialDoCliente_(admin: SupabaseClient, targetOrgId: string, provider: string): Promise<string | null> {
  const { data } = await admin
    .from("ai_provider_credentials")
    .select("id, created_at")
    .eq("organization_id", targetOrgId)
    .eq("provider", provider)
    .eq("is_active", true)
    .not("validated_at", "is", null)
    .order("created_at", { ascending: false });
  const linhas = (data ?? []) as Array<{ id: string }>;
  return linhas[0]?.id ?? null;
}

/** O follow-up do modelo aponta para fluxos do modelo: nasce vazio e desligado. */
function followupSemFluxosDoModelo(followup: unknown): Record<string, unknown> {
  const base = followup && typeof followup === "object" && !Array.isArray(followup) ? followup : {};
  return { ...(base as Record<string, unknown>), enabled: false, flow_pointer_ids: [] };
}

export async function aplicarAgenteModelo(
  admin: SupabaseClient,
  input: {
    sourceOrgId: string;
    sourceAgentId: string;
    targetOrgId: string;
    actorUserId: string;
  },
): Promise<AplicarModeloResult> {
  const { sourceOrgId, sourceAgentId, targetOrgId, actorUserId } = input;
  if (sourceOrgId === targetOrgId) return { ok: false, error: "same_organization" };

  // A organização de origem entra no filtro: o agente só vale se for DELA.
  const { data: srcAgent } = await admin
    .from("ai_agents")
    .select(DUPLICATE_AGENT_COLUMNS)
    .eq("id", sourceAgentId)
    .eq("organization_id", sourceOrgId)
    .is("archived_at", null)
    .maybeSingle();
  if (!srcAgent) return { ok: false, error: "source_not_found" };
  const src = srcAgent as Record<string, unknown>;
  if (src.kind !== "mcp_agent") return { ok: false, error: "unsupported_kind" };

  // O modelo é a versão PUBLICADA — a que alguém já pôs no ar. Um rascunho do
  // modelo pode estar a meio, e copiá-lo propagaria o meio-feito para o cliente.
  const publicada = src.published_version_id as string | null;
  const { data: srcVersion } = publicada
    ? await admin
        .from("ai_agent_versions")
        .select(DUPLICATE_VERSION_COLUMNS)
        .eq("id", publicada)
        .eq("organization_id", sourceOrgId)
        .eq("status", "published")
        .maybeSingle()
    : { data: null };
  if (!srcVersion) return { ok: false, error: "source_not_published" };
  const versao = srcVersion as unknown as Record<string, unknown>;

  const credencialDoCliente = await credencialDoCliente_(admin, targetOrgId, String(versao.provider));
  const channelSessionId = await sessaoDoCliente(admin, targetOrgId);
  if (!channelSessionId) return { ok: false, error: "target_has_no_channel_session" };

  const { data: newAgent, error: agentErr } = await admin
    .from("ai_agents")
    .insert({
      organization_id: targetOrgId,
      name: String(src.name).slice(0, 120),
      description: src.description,
      model: src.model,
      system_prompt: src.system_prompt,
      kind: src.kind,
      priority: src.priority ?? 0,
      // Sem `published_version_id`, nenhum runtime a enxerga: nasce fora do ar.
      is_active: true,
      is_default: false,
      config: src.config ?? {},
      guardrails: src.guardrails ?? null,
      active_kb_version_id: null,
      source_agent_id: sourceAgentId,
      source_version_id: versao.id,
      created_by: actorUserId,
    })
    .select(DUPLICATE_AGENT_COLUMNS)
    .single();
  if (agentErr || !newAgent) {
    return { ok: false, error: "agent_insert_failed", message: agentErr?.message };
  }
  const agentId = (newAgent as unknown as { id: string }).id;

  const { data: newVersion, error: versionErr } = await admin
    .from("ai_agent_versions")
    .insert({
      organization_id: targetOrgId,
      agent_id: agentId,
      version_number: 1,
      ...versionPayloadFrom(versao),
      // O que é da organização, reposto — ver a tabela no cabeçalho.
      channel_session_id: channelSessionId,
      credential_id: credencialDoCliente,
      pipeline_ids: [],
      knowledge_source_ids: [],
      followup: followupSemFluxosDoModelo(versao.followup),
      status: "draft",
      created_by: actorUserId,
    })
    .select(DUPLICATE_VERSION_COLUMNS)
    .single();
  if (versionErr || !newVersion) {
    // Sem a versão a cópia é uma casca: arquiva-se, como em `duplicate.ts`.
    await admin.from("ai_agents").update({ archived_at: new Date().toISOString() }).eq("id", agentId);
    return { ok: false, error: "version_insert_failed", message: versionErr?.message };
  }

  return {
    ok: true,
    agent: newAgent as unknown as Record<string, unknown>,
    version: newVersion as unknown as Record<string, unknown>,
    sourceVersionId: versao.id as string,
    channelSessionId,
    a_configurar: credencialDoCliente ? ITENS_A_CONFIGURAR : (["credencial_de_ia", ...ITENS_A_CONFIGURAR] as const),
  };
}
