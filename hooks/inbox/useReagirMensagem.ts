"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

/**
 * SonghaiCRM — reagir (ou tirar a reação) a uma mensagem. Sem toast de
 * sucesso: a reação aparece na própria bolha, e um aviso a cada emoji seria
 * ruído. O fio recarrega só depois de o canal confirmar.
 */
export function useReagirMensagem(conversationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string }) =>
      apiClient.post(`/api/v1/messages/${id}/reaction`, { emoji }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
    },
    onError: showApiError,
  });
}
