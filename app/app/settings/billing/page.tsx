import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { instrucoesDeTransferencia } from "@/lib/billing/config";
import { somarDias } from "@/lib/billing/calculo";
import { estadoDosTokens, tokensLegiveis, type EstadoDosTokens } from "@/lib/billing/tokens";
import { dataLegivel } from "@/lib/billing/emails";
import { emailDeSuporte } from "@/lib/branding/saida";
import { traduzir } from "@/lib/i18n/dicionario";
import { formatCents } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Fatura {
  id: string;
  period_start: string;
  due_date: string;
  amount_cents: number;
  currency: string;
  status: "open" | "paid" | "void";
  checkout_url: string | null;
  billing_invoice_lines: Array<{ position: number; description: string; amount_cents: number }>;
}

/**
 * A FACTURAÇÃO DO CLIENTE — o pacote, os extras e as facturas dele (SonghaiCRM, 9010).
 *
 * Só admin da empresa (a RLS das três tabelas também o exige): dinheiro não é
 * assunto de quem atende. Lê pela sessão — a RLS faz o recorte —, nunca por
 * service role. O link de pagamento da factura aberta está aqui e no aviso que o
 * topo da aplicação mostra enquanto houver o que pagar.
 */
export default async function BillingPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);
  const suporte = await emailDeSuporte();
  // Dados do banco que o operador escreveu (config da instalação, só o servidor lê).
  const dadosDoBanco = await instrucoesDeTransferencia(createAdminClient());

  // O consumo de tokens do período. A soma é um RPC só do servidor, por isso lê com o cliente admin —
  // mas a organização vem da SESSÃO (nunca da URL). Falhar a medir não derruba a página.
  let tokens: EstadoDosTokens | null = null;
  try {
    tokens = await estadoDosTokens(createAdminClient(), activeOrg.orgId);
  } catch {
    tokens = null;
  }

  const supabase = await createClient();
  const [{ data: assinatura }, { data: extras }, { data: faturas }] = await Promise.all([
    supabase
      .from("organization_subscriptions")
      .select("agreed_price_cents, plan:plans(display_name, price_cents, currency)")
      .eq("organization_id", activeOrg.orgId)
      .is("ended_at", null)
      .maybeSingle(),
    supabase
      .from("subscription_items")
      .select("id, description, unit_price_cents, quantity, recurrence")
      .eq("organization_id", activeOrg.orgId)
      .is("ended_on", null)
      .order("started_on", { ascending: true }),
    supabase
      .from("billing_invoices")
      .select("id, period_start, due_date, amount_cents, currency, status, checkout_url, billing_invoice_lines(position, description, amount_cents)")
      .eq("organization_id", activeOrg.orgId)
      .order("period_start", { ascending: false })
      .limit(12),
  ]);

  const plano = (assinatura as { plan: { display_name: string; price_cents: number | null; currency: string } | null; agreed_price_cents: number | null } | null);
  const mensalidade = plano?.agreed_price_cents ?? plano?.plan?.price_cents ?? null;
  const lista = (faturas ?? []) as unknown as Fatura[];
  const ESTADO = {
    open: { rotulo: "Por pagar", variante: "neutral" as const },
    paid: { rotulo: "Paga", variante: "success" as const },
    void: { rotulo: "Anulada", variante: "error" as const },
  };

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-testid="facturacao-do-cliente">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Facturação")}</h1>
        <p className="text-sm text-muted-foreground">{t("O seu pacote, os extras e as facturas.")}</p>
      </header>

      <Card className="max-w-2xl space-y-3 p-6">
        <h2 className="text-sm font-semibold">{t("Pacote")}</h2>
        {plano?.plan ? (
          <>
            <p className="text-sm">
              <strong>{plano.plan.display_name}</strong>
              {mensalidade !== null && <> · {formatCents(mensalidade, plano.plan.currency)} {t("por mês")}</>}
            </p>
            {(extras ?? []).length > 0 && (
              <ul className="divide-y rounded-md border text-sm">
                {(extras ?? []).map((e) => {
                  const x = e as { id: string; description: string; unit_price_cents: number; quantity: number; recurrence: string };
                  return (
                    <li key={x.id} className="flex justify-between px-3 py-2">
                      <span>
                        {x.description}
                        {x.quantity > 1 ? ` ×${x.quantity}` : ""}
                      </span>
                      <span className="text-muted-foreground">
                        {formatCents(x.unit_price_cents * x.quantity, plano.plan!.currency)}{" "}
                        {x.recurrence === "monthly" ? t("por mês") : t("uma vez")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("Ainda não tem um pacote atribuído.")}</p>
        )}
      </Card>

      {tokens && tokens.quota !== null && (
        <Card className="max-w-2xl space-y-3 p-6" data-testid="consumo-de-ia">
          <h2 className="text-sm font-semibold">{t("Consumo de IA")}</h2>
          <p className="text-sm">
            <strong>{tokensLegiveis(tokens.consumidos)}</strong> / {tokensLegiveis(tokens.quota)} {t("tokens")} ({tokens.percentagem}%)
          </p>
          <div className="h-2 w-full overflow-hidden rounded-md bg-muted" aria-hidden>
            <div
              className={tokens.nivel === 100 ? "h-full bg-destructive" : "h-full bg-foreground"}
              style={{ width: `${Math.min(100, tokens.percentagem ?? 0)}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t("O período recomeça a")} {dataLegivel(somarDias(tokens.janela.fim, 1))}. {t("Avisamos aos 80% e quando o limite for atingido.")}
          </p>
        </Card>
      )}

      <Card className="max-w-2xl space-y-3 p-6">
        <h2 className="text-sm font-semibold">{t("Facturas")}</h2>
        {lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Ainda não há facturas.")}</p>
        ) : (
          <ul className="space-y-3">
            {lista.map((f) => {
              const e = ESTADO[f.status] ?? ESTADO.open;
              const linhas = [...(f.billing_invoice_lines ?? [])].sort((a, b) => a.position - b.position);
              return (
                <li key={f.id} className="space-y-2 rounded-md border p-3 text-sm" data-testid="fatura-do-cliente">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {dataLegivel(f.period_start)} · {t("vence a")} {dataLegivel(f.due_date)}
                    </span>
                    <span className="flex items-center gap-2">
                      <strong>{formatCents(f.amount_cents, f.currency)}</strong>
                      <Badge variant={e.variante}>{t(e.rotulo)}</Badge>
                    </span>
                  </div>
                  {f.status === "open" && (
                    <>
                      <ul className="space-y-0.5 text-muted-foreground">
                        {linhas.map((l) => (
                          <li key={l.position} className="flex justify-between">
                            <span>{l.description}</span>
                            <span>{formatCents(l.amount_cents, f.currency)}</span>
                          </li>
                        ))}
                      </ul>
                      {f.checkout_url ? (
                        <a
                          href={f.checkout_url}
                          className="inline-block rounded-md bg-primary px-3 py-1.5 text-primary-foreground"
                          data-testid="pagar-fatura"
                        >
                          {t("Pagar agora (M-Pesa, e-Mola ou cartão)")}
                        </a>
                      ) : (
                        <p className="text-muted-foreground">{t("O link de pagamento está a ser preparado.")}</p>
                      )}
                      {dadosDoBanco && (
                        <div className="rounded-md bg-muted p-3 text-muted-foreground" data-testid="dados-da-transferencia">
                          <p className="font-medium text-foreground">{t("Ou pague directamente (transferência bancária ou números de recepção)")}</p>
                          <p className="whitespace-pre-line">{dadosDoBanco}</p>
                          <p>{t("Depois de transferir, envie o comprovativo: a conta é actualizada assim que a equipa confirmar.")}</p>
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {suporte && (
          <p className="text-sm text-muted-foreground">
            {t("Dúvidas sobre uma factura:")}{" "}
            <a className="underline" href={`mailto:${suporte}`}>
              {suporte}
            </a>
            .
          </p>
        )}
      </Card>
    </div>
  );
}
