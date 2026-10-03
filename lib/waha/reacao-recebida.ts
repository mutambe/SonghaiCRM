/**
 * EVENTO `message.reaction` DO WAHA — SonghaiCRM (ideia trazida do OpenWA).
 *
 * O cliente reagiu (ou tirou a reação) a uma mensagem. Antes disto o evento
 * nem era assinado (`WHATSAPP_HOOK_EVENTS`), e o "👍" do cliente — que muitas
 * vezes É a resposta: "pode ser às 15h?" → 👍 — nunca chegava ao CRM.
 *
 * Forma do payload, da documentação do WAHA:
 *
 *   { id, from, fromMe, participant?,
 *     reaction: { text: "👍", messageId: "true_258…@c.us_3EB0…" } }
 *
 * `reaction.messageId` é a mensagem REAGIDA, e `text: ""` é reação retirada.
 * A linha reagida pode estar gravada pelo id completo (recebida) ou pela
 * cauda (enviada por nós — ver `bareWaMessageId`), daí procurar as duas.
 *
 * `fromMe` é a própria conta a reagir pelo aparelho: vira a reação da equipa,
 * a mesma chave que a reação dada pelo CRM (para o WhatsApp é uma só).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { CHAVE_DA_EQUIPA, aplicarReacao, emojiDeReacaoSchema } from "@/lib/messaging/reacoes";

import { bareWaMessageId } from "./message-id";

const reacaoDoPayloadSchema = z.looseObject({
  from: z.string().nullish(),
  fromMe: z.boolean().nullish(),
  participant: z.unknown().optional(),
  reaction: z.looseObject({
    text: emojiDeReacaoSchema.nullish(),
    messageId: z.string().min(1),
  }),
});

export type DesfechoDaReacaoRecebida = "gravada" | "payload_invalido" | "mensagem_desconhecida";

export async function gravarReacaoRecebida(
  admin: SupabaseClient,
  session: { organization_id: string },
  payload: unknown,
  agora: Date = new Date(),
): Promise<DesfechoDaReacaoRecebida> {
  const p = reacaoDoPayloadSchema.safeParse(payload);
  if (!p.success) return "payload_invalido";
  const { reaction, fromMe, from, participant } = p.data;

  const quem = fromMe
    ? CHAVE_DA_EQUIPA
    : (typeof participant === "string" && participant) || from || null;
  if (!quem) return "payload_invalido";

  const alvoCompleto = reaction.messageId;
  const alvoBare = bareWaMessageId(alvoCompleto);
  const { data: alvo, error } = await admin
    .from("messages")
    .select("id, metadata")
    .eq("organization_id", session.organization_id)
    .in("external_id", Array.from(new Set([alvoCompleto, alvoBare])))
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!alvo) return "mensagem_desconhecida";

  const metadata = aplicarReacao(
    (alvo as { metadata: Record<string, unknown> | null }).metadata,
    quem,
    reaction.text ?? "",
    agora,
  );
  const { error: updErr } = await admin
    .from("messages")
    .update({ metadata })
    .eq("organization_id", session.organization_id)
    .eq("id", (alvo as { id: string }).id);
  if (updErr) throw updErr;
  return "gravada";
}
