"use client";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlans } from "@/hooks/usePlans";
import { useChangeSubscription } from "@/hooks/useChangeSubscription";

interface ChangePlanDialogProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  currentPlanId?: string;
}

export function ChangePlanDialog({
  open,
  onClose,
  organizationId,
  currentPlanId,
}: ChangePlanDialogProps) {
  const { data: plansData } = usePlans();
  const plans = plansData?.data ?? [];
  const [planId, setPlanId] = useState(currentPlanId ?? "");
  const changeSubscription = useChangeSubscription();

  function handleClose() {
    setPlanId(currentPlanId ?? "");
    onClose();
  }

  function handleConfirm() {
    if (!planId) return;
    changeSubscription.mutate(
      { id: organizationId, plan_id: planId },
      { onSuccess: onClose },
    );
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Alterar plano</AlertDialogTitle>
          <AlertDialogDescription>
            O plano anterior fica registrado no histórico da organização.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-2">
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger aria-label="Novo plano">
              <SelectValue placeholder="Selecione um pacote" />
            </SelectTrigger>
            <SelectContent>
              {plans.map((plan) => (
                <SelectItem key={plan.id} value={plan.id}>
                  {plan.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleClose}>Cancelar</AlertDialogCancel>
          <Button onClick={handleConfirm} disabled={!planId || changeSubscription.isPending}>
            {changeSubscription.isPending ? "Salvando..." : "Confirmar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
