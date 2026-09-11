"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

export interface DeleteTenantPayload {
  id: string;
  slug_confirmation: string;
}

export function useDeleteTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, slug_confirmation }: DeleteTenantPayload) =>
      apiClient.delete(`/api/v1/admin/tenants/${id}`, { slug_confirmation }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
      toast.success("Tenant apagado com sucesso");
    },
    onError: (err: Error) => {
      toast.error("Erro ao apagar tenant", { description: err.message });
    },
  });
}
