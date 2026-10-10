"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

interface OrganizacaoDaLista {
  id: string;
  display_name: string;
}
interface AgenteDaLista {
  id: string;
  name: string;
  kind: string;
  published_version: { version_number: number } | null;
}
interface Aplicado {
  agent_id: string;
  a_configurar: string[];
}

/** O que falta no cliente depois de aplicar, em palavras de quem opera. */
const A_CONFIGURAR: Record<string, string> = {
  credencial_de_ia: "a chave de IA do cliente para o provedor do agente: obtenha-a no provedor e registe-a em IA › Credenciais antes de publicar",
  funis: "os funis em que o agente pode mexer",
  base_de_conhecimento: "a base de conhecimento do cliente",
  follow_ups: "os follow-ups, que nascem desligados",
};

/**
 * APLICAR UM AGENTE-MODELO A ESTE CLIENTE — SonghaiCRM, Fase B da spec 19.
 *
 * O operador escolhe a organização que guarda os modelos e um agente DELA com
 * versão publicada; a cópia nasce rascunho no cliente, com o WhatsApp do
 * cliente, e a tela diz o que ainda falta configurar. Nada vai ao ar sozinho.
 */
export function AgenteModeloDoCliente({ organizationId }: { organizationId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [origem, setOrigem] = useState("");
  const [agente, setAgente] = useState("");
  const [feito, setFeito] = useState<Aplicado | null>(null);

  const organizacoes = useQuery({
    queryKey: ["admin", "tenants", "lista-para-modelo"],
    queryFn: () => apiClient.get<{ data: OrganizacaoDaLista[] }>("/api/v1/admin/tenants?limit=100"),
  });
  const agentes = useQuery({
    queryKey: ["admin", "tenant", origem, "agentes"],
    enabled: origem !== "",
    queryFn: () =>
      apiClient.get<{ data: { agents: AgenteDaLista[] } }>(`/api/v1/admin/tenants/${origem}/agents`),
  });

  const aplicar = useMutation({
    mutationFn: () =>
      apiClient.post<{ data: Aplicado }>(`/api/v1/admin/tenants/${organizationId}/package`, {
        source_organization_id: origem,
        source_agent_id: agente,
      }),
    onSuccess: (r) => {
      setFeito(r.data);
      setAgente("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "tenant", organizationId, "agentes"] });
      toast.success(t("Agente criado como rascunho."));
    },
    onError: (err: Error) => toast.error(t("Não foi possível aplicar o modelo."), { description: err.message }),
  });

  const candidatas = (organizacoes.data?.data ?? []).filter((o) => o.id !== organizationId);
  // Só serve de modelo o agente com ferramentas e versão publicada (a revista).
  const modelos = (agentes.data?.data.agents ?? []).filter((a) => a.kind === "mcp_agent" && a.published_version);

  return (
    <div className="rounded-lg border bg-card p-5" data-testid="agente-modelo-do-cliente">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {t("Agente-modelo")}
      </h2>
      <p className="mb-3 text-sm text-text-muted">
        {t("Copia para este cliente a versão publicada de um agente-modelo, como rascunho. Nada vai ao ar sozinho.")}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={origem}
          onValueChange={(v) => {
            setOrigem(v);
            setAgente("");
            setFeito(null);
          }}
        >
          <SelectTrigger className="w-56" aria-label={t("Organização dos modelos")}>
            <SelectValue placeholder={t("Organização dos modelos…")} />
          </SelectTrigger>
          <SelectContent>
            {candidatas.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={agente} onValueChange={setAgente} disabled={origem === ""}>
          <SelectTrigger className="w-64" aria-label={t("Agente-modelo")}>
            <SelectValue placeholder={t("Agente-modelo…")} />
          </SelectTrigger>
          <SelectContent>
            {modelos.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name} · v{a.published_version?.version_number}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          disabled={!origem || !agente || aplicar.isPending}
          onClick={() => aplicar.mutate()}
          data-testid="agente-modelo-aplicar"
        >
          {aplicar.isPending ? t("A aplicar…") : t("Aplicar modelo")}
        </Button>
      </div>

      {origem !== "" && agentes.isSuccess && modelos.length === 0 && (
        <p className="mt-3 text-sm text-text-muted" data-testid="agente-modelo-vazio">
          {t("Essa organização não tem agente com versão publicada. Publique o modelo primeiro.")}
        </p>
      )}

      {feito && (
        <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm" data-testid="agente-modelo-resultado">
          <p className="font-medium">{t("Falta, dentro do cliente:")}</p>
          <ul className="mt-1 list-disc pl-5 text-text-muted">
            {feito.a_configurar.map((item) => (
              <li key={item}>{t(A_CONFIGURAR[item] ?? item)}</li>
            ))}
            <li>{t("rever o texto e publicar")}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
