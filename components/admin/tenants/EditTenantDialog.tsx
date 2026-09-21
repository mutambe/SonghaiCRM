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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateTenant } from "@/hooks/useUpdateTenant";
import type { TenantOrganization } from "@/hooks/useTenantDetail";

interface EditTenantDialogProps {
  open: boolean;
  onClose: () => void;
  organization: TenantOrganization;
}

const SLUG_PATTERN = /^[a-z0-9-]+$/;

export function EditTenantDialog({ open, onClose, organization }: EditTenantDialogProps) {
  const [displayName, setDisplayName] = useState(organization.display_name);
  const [legalName, setLegalName] = useState(organization.legal_name ?? "");
  const [nuit, setNuit] = useState(organization.nuit ?? "");
  const [slug, setSlug] = useState(organization.slug);
  const update = useUpdateTenant();

  const displayNameValid = displayName.trim().length >= 2;
  const slugValid = SLUG_PATTERN.test(slug) && slug.length >= 2;
  const isValid = displayNameValid && slugValid;

  function handleClose() {
    onClose();
  }

  function handleConfirm() {
    if (!isValid) return;
    update.mutate(
      {
        id: organization.id,
        display_name: displayName.trim(),
        legal_name: legalName.trim() ? legalName.trim() : null,
        nuit: nuit.trim() ? nuit.trim() : null,
        slug,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Editar tenant</AlertDialogTitle>
          <AlertDialogDescription>
            Atualiza os dados cadastrais da organização. Não mexe no responsável nem no plano.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-display-name">Nome</Label>
            <Input
              id="edit-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-slug">Slug</Label>
            <Input
              id="edit-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              maxLength={40}
              aria-invalid={!slugValid}
            />
            {!slugValid && (
              <p className="text-xs text-destructive">
                Minúsculo, só letras/números/hífen.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-legal-name">Razão social</Label>
            <Input
              id="edit-legal-name"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              maxLength={255}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-nuit">NUIT</Label>
            <Input id="edit-nuit" value={nuit} onChange={(e) => setNuit(e.target.value)} />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleClose}>Cancelar</AlertDialogCancel>
          <Button onClick={handleConfirm} disabled={!isValid || update.isPending}>
            {update.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
