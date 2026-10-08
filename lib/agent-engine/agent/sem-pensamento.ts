/**
 * O CHECKPOINT NÃO REENVIA PENSAMENTO (SonghaiCRM, 08/10/2026).
 *
 * O fechamento do turno (`checkpoint`) é um SEGUNDO pedido: sem as ferramentas
 * do primeiro, com a abertura só em texto e os resultados de ferramentas
 * podados. Os modelos novos da Anthropic (Haiku 5.5, Sonnet 5.5, Opus 5.5,
 * Fable 5.1) amarram cada bloco de pensamento ao que veio ANTES dele — `system`,
 * `tools` e as mensagens anteriores —, e devolvem 400 a um bloco reenviado
 * depois de qualquer mudança nesse prefixo. A verificação é obrigatória em
 * contas criadas a partir de 31/08/2026 (guia de migração do Haiku 5.5,
 * «Keep earlier turns unchanged»).
 *
 * O AI SDK devolve em `response.messages` o pensamento assinado do último
 * passo (parte `reasoning`) e o reenvia por omissão. Medido com o SDK
 * instalado: o pedido do checkpoint leva um bloco `thinking` assinado, com as
 * ferramentas removidas. Este é o defeito — e o agente novo nasce no Haiku 5.5.
 *
 * O checkpoint só precisa do TEXTO que o agente respondeu e do que as
 * ferramentas devolveram; o raciocínio não faz parte do que ele resume. Sair
 * sem pensamento é sempre válido (um pedido sem blocos de pensamento não é
 * verificado). Dentro do mesmo `generateText`, em que as etapas só
 * acrescentam, o SDK segue reenviando o pensamento, e isso é o que a regra
 * exige — esta função só vale para quem RE-SERIALIZA a fita num pedido novo.
 */
import type { ModelMessage } from "ai";

/** `true` para a parte de raciocínio que o SDK devolve (`reasoning`, assinada ou não). */
function ehPensamento(parte: unknown): boolean {
  const tipo = (parte as { type?: unknown } | null)?.type;
  return tipo === "reasoning" || tipo === "redacted-reasoning" || tipo === "reasoning-file";
}

export function semBlocosDePensamento(messages: readonly ModelMessage[]): ModelMessage[] {
  const saida: ModelMessage[] = [];
  for (const mensagem of messages) {
    if (mensagem.role !== "assistant" || !Array.isArray(mensagem.content)) {
      saida.push(mensagem);
      continue;
    }
    const partes = mensagem.content.filter((p) => !ehPensamento(p));
    // Mensagem que só tinha pensamento some inteira: assistente vazio é 400.
    if (partes.length === 0) continue;
    saida.push(partes.length === mensagem.content.length ? mensagem : { ...mensagem, content: partes });
  }
  return saida;
}
