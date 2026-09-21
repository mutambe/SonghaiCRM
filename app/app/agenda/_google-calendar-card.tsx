"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ConnectionRow {
  id: string;
  account_email: string;
  status: "connecting" | "healthy" | "token_expired" | "scope_missing" | "disconnected" | "rate_limited" | "error";
  last_sync_error: string | null;
  created_at: string;
}

const ROTULO_DO_STATUS: Record<ConnectionRow["status"], string> = {
  connecting: "Conectando",
  healthy: "Conectada",
  token_expired: "Reconecte sua agenda",
  scope_missing: "Falta permissão de calendário",
  disconnected: "Desconectada",
  rate_limited: "O Google pediu para esperar",
  error: "Erro na conexão",
};

/** Os códigos que `?erro=` traz de volta do callback — traduzidos para o operador. */
const MENSAGEM_DO_ERRO: Record<string, string> = {
  conexao_cancelada: "Conexão cancelada.",
  google_nao_configurado:
    "O Google Calendar ainda não está configurado nesta instalação (falta GOOGLE_CALENDAR_CLIENT_ID/SECRET).",
  segredo_indisponivel: "Não consegui iniciar a conexão. Tente novamente em instantes.",
  retorno_nao_verificavel: "Não consegui confirmar que foi você quem voltou do Google. Tente conectar de novo.",
  retorno_incompleto: "O Google não devolveu os dados esperados. Tente novamente.",
  troca_de_codigo_falhou: "Não consegui trocar a autorização por acesso. Tente novamente.",
  permissao_incompleta: "Faltou marcar alguma permissão de calendário na tela do Google. Tente de novo, marcando tudo.",
  sem_token_de_renovacao:
    "O Google não devolveu permissão de renovação contínua. Desconecte outra conexão desta conta, se houver, e tente de novo.",
  conta_indisponivel: "Não consegui ler os dados da sua conta Google. Tente novamente.",
  google_recusou_o_acesso: "O Google recusou o acesso a este calendário.",
  cifra_indisponivel: "Não consegui proteger sua credencial. Fale com quem administra esta instalação.",
  nao_consegui_guardar: "Não consegui guardar a conexão. Tente novamente.",
};

export function GoogleCalendarCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [desconectando, setDesconectando] = useState(false);

  useEffect(() => {
    const erro = searchParams.get("erro");
    const ok = searchParams.get("ok");
    if (erro) toast.error(MENSAGEM_DO_ERRO[erro] ?? `Não consegui conectar o Google (${erro}).`);
    if (ok === "agenda_conectada") toast.success("Agenda do Google conectada.");
    if (erro || ok) router.replace("/app/agenda");
    // Só na primeira renderização: a URL é limpa logo em seguida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelado = false;
    fetch("/api/v1/agenda/google/calendarios")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((json: { data?: { connections: ConnectionRow[] } }) => {
        if (!cancelado) setConnections(json.data?.connections ?? []);
      })
      .catch(() => {
        if (!cancelado) setConnections([]);
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  async function desconectar() {
    setDesconectando(true);
    try {
      const res = await fetch("/api/v1/agenda/google/desconectar", { method: "DELETE" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setConnections([]);
      toast.success("Agenda do Google desconectada.");
    } catch {
      toast.error("Não consegui desconectar. Tente novamente.");
    } finally {
      setDesconectando(false);
    }
  }

  if (loading) return null;

  const conexao = connections[0] ?? null;

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Google Calendar</span>
          {conexao ? (
            <span className="text-xs text-muted-foreground">{conexao.account_email}</span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Conecte a sua agenda do Google para ver os compromissos marcados por lá.
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {conexao && (
            <>
              <Badge variant={conexao.status === "healthy" ? "default" : "outline"}>
                {ROTULO_DO_STATUS[conexao.status]}
              </Badge>
              <Button variant="outline" size="sm" onClick={desconectar} disabled={desconectando}>
                {desconectando ? "Desconectando…" : "Desconectar"}
              </Button>
            </>
          )}
          {!conexao && (
            <Button asChild size="sm">
              <a href="/api/v1/agenda/google/connect">Conectar Google</a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
