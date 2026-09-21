"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

export interface UpdateTenantPayload {
  id: string;
  display_name?: string;
  legal_name?: string | null;
  nuit?: string | null;
  slug?: string;
}

export function useUpdateTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...changes }: UpdateTenantPayload) =>
      apiClient.patch(`/api/v1/admin/tenants/${id}`, changes),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenant", variables.id] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
      toast.success("Tenant atualizado com sucesso");
    },
    onError: (err: Error) => {
      toast.error("Erro ao atualizar tenant", { description: err.message });
    },
  });
}
