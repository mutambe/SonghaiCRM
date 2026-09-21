"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

export type TenantOwnerActionPayload =
  | { id: string; action: "resend" }
  | { id: string; action: "change_email"; email: string }
  | { id: string; action: "reset_password" };

const SUCCESS_MESSAGE: Record<string, string> = {
  invite_resent: "Convite reenviado",
  owner_changed: "Responsável atualizado — convite enviado para o novo e-mail",
  reset_email_sent: "E-mail de redefinição de senha enviado",
};

export function useTenantOwnerAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...body }: TenantOwnerActionPayload) =>
      apiClient.post<{ data: { status: string } }>(`/api/v1/admin/tenants/${id}/owner`, body),
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenant", variables.id] });
      toast.success(SUCCESS_MESSAGE[data.data.status] ?? "Feito");
    },
    onError: (err: Error) => {
      toast.error("Erro ao gerir o acesso do responsável", { description: err.message });
    },
  });
}
