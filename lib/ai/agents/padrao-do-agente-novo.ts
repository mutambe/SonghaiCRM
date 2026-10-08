/**
 * O modelo com que um agente NOVO nasce (SonghaiCRM, decisão do dono em
 * 08/10/2026): Claude Haiku 5.5 com esforço Médio, quando o provedor é a
 * Anthropic. Vale só para agente criado daqui para a frente — agentes que já
 * existem mantêm o modelo que têm, e o padrão da organização (que decide os
 * pontos sem binding) não muda.
 */
import type { Esforco } from "@/lib/ai/esforco";

export const MODELO_DO_AGENTE_NOVO = {
  provider: "anthropic",
  model: "claude-haiku-5-5",
  effort: "medium" satisfies Esforco,
} as const;

/** O modelo e o esforço iniciais para um agente novo neste provedor; nada para os outros. */
export function padraoDoAgenteNovo(provider: string): { model: string; effort: Esforco } | null {
  return provider === MODELO_DO_AGENTE_NOVO.provider
    ? { model: MODELO_DO_AGENTE_NOVO.model, effort: MODELO_DO_AGENTE_NOVO.effort }
    : null;
}
