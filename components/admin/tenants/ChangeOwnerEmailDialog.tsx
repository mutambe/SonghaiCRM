"use client";
import { useState } from "react";
import { z } from "zod";
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
import { useTenantOwnerAction } from "@/hooks/useTenantOwnerAction";

const emailSchema = z.string().email("E-mail inválido");

interface ChangeOwnerEmailDialogProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  currentEmail: string | null;
}

export function ChangeOwnerEmailDialog({
  open,
  onClose,
  organizationId,
  currentEmail,
}: ChangeOwnerEmailDialogProps) {
  const [email, setEmail] = useState("");
  const ownerAction = useTenantOwnerAction();

  const validation = emailSchema.safeParse(email);
  const isValid = validation.success;

  function handleClose() {
    setEmail("");
    onClose();
  }

  function handleConfirm() {
    if (!isValid) return;
    ownerAction.mutate(
      { id: organizationId, action: "change_email", email: validation.data },
      { onSuccess: handleClose },
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {currentEmail ? "Trocar e-mail do responsável" : "Definir e-mail do responsável"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {currentEmail
              ? `O convite pendente para ${currentEmail} é cancelado e um novo é enviado para o e-mail correto.`
              : "Envia o convite de acesso ao tenant para este e-mail."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1.5 py-2">
          <Label htmlFor="owner-email">E-mail correto</Label>
          <Input
            id="owner-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="dono@empresa.com"
            autoFocus
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleClose}>Cancelar</AlertDialogCancel>
          <Button onClick={handleConfirm} disabled={!isValid || ownerAction.isPending}>
            {ownerAction.isPending ? "Enviando..." : "Enviar convite"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
