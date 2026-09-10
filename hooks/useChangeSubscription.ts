"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

export interface ChangeSubscriptionPayload {
  id: string;
  plan_id: string;
  notes?: string;
}

export function useChangeSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, plan_id, notes }: ChangeSubscriptionPayload) =>
      apiClient.patch(`/api/v1/admin/tenants/${id}/subscription`, { plan_id, notes }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenant", variables.id] });
      toast.success("Plano alterado com sucesso");
    },
    onError: (err: Error) => {
      toast.error("Erro ao alterar plano", { description: err.message });
    },
  });
}
