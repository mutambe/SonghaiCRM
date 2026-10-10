/**
 * SonghaiCRM — as FUNCIONALIDADES que cada pacote inclui (migration 9008).
 *
 * Os pacotes são comerciais (Agente Simples/Médio/Avançado/Enterprise). O que
 * cada um inclui mora no banco, em `plans.limits.features`; aqui moram só os
 * nomes e o mapa de ONDE cada funcionalidade se manifesta (rotas da API).
 * Sem import do cliente administrativo: a consulta recebe o cliente de quem
 * chama, para este módulo poder ser importado de código que também roda fora
 * do servidor.
 *
 * Regras que valem para todo consumidor:
 * - `features` AUSENTE no plano = todas (é o Enterprise). `[]` = nenhuma extra.
 * - Sem assinatura vigente = todas. É o estado de instalação nova e de quem
 *   ainda não recebeu plano; fechar o produto aí seria pior que o defeito.
 * - Falha ao ler o plano = todas, e vai para o log. Atendimento não cai por
 *   causa de uma consulta.
 * - O que o pacote básico faz — agente de IA e WhatsApp — não é funcionalidade
 *   aqui: nunca é bloqueado.
 *
 * Dados NUNCA são apagados ao baixar de plano: a funcionalidade só fica
 * indisponível, e volta inteira quando o plano sobe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

export const FUNCIONALIDADES_DO_PLANO = [
  "agenda",
  "crm",
  "qualificacao_leads",
  "relatorios",
  "analytics",
  "integracoes",
  "mpesa",
] as const;
export type FuncionalidadeDoPlano = (typeof FUNCIONALIDADES_DO_PLANO)[number];

export function ehFuncionalidadeDoPlano(v: unknown): v is FuncionalidadeDoPlano {
  return typeof v === "string" && (FUNCIONALIDADES_DO_PLANO as readonly string[]).includes(v);
}

/** O que o utilizador lê quando esbarra: nome da funcionalidade e o pacote que a traz. */
export const ROTULO_DA_FUNCIONALIDADE: Readonly<Record<FuncionalidadeDoPlano, string>> = {
  agenda: "Agenda",
  crm: "CRM e funil",
  qualificacao_leads: "Qualificação automática de leads",
  relatorios: "Relatórios",
  analytics: "Analytics em tempo real",
  integracoes: "Integrações",
  mpesa: "Pagamentos M-Pesa",
};

/** O pacote mais barato que traz a funcionalidade (para a mensagem de "suba de plano"). */
export const PACOTE_QUE_TRAZ: Readonly<Record<FuncionalidadeDoPlano, string>> = {
  agenda: "Agente Médio",
  crm: "Agente Médio",
  qualificacao_leads: "Agente Médio",
  relatorios: "Agente Médio",
  analytics: "Agente Avançado",
  integracoes: "Agente Avançado",
  mpesa: "Agente Avançado",
};

/**
 * `plans.limits` → funcionalidades. Pura. `features` ausente ou malformado =
 * todas: a leitura nunca fecha por defeito de dado.
 */
export function funcionalidadesDosLimites(limits: unknown): readonly FuncionalidadeDoPlano[] {
  const features =
    limits && typeof limits === "object" ? (limits as { features?: unknown }).features : undefined;
  if (!Array.isArray(features)) return FUNCIONALIDADES_DO_PLANO;
  return features.filter(ehFuncionalidadeDoPlano);
}

/**
 * As funcionalidades do plano vigente da organização, lidas com o cliente que
 * o chamador já tem (admin, no servidor). Sem assinatura, ou com QUALQUER falha
 * na leitura, devolve TODAS e a falha vai para o log. Nunca lança.
 */
export async function funcionalidadesDaOrganizacao(
  db: SupabaseClient,
  organizationId: string,
): Promise<readonly FuncionalidadeDoPlano[]> {
  try {
    const { data, error } = await db
      .from("organization_subscriptions")
      .select("plan:plans(limits)")
      .eq("organization_id", organizationId)
      .is("ended_at", null)
      .maybeSingle();
    if (error) {
      logger.warn("plano: leitura das funcionalidades recusada — tratando todas como incluídas", {
        organization_id: organizationId,
        detalhe: (error as { message?: string }).message,
      });
      return FUNCIONALIDADES_DO_PLANO;
    }
    const plano = (data as unknown as { plan: { limits: unknown } | null } | null)?.plan;
    return plano ? funcionalidadesDosLimites(plano.limits) : FUNCIONALIDADES_DO_PLANO;
  } catch (erro) {
    logger.warn("plano: leitura das funcionalidades falhou — tratando todas como incluídas", {
      organization_id: organizationId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return FUNCIONALIDADES_DO_PLANO;
  }
}

/**
 * Onde cada funcionalidade se manifesta na API. Prefixo por SEGMENTO
 * (`/api/v1/leads` casa `/api/v1/leads/x`, nunca `/api/v1/leads-x`). Quem
 * aplica é `requireRole` (`lib/auth/require-role.ts`); a cobertura é vigiada por
 * `tests/unit/plano-funcionalidades-cobertura.test.ts`.
 */
export const ROTAS_POR_FUNCIONALIDADE: Readonly<Record<FuncionalidadeDoPlano, readonly string[]>> = {
  agenda: ["/api/v1/agenda"],
  crm: [
    "/api/v1/leads",
    "/api/v1/pipelines",
    "/api/v1/companies",
    "/api/v1/company-people",
    "/api/v1/tasks",
  ],
  // Humano não qualifica por rota própria: a qualificação automática é o agente
  // movendo o funil, e isso passa pelas ferramentas (catálogo MCP).
  qualificacao_leads: [],
  relatorios: ["/api/v1/reports"],
  analytics: ["/api/v1/metrics"],
  // NÃO entra `/api/v1/webhooks/*`: é a ENTRADA (as mensagens dos canais e a
  // confirmação dos pagamentos) — é o WhatsApp do pacote básico chegando, e
  // nenhum plano a corta. A gestão dos
  // webhooks de saída mora em `webhook-sources`.
  integracoes: [
    "/api/v1/webhook-sources",
    "/api/v1/external-db",
    "/api/v1/extensions",
    "/api/v1/integrations/nuvemshop",
  ],
  mpesa: ["/api/v1/integrations/paysuite"],
};

function casaPorSegmento(pathname: string, prefixo: string): boolean {
  return pathname === prefixo || pathname.startsWith(`${prefixo}/`);
}

/** A funcionalidade que este caminho de API exige, ou `null` se ele é do pacote básico. */
export function funcionalidadeDaRotaApi(pathname: string | null | undefined): FuncionalidadeDoPlano | null {
  if (!pathname) return null;
  for (const f of FUNCIONALIDADES_DO_PLANO) {
    if (ROTAS_POR_FUNCIONALIDADE[f].some((p) => casaPorSegmento(pathname, p))) return f;
  }
  return null;
}

/** O corpo do 403 — o mesmo em toda porta (API, tela, ferramenta). */
export function mensagemDeFuncionalidadeForaDoPlano(f: FuncionalidadeDoPlano): string {
  return `${ROTULO_DA_FUNCIONALIDADE[f]} não está incluída no seu plano. Disponível a partir do ${PACOTE_QUE_TRAZ[f]}.`;
}
