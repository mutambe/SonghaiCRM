"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface StatusResponse {
  configured: boolean;
  status?: string;
  updated_at?: string;
}

/**
 * Credencial do PaySuite da instância CENTRAL — mesmo padrão de
 * `app/app/integrations/paysuite/_components/PaySuiteForm.tsx` (credencial de
 * tenant), adaptado pra singleton: não tem `webhook_url` pra mostrar porque o
 * webhook da Central é fixo (`/api/v1/licensing/webhooks/paysuite`), não um
 * path token por instalação.
 */
export function PaySuiteCredencialForm() {
  const [carregando, setCarregando] = useState(true);
  const [dados, setDados] = useState<StatusResponse | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      const res = await fetch("/api/v1/licensing/admin/paysuite-credentials");
      const json = (await res.json()) as { data?: StatusResponse };
      setDados(json.data ?? { configured: false });
    } catch {
      toast.error("Não consegui verificar a configuração do PaySuite.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function salvar() {
    if (apiToken.trim().length < 10 || webhookSecret.trim().length < 10) {
      toast.error("Cole o token de API e o segredo de webhook completos.");
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/v1/licensing/admin/paysuite-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_token: apiToken.trim(), webhook_secret: webhookSecret.trim() }),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        toast.error(json.error?.message ?? "Não consegui salvar.");
        return;
      }
      toast.success("Credencial do PaySuite salva.");
      setApiToken("");
      setWebhookSecret("");
      await carregar();
    } catch {
      toast.error("Não consegui falar com o servidor.");
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  return (
    <div className="space-y-4">
      {dados?.configured ? (
        <p className="text-sm text-muted-foreground">
          Configurado <Badge variant="secondary">{dados.status}</Badge>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma credencial configurada ainda.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{dados?.configured ? "Trocar credenciais" : "Conectar PaySuite"}</CardTitle>
          <CardDescription>
            Pegue o token e o segredo de webhook em Settings › API Access no dashboard do
            PaySuite (paysuite.tech). O webhook desta Central é fixo — cole essa URL lá:{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              /api/v1/licensing/webhooks/paysuite
            </code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ps-token">Token de API (Bearer)</Label>
            <Input
              id="ps-token"
              type="password"
              autoComplete="off"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ps-secret">Segredo de webhook</Label>
            <Input
              id="ps-secret"
              type="password"
              autoComplete="off"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
