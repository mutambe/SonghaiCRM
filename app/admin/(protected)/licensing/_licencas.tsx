"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface LicencaListada {
  id: string;
  license_key: string;
  status: string;
  plan_amount_cents: number;
  current_period_end: string;
  created_at: string;
  licensing_installs: { customer_name: string; contact_email: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  trial: "Teste",
  active: "Ativa",
  revoked: "Revogada",
};

function formatarMzn(cents: number): string {
  return (cents / 100).toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-MZ");
}

/**
 * "Emitir licença" pra quem administra a Central no dia a dia — sem precisar
 * chamar `POST /api/v1/licensing/admin` na mão. A chave gerada só aparece
 * UMA vez, na resposta desta chamada — a lista (GET) nunca precisa escondê-la
 * porque ela já é o dado que o cliente recebe pra colar no `.env` dele, mas
 * evitamos reexibir por hábito de segurança (o valor persiste só em texto no
 * banco por desenho da Task 1, não é hash — quem perdeu a chave inicial
 * ainda pode vir aqui rever, é intencional).
 */
export function LicencasCentral() {
  const [carregando, setCarregando] = useState(true);
  const [licencas, setLicencas] = useState<LicencaListada[]>([]);
  const [emitindo, setEmitindo] = useState(false);
  const [chaveNova, setChaveNova] = useState<string | null>(null);

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [valorMzn, setValorMzn] = useState("");
  const [trialDias, setTrialDias] = useState("7");
  const [intervaloDias, setIntervaloDias] = useState("30");

  async function carregar() {
    setCarregando(true);
    try {
      const res = await fetch("/api/v1/licensing/admin");
      const json = (await res.json()) as { data?: LicencaListada[] };
      setLicencas(json.data ?? []);
    } catch {
      toast.error("Não consegui carregar as licenças.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function emitir() {
    const amountMzn = Number(valorMzn.replace(",", "."));
    if (!nome.trim() || !email.trim() || !Number.isFinite(amountMzn) || amountMzn <= 0) {
      toast.error("Preencha nome, email e um valor de plano válido.");
      return;
    }
    setEmitindo(true);
    setChaveNova(null);
    try {
      const res = await fetch("/api/v1/licensing/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: nome.trim(),
          contact_email: email.trim(),
          plan_amount_cents: Math.round(amountMzn * 100),
          plan_interval_days: Number(intervaloDias) || 30,
          trial_days: Number(trialDias) || 0,
        }),
      });
      const json = (await res.json()) as {
        error?: { message?: string };
        data?: { license_key: string };
      };
      if (!res.ok || !json.data) {
        toast.error(json.error?.message ?? "Não consegui emitir a licença.");
        return;
      }
      setChaveNova(json.data.license_key);
      toast.success("Licença emitida.");
      setNome("");
      setEmail("");
      setValorMzn("");
      await carregar();
    } catch {
      toast.error("Não consegui falar com o servidor.");
    } finally {
      setEmitindo(false);
    }
  }

  return (
    <div className="space-y-6">
      {chaveNova ? (
        <Card className="border-emerald-500/50">
          <CardHeader>
            <CardTitle>Licença emitida</CardTitle>
            <CardDescription>
              Copie esta chave e envie ao cliente — ele cola em <code>LICENSE_KEY</code> no
              <code> .env</code> da instalação dele. Ela continua visível na lista abaixo se
              precisar consultar depois.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block break-all rounded bg-muted px-3 py-2 text-sm">{chaveNova}</code>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Nova licença</CardTitle>
          <CardDescription>
            Registre um cliente e emita a chave que ele vai colar na instalação dele.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="lic-nome">Nome do cliente</Label>
            <Input id="lic-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lic-email">Email de contacto</Label>
            <Input
              id="lic-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lic-valor">Valor do plano (MZN, por período)</Label>
            <Input
              id="lic-valor"
              inputMode="decimal"
              placeholder="5000.00"
              value={valorMzn}
              onChange={(e) => setValorMzn(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lic-intervalo">Renova a cada quantos dias</Label>
            <Input
              id="lic-intervalo"
              inputMode="numeric"
              value={intervaloDias}
              onChange={(e) => setIntervaloDias(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lic-trial">Dias de teste antes de cobrar</Label>
            <Input
              id="lic-trial"
              inputMode="numeric"
              value={trialDias}
              onChange={(e) => setTrialDias(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={emitir} disabled={emitindo}>
            {emitindo ? "Emitindo…" : "Emitir licença"}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Licenças emitidas</CardTitle>
        </CardHeader>
        <CardContent>
          {carregando ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : licencas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma licença emitida ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Renova até</TableHead>
                  <TableHead>Emitida em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {licencas.map((lic) => (
                  <TableRow key={lic.id}>
                    <TableCell>
                      <div className="font-medium">{lic.licensing_installs?.customer_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {lic.licensing_installs?.contact_email ?? ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{STATUS_LABEL[lic.status] ?? lic.status}</Badge>
                    </TableCell>
                    <TableCell>{formatarMzn(lic.plan_amount_cents)} MZN</TableCell>
                    <TableCell>{formatarData(lic.current_period_end)}</TableCell>
                    <TableCell>{formatarData(lic.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
