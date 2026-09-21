"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDeleteTenant } from "@/hooks/useDeleteTenant";

interface DeleteTenantDialogProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  slug: string;
}

export function DeleteTenantDialog({ open, onClose, organizationId, slug }: DeleteTenantDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  const deleteTenant = useDeleteTenant();
  const router = useRouter();

  const isValid = confirmation === slug;

  function handleClose() {
    setConfirmation("");
    onClose();
  }

  function handleConfirm() {
    if (!isValid) return;
    deleteTenant.mutate(
      { id: organizationId, slug_confirmation: confirmation },
      {
        onSuccess: () => {
          setConfirmation("");
          onClose();
          router.push("/admin/tenants");
        },
      },
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deletar tenant</AlertDialogTitle>
          <AlertDialogDescription>
            Apaga a organização e tudo dentro dela de forma irreversível. Só é permitido
            quando o tenant não tem nenhum uso real (usuário ativo, conversa, lead ou pedido) —
            se houver, use Suspender.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="delete-confirmation">
            Digite <span className="font-mono font-semibold">{slug}</span> para confirmar
          </Label>
          <Input
            id="delete-confirmation"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleClose}>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isValid || deleteTenant.isPending}
          >
            {deleteTenant.isPending ? "Apagando..." : "Apagar definitivamente"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
