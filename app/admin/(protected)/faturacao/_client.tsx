"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ConteudoDoPacote } from "@/components/admin/faturacao/ConteudoDoPacote";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { dataLegivel } from "@/lib/billing/emails";
import type { ResumoDaFaturacao } from "@/lib/billing/resumo";
import { tokensLegiveis } from "@/lib/billing/tokens";
import { formatCents, parseReaisToCents } from "@/lib/money";

const CHAVE = ["admin", "faturacao"];

/** `800000` → `"8000,00"`, para o campo editar o que o operador lê. */
function paraCampo(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

/** Um campo de preço com o seu botão: vazio = sem preço (`null`). */
function CampoDePreco({
  valor,
  rotulo,
  aoGuardar,
  aGuardar,
  placeholder,
}: {
  valor: number | null;
  rotulo: string;
  aoGuardar: (cents: number | null) => void;
  aGuardar: boolean;
  placeholder?: string;
}) {
  const t = useT();
  const [texto, setTexto] = useState(paraCampo(valor));
  const cents = texto.trim() === "" ? null : parseReaisToCents(texto);
  const invalido = texto.trim() !== "" && cents === null;
  const mudou = cents !== valor;
  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={rotulo}
        inputMode="decimal"
        className="w-32"
        placeholder={placeholder}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-invalid={invalido}
      />
      <Button size="sm" variant="outline" disabled={!mudou || invalido || aGuardar} onClick={() => aoGuardar(cents)}>
        {t("Guardar")}
      </Button>
    </div>
  );
}

const ESTADOS: Record<string, { rotulo: string; variante: "neutral" | "success" | "error" }> = {
  open: { rotulo: "Em aberto", variante: "neutral" },
  paid: { rotulo: "Paga", variante: "success" },
  void: { rotulo: "Anulada", variante: "error" },
};

export function FaturacaoClient() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: CHAVE,
    queryFn: () => apiClient.get<{ data: ResumoDaFaturacao }>("/api/v1/admin/billing"),
  });
  const organizacoes = useQuery({
    queryKey: ["admin", "tenants", "lista-faturacao"],
    queryFn: () => apiClient.get<{ data: Array<{ id: string; display_name: string }> }>("/api/v1/admin/tenants?limit=100"),
  });
  const [quemRecebe, setQuemRecebe] = useState("");
  // null = ainda não mexeu: o campo mostra o que está guardado.
  const [dadosDoBanco, setDadosDoBanco] = useState<string | null>(null);
  const [emailsDoFornecedor, setEmailsDoFornecedor] = useState<string | null>(null);

  const atualizar = () => queryClient.invalidateQueries({ queryKey: CHAVE });
  const falhou = (titulo: string) => (err: Error) => toast.error(titulo, { description: err.message });

  const ligar = useMutation({
    mutationFn: () => apiClient.put("/api/v1/admin/billing", { organization_id: quemRecebe }),
    onSuccess: () => {
      void atualizar();
      toast.success(t("Faturação ligada."));
    },
    onError: falhou(t("Não foi possível ligar a faturação.")),
  });

  const guardarTransferencia = useMutation({
    mutationFn: (instructions: string | null) => apiClient.put("/api/v1/admin/billing/transfer", { instructions }),
    onSuccess: () => {
      setDadosDoBanco(null);
      void atualizar();
      toast.success(t("Guardado. Aparece nas facturas, nos e-mails e na página de facturação do cliente."));
    },
    onError: falhou(t("Não foi possível guardar os dados da transferência.")),
  });

  const guardarEmailsDoFornecedor = useMutation({
    mutationFn: (emails: string[]) => apiClient.put("/api/v1/admin/billing/notices", { emails }),
    onSuccess: () => {
      setEmailsDoFornecedor(null);
      void atualizar();
      toast.success(t("Guardado."));
    },
    onError: falhou(t("Não foi possível guardar os e-mails.")),
  });

  const precoDoPacote = useMutation({
    mutationFn: (a: { id: string; price_cents?: number | null; setup_fee_cents?: number | null }) =>
      apiClient.patch<{ data: { clientes_afetados: number } }>(`/api/v1/admin/plans/${a.id}`, {
        ...(a.price_cents !== undefined ? { price_cents: a.price_cents } : {}),
        ...(a.setup_fee_cents !== undefined ? { setup_fee_cents: a.setup_fee_cents } : {}),
      }),
    onSuccess: (r) => {
      void atualizar();
      toast.success(
        r.data.clientes_afetados > 0
          ? `${t("Guardado. Vale para")} ${r.data.clientes_afetados} ${t("cliente(s) sem preço acordado, a partir da próxima factura.")}`
          : t("Guardado. Nenhum cliente segue este preço ainda."),
      );
    },
    onError: falhou(t("Não foi possível guardar o preço.")),
  });

  const precoDoExtra = useMutation({
    mutationFn: (a: { id: string; unit_price_cents: number | null }) =>
      apiClient.patch(`/api/v1/admin/billing/addons/${a.id}`, { unit_price_cents: a.unit_price_cents }),
    onSuccess: () => {
      void atualizar();
      toast.success(t("Guardado."));
    },
    onError: falhou(t("Não foi possível guardar o preço.")),
  });

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" />;
  if (isError || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center text-sm text-destructive">
        {t("Não foi possível carregar a faturação. Tente recarregar a página.")}
      </div>
    );
  }
  const r = data.data;

  return (
    <div className="space-y-8" data-testid="faturacao">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Faturação")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Preços dos pacotes e dos extras, e quem deve. Emite, lembra, suspende e reactiva sozinha.")}
        </p>
      </div>

      {/* 1. Ligar */}
      <section className="rounded-lg border bg-card p-5" data-testid="faturacao-configuracao">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("Quem recebe")}</h2>
        {r.config ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="success">{t("Ligada")}</Badge>
            <span>
              {t("Cobra em nome de")} <strong>{r.config.organizacao}</strong> {t("desde")} {r.config.ativaDesde}.
            </span>
            {r.paysuite ? (
              <Badge variant="success">PaySuite {t("configurado")}</Badge>
            ) : (
              <Badge variant="error">PaySuite {t("não configurado")}</Badge>
            )}
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            {t("Desligada: nada é emitido nem suspenso. Escolha a organização que recebe — a que tem o PaySuite configurado.")}
          </p>
        )}
        {r.config && !r.paysuite && (
          <p className="mt-2 text-sm text-error-fg">
            {t("Sem o PaySuite dessa organização as facturas saem sem link de pagamento. Configure-o em Integrações › PaySuite dentro dela.")}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Select value={quemRecebe} onValueChange={setQuemRecebe}>
            <SelectTrigger className="w-64" aria-label={t("Organização que recebe")}>
              <SelectValue placeholder={r.config ? t("Trocar organização…") : t("Organização que recebe…")} />
            </SelectTrigger>
            <SelectContent>
              {(organizacoes.data?.data ?? []).map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={!quemRecebe || ligar.isPending} onClick={() => ligar.mutate()} data-testid="faturacao-ligar">
            {r.config ? t("Trocar") : t("Ligar faturação")}
          </Button>
        </div>
      </section>

      {/* 1b. Transferência bancária */}
      <section className="rounded-lg border bg-card p-5" data-testid="faturacao-transferencia">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("Dados para pagamento directo")}</h2>
        <p className="mb-3 text-sm text-text-muted">
          {t("M-Pesa, e-Mola e cartão pelo link são confirmados sozinhos. O pagamento directo não: escreva aqui os dados do banco (banco, titular, NIB/IBAN) e os números de recepção de M-Pesa e e-Mola, para o cliente os ver, e dê a factura como paga na página do cliente quando o dinheiro entrar. Altere sempre que for preciso.")}
        </p>
        <textarea
          className="min-h-24 w-full rounded-md border bg-background p-3 text-sm"
          aria-label={t("Dados para pagamento directo")}
          maxLength={600}
          value={dadosDoBanco ?? r.instrucoes_de_transferencia ?? ""}
          onChange={(e) => setDadosDoBanco(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={dadosDoBanco === null || dadosDoBanco === (r.instrucoes_de_transferencia ?? "") || guardarTransferencia.isPending}
            onClick={() => guardarTransferencia.mutate(dadosDoBanco?.trim() ? dadosDoBanco : null)}
            data-testid="transferencia-guardar"
          >
            {t("Guardar")}
          </Button>
        </div>
      </section>

      {/* 1c. Avisos do fornecedor */}
      <section className="rounded-lg border bg-card p-5" data-testid="faturacao-avisos">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("Avisos para si, como fornecedor")}</h2>
        <p className="mb-3 text-sm text-text-muted">
          {t("Recebe um e-mail quando um cliente chega aos 80% e ao limite dos tokens de IA. Um endereço por linha (até 10). Vazio = os administradores da plataforma.")}
        </p>
        <textarea
          className="min-h-20 w-full rounded-md border bg-background p-3 text-sm"
          aria-label={t("E-mails que recebem os avisos do fornecedor")}
          value={emailsDoFornecedor ?? r.emails_do_fornecedor.join(String.fromCharCode(10))}
          onChange={(e) => setEmailsDoFornecedor(e.target.value)}
        />
        <div className="mt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={emailsDoFornecedor === null || guardarEmailsDoFornecedor.isPending}
            onClick={() => guardarEmailsDoFornecedor.mutate((emailsDoFornecedor ?? "").split(/[\s,;]+/).filter(Boolean))}
            data-testid="avisos-guardar"
          >
            {t("Guardar")}
          </Button>
        </div>
      </section>

      {/* 2. Totais */}
      <section className="grid gap-4 sm:grid-cols-3" data-testid="faturacao-totais">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t("Em aberto")}</p>
          <p className="mt-1 text-2xl font-semibold">{r.totais.abertas}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t("Vencidas")}</p>
          <p className="mt-1 text-2xl font-semibold">{r.totais.vencidas}</p>
          <p className="text-xs text-muted-foreground">{formatCents(r.totais.vencidas_cents, "MZN")}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t("Suspensas por falta de pagamento")}</p>
          <p className="mt-1 text-2xl font-semibold">{r.totais.suspensas_por_cobranca}</p>
        </div>
      </section>

      {/* 3. Preços globais dos pacotes */}
      <section className="rounded-lg border bg-card p-5" data-testid="faturacao-pacotes">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("Preço dos pacotes")}</h2>
        <p className="mb-4 text-sm text-text-muted">
          {t("Vale para todos os clientes sem preço acordado, a partir da próxima factura. Facturas já emitidas não mudam.")}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4">{t("Pacote")}</th>
                <th className="py-2 pr-4">{t("Mensalidade (MTn)")}</th>
                <th className="py-2 pr-4">{t("Setup (MTn)")}</th>
                <th className="py-2">{t("Clientes")}</th>
              </tr>
            </thead>
            <tbody>
              {r.pacotes.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-3 pr-4 font-medium">{p.display_name}</td>
                  <td className="py-3 pr-4">
                    <CampoDePreco
                      valor={p.price_cents}
                      rotulo={`${t("Mensalidade")} ${p.display_name}`}
                      placeholder={t("sob consulta")}
                      aGuardar={precoDoPacote.isPending}
                      aoGuardar={(c) => precoDoPacote.mutate({ id: p.id, price_cents: c })}
                    />
                  </td>
                  <td className="py-3 pr-4">
                    <CampoDePreco
                      valor={p.setup_fee_cents}
                      rotulo={`${t("Setup")} ${p.display_name}`}
                      placeholder="—"
                      aGuardar={precoDoPacote.isPending}
                      aoGuardar={(c) => precoDoPacote.mutate({ id: p.id, setup_fee_cents: c })}
                    />
                  </td>
                  <td className="py-3 text-text-muted">
                    {p.clientes} ({p.clientes_sem_acordo} {t("seguem este preço")})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3b. O que cada pacote inclui */}
      <section className="rounded-lg border bg-card p-5" data-testid="faturacao-conteudo">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("O que cada pacote inclui")}</h2>
        <p className="mb-4 text-sm text-text-muted">
          {t("Ao contrário do preço, isto vale já para todos os clientes do pacote. Os dados nunca se apagam: a funcionalidade que sai só fica indisponível.")}
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {r.pacotes.map((p) => (
            <ConteudoDoPacote key={`${p.id}-${JSON.stringify(p.limits)}`} pacote={p} />
          ))}
        </div>
      </section>

      {/* 3c. Consumo de IA */}
      <section className="rounded-lg border bg-card p-5" data-testid="faturacao-consumo">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("Consumo de tokens de IA")}</h2>
        <p className="mb-4 text-sm text-text-muted">
          {t("Clientes com quota, do mais perto do limite para o mais longe. A quota renova com a conta.")}
        </p>
        {r.tokens.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhum cliente tem quota definida. Defina os tokens de cada pacote acima.")}</p>
        ) : (
          <ul className="divide-y" data-testid="consumo-lista">
            {r.tokens.map((c) => (
              <li key={c.organization_id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span>{c.organizacao}</span>
                <span className="flex items-center gap-3 text-muted-foreground">
                  {tokensLegiveis(c.consumidos)} / {tokensLegiveis(c.quota)} · {t("renova a")} {dataLegivel(c.renova_a)}
                  <Badge variant={c.nivel === 100 ? "error" : c.nivel === 80 ? "neutral" : "success"}>{c.percentagem}%</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. Catálogo de extras */}
      <section className="rounded-lg border bg-card p-5" data-testid="faturacao-extras">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("Extras")}</h2>
        <p className="mb-4 text-sm text-text-muted">
          {t("O preço aqui é o padrão. Ao contratar um extra a um cliente pode combinar outro preço só para ele. Sem preço, o extra não se vende.")}
        </p>
        <ul className="divide-y">
          {r.extras.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium">{e.description}</p>
                <p className="text-xs text-muted-foreground">
                  {e.recurrence === "monthly" ? t("todos os meses") : t("cobrança única")}
                  {e.unit_price_cents === null && (
                    <span className="ml-2 text-error-fg">{t("preço por definir")}</span>
                  )}
                </p>
              </div>
              <CampoDePreco
                valor={e.unit_price_cents}
                rotulo={`${t("Preço de")} ${e.description}`}
                placeholder={t("por definir")}
                aGuardar={precoDoExtra.isPending}
                aoGuardar={(c) => precoDoExtra.mutate({ id: e.id, unit_price_cents: c })}
              />
            </li>
          ))}
        </ul>
      </section>

      {/* 5. Facturas */}
      <section className="rounded-lg border bg-card p-5" data-testid="faturacao-facturas">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("Facturas recentes")}</h2>
        {r.faturas.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Ainda não há facturas.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4">{t("Cliente")}</th>
                  <th className="py-2 pr-4">{t("Período")}</th>
                  <th className="py-2 pr-4">{t("Vence")}</th>
                  <th className="py-2 pr-4">{t("Valor")}</th>
                  <th className="py-2">{t("Estado")}</th>
                </tr>
              </thead>
              <tbody>
                {r.faturas.map((f) => {
                  const e = ESTADOS[f.status] ?? ESTADOS.open!;
                  return (
                    <tr key={f.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{f.organizacao}</td>
                      <td className="py-2 pr-4">{f.period_start}</td>
                      <td className="py-2 pr-4">{f.due_date}</td>
                      <td className="py-2 pr-4">{formatCents(f.amount_cents, f.currency)}</td>
                      <td className="py-2">
                        <Badge variant={e.variante}>{t(e.rotulo)}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
