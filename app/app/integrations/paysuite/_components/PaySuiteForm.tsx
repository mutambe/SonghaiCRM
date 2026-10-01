"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";

interface Estado {
  configured: boolean;
  status?: string;
  status_reason?: string | null;
  webhook_url?: string;
  updated_at?: string;
}

/** O status cru do banco (`connecting|healthy|error`) não vai para a tela. */
function rotuloDoEstado(status: string | undefined, t: (s: string) => string): string {
  if (status === "healthy") return t("Ligado");
  if (status === "error") return t("Com erro");
  return t("A ligar");
}

export function PaySuiteForm() {
  const t = useT();
  const [carregando, setCarregando] = useState(true);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [segredo, setSegredo] = useState("");
  const [guardando, setGuardando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await fetch("/api/v1/integrations/paysuite");
      const json = (await res.json()) as { data?: Estado };
      setEstado(json.data ?? { configured: false });
    } catch {
      toast.error(t("Não consegui verificar a configuração do PaySuite."));
    } finally {
      setCarregando(false);
    }
  }, [t]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function guardar() {
    if (apiToken.trim().length < 10 || segredo.trim().length < 10) {
      toast.error(t("Cole o token de API e o segredo de webhook completos."));
      return;
    }
    setGuardando(true);
    try {
      const res = await fetch("/api/v1/integrations/paysuite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_token: apiToken.trim(), webhook_secret: segredo.trim() }),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        toast.error(json.error?.message ?? t("Não consegui guardar."));
        return;
      }
      toast.success(t("PaySuite ligado."));
      setApiToken("");
      setSegredo("");
      await carregar();
    } catch {
      toast.error(t("Não consegui falar com o servidor."));
    } finally {
      setGuardando(false);
    }
  }

  if (carregando) return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;

  return (
    <div className="flex flex-col gap-6">
      {estado?.configured ? (
        <Card data-testid="paysuite-ligado">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              {t("Ligado")}
              <Badge variant="secondary">{rotuloDoEstado(estado.status, t)}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div>
              <span className="font-medium">{t("URL de webhook")}</span>{" "}
              {t("— cole isto no painel do PaySuite, nas configurações de webhook:")}
              <code data-testid="paysuite-webhook-url" className="mt-1 block break-all rounded-md bg-muted px-2 py-1 text-xs">
                {estado.webhook_url}
              </code>
            </div>
            {estado.status_reason ? <p className="text-warning-fg">{estado.status_reason}</p> : null}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-text-muted">{t("Nenhuma conta PaySuite ligada ainda.")}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{estado?.configured ? t("Trocar as credenciais") : t("Ligar o PaySuite")}</CardTitle>
          <CardDescription>
            {t("O token e o segredo de webhook estão em Settings › API Access, no painel do PaySuite.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ps-token">{t("Token de API")}</Label>
            <Input id="ps-token" type="password" autoComplete="off" value={apiToken} onChange={(e) => setApiToken(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ps-secret">{t("Segredo de webhook")}</Label>
            <Input id="ps-secret" type="password" autoComplete="off" value={segredo} onChange={(e) => setSegredo(e.target.value)} />
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={guardar} disabled={guardando} data-testid="paysuite-guardar">
            {guardando ? t("Salvando…") : t("Salvar")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
