/**
 * COMO PEDIR UMA CLASSIFICAÇÃO CURTA A CADA MODELO (SonghaiCRM, 08/10/2026).
 *
 * O worker de clima faz `generateObject` com um JSON de ~150 tokens e
 * `temperature: 0`. Isso funcionava nos modelos antigos e quebra nos novos, por
 * três motivos que esta regra concentra:
 *
 *  1. SAMPLING — os modelos novos da Anthropic devolvem 400 a `temperature`
 *     (`lib/ai/amostragem.ts`). Não se envia.
 *  2. TOOL_CHOICE FORÇADO — o AI SDK instalado (`@ai-sdk/anthropic` 4.0.x) só
 *     conhece alguns ids novos; para os que não conhece (`claude-opus-5-5`,
 *     `claude-opus-5`, `claude-haiku-5-5`) cai no modo «ferramenta `json`
 *     forçada» (`tool_choice: any`), e o Opus 5.5 devolve 400 a isso. Para o
 *     modelo novo pede-se a SAÍDA ESTRUTURADA NATIVA (`output_config.format`),
 *     que não força ferramenta nenhuma e vale para os conhecidos e os que
 *     ainda não são.
 *  3. PENSAMENTO CONTA NO LIMITE — nos modelos novos o pensamento adaptativo
 *     está ligado e conta em `maxOutputTokens`. Esforço `low` o encurta e o
 *     limite sobe para o JSON não ser cortado no meio (o defeito que já houve
 *     aqui, com 256 e a ferramenta).
 *
 * O esforço escolhido no painel para o ponto vence o `low`: a escolha é do
 * utilizador, o sistema só dá um padrão sensato para classificar.
 */
import { aceitaAmostragem } from "./amostragem";
import { niveisDeEsforco, type Esforco } from "./esforco";

/** Limite de saída dos modelos antigos: o JSON do clima pica em ~150 tokens. */
export const LIMITE_DE_SAIDA_DO_CLIMA = 256;
/**
 * Limite de saída dos modelos com pensamento adaptativo. É um TETO, não um
 * gasto: com esforço `low` o modelo quase não pensa. NÃO MEDIDO com chamada
 * real (sem chave de IA nesta máquina) — conferir a primeira vez que houver
 * uma, em `llm_calls` (`output_tokens` do ponto `sentiment_classify`).
 */
export const LIMITE_DE_SAIDA_DO_CLIMA_COM_PENSAMENTO = 1024;

export interface OpcoesDaClassificacao {
  /** `temperature: 0` só quando o modelo a aceita. */
  temperature?: 0;
  maxOutputTokens: number;
  /** Esforço a aplicar além do que o painel já tenha escolhido; nulo = nenhum. */
  esforcoPadrao: Esforco | null;
  /** Anthropic moderna: saída estruturada nativa, sem ferramenta forçada. */
  providerOptions?: { anthropic: { structuredOutputMode: "outputFormat" } };
}

export function opcoesDaClassificacao(p: {
  provider: string | null;
  modelId: string | null | undefined;
  /** O esforço que o painel já escolheu para o ponto (vence o padrão). */
  esforcoEscolhido: Esforco | null;
}): OpcoesDaClassificacao {
  const provider = p.provider ?? "";
  const aceita = aceitaAmostragem(provider, p.modelId);
  const moderna = provider === "anthropic" && !aceita;
  return {
    ...(aceita ? { temperature: 0 as const } : {}),
    maxOutputTokens: moderna ? LIMITE_DE_SAIDA_DO_CLIMA_COM_PENSAMENTO : LIMITE_DE_SAIDA_DO_CLIMA,
    esforcoPadrao:
      moderna && p.esforcoEscolhido === null && niveisDeEsforco(provider, p.modelId).includes("low")
        ? "low"
        : null,
    ...(moderna ? { providerOptions: { anthropic: { structuredOutputMode: "outputFormat" as const } } } : {}),
  };
}
