"use client";
import { useEffect } from "react";
import { apiClient } from "@/lib/api/client";

/**
 * Marca as mensagens do CLIENTE (inbound) como lidas pelo agente assim que a
 * conversa é aberta. Fire-and-forget: falhar aqui não pode travar o inbox —
 * na pior hipótese os ticks ficam cinza por mais tempo, e a próxima abertura
 * tenta de novo (a rota é idempotente).
 */
export function useMarkConversationRead(conversationId: string | null) {
  useEffect(() => {
    if (!conversationId) return;
    void apiClient.post(`/api/v1/conversations/${conversationId}/mark-read`, {}).catch(() => {});
  }, [conversationId]);
}
