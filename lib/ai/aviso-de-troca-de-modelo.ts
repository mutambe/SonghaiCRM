/**
 * AVISO NA CENTRAL QUANDO ALGUÉM TROCA MODELO OU ESFORÇO (SonghaiCRM, decisão
 * do dono em 08/10/2026).
 *
 * Trocar o modelo de um agente ou de um ponto muda como a IA fala com o
 * cliente e quanto ela custa — e acontecia em silêncio, visível só no
 * histórico de auditoria. Agora quem administra vê na Central: quem mudou, o
 * quê, de quê para quê.
 *
 * Disparado por PESSOAS (publicar uma versão do agente, salvar um ponto em IA ›
 * Provedores). Mudança feita pelo próprio sistema não passa por aqui.
 *
 * Usa o `kind` genérico `other` de `agent_inbox_items`, que já aceita
 * `ref_kind = 'ai_agent'` com o link "Revisar agente" (`lib/ai/inbox-destino.ts`)
 * — sem tocar no vocabulário do upstream.
 *
 * Falhar aqui não desfaz a troca: ela já está gravada, e devolver erro por
 * causa de um aviso faria a pessoa repetir uma ação que deu certo.
 */
import { ROTULO_DO_ESFORCO, ehEsforco } from "@/lib/ai/esforco";
import { logger } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";

export interface EscolhaDeModelo {
  provider: string;
  model: string | null;
  effort: string | null;
}

function semPrefixo(model: string | null): string {
  if (!model) return "—";
  const i = model.indexOf("/");
  return i >= 0 ? model.slice(i + 1) : model;
}

function rotuloDoEsforco(effort: string | null): string {
  return ehEsforco(effort) ? (ROTULO_DO_ESFORCO[effort].split(" — ")[0] ?? effort) : "padrão do modelo";
}

/** `null` quando nada que importa mudou (mesmo modelo e mesmo esforço). */
export function descreverTroca(
  antes: EscolhaDeModelo | null,
  depois: EscolhaDeModelo,
): { mudouModelo: boolean; mudouEsforco: boolean; texto: string } | null {
  if (antes === null) return null;
  const modeloAntes = `${antes.provider}/${semPrefixo(antes.model)}`;
  const modeloDepois = `${depois.provider}/${semPrefixo(depois.model)}`;
  const mudouModelo = modeloAntes !== modeloDepois;
  const mudouEsforco = (antes.effort ?? null) !== (depois.effort ?? null);
  if (!mudouModelo && !mudouEsforco) return null;
  const partes: string[] = [];
  if (mudouModelo) partes.push(`modelo ${semPrefixo(antes.model)} → ${semPrefixo(depois.model)}`);
  if (mudouEsforco) partes.push(`esforço ${rotuloDoEsforco(antes.effort)} → ${rotuloDoEsforco(depois.effort)}`);
  return { mudouModelo, mudouEsforco, texto: partes.join("; ") };
}

export async function avisarTrocaDeModelo(
  admin: ReturnType<typeof createAdminClient>,
  p: {
    organizationId: string;
    /** "o agente «Vendas»" ou "o ponto «Classificar a conversa»". */
    onde: string;
    quem: string;
    antes: EscolhaDeModelo | null;
    depois: EscolhaDeModelo;
    ref: { kind: "ai_agent"; id: string } | null;
  },
): Promise<boolean> {
  const troca = descreverTroca(p.antes, p.depois);
  if (troca === null) return false;
  const { error } = await admin.from("agent_inbox_items").insert({
    organization_id: p.organizationId,
    kind: "other",
    severity: "info",
    title: `Modelo de IA alterado em ${p.onde}`,
    body: `${p.quem} alterou ${troca.texto}. A partir de agora as respostas usam esta configuração.`,
    ref_kind: p.ref?.kind ?? null,
    ref_id: p.ref?.id ?? null,
  });
  if (error) {
    logger.warn("[aviso-de-troca-de-modelo] aviso não gravado na Central", {
      organization_id: p.organizationId,
      causa: error.message,
    });
    return false;
  }
  return true;
}

/**
 * O aviso da PUBLICAÇÃO de uma versão de agente: compara com a versão que
 * estava em vigor e avisa se o modelo ou o esforço mudaram. Partilhado pelos
 * três caminhos que publicam — a rota `/publish`, a ação da tela e o
 * «reverter para esta versão» —, senão um deles muda o modelo em silêncio.
 * Primeira publicação (sem versão anterior) não é troca.
 */
export async function avisarTrocaNaPublicacao(
  admin: ReturnType<typeof createAdminClient>,
  p: {
    organizationId: string;
    agentId: string;
    previousVersionId: string | null;
    depois: EscolhaDeModelo;
    quem: string;
  },
): Promise<boolean> {
  if (!p.previousVersionId) return false;
  const [{ data: anterior }, { data: agente }] = await Promise.all([
    admin
      .from("ai_agent_versions")
      .select("provider, model, effort")
      .eq("id", p.previousVersionId)
      .eq("organization_id", p.organizationId)
      .maybeSingle(),
    admin
      .from("ai_agents")
      .select("name")
      .eq("id", p.agentId)
      .eq("organization_id", p.organizationId)
      .maybeSingle(),
  ]);
  if (!anterior) return false;
  return avisarTrocaDeModelo(admin, {
    organizationId: p.organizationId,
    onde: `o agente «${agente?.name ?? "sem nome"}»`,
    quem: p.quem,
    antes: { provider: anterior.provider, model: anterior.model, effort: anterior.effort ?? null },
    depois: p.depois,
    ref: { kind: "ai_agent", id: p.agentId },
  });
}
