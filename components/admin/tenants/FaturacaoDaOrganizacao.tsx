"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { dataLegivel } from "@/lib/billing/emails";
import { somarDias } from "@/lib/billing/calculo";
import { tokensLegiveis, type EstadoDosTokens } from "@/lib/billing/tokens";
import { formatCents, parseReaisToCents } from "@/lib/money";

interface Assinatura {
  id: string;
  agreed_price_cents: number | null;
  agreed_setup_cents: number | null;
  is_pilot: boolean;
  ai_tokens_override: number | null;
  plan: { display_name: string; price_cents: number | null; setup_fee_cents: number | null; currency: string } | null;
}
interface Extra {
  id: string;
  description: string;
  unit_price_cents: number;
  quantity: number;
  recurrence: "monthly" | "once";
  started_on: string;
  ended_on: string | null;
  billed_invoice_id: string | null;
}
interface Fatura {
  id: string;
  period_start: string;
  due_date: string;
  amount_cents: number;
  currency: string;
  status: string;
  checkout_url: string | null;
}
interface Catalogo {
  id: string;
  slug: string;
  description: string;
  unit_price_cents: number | null;
  recurrence: "monthly" | "once";
}
interface Resposta {
  data: { assinatura: Assinatura | null; extras: Extra[]; faturas: Fatura[]; catalogo: Catalogo[]; tokens: EstadoDosTokens | null };
}

const ESTADOS: Record<string, { rotulo: string; variante: "neutral" | "success" | "error" }> = {
  open: { rotulo: "Em aberto", variante: "neutral" },
  paid: { rotulo: "Paga", variante: "success" },
  void: { rotulo: "Anulada", variante: "error" },
};

const paraCampo = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));

/**
 * PREÇO E EXTRAS DE UM CLIENTE — SonghaiCRM, migration 9010.
 *
 * O preço do pacote é global (Faturação); aqui mora o que é só deste cliente: um
 * preço combinado, o piloto e os extras (um número de WhatsApp a mais, etc.). O
 * extra sobe o limite do cliente na hora e entra na factura seguinte — sem
 * segundo passo. Nada disto altera facturas já emitidas.
 */
export function FaturacaoDaOrganizacao({ organizationId }: { organizationId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const chave = ["admin", "tenant", organizationId, "faturacao"];
  const base = `/api/v1/admin/tenants/${organizationId}/billing`;

  const { data, isLoading, isError } = useQuery({ queryKey: chave, queryFn: () => apiClient.get<Resposta>(base) });

  const [preco, setPreco] = useState<string | null>(null);
  const [quotaAcordada, setQuotaAcordada] = useState<string | null>(null);
  const [addon, setAddon] = useState("");
  const [precoDoExtra, setPrecoDoExtra] = useState("");
  const [quantidade, setQuantidade] = useState("1");

  const atualizar = () => queryClient.invalidateQueries({ queryKey: chave });
  const falhou = (titulo: string) => (err: Error) => toast.error(titulo, { description: err.message });

  const termos = useMutation({
    mutationFn: (corpo: { agreed_price_cents?: number | null; is_pilot?: boolean; ai_tokens_override?: number | null }) =>
      apiClient.patch(base, corpo),
    onSuccess: () => {
      setPreco(null);
      setQuotaAcordada(null);
      void atualizar();
      toast.success(t("Guardado. Vale a partir da próxima factura."));
    },
    onError: falhou(t("Não foi possível guardar.")),
  });

  const contratar = useMutation({
    mutationFn: (corpo: { addon_slug: string; unit_price_cents?: number; quantity: number }) => apiClient.post(`${base}/items`, corpo),
    onSuccess: () => {
      setAddon("");
      setPrecoDoExtra("");
      setQuantidade("1");
      void atualizar();
      toast.success(t("Extra contratado. O limite do cliente já subiu e o preço entra na próxima factura."));
    },
    onError: falhou(t("Não foi possível contratar o extra.")),
  });

  const [prazoDe, setPrazoDe] = useState<{ id: string; data: string } | null>(null);
  const [aConfirmarPaga, setAConfirmarPaga] = useState<string | null>(null);
  const fatura = useMutation({
    mutationFn: (a: { id: string; corpo: { due_date: string } | { void: true } | { paid_via: "transferencia" } }) =>
      apiClient.patch<{ data: { reativada: boolean } }>(`${base}/invoices/${a.id}`, a.corpo),
    onSuccess: (r) => {
      setPrazoDe(null);
      setAConfirmarPaga(null);
      void atualizar();
      toast.success(r.data.reativada ? t("Feito. A conta foi reactivada na hora.") : t("Feito."));
    },
    onError: falhou(t("Não foi possível alterar a factura.")),
  });

  const terminar = useMutation({
    mutationFn: (itemId: string) => apiClient.delete(`${base}/items/${itemId}`),
    onSuccess: () => {
      void atualizar();
      toast.success(t("Extra terminado."));
    },
    onError: falhou(t("Não foi possível terminar o extra.")),
  });

  if (isLoading) return <div className="rounded-lg border bg-card p-5 text-sm text-text-muted">{t("Carregando…")}</div>;
  if (isError || !data) {
    return <div className="rounded-lg border bg-card p-5 text-sm text-error-fg">{t("Não foi possível carregar o preço deste cliente.")}</div>;
  }

  const { assinatura, extras, faturas, catalogo, tokens } = data.data;
  if (!assinatura || !assinatura.plan) {
    return (
      <div className="rounded-lg border bg-card p-5" data-testid="faturacao-da-organizacao">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("Preço e extras")}</h2>
        <p className="text-sm text-text-muted">{t("Atribua um pacote primeiro: sem pacote não há o que facturar.")}</p>
      </div>
    );
  }

  const moeda = assinatura.plan.currency;
  const acordado = assinatura.agreed_price_cents !== null;
  const mensalidade = assinatura.agreed_price_cents ?? assinatura.plan.price_cents;
  const campo = preco ?? paraCampo(assinatura.agreed_price_cents);
  const campoCents = campo.trim() === "" ? null : parseReaisToCents(campo);
  const campoInvalido = campo.trim() !== "" && campoCents === null;

  const ativos = extras.filter((e) => e.ended_on === null && !(e.recurrence === "once" && e.billed_invoice_id));
  const escolhido = catalogo.find((c) => c.slug === addon);
  const precoDoExtraCents = precoDoExtra.trim() === "" ? null : parseReaisToCents(precoDoExtra);
  const precoEfetivo = precoDoExtraCents ?? escolhido?.unit_price_cents ?? null;
  const quantidadeN = Number.parseInt(quantidade, 10);
  const podeContratar = Boolean(escolhido) && precoEfetivo !== null && Number.isInteger(quantidadeN) && quantidadeN >= 1;

  return (
    <div className="space-y-5 rounded-lg border bg-card p-5" data-testid="faturacao-da-organizacao">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("Preço e extras")}</h2>

      {/* preço deste cliente */}
      <div className="space-y-2 text-sm">
        <p>
          {t("Mensalidade")}:{" "}
          <strong>{mensalidade === null ? t("sob consulta") : formatCents(mensalidade, moeda)}</strong>{" "}
          <span className="text-text-muted">({acordado ? t("preço acordado com este cliente") : t("preço do pacote")})</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t("Mensalidade acordada (MTn)")}
            className="w-36"
            inputMode="decimal"
            placeholder={t("preço do pacote")}
            value={campo}
            onChange={(e) => setPreco(e.target.value)}
            aria-invalid={campoInvalido}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={campoInvalido || campoCents === assinatura.agreed_price_cents || termos.isPending}
            onClick={() => termos.mutate({ agreed_price_cents: campoCents })}
            data-testid="termos-guardar"
          >
            {t("Guardar")}
          </Button>
          {acordado && (
            <Button size="sm" variant="ghost" disabled={termos.isPending} onClick={() => termos.mutate({ agreed_price_cents: null })}>
              {t("Voltar ao preço do pacote")}
            </Button>
          )}
        </div>
      </div>

      {/* piloto */}
      <div className="flex items-start justify-between gap-4 text-sm">
        <div>
          <p className="font-medium">{t("Piloto")}</p>
          <p className="text-xs text-text-muted">
            {faturas.length > 0
              ? t("Já não se pode mudar: a primeira factura já foi emitida.")
              : t("Setup grátis e 50% na primeira mensalidade, aplicados pelo sistema.")}
          </p>
        </div>
        <Switch
          checked={assinatura.is_pilot}
          disabled={faturas.length > 0 || termos.isPending}
          onCheckedChange={(v) => termos.mutate({ is_pilot: v })}
          aria-label={t("Piloto")}
        />
      </div>

      {/* tokens de IA */}
      <div className="space-y-2 text-sm" data-testid="tokens-do-cliente">
        <p className="font-medium">{t("Tokens de IA neste período")}</p>
        {tokens ? (
          <>
            <p className="text-text-muted">
              {tokensLegiveis(tokens.consumidos)}
              {tokens.quota !== null ? ` / ${tokensLegiveis(tokens.quota)} (${tokens.percentagem}%)` : ` · ${t("sem limite")}`} ·{" "}
              {t("renova a")} {dataLegivel(somarDias(tokens.janela.fim, 1))}
              {tokens.quota !== null && (
                <>
                  {" "}
                  · {tokens.origem === "acordado" ? t("quota acordada com este cliente") : `${tokens.contas} ${t("conta(s) de WhatsApp")} × ${t("quota do pacote")}`}
                </>
              )}
            </p>
            {tokens.quota !== null && (
              <div className="h-2 w-full max-w-sm overflow-hidden rounded bg-muted" aria-hidden>
                <div
                  className={tokens.nivel === 100 ? "h-full bg-error-fg" : "h-full bg-foreground"}
                  style={{ width: `${Math.min(100, tokens.percentagem ?? 0)}%` }}
                />
              </div>
            )}
          </>
        ) : (
          <p className="text-text-muted">{t("Não foi possível medir o consumo agora.")}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t("Quota de tokens acordada com este cliente")}
            className="w-44"
            inputMode="numeric"
            placeholder={t("quota do pacote")}
            value={quotaAcordada ?? (assinatura.ai_tokens_override === null ? "" : String(assinatura.ai_tokens_override))}
            onChange={(e) => setQuotaAcordada(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={
              quotaAcordada === null ||
              termos.isPending ||
              (quotaAcordada.trim() !== "" && !/^[0-9]+$/.test(quotaAcordada.replace(/\s/g, "")))
            }
            onClick={() => termos.mutate({ ai_tokens_override: quotaAcordada!.trim() === "" ? null : Number(quotaAcordada!.replace(/\s/g, "")) })}
            data-testid="quota-guardar"
          >
            {t("Guardar")}
          </Button>
          {assinatura.ai_tokens_override !== null && (
            <Button size="sm" variant="ghost" disabled={termos.isPending} onClick={() => termos.mutate({ ai_tokens_override: null })}>
              {t("Voltar à quota do pacote")}
            </Button>
          )}
        </div>
      </div>

      {/* extras */}
      <div className="space-y-3">
        <p className="text-sm font-medium">{t("Extras contratados")}</p>
        {ativos.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhum extra.")}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {ativos.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  {e.description}
                  {e.quantity > 1 ? ` ×${e.quantity}` : ""}{" "}
                  <span className="text-text-muted">
                    · {formatCents(e.unit_price_cents * e.quantity, moeda)}{" "}
                    {e.recurrence === "monthly" ? t("por mês") : t("uma vez")}
                  </span>
                </span>
                <Button size="sm" variant="ghost" disabled={terminar.isPending} onClick={() => terminar.mutate(e.id)}>
                  {t("Terminar")}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <Select value={addon} onValueChange={(v) => { setAddon(v); setPrecoDoExtra(""); }}>
            <SelectTrigger className="w-60" aria-label={t("Extra")}>
              <SelectValue placeholder={t("Contratar extra…")} />
            </SelectTrigger>
            <SelectContent>
              {catalogo.map((c) => (
                <SelectItem key={c.id} value={c.slug}>
                  {c.description}
                  {c.unit_price_cents === null ? ` (${t("preço por definir")})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label={t("Preço para este cliente (MTn)")}
            className="w-36"
            inputMode="decimal"
            placeholder={escolhido?.unit_price_cents != null ? paraCampo(escolhido.unit_price_cents) : t("preço")}
            value={precoDoExtra}
            onChange={(e) => setPrecoDoExtra(e.target.value)}
            disabled={!escolhido}
          />
          <Input
            aria-label={t("Quantidade")}
            className="w-20"
            inputMode="numeric"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            disabled={!escolhido}
          />
          <Button
            size="sm"
            disabled={!podeContratar || contratar.isPending}
            onClick={() =>
              contratar.mutate({
                addon_slug: addon,
                ...(precoDoExtraCents !== null ? { unit_price_cents: precoDoExtraCents } : {}),
                quantity: quantidadeN,
              })
            }
            data-testid="extra-contratar"
          >
            {t("Contratar")}
          </Button>
        </div>
        {escolhido && precoEfetivo === null && (
          <p className="text-xs text-error-fg">
            {t("Este extra ainda não tem preço padrão. Indique o preço para este cliente, ou defina-o em Faturação.")}
          </p>
        )}
      </div>

      {/* facturas */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("Facturas")}</p>
        {faturas.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Ainda sem facturas.")}</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {faturas.map((f) => {
              const e = ESTADOS[f.status] ?? ESTADOS.open!;
              return (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    {f.period_start} · {t("vence")} {f.due_date}
                  </span>
                  <span className="flex items-center gap-2">
                    {formatCents(f.amount_cents, f.currency)}
                    <Badge variant={e.variante}>{t(e.rotulo)}</Badge>
                    {f.status === "open" && f.checkout_url && (
                      <a className="underline" href={f.checkout_url} target="_blank" rel="noreferrer">
                        {t("link")}
                      </a>
                    )}
                  </span>
                  {f.status === "open" && (
                    <span className="flex w-full flex-wrap items-center gap-2">
                      {prazoDe?.id === f.id ? (
                        <>
                          <Input
                            type="date"
                            aria-label={t("Nova data de vencimento")}
                            className="w-40"
                            value={prazoDe.data}
                            onChange={(e) => setPrazoDe({ id: f.id, data: e.target.value })}
                          />
                          <Button
                            size="sm"
                            disabled={!prazoDe.data || fatura.isPending}
                            onClick={() => fatura.mutate({ id: f.id, corpo: { due_date: prazoDe.data } })}
                            data-testid="prazo-confirmar"
                          >
                            {t("Dar prazo")}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setPrazoDe(null)}>
                            {t("Cancelar")}
                          </Button>
                        </>
                      ) : (
                        <>
                          {aConfirmarPaga === f.id ? (
                            <>
                              <span className="text-xs text-error-fg">
                                {t("Confirma que a transferência de")} {formatCents(f.amount_cents, f.currency)} {t("entrou no banco?")}
                              </span>
                              <Button
                                size="sm"
                                disabled={fatura.isPending}
                                onClick={() => fatura.mutate({ id: f.id, corpo: { paid_via: "transferencia" } })}
                                data-testid="paga-confirmar"
                              >
                                {t("Sim, entrou")}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setAConfirmarPaga(null)}>
                                {t("Cancelar")}
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setAConfirmarPaga(f.id)} data-testid="paga-transferencia">
                              {t("Marcar como paga (transferência)")}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setPrazoDe({ id: f.id, data: "" })}>
                            {t("Dar prazo")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={fatura.isPending}
                            onClick={() => fatura.mutate({ id: f.id, corpo: { void: true } })}
                          >
                            {t("Anular")}
                          </Button>
                        </>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
