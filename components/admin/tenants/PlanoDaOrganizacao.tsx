"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { formatCents } from "@/lib/money";

interface Plano {
  id: string;
  slug: string;
  display_name: string;
  price_cents: number | null;
  currency: string;
  limits: { max_users?: number; max_whatsapp_connections?: number };
}

interface Assinatura {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  plan: Plano | null;
}

interface RespostaDoPlano {
  data: { vigente: Assinatura | null; historico: Assinatura[]; catalogo: Plano[] };
}

/** "20 utilizadores · 1 número de WhatsApp" — ou "sem limite". */
function limitesLegiveis(plano: Plano, t: (s: string) => string): string {
  const u = plano.limits.max_users;
  const w = plano.limits.max_whatsapp_connections;
  if (u === undefined && w === undefined) return t("sem limite");
  return [
    u !== undefined ? `${u} ${t("utilizadores")}` : null,
    w !== undefined ? `${w} ${t("número(s) de WhatsApp")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * O PLANO DE UMA ORGANIZAÇÃO — SonghaiCRM, migration 9004.
 *
 * Mostra o pacote vigente com os limites que o produto aplica (convite de
 * equipa e ligação de número) e deixa o admin da plataforma mudar de pacote.
 * Sem assinatura, diz isso: a organização fica SEM teto até receber um plano.
 */
export function PlanoDaOrganizacao({ organizationId }: { organizationId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const chave = ["admin", "tenant", organizationId, "assinatura"];
  const { data, isLoading, isError } = useQuery({
    queryKey: chave,
    queryFn: () => apiClient.get<RespostaDoPlano>(`/api/v1/admin/tenants/${organizationId}/subscription`),
  });
  const [escolhido, setEscolhido] = useState<string>("");

  const trocar = useMutation({
    mutationFn: (planId: string) => apiClient.patch(`/api/v1/admin/tenants/${organizationId}/subscription`, { plan_id: planId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chave });
      setEscolhido("");
      toast.success(t("Pacote alterado."));
    },
    onError: (err: Error) => toast.error(t("Não foi possível mudar o pacote."), { description: err.message }),
  });

  if (isLoading) return <div className="rounded-lg border bg-card p-5 text-sm text-text-muted">{t("Carregando…")}</div>;
  if (isError || !data) {
    return <div className="rounded-lg border bg-card p-5 text-sm text-error-fg">{t("Não foi possível carregar o pacote desta organização.")}</div>;
  }

  const { vigente, catalogo } = data.data;
  const atual = vigente?.plan ?? null;
  const opcoes = catalogo.filter((p) => p.id !== atual?.id);

  return (
    <div className="rounded-lg border bg-card p-5" data-testid="plano-da-organizacao">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("Pacote")}</h2>
      {atual ? (
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="neutral">{atual.display_name}</Badge>
            {atual.price_cents !== null && (
              <span className="text-text-muted">
                {formatCents(atual.price_cents, atual.currency)} {t("por mês")}
              </span>
            )}
          </div>
          <p className="text-text-muted">{limitesLegiveis(atual, t)}</p>
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          {t("Sem pacote atribuído — a organização não tem teto de utilizadores nem de números até receber um.")}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select value={escolhido} onValueChange={setEscolhido}>
          <SelectTrigger className="w-56" aria-label={t("Novo pacote")}>
            <SelectValue placeholder={atual ? t("Mudar para…") : t("Atribuir pacote…")} />
          </SelectTrigger>
          <SelectContent>
            {opcoes.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!escolhido || trocar.isPending}
          onClick={() => trocar.mutate(escolhido)}
          data-testid="plano-confirmar"
        >
          {trocar.isPending ? t("A guardar…") : t("Confirmar")}
        </Button>
      </div>
    </div>
  );
}
