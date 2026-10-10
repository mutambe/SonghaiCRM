"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

interface Config {
  emails: string[];
  ligado: boolean;
}

/**
 * O MESMO AVISO, POR E-MAIL — SonghaiCRM, migration 9012.
 *
 * Canal adicional ao aviso no WhatsApp (que fala com UM número): uma lista de até
 * 10 e-mails que recebe o aviso quando o assistente abre um caso. Independente do
 * WhatsApp — ligar um não depende do outro, e nenhum número novo passa a entrar
 * no recebimento de mensagens.
 */
export function AvisoPorEmail() {
  const t = useT();
  const queryClient = useQueryClient();
  const chave = ["ai", "cases", "aviso-email"];
  const { data, isLoading } = useQuery({
    queryKey: chave,
    queryFn: () => apiClient.get<{ data: Config }>("/api/v1/ai/cases/aviso-email"),
  });
  // null = ainda não mexeu: os campos mostram o que está guardado.
  const [texto, setTexto] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: (c: { emails: string[]; ligado: boolean }) => apiClient.put("/api/v1/ai/cases/aviso-email", c),
    onSuccess: () => {
      setTexto(null);
      void queryClient.invalidateQueries({ queryKey: chave });
      toast.success(t("Guardado."));
    },
    onError: (err: Error) => toast.error(t("Não foi possível guardar."), { description: err.message }),
  });

  if (isLoading || !data) return null;
  const atual = data.data;
  const linhas = texto ?? atual.emails.join(String.fromCharCode(10));
  const emails = linhas.split(/[\s,;]+/).filter(Boolean);

  return (
    <section className="max-w-2xl space-y-3 rounded-lg border bg-card p-5" data-testid="aviso-por-email">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">{t("Avisar também por e-mail")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Recebe o mesmo aviso quando o assistente abre um caso. Um endereço por linha, até 10. Funciona em separado do WhatsApp.")}
          </p>
        </div>
        <Switch
          checked={atual.ligado}
          disabled={guardar.isPending || (!atual.ligado && atual.emails.length === 0)}
          onCheckedChange={(ligado) => guardar.mutate({ emails: atual.emails, ligado })}
          aria-label={t("Avisar por e-mail")}
        />
      </div>
      <textarea
        className="min-h-24 w-full rounded-md border bg-background p-3 text-sm"
        aria-label={t("E-mails que recebem o aviso de caso")}
        value={linhas}
        onChange={(e) => setTexto(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={texto === null || guardar.isPending}
        onClick={() => guardar.mutate({ emails, ligado: atual.ligado && emails.length > 0 })}
        data-testid="aviso-email-guardar"
      >
        {t("Guardar")}
      </Button>
    </section>
  );
}
