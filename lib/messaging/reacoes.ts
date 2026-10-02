/**
 * REAÇÕES A MENSAGENS — SonghaiCRM (ideia trazida do OpenWA).
 *
 * O WhatsApp guarda UMA reação por pessoa por mensagem, e reagir de novo troca
 * a anterior; reagir com "" tira. O CRM espelha isso em
 * `messages.metadata.reacoes`, um mapa `quem → reação`, na própria mensagem
 * reagida — não numa tabela: a reação não tem vida fora da mensagem, morre com
 * ela, e a bolha já recebe `metadata` (precedente: `metadata.crm_hidden_at`).
 *
 * Este arquivo é o ÚNICO que conhece o formato (anti-pattern 6 do CLAUDE.md:
 * jsonb lido direto pela tela sem schema central). A tela, a rota e o ingest
 * passam por aqui.
 *
 * As chaves do mapa:
 *   - `CHAVE_DA_EQUIPA` — a reação da CONTA. A equipa inteira fala pelo mesmo
 *     número, então para o WhatsApp há uma só; quem da equipa reagiu fica em
 *     `por_user_id`.
 *   - o id de quem reagiu, como o canal o deu (o contacto numa conversa
 *     individual, o participante num grupo).
 */
import { z } from "zod";

export const CHAVE_DA_EQUIPA = "equipa";

/** Os atalhos do menu da bolha — os mesmos seis do aparelho. */
export const REACOES_RAPIDAS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/**
 * Um emoji, ou "" para tirar. O teto de 16 unidades cabe as sequências com
 * modificador de tom e ZWJ; espaço e letra não são reação.
 */
export const emojiDeReacaoSchema = z
  .string()
  .max(16)
  .refine((s) => s === "" || (!/\s/.test(s) && !/[\p{L}\p{N}]/u.test(s)), "emoji inválido");

const reacaoGravadaSchema = z.object({
  emoji: z.string().min(1).max(16),
  em: z.string(),
  por_user_id: z.string().uuid().nullish(),
});

export type ReacaoGravada = z.infer<typeof reacaoGravadaSchema>;

export interface Reacao {
  chave: string;
  daEquipa: boolean;
  emoji: string;
  em: string;
}

/**
 * As reações válidas de uma mensagem, mais antigas primeiro. Entrada torta é
 * IGNORADA, não lançada: a bolha não pode cair por causa de um enfeite.
 */
export function lerReacoes(metadata: Record<string, unknown> | null | undefined): Reacao[] {
  const bruto = metadata?.reacoes;
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return [];
  const out: Reacao[] = [];
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    const r = reacaoGravadaSchema.safeParse(valor);
    if (r.success) out.push({ chave, daEquipa: chave === CHAVE_DA_EQUIPA, emoji: r.data.emoji, em: r.data.em });
  }
  return out.sort((a, b) => a.em.localeCompare(b.em));
}

/** A reação que a equipa deixou nesta mensagem, ou `null`. */
export function reacaoDaEquipa(metadata: Record<string, unknown> | null | undefined): string | null {
  return lerReacoes(metadata).find((r) => r.daEquipa)?.emoji ?? null;
}

/**
 * O `metadata` novo depois de `chave` reagir com `emoji` ("" tira). Puro:
 * devolve outro objeto e preserva o resto do metadata.
 */
export function aplicarReacao(
  metadata: Record<string, unknown> | null | undefined,
  chave: string,
  emoji: string,
  agora: Date,
  porUserId: string | null = null,
): Record<string, unknown> {
  const base = { ...(metadata ?? {}) };
  const atuais =
    base.reacoes && typeof base.reacoes === "object" && !Array.isArray(base.reacoes)
      ? { ...(base.reacoes as Record<string, unknown>) }
      : {};
  if (emoji === "") {
    delete atuais[chave];
  } else {
    const nova: ReacaoGravada = {
      emoji,
      em: agora.toISOString(),
      ...(porUserId ? { por_user_id: porUserId } : {}),
    };
    atuais[chave] = nova;
  }
  if (Object.keys(atuais).length === 0) {
    delete base.reacoes;
  } else {
    base.reacoes = atuais;
  }
  return base;
}
