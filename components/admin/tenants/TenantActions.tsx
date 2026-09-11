"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SuspendDialog } from "./SuspendDialog";
import { ReactivateDialog } from "./ReactivateDialog";
import { ChangePlanDialog } from "./ChangePlanDialog";
import { EditTenantDialog } from "./EditTenantDialog";
import { DeleteTenantDialog } from "./DeleteTenantDialog";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";
import type { TenantCounts, TenantOrganization } from "@/hooks/useTenantDetail";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TenantActionsProps {
  organization: TenantOrganization;
  status: "active" | "suspended" | "redacted";
  displayName: string;
  currentPlanId?: string;
  counts: TenantCounts;
  ownerAccepted: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TenantActions({
  organization,
  status,
  displayName,
  currentPlanId,
  counts,
  ownerAccepted,
}: TenantActionsProps) {
  const organizationId = organization.id;
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [changePlanOpen, setChangePlanOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const canSuspend = status === "active";
  const isSuspended = status === "suspended";
  const isRedacted = status === "redacted";

  // Hard-delete só é oferecido quando o tenant não tem NENHUM sinal de uso
  // real — mesma regra do servidor (DELETE .../[id]). Convite pendente não
  // conta: é exatamente o caso que o botão existe para limpar.
  const canDelete =
    !isRedacted &&
    !ownerAccepted &&
    counts.conversations_count === 0 &&
    counts.messages_count === 0 &&
    counts.leads_count === 0 &&
    counts.orders_count === 0 &&
    counts.waha_sessions_count === 0;

  return (
    <>
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Ações
        </h2>

        {/* Impersonate (S-11.07) */}
        <ImpersonateButton
          organizationId={organizationId}
          displayName={displayName}
          disabled={isRedacted}
          disabledReason={
            isRedacted ? "Tenant redigido — ação não disponível" : undefined
          }
        />

        {/* Edit */}
        <Button
          className="w-full"
          variant="outline"
          onClick={() => setEditOpen(true)}
          disabled={isRedacted}
          aria-label="Editar tenant"
        >
          Editar
        </Button>

        {/* Change plan */}
        <Button
          className="w-full"
          variant="outline"
          onClick={() => setChangePlanOpen(true)}
          aria-label="Alterar plano"
        >
          Alterar plano
        </Button>

        {/* Suspend */}
        {canSuspend && (
          <Button
            className="w-full"
            variant="destructive"
            onClick={() => setSuspendOpen(true)}
            aria-label="Suspender tenant"
          >
            Suspender tenant
          </Button>
        )}

        {/* Reactivate */}
        {isSuspended && (
          <Button
            className="w-full"
            variant="outline"
            onClick={() => setReactivateOpen(true)}
            aria-label="Reativar tenant"
          >
            Reativar tenant
          </Button>
        )}

        {isRedacted && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Tenant redigido — ações de gestão não disponíveis.
          </p>
        )}

        {/* Delete — só tenant sem nenhum uso real */}
        {canDelete && (
          <Button
            className="w-full"
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
            aria-label="Deletar tenant"
          >
            Deletar tenant
          </Button>
        )}
      </div>

      <SuspendDialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        organizationId={organizationId}
      />

      <ReactivateDialog
        open={reactivateOpen}
        onClose={() => setReactivateOpen(false)}
        organizationId={organizationId}
      />

      <ChangePlanDialog
        open={changePlanOpen}
        onClose={() => setChangePlanOpen(false)}
        organizationId={organizationId}
        currentPlanId={currentPlanId}
      />

      <EditTenantDialog
        key={String(editOpen)}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        organization={organization}
      />

      <DeleteTenantDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        organizationId={organizationId}
        slug={organization.slug}
      />
    </>
  );
}
