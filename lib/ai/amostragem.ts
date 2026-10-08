/**
 * QUEM ACEITA `temperature` / `top_p` / `top_k` (SonghaiCRM, 08/10/2026).
 *
 * Os modelos novos da Anthropic devolvem 400 a qualquer valor fora do padrão
 * desses três parâmetros: Haiku 5.5, Sonnet 5.5 e 5, Opus 5.5, 5, 4.8 e 4.7,
 * Fable 5 e 5.1 (platform.claude.com, guias de migração, conferidos em
 * 08/10/2026). Mandar um deles mata a chamada inteira — no atendimento, o
 * cliente fica sem resposta.
 *
 * A negação é o PADRÃO para a Anthropic: só aceitam os modelos antigos
 * conhecidos abaixo. Modelo novo ou desconhecido não recebe amostragem, porque
 * perder afinação num modelo antigo custa pouco e mandá-la a um modelo novo
 * custa a chamada. Outros provedores: inalterado.
 *
 * ESTE É O ÚNICO LUGAR onde `temperature` pode aparecer como parâmetro de
 * chamada — vigiado por `tests/unit/amostragem-por-modelo.test.ts`.
 */
import { idDoModelo } from "./esforco";

/** Modelos da Anthropic que ainda aceitam amostragem, por id normalizado. */
const ACEITAM_AMOSTRAGEM: readonly string[] = [
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-sonnet-4",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-opus-4-1",
  "claude-opus-4",
];

export function aceitaAmostragem(provider: string, modelId: string | null | undefined): boolean {
  if (provider !== "anthropic") return true;
  if (!modelId) return false;
  const id = idDoModelo(modelId);
  return id.startsWith("claude-3") || ACEITAM_AMOSTRAGEM.includes(id);
}

export interface Amostragem {
  temperature?: number;
  topP?: number;
  topK?: number;
}

/**
 * A amostragem que de fato vai na chamada: a pedida, se o modelo a aceita; senão
 * nada. `retirados` lista o que foi pedido e NÃO foi enviado, para o aviso.
 */
export function amostragemDaChamada(
  provider: string,
  modelId: string | null | undefined,
  pedida: Amostragem,
): { enviar: Amostragem; retirados: string[] } {
  if (aceitaAmostragem(provider, modelId)) return { enviar: pedida, retirados: [] };
  const retirados: string[] = [];
  if (pedida.temperature !== undefined) retirados.push("temperature");
  if (pedida.topP !== undefined) retirados.push("top_p");
  if (pedida.topK !== undefined) retirados.push("top_k");
  return { enviar: {}, retirados };
}

/** Os nomes (como a pessoa os conhece) da amostragem presente em `settings.llm.params`. */
export function amostragemConfigurada(params: unknown): string[] {
  if (params === null || typeof params !== "object") return [];
  const p = params as Record<string, unknown>;
  const nomes: string[] = [];
  if (typeof p.temperature === "number") nomes.push("temperature");
  if (typeof p.topP === "number") nomes.push("top_p");
  if (typeof p.topK === "number") nomes.push("top_k");
  return nomes;
}

/**
 * A frase de aviso para quem ESCOLHE um modelo que recusa a amostragem que a
 * organização tem configurada. Não bloqueia a escolha — a escolha é do
 * utilizador —, só diz o que vai acontecer. `null` quando não há o que avisar.
 * Quem exibe passa o texto por `t()`.
 */
export function avisoDaAmostragemNaEscolha(
  provider: string,
  modelId: string | null | undefined,
  params: unknown,
): string | null {
  const configurados = amostragemConfigurada(params);
  if (configurados.length === 0 || aceitaAmostragem(provider, modelId)) return null;
  const modelo = modelId ? idDoModelo(modelId) : "escolhido";
  return (
    `Atenção: a organização tem ${configurados.join(", ")} configurados e o modelo ${modelo} não os aceita. ` +
    `Eles serão retirados dos pedidos a este modelo; nada é alterado no modelo.`
  );
}
