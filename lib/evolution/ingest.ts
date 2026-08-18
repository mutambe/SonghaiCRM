/**
 * Ingestão do Evolution API: webhook → contato, conversa, mensagem.
 *
 * Mirror de `lib/channels/zernio/ingest.ts` — mesmas RPCs compartilhadas
 * (`fn_upsert_wa_contact`, `fn_upsert_wa_conversation`,
 * `fn_mark_conversation_message`, `emit_event`), mesma idempotência por
 * `unique (organization_id, external_id)` capturando 23505.
 *
 * Identidade sempre `phone:` — a v1 não resolve LID por este canal (ver spec,
 * seção Riscos). `chatId` (`<telefone>@s.whatsapp.net`) é a própria thread:
 * não há `provider_conversation_id` a gravar, como no WAHA.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { aplicarEfeitosPosEntrada } from "../channels/pos-entrada";

import { parseEvolutionInbound, type EvolutionInboundMessage } from "./webhook";

export interface EvolutionIngestResult {
  status: "ingested" | "duplicate" | "ignored";
  conversationId?: string;
  messageId?: string;
  reason?: string;
}

export async function ingestEvolutionInbound(
  admin: SupabaseClient,
  input: { organizationId: string; channelSessionId: string; payload: unknown; requestId?: string },
): Promise<EvolutionIngestResult> {
  const msg = parseEvolutionInbound(input.payload);
  if (!msg) return { status: "ignored", reason: "evento_sem_interesse" };

  const phone = telefoneDoChatId(msg.chatId);
  if (!phone) return { status: "ignored", reason: "chatId_sem_telefone_reconhecivel" };

  const contactId = await upsertContact(admin, input.organizationId, msg, phone);
  if (!contactId) return { status: "ignored", reason: "contato_nao_resolvido" };

  const conversationId = await upsertConversation(admin, input.organizationId, contactId, input.channelSessionId);
  if (!conversationId) return { status: "ignored", reason: "conversa_nao_resolvida" };

  const inserted = await insertMessage(admin, {
    organizationId: input.organizationId,
    conversationId,
    contactId,
    channelSessionId: input.channelSessionId,
    msg,
  });

  if (inserted === "duplicate") return { status: "duplicate", conversationId };

  await marcarConversa(admin, conversationId, msg);
  if (msg.attachmentType) {
    await pedirPersistenciaDaMidia(admin, input.organizationId, conversationId, inserted);
  }
  if (msg.direction === "inbound") {
    await aplicarEfeitosPosEntrada(admin, {
      organizationId: input.organizationId,
      contactId,
      conversationId,
      messageId: inserted,
      channelSessionId: input.channelSessionId,
      texto: msg.body,
      nomeDoContato: msg.pushName,
      requestId: input.requestId,
      origem: "evolution_webhook",
    });
  }

  return { status: "ingested", conversationId, messageId: inserted };
}

/** `5511999999999@s.whatsapp.net` → `+5511999999999`. Grupo (`@g.us`) não tem telefone. */
function telefoneDoChatId(chatId: string): string | null {
  if (chatId.endsWith("@g.us")) return null;
  const digitos = chatId.split("@")[0]?.replace(/\D/g, "") ?? "";
  return digitos.length >= 8 ? `+${digitos}` : null;
}

async function upsertContact(
  admin: SupabaseClient,
  organizationId: string,
  msg: EvolutionInboundMessage,
  phone: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_wa_contact", {
    p_org: organizationId,
    p_kind: "phone",
    p_phone: phone,
    p_lid: null,
    p_chat_id: msg.chatId,
    p_notify: msg.pushName,
  });
  if (error) return null;
  return (data as string) ?? null;
}

async function upsertConversation(
  admin: SupabaseClient,
  organizationId: string,
  contactId: string,
  channelSessionId: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_wa_conversation", {
    p_org: organizationId,
    p_contact: contactId,
    p_session: channelSessionId,
  });
  if (error || !data) return null;
  return data as string;
}

async function insertMessage(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    conversationId: string;
    contactId: string;
    channelSessionId: string;
    msg: EvolutionInboundMessage;
  },
): Promise<string | "duplicate"> {
  const { msg } = input;
  const { data, error } = await admin
    .from("messages")
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      contact_id: input.contactId,
      channel_session_id: input.channelSessionId,
      external_id: msg.externalId,
      direction: msg.direction,
      sent_via: "external_device",
      status: msg.direction === "outbound" ? "sent" : "delivered",
      type: msg.attachmentType ?? "text",
      body: msg.body,
      metadata: {},
      ...(msg.sentAt ? { sent_at: msg.sentAt } : {}),
    })
    .select("id")
    .maybeSingle();

  if (error?.code === "23505") return "duplicate";
  if (error || !data) throw new Error(`evolution_ingest_insert_failed: ${error?.message ?? "sem id"}`);
  return (data as { id: string }).id;
}

async function marcarConversa(
  admin: SupabaseClient,
  conversationId: string,
  msg: EvolutionInboundMessage,
): Promise<void> {
  const { error } = await admin.rpc("fn_mark_conversation_message" as never, {
    p_conv: conversationId,
    p_direction: msg.direction,
    p_preview: (msg.body ?? "").slice(0, 200),
    p_at: msg.sentAt ?? new Date().toISOString(),
  } as never);
  if (error) {
    logger.warn("[evolution] carimbo da conversa falhou", { conversationId, detail: error.message });
  }
}

async function pedirPersistenciaDaMidia(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  const { error } = await admin.rpc("emit_event" as never, {
    p_event_type: "media.persist_requested",
    p_entity_kind: "message",
    p_entity_id: messageId,
    p_payload: { message_id: messageId, conversation_id: conversationId },
    p_metadata: { source: "evolution_webhook" },
    p_organization_id: organizationId,
  } as never);
  if (error) {
    logger.warn("[evolution] emit media.persist_requested falhou", { messageId, detail: error.message });
  }
}
