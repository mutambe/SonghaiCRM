/**
 * O ESFORÇO DO MODELO, por ponto de IA (SonghaiCRM, migration 9006).
 *
 * O esforço (`output_config.effort` da Anthropic) troca profundidade de
 * raciocínio por tokens: `low` responde rápido e gasta pouco, `max` pensa até
 * onde precisar. Quem escolhe é quem administra, em IA › Provedores, ao lado do
 * modelo de cada ponto; vazio = o padrão do próprio modelo.
 *
 * Este módulo é a ÚNICA resposta a "que níveis este modelo aceita?". A rota
 * recusa na escrita um nível que o modelo não aceita, e o motor, na leitura,
 * simplesmente não envia — um binding gravado antes de trocar o modelo nunca
 * vira 400 do provedor no meio de um atendimento.
 *
 * Níveis por modelo (platform.claude.com/docs/en/build-with-claude/effort,
 * conferido em 08/10/2026): Opus 4.5 só low/medium/high; Opus 4.6 e Sonnet 4.6
 * sem `xhigh`; da geração Opus 4.7 em diante, e o Haiku 5.5, os cinco.
 * Haiku 4.5 e Sonnet 4.5 recusam o campo — por isso não estão aqui.
 */
export const ESFORCOS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Esforco = (typeof ESFORCOS)[number];

export function ehEsforco(valor: unknown): valor is Esforco {
  return typeof valor === "string" && (ESFORCOS as readonly string[]).includes(valor);
}

/** O rótulo da tela. Passa por `t()` em quem desenha. */
export const ROTULO_DO_ESFORCO: Record<Esforco, string> = {
  low: "Baixo — mais rápido e barato",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo — mais lento e caro",
};

const TODOS: readonly Esforco[] = ESFORCOS;
const SEM_XHIGH: readonly Esforco[] = ["low", "medium", "high", "max"];
const SO_TRES: readonly Esforco[] = ["low", "medium", "high"];

const NIVEIS_ANTHROPIC: Record<string, readonly Esforco[]> = {
  "claude-fable-5-1": TODOS,
  "claude-fable-5": TODOS,
  "claude-opus-5-5": TODOS,
  "claude-opus-5": TODOS,
  "claude-opus-4-8": TODOS,
  "claude-opus-4-7": TODOS,
  "claude-sonnet-5-5": TODOS,
  "claude-sonnet-5": TODOS,
  "claude-haiku-5-5": TODOS,
  "claude-opus-4-6": SEM_XHIGH,
  "claude-sonnet-4-6": SEM_XHIGH,
  "claude-opus-4-5": SO_TRES,
};

/** O id como a tabela o conhece: sem o prefixo `anthropic/` e sem sufixo de data. */
export function idDoModelo(modelId: string): string {
  const semPrefixo = modelId.startsWith("anthropic/") ? modelId.slice("anthropic/".length) : modelId;
  return semPrefixo.replace(/-\d{8}$/, "");
}

/** Os níveis que este modelo aceita. Vazio = o modelo não tem esforço escolhível. */
export function niveisDeEsforco(provider: string, modelId: string | null | undefined): readonly Esforco[] {
  if (provider !== "anthropic" || !modelId) return [];
  return NIVEIS_ANTHROPIC[idDoModelo(modelId)] ?? [];
}

/**
 * O esforço que de fato vai na chamada: o gravado, se o modelo o aceita; senão
 * `null` (vale o padrão do modelo).
 */
export function esforcoEfetivo(
  provider: string,
  modelId: string | null | undefined,
  gravado: unknown,
): Esforco | null {
  if (!ehEsforco(gravado)) return null;
  return niveisDeEsforco(provider, modelId).includes(gravado) ? gravado : null;
}

/**
 * `null` quando o par (modelo, esforço) é aceitável; senão a frase para quem
 * escolheu. Esforço nulo (padrão do modelo) é sempre aceitável.
 */
export function recusaDoEsforco(
  provider: string,
  modelId: string | null | undefined,
  esforco: Esforco | null | undefined,
): string | null {
  if (esforco === null || esforco === undefined) return null;
  const aceitos = niveisDeEsforco(provider, modelId);
  if (aceitos.length === 0) return "Este modelo não permite escolher o esforço — deixe no padrão do modelo.";
  if (!aceitos.includes(esforco)) return `Este modelo não aceita o esforço "${esforco}". Níveis aceites: ${aceitos.join(", ")}.`;
  return null;
}

/**
 * O esforço que vai numa chamada do motor: vem de quem escolheu o MODELO. O
 * painel (9006) quando a decisão é do binding; a versão do agente (9007) quando
 * o modelo é o do agente ou herdado dele; nada nos demais (padrão da
 * organização, variável de ambiente, ponto fixo). Sempre reconferido contra o
 * provider/modelo que de fato vão na chamada.
 */
export function esforcoDaChamada(p: {
  origem: string;
  doPainel: unknown;
  doAgente: unknown;
  provider: string;
  modelId: string | null | undefined;
}): Esforco | null {
  const escolhido =
    p.origem === "binding"
      ? p.doPainel
      : p.origem === "agente_publicado" || p.origem === "herdado_de_quem_chamou"
        ? p.doAgente
        : null;
  return esforcoEfetivo(p.provider, p.modelId, escolhido);
}
