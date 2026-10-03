/**
 * OS TIQUES AZUIS NO APARELHO DO CLIENTE — SonghaiCRM (ideia trazida do OpenWA).
 *
 * `marcarRecebidasComoLidas` (ao lado) diz ao CRM que a equipa leu. Isto diz o
 * mesmo ao CLIENTE, pelo canal: sem isto o cliente via dois tiques cinzentos
 * até alguém responder, e lia silêncio onde havia leitura.
 *
 * Basta a ÚLTIMA recebida: no WhatsApp, ler a última é ler a conversa. Quem
 * chama (`POST /api/v1/conversations/[id]/mark-read`) só chama quando o CRM
 * acabou de marcar alguma recebida — abrir a mesma conversa dez vezes não
 * avisa o aparelho dez vezes.
 *
 * Pergunta ao canal pela PRESENÇA de `markRead`, nunca pelo nome do provider.
 * Conversa de grupo fica de fora: o tique azul num grupo diz a todos os
 * participantes que a empresa leu, e essa decisão não é deste recurso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CHANNEL_SESSION_REF_COLUMNS,
  getAdapter,
  resolveSessionRef,
  transportaMensagem,
  type ChannelProvider,
  type ChannelSessionRef,
} from "@/lib/channels";

export type DesfechoDaLeituraNoCanal =
  | "avisado"
  | "sem_conversa"
  | "grupo"
  | "canal_nao_avisa"
  | "sem_recebida"
  | "sem_destinatario";

export async function avisarLeituraAoCanal(
  supabase: SupabaseClient,
  organizationId: string,
  conversationId: string,
): Promise<DesfechoDaLeituraNoCanal> {
  const { data: conversa, error } = await supabase
    .from("conversations")
    .select("id, contact_id, is_group, channel_session_id")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!conversa) return "sem_conversa";
  if (conversa.is_group) return "grupo";

  const [{ data: sessao }, { data: contato }, { data: ultima }] = await Promise.all([
    supabase.from("channel_sessions").select(`${CHANNEL_SESSION_REF_COLUMNS}, archived_at`)
      .eq("id", conversa.channel_session_id).eq("organization_id", organizationId).maybeSingle(),
    supabase.from("contacts").select("phone_number, wa_identity, wa_lid")
      .eq("id", conversa.contact_id).eq("organization_id", organizationId).maybeSingle(),
    supabase.from("messages").select("external_id")
      .eq("organization_id", organizationId).eq("conversation_id", conversationId)
      .eq("direction", "inbound").not("external_id", "is", null)
      .order("sent_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const adapter = sessao && !sessao.archived_at && transportaMensagem(sessao.provider)
    ? getAdapter(sessao.provider as ChannelProvider) : null;
  if (!adapter?.markRead || !adapter.isConfigured()) return "canal_nao_avisa";
  const externalId = (ultima as { external_id: string | null } | null)?.external_id;
  if (!externalId) return "sem_recebida";
  const recipient = adapter.resolveRecipient({
    isGroup: false, groupChatId: null, phoneNumber: contato?.phone_number,
    waIdentity: contato?.wa_identity, waLid: contato?.wa_lid,
  });
  if (!recipient) return "sem_destinatario";

  await adapter.markRead({
    organizationId,
    sessionRef: resolveSessionRef(sessao as unknown as ChannelSessionRef),
    recipient,
    externalIds: [externalId],
  });
  return "avisado";
}
