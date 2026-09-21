"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChangeOwnerEmailDialog } from "./ChangeOwnerEmailDialog";
import { useTenantOwnerAction } from "@/hooks/useTenantOwnerAction";
import type { TenantOwner } from "@/hooks/useTenantDetail";

interface TenantOwnerCardProps {
  organizationId: string;
  owner: TenantOwner;
  disabled?: boolean;
}

const STATUS_LABEL: Record<TenantOwner["status"], string> = {
  none: "Sem responsável definido",
  pending: "Convite pendente",
  accepted: "Ativo",
};

export function TenantOwnerCard({ organizationId, owner, disabled }: TenantOwnerCardProps) {
  const [changeEmailOpen, setChangeEmailOpen] = useState(false);
  const ownerAction = useTenantOwnerAction();

  return (
    <div className="rounded-lg border bg-card p-5 space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Responsável
      </h2>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">
          {owner.email ?? <span className="text-muted-foreground">Nenhum e-mail convidado</span>}
        </span>
        <Badge variant={owner.status === "accepted" ? "default" : "neutral"}>
          {STATUS_LABEL[owner.status]}
        </Badge>
      </div>

      {!disabled && (
        <div className="flex flex-col gap-2 pt-1">
          {owner.status === "pending" && (
            <Button
              variant="outline"
              size="sm"
              disabled={ownerAction.isPending}
              onClick={() => ownerAction.mutate({ id: organizationId, action: "resend" })}
            >
              Reenviar convite
            </Button>
          )}

          {owner.status !== "accepted" && (
            <Button variant="outline" size="sm" onClick={() => setChangeEmailOpen(true)}>
              {owner.status === "pending" ? "Trocar e-mail do responsável" : "Definir e-mail do responsável"}
            </Button>
          )}

          {owner.status === "accepted" && (
            <Button
              variant="outline"
              size="sm"
              disabled={ownerAction.isPending}
              onClick={() => ownerAction.mutate({ id: organizationId, action: "reset_password" })}
            >
              Enviar link de redefinição de senha
            </Button>
          )}
        </div>
      )}

      <ChangeOwnerEmailDialog
        open={changeEmailOpen}
        onClose={() => setChangeEmailOpen(false)}
        organizationId={organizationId}
        currentEmail={owner.email}
      />
    </div>
  );
}
