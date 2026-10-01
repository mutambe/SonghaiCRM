/**
 * TETO DE NÚMEROS DE WHATSAPP DO PLANO (SonghaiCRM, migration 0504).
 *
 * Uma função para TODAS as portas que ligam um número novo — o QR, o canal
 * oficial e os parceiros. No fork antigo o teto só existia no QR; aqui há mais
 * portas, e uma porta sem o teto fura o plano inteiro.
 *
 * Conta só números de WhatsApp VIVOS: canais arquivados foram excluídos pelo
 * utilizador e não ocupam vaga, e redes sociais e chamada de voz não são
 * números de conversa do plano. Quais providers contam é decidido em
 * `lib/channels/numeros-de-whatsapp.ts` — nomear provider fora de
 * `lib/channels/` é proibido (`pnpm lint:channels`).
 *
 * Sem assinatura vigente não bloqueia (lib/plans/limiteDoTenant.ts). Quem chama
 * aplica isto só quando vai CRIAR uma ligação — reconfigurar a existente nunca
 * esbarra no teto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { PROVIDERS_DE_NUMERO_WHATSAPP } from "@/lib/channels/numeros-de-whatsapp";
import { logger } from "@/lib/logger";
import { limitesDoTenant } from "@/lib/plans/limiteDoTenant";

/** Reexportado para quem já lia daqui. */
export const PROVEDORES_DE_NUMERO_WHATSAPP = PROVIDERS_DE_NUMERO_WHATSAPP;

export interface TetoAtingido {
  mensagem: string;
  details: { limit: "max_whatsapp_connections"; current: number; max: number };
}

/**
 * `null` = pode ligar mais um número; senão, o que dizer a quem tentou.
 *
 * Falha ABERTO por inteiro: qualquer erro — da leitura do pacote ou da
 * contagem — deixa passar e vai para o log. Só a contagem estava protegida, e
 * uma falha ao ler o pacote virava 500 na tela de ligar o número (achado pela
 * suíte: o mock do `graph-partner` não tem `from`, e o turno inteiro caía).
 */
export async function tetoDeConexoesWhatsApp(db: SupabaseClient, organizationId: string): Promise<TetoAtingido | null> {
  try {
    return await calcularTeto(db, organizationId);
  } catch (err) {
    logger.warn("[plano] teto de números não conferido — deixei passar", {
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function calcularTeto(db: SupabaseClient, organizationId: string): Promise<TetoAtingido | null> {
  const limites = await limitesDoTenant(organizationId);
  if (!limites || !Number.isFinite(limites.maxWhatsappConnections)) return null;

  const { count, error } = await db
    .from("channel_sessions")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("provider", [...PROVEDORES_DE_NUMERO_WHATSAPP])
    .is("archived_at", null);
  // Falha de leitura não vira bloqueio: o teto é regra comercial, e travar a
  // ligação de um número por uma contagem que não chegou seria pior do que
  // deixar passar uma vez. O erro fica no log de quem chama.
  if (error) return null;

  const atual = count ?? 0;
  if (atual < limites.maxWhatsappConnections) return null;
  return {
    mensagem: `O pacote ${limites.planDisplayName} permite até ${limites.maxWhatsappConnections} número(s) de WhatsApp. Fale com o suporte para mudar de pacote.`,
    details: { limit: "max_whatsapp_connections", current: atual, max: limites.maxWhatsappConnections },
  };
}
