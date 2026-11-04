/**
 * O LIMITE DE SAÍDA QUE O AI SDK NÃO SABE (SonghaiCRM, 08/10/2026).
 *
 * Sem `maxOutputTokens`, o `@ai-sdk/anthropic` envia como `max_tokens` o teto
 * que ELE conhece para o modelo: 64 000–128 000 nos que reconhece, e **4096**
 * nos que não reconhece. Medido com o SDK instalado (4.0.x), por pedido real
 * ao `fetch`: `claude-haiku-5-5`, `claude-opus-5` e `claude-opus-5-5` saem com
 * 4096. Nesses modelos o pensamento adaptativo está ligado por omissão e conta
 * para o `max_tokens` — um agente que pensa e responde pode parar em
 * `stop_reason: max_tokens`, com a resposta cortada, sem erro nenhum.
 *
 * O agente novo nasce no Haiku 5.5, então isto não é um canto: é o caminho
 * padrão. Aqui o piso explícito, só para os modelos que o SDK subestima. Os que
 * ele conhece não mudam (ficam com o teto deles), e uma versão futura do SDK
 * que passe a conhecer o modelo só deixa este piso de 16 000 abaixo do teto
 * dele — inofensivo para conversa de WhatsApp.
 *
 * `tests/unit/saida-e-pensamento-do-agente.test.ts` mede o `max_tokens` que sai
 * de verdade para cada família: se o SDK mudar, o teste diz.
 */
import { idDoModelo } from "./esforco";

/** Piso de `max_tokens` para o agente: o pensamento e a resposta cabem com folga. */
export const LIMITE_DE_SAIDA_DO_AGENTE = 16_000;

/** Famílias que o SDK instalado não conhece e por isso limita a 4096. */
// SonghaiCRM (2026-11-03): VAZIA. O merge do upstream subiu o AI SDK (`@ai-sdk/anthropic`
// 4.0.16 → 4.0.78) e ele passou a conhecer claude-haiku-5-5, claude-opus-5 e claude-opus-5-5
// (128000 de saída, medido no corpo HTTP em `tests/unit/saida-e-pensamento-do-agente.test.ts`).
// O piso de 16 000 deixou de ser necessário; o mecanismo fica para o próximo modelo que o SDK
// não conheça: basta acrescentar a família aqui.
const FAMILIAS_QUE_O_SDK_SUBESTIMA = /(?!)/;

/**
 * O `max_tokens` a passar quando ninguém definiu um (nem a chamada, nem a
 * organização); `undefined` quando o próprio SDK acerta.
 */
export function limiteDeSaidaDoSdkDesconhecido(
  provider: string,
  modelId: string | null | undefined,
): number | undefined {
  if (provider !== "anthropic" || !modelId) return undefined;
  return FAMILIAS_QUE_O_SDK_SUBESTIMA.test(idDoModelo(modelId)) ? LIMITE_DE_SAIDA_DO_AGENTE : undefined;
}
