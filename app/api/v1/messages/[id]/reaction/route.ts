/**
 * POST /api/v1/messages/[id]/reaction — SonghaiCRM.
 *
 * A equipa reage a uma mensagem com um emoji (`{ emoji: "👍" }`) ou tira a
 * reação (`{ emoji: "" }`). Sai primeiro pelo canal e só depois fica gravada
 * em `metadata.reacoes`: gravar antes mostraria na tela uma reação que o
 * cliente nunca viu.
 *
 * Molde: a rota de editar/apagar ao lado (`../route.ts`) — mesmo endereçamento,
 * mesma pergunta ao canal pela PRESENÇA do método, nunca pelo nome do provider.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  getAdapter,
  resolveSessionRef,
  transportaMensagem,
  type ChannelProvider,
  type ChannelSessionRef,
} from "@/lib/channels";
import { traduzir } from "@/lib/i18n/dicionario";
import { CHAVE_DA_EQUIPA, aplicarReacao, emojiDeReacaoSchema } from "@/lib/messaging/reacoes";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Ctx { params: Promise<{ id: string }> }
const corpoSchema = z.object({ emoji: emojiDeReacaoSchema });

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "messages" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, { requestId });
  }
  const emoji = parsed.data.emoji;

  const supabase = await createClient();
  const { data: message, error: messageError } = await supabase.from("messages")
    .select("id, organization_id, conversation_id, channel_session_id, external_id, revoked_at, metadata")
    .eq("id", id).eq("organization_id", authz.org.orgId).maybeSingle();
  if (messageError) return fail("internal_error", t("Erro ao buscar mensagem."), 500, { requestId });
  if (!message) return fail("not_found", t("Mensagem não encontrada."), 404, { requestId });
  // Sem id no canal não há o que reagir: é mensagem que ainda não saiu, ou
  // que falhou. Apagada também não — o cliente já não a vê.
  if (!message.external_id || message.revoked_at) {
    return fail("forbidden", t("Não é possível reagir a esta mensagem."), 403, { requestId });
  }

  const { data: conversation, error: conversationError } = await supabase.from("conversations")
    .select("id, contact_id, is_group, group_chat_id, channel_session_id")
    .eq("id", message.conversation_id).eq("organization_id", authz.org.orgId).maybeSingle();
  if (conversationError || !conversation || conversation.channel_session_id !== message.channel_session_id) {
    return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  }
  const [{ data: session }, { data: contact }] = await Promise.all([
    supabase.from("channel_sessions").select(`${CHANNEL_SESSION_REF_COLUMNS}, archived_at`)
      .eq("id", message.channel_session_id).eq("organization_id", authz.org.orgId).maybeSingle(),
    supabase.from("contacts").select("phone_number, wa_identity, wa_lid")
      .eq("id", conversation.contact_id).eq("organization_id", authz.org.orgId).maybeSingle(),
  ]);
  const adapter = session && !session.archived_at && transportaMensagem(session.provider)
    ? getAdapter(session.provider as ChannelProvider) : null;
  const sessionRef = session ? resolveSessionRef(session as unknown as ChannelSessionRef) : null;
  if (!adapter?.reactToMessage || !sessionRef) {
    return fail("unsupported_channel", t("Este canal não permite reagir a mensagens."), 409, { requestId });
  }
  if (!adapter.isConfigured()) {
    return fail("channel_unavailable", t("WhatsApp indisponível no momento."), 503, { requestId });
  }

  try {
    await adapter.reactToMessage({
      organizationId: authz.org.orgId,
      sessionRef,
      externalId: message.external_id,
      emoji,
      recipient: adapter.resolveRecipient({
        isGroup: conversation.is_group, groupChatId: conversation.group_chat_id,
        phoneNumber: contact?.phone_number, waIdentity: contact?.wa_identity, waLid: contact?.wa_lid,
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "recipient_unavailable") {
      return fail("recipient_unavailable", t("Contato sem WhatsApp válido."), 409, { requestId });
    }
    return fail("channel_error", t("O WhatsApp recusou a reação."), 502, { requestId });
  }

  const metadata = aplicarReacao(
    message.metadata as Record<string, unknown> | null,
    CHAVE_DA_EQUIPA,
    emoji,
    new Date(),
    authz.user.id,
  );
  const { data: updated, error: updateError } = await supabase.from("messages")
    .update({ metadata }).eq("id", id).eq("organization_id", authz.org.orgId)
    .select("id, metadata").maybeSingle();
  if (updateError || !updated) {
    return fail("internal_error", t("O WhatsApp recebeu a reação, mas o CRM não conseguiu registá-la."), 500, { requestId });
  }
  await audit({
    action: "message.reacted",
    actorUserId: authz.user.id, organizationId: authz.org.orgId,
    resourceType: "message", resourceId: id, requestId,
    metadata: { conversation_id: message.conversation_id, emoji: emoji || null },
  });
  return ok(updated, { requestId });
}
