/**
 * O ATENDENTE LEU O QUE O CLIENTE MANDOU — SonghaiCRM (porte do `bcb34686c`).
 *
 * `messages.read_at` só era escrito para o que NÓS enviamos (o ack do WAHA:
 * o cliente leu no WhatsApp dele). Na direção contrária ficava sempre vazio, e
 * a bolha do cliente não dizia se alguém da equipa já a tinha visto. Esta
 * função marca as mensagens RECEBIDAS ainda não lidas de uma conversa; quem a
 * chama é `POST /api/v1/conversations/[id]/mark-read`, a mesma rota que o
 * upstream já usa para zerar o contador de não-lidas.
 *
 * Client da SESSÃO de propósito: a policy `messages_update` restringe às
 * organizações do ator, e o filtro explícito de `organization_id` repete a
 * régua. Idempotente — `is('read_at', null)` faz a segunda chamada não mexer em
 * nada. O único trigger de UPDATE que a coluna aciona é o `updated_at`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function marcarRecebidasComoLidas(
  supabase: SupabaseClient,
  organizationId: string,
  conversationId: string,
  agora: Date = new Date(),
): Promise<number> {
  const { data, error } = await supabase
    .from("messages")
    .update({ read_at: agora.toISOString() })
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .is("read_at", null)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}
