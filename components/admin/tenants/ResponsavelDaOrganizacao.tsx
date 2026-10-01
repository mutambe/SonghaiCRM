"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { useIdioma } from "@/lib/i18n/IdiomaProvider";
import { apiClient } from "@/lib/api/client";
import { copyToClipboard } from "@/lib/clipboard";
import type { EstadoDoResponsavel } from "@/lib/admin/responsavel-da-organizacao";

interface ConviteEmitido {
  email: string;
  accept_url: string;
  expires_at: string;
  email_dispatched: boolean;
}

/**
 * O RESPONSÁVEL DA ORGANIZAÇÃO — SonghaiCRM (porte do `b1b1eb812`).
 *
 * Diz se alguém já assumiu a organização, se o convite está pendente (e se
 * venceu) ou se não há ninguém. Enquanto ninguém assumiu, o admin da
 * plataforma reenvia o convite ou o manda para outro e-mail — o anterior é
 * revogado e o link dele deixa de valer. O link novo aparece para copiar,
 * porque numa instalação sem e-mail configurado é a única entrega.
 */
export function ResponsavelDaOrganizacao({ organizationId }: { organizationId: string }) {
  const t = useT();
  const idioma = useIdioma();
  const queryClient = useQueryClient();
  const chave = ["admin", "tenant", organizationId, "responsavel"];
  const { data, isLoading, isError } = useQuery({
    queryKey: chave,
    queryFn: () => apiClient.get<{ data: EstadoDoResponsavel }>(`/api/v1/admin/tenants/${organizationId}/owner`),
  });
  const [email, setEmail] = useState("");
  const [emitido, setEmitido] = useState<ConviteEmitido | null>(null);

  const convidar = useMutation({
    mutationFn: (destino: string) =>
      apiClient.post<{ data: ConviteEmitido }>(`/api/v1/admin/tenants/${organizationId}/owner`, { email: destino }),
    onSuccess: (r) => {
      setEmitido(r.data);
      setEmail("");
      void queryClient.invalidateQueries({ queryKey: chave });
      toast.success(r.data.email_dispatched ? t("Convite enviado.") : t("Convite criado. Copie o link e envie ao responsável."));
    },
    onError: (err: Error) => toast.error(t("Não foi possível convidar."), { description: err.message }),
  });

  if (isLoading) return <div className="rounded-lg border bg-card p-5 text-sm text-text-muted">{t("Carregando…")}</div>;
  if (isError || !data) {
    return <div className="rounded-lg border bg-card p-5 text-sm text-error-fg">{t("Não foi possível carregar o responsável.")}</div>;
  }
  const estado = data.data;

  return (
    <div className="rounded-lg border bg-card p-5" data-testid="responsavel-da-organizacao">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("Responsável")}</h2>

      {estado.estado === "ativo" && (
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="neutral">{t("Ativo")}</Badge>
            <span>{estado.email ?? "—"}</span>
          </div>
          <p className="text-text-muted">
            {t("Para recuperar o acesso, o responsável usa «Esqueci a palavra-passe» no ecrã de entrada.")}
          </p>
        </div>
      )}

      {estado.estado === "convite_pendente" && (
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="neutral">{estado.expirado ? t("Convite vencido") : t("Convite pendente")}</Badge>
            <span>{estado.email}</span>
          </div>
          <p className="text-text-muted">
            {estado.expirado ? t("Venceu em") : t("Vence em")} {new Date(estado.expira_em).toLocaleString(idioma)}
          </p>
        </div>
      )}

      {estado.estado === "sem_responsavel" && (
        <p className="text-sm text-text-muted">{t("Ninguém assumiu esta organização e não há convite em aberto.")}</p>
      )}

      {estado.estado !== "ativo" && (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="email"
              className="w-64"
              placeholder={estado.estado === "convite_pendente" ? estado.email : "dono@empresa.co.mz"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label={t("E-mail do responsável")}
            />
            <Button
              size="sm"
              disabled={convidar.isPending || (!email.trim() && estado.estado !== "convite_pendente")}
              onClick={() => convidar.mutate(email.trim() || (estado.estado === "convite_pendente" ? estado.email : ""))}
              data-testid="responsavel-convidar"
            >
              {convidar.isPending
                ? t("A enviar…")
                : email.trim() || estado.estado !== "convite_pendente"
                  ? t("Enviar convite")
                  : t("Reenviar convite")}
            </Button>
          </div>
          {estado.estado === "convite_pendente" && (
            <p className="text-xs text-text-muted">
              {t("Escreva outro e-mail para trocar o responsável: o convite anterior deixa de valer.")}
            </p>
          )}
        </div>
      )}

      {emitido && (
        <div className="mt-4 space-y-1">
          <p className="text-xs text-text-muted">
            {emitido.email_dispatched
              ? t("Convite enviado por e-mail. O link também serve:")
              : t("O envio por e-mail não foi confirmado. Copie o link e envie ao responsável:")}
          </p>
          <div className="flex gap-2">
            <Input readOnly value={emitido.accept_url} aria-label={t("Link do convite")} />
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (await copyToClipboard(emitido.accept_url)) toast.success(t("Link copiado."));
                else toast.error(t("Selecione e copie o link acima."));
              }}
            >
              {t("Copiar")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
