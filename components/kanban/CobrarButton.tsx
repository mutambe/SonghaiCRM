"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { copyToClipboard } from "@/lib/clipboard";
import { Receipt } from "@/lib/ui/icons";

interface Props {
  leadId: string;
  valueCents: number | null;
  currency: string | null;
}

/**
 * "Cobrar" — gera o link de pagamento PaySuite (M-Pesa, e-Mola, cartão) e o
 * copia: o destino é sempre colar no WhatsApp, e poupar o "abrir, selecionar,
 * copiar" é o que faz o botão valer a pena (SonghaiCRM).
 *
 * Desabilitado, dizendo porquê, quando não há o que cobrar: sem valor no
 * negócio, ou numa moeda que o PaySuite não cobra (só metical). A rota recusa
 * os dois casos também — o botão só evita o clique que já se sabe inútil.
 * "PaySuite não configurado" é o erro mais comum da primeira vez, e a mensagem
 * da rota já aponta para a tela de configuração.
 */
export function CobrarButton({ leadId, valueCents, currency }: Props) {
  const t = useT();
  const [enviando, setEnviando] = useState(false);

  const semValor = valueCents === null || valueCents <= 0;
  const outraMoeda = (currency ?? "MZN") !== "MZN";
  const motivo = semValor
    ? t("Defina um valor para o negócio antes de cobrar.")
    : outraMoeda
      ? t("O PaySuite só cobra em meticais (MTn).")
      : undefined;

  async function cobrar() {
    setEnviando(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/charge`, { method: "POST" });
      const json = (await res.json()) as { error?: { message?: string }; data?: { checkout_url?: string } };
      if (!res.ok) {
        toast.error(json.error?.message ?? t("Não consegui gerar o link de cobrança."));
        return;
      }
      const url = json.data?.checkout_url;
      if (!url) {
        toast.error(t("O PaySuite não devolveu o link de pagamento."));
        return;
      }
      if (await copyToClipboard(url)) toast.success(t("Link de pagamento copiado — cole no WhatsApp."));
      else toast.success(t("Link de pagamento gerado."), { description: url });
    } catch {
      toast.error(t("Não consegui falar com o servidor."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-6 gap-1 px-2 text-xs"
      disabled={!!motivo || enviando}
      title={motivo}
      onClick={cobrar}
      data-testid="cobrar-negocio"
    >
      <Receipt size={14} weight="bold" />
      {enviando ? t("A gerar…") : t("Cobrar")}
    </Button>
  );
}
