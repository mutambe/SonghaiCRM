"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { PacoteNoResumo } from "@/lib/billing/resumo";
import { FUNCIONALIDADES_DO_PLANO, ROTULO_DA_FUNCIONALIDADE } from "@/lib/plans/funcionalidades";

const TEXTO_DO_LIMITE = (v: number | undefined) => (v === undefined ? "" : String(v));

/**
 * O QUE UM PACOTE INCLUI — SonghaiCRM, 9010.
 *
 * As funcionalidades e os limites de utilizadores e de números de WhatsApp. Ao
 * contrário do preço, isto vale NA HORA para todos os clientes do pacote, e por
 * isso a tela pede uma confirmação que diz quantos são. Nenhum dado é apagado:
 * a funcionalidade que sai só fica indisponível.
 */
export function ConteudoDoPacote({ pacote }: { pacote: PacoteNoResumo }) {
  const t = useT();
  const queryClient = useQueryClient();

  const inicial = pacote.limits.features ?? [...FUNCIONALIDADES_DO_PLANO];
  const [marcadas, setMarcadas] = useState<string[]>(inicial);
  const [utilizadores, setUtilizadores] = useState(TEXTO_DO_LIMITE(pacote.limits.max_users));
  const [numeros, setNumeros] = useState(TEXTO_DO_LIMITE(pacote.limits.max_whatsapp_connections));
  const [tokens, setTokens] = useState(TEXTO_DO_LIMITE(pacote.limits.ai_tokens_per_account));
  const [aConfirmar, setAConfirmar] = useState(false);

  const limite = (texto: string): number | null | "invalido" => {
    if (texto.trim() === "") return null;
    const n = Number(texto);
    return Number.isInteger(n) && n >= 1 ? n : "invalido";
  };
  const u = limite(utilizadores);
  const w = limite(numeros);
  const k = limite(tokens.replace(/\s/g, ""));
  const invalido = u === "invalido" || w === "invalido" || k === "invalido";

  const mudouFuncionalidades =
    marcadas.length !== inicial.length || marcadas.some((m) => !inicial.includes(m));
  const mudouLimites =
    u !== (pacote.limits.max_users ?? null) ||
    w !== (pacote.limits.max_whatsapp_connections ?? null) ||
    k !== (pacote.limits.ai_tokens_per_account ?? null);
  const mudou = mudouFuncionalidades || mudouLimites;

  const guardar = useMutation({
    mutationFn: () =>
      apiClient.patch<{ data: { clientes_afetados: number } }>(`/api/v1/admin/plans/${pacote.id}/content`, {
        // todas marcadas = "todas": a chave sai, e um módulo novo no futuro já entra
        features: marcadas.length === FUNCIONALIDADES_DO_PLANO.length ? null : marcadas,
        max_users: u === "invalido" ? undefined : u,
        max_whatsapp_connections: w === "invalido" ? undefined : w,
        ai_tokens_per_account: k === "invalido" ? undefined : k,
      }),
    onSuccess: (r) => {
      setAConfirmar(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "faturacao"] });
      toast.success(`${t("Guardado. Já vale para")} ${r.data.clientes_afetados} ${t("cliente(s) deste pacote.")}`);
    },
    onError: (err: Error) => toast.error(t("Não foi possível guardar o pacote."), { description: err.message }),
  });

  const alternar = (f: string) => {
    setAConfirmar(false);
    setMarcadas((atual) => (atual.includes(f) ? atual.filter((x) => x !== f) : [...atual, f]));
  };

  return (
    <div className="rounded-md border p-4" data-testid={`conteudo-${pacote.slug}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{pacote.display_name}</h3>
        <span className="text-xs text-muted-foreground">
          {pacote.clientes} {t("cliente(s)")}
        </span>
      </div>

      <p className="mb-2 text-xs text-muted-foreground">{t("O agente de IA e o WhatsApp vêm sempre. Inclui ainda:")}</p>
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        {FUNCIONALIDADES_DO_PLANO.map((f) => (
          <label key={f} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={marcadas.includes(f)}
              onChange={() => alternar(f)}
              aria-label={`${pacote.display_name}: ${t(ROTULO_DA_FUNCIONALIDADE[f])}`}
            />
            {t(ROTULO_DA_FUNCIONALIDADE[f])}
          </label>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-4">
        <label className="space-y-1 text-xs text-muted-foreground">
          {t("Utilizadores (vazio = sem limite)")}
          <Input
            className="w-36"
            inputMode="numeric"
            aria-label={`${pacote.display_name}: ${t("Utilizadores")}`}
            value={utilizadores}
            onChange={(e) => {
              setAConfirmar(false);
              setUtilizadores(e.target.value);
            }}
            aria-invalid={u === "invalido"}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          {t("Números de WhatsApp (vazio = sem limite)")}
          <Input
            className="w-36"
            inputMode="numeric"
            aria-label={`${pacote.display_name}: ${t("Números de WhatsApp")}`}
            value={numeros}
            onChange={(e) => {
              setAConfirmar(false);
              setNumeros(e.target.value);
            }}
            aria-invalid={w === "invalido"}
          />
        </label>
      </div>

      <div className="mb-4">
        <label className="space-y-1 text-xs text-muted-foreground">
          {t("Tokens de IA por mês, por conta de WhatsApp (vazio = sem limite)")}
          <Input
            className="w-48"
            inputMode="numeric"
            aria-label={`${pacote.display_name}: ${t("Tokens de IA por conta")}`}
            value={tokens}
            onChange={(e) => {
              setAConfirmar(false);
              setTokens(e.target.value);
            }}
            aria-invalid={k === "invalido"}
          />
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Cada conta de WhatsApp tem a sua quantidade. Avisa o cliente e o fornecedor aos 80% e ao limite; não corta o serviço. Renova com a conta.")}
        </p>
      </div>

      {aConfirmar ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="conteudo-confirmar">
          <span className="text-error-fg">
            {t("Isto muda JÁ para")} {pacote.clientes} {t("cliente(s). Confirma?")}
          </span>
          <Button size="sm" disabled={guardar.isPending} onClick={() => guardar.mutate()}>
            {t("Confirmar")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAConfirmar(false)}>
            {t("Cancelar")}
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={!mudou || invalido} onClick={() => setAConfirmar(true)}>
          {t("Guardar")}
        </Button>
      )}
    </div>
  );
}
