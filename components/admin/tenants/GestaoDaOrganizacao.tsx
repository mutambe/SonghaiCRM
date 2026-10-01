"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { TenantOrganization } from "@/hooks/useTenantDetail";

/**
 * EDITAR E APAGAR UMA ORGANIZAÇÃO — SonghaiCRM (porte do `b1b1eb812`).
 *
 * Editar corrige o que a criação gravou errado (nome, nome legal, NUIT, slug).
 * Apagar existe só para a organização criada por engano e nunca usada: a rota
 * recusa (409) qualquer uma com membros, conversas, negócios ou canais, e a
 * resposta certa aí é suspender. A confirmação pede o slug escrito.
 */
export function GestaoDaOrganizacao({ organization }: { organization: TenantOrganization }) {
  const t = useT();
  const [editar, setEditar] = useState(false);
  const [apagar, setApagar] = useState(false);
  const bloqueada = organization.status === "redacted";

  return (
    <>
      <Button className="w-full" variant="outline" disabled={bloqueada} onClick={() => setEditar(true)} data-testid="organizacao-editar">
        {t("Editar dados")}
      </Button>
      <Button className="w-full" variant="ghost" disabled={bloqueada} onClick={() => setApagar(true)} data-testid="organizacao-apagar">
        {t("Apagar organização")}
      </Button>
      {editar && <EditarDialog organization={organization} onClose={() => setEditar(false)} />}
      {apagar && <ApagarDialog organization={organization} onClose={() => setApagar(false)} />}
    </>
  );
}

function EditarDialog({ organization, onClose }: { organization: TenantOrganization; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [nome, setNome] = useState(organization.display_name);
  const [nomeLegal, setNomeLegal] = useState(organization.legal_name ?? "");
  const [nuit, setNuit] = useState(organization.cnpj ?? "");
  const [slug, setSlug] = useState(organization.slug);

  const guardar = useMutation({
    mutationFn: () => {
      const corpo: Record<string, string | null> = {};
      if (nome.trim() !== organization.display_name) corpo.display_name = nome.trim();
      if (nomeLegal.trim() && nomeLegal.trim() !== (organization.legal_name ?? "")) corpo.legal_name = nomeLegal.trim();
      if (nuit.trim() !== (organization.cnpj ?? "")) corpo.nuit = nuit.trim() || null;
      if (slug.trim() !== organization.slug) corpo.slug = slug.trim();
      return apiClient.patch(`/api/v1/admin/tenants/${organization.id}`, corpo);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenant", organization.id] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
      toast.success(t("Organização atualizada."));
      onClose();
    },
    onError: (err: Error) => toast.error(t("Não foi possível guardar."), { description: err.message }),
  });

  const mudou =
    nome.trim() !== organization.display_name ||
    (nomeLegal.trim() !== "" && nomeLegal.trim() !== (organization.legal_name ?? "")) ||
    nuit.trim() !== (organization.cnpj ?? "") ||
    slug.trim() !== organization.slug;

  return (
    <AlertDialog open onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Editar dados da organização")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("Mudar o slug muda o endereço da organização; avise quem já o usa.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="org-nome">{t("Nome")}</Label>
            <Input id="org-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="org-nome-legal">{t("Nome legal")}</Label>
            <Input id="org-nome-legal" value={nomeLegal} onChange={(e) => setNomeLegal(e.target.value)} maxLength={255} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="org-nuit">NUIT</Label>
            <Input id="org-nuit" value={nuit} onChange={(e) => setNuit(e.target.value)} inputMode="numeric" maxLength={20} placeholder="123456789" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="org-slug">Slug</Label>
            <Input id="org-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={40} />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>{t("Cancelar")}</AlertDialogCancel>
          <Button onClick={() => guardar.mutate()} disabled={!mudou || guardar.isPending} data-testid="organizacao-editar-guardar">
            {guardar.isPending ? t("A guardar…") : t("Guardar")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ApagarDialog({ organization, onClose }: { organization: TenantOrganization; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmacao, setConfirmacao] = useState("");

  const apagar = useMutation({
    mutationFn: () => apiClient.delete(`/api/v1/admin/tenants/${organization.id}`, { slug_confirmation: confirmacao }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
      toast.success(t("Organização apagada."));
      router.push("/admin/tenants");
    },
    onError: (err: Error) => toast.error(t("Não foi possível apagar."), { description: err.message }),
  });

  return (
    <AlertDialog open onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Apagar organização")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("Só se apaga uma organização criada por engano e nunca usada. Com membros, conversas, negócios ou canais, suspenda-a.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1 py-2">
          <Label htmlFor="org-apagar-slug">
            {t("Escreva o slug para confirmar:")} <span className="font-mono">{organization.slug}</span>
          </Label>
          <Input id="org-apagar-slug" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} autoComplete="off" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>{t("Cancelar")}</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => apagar.mutate()}
            disabled={confirmacao.trim().toLowerCase() !== organization.slug.toLowerCase() || apagar.isPending}
            data-testid="organizacao-apagar-confirmar"
          >
            {apagar.isPending ? t("A apagar…") : t("Apagar de vez")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
