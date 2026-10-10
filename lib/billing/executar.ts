/**
 * A RODADA DA FATURAÇÃO — o que corre sozinho, de hora a hora (SonghaiCRM, 9010).
 *
 * Cinco passos, cada um IDEMPOTENTE e independente dos outros (um que falha não
 * impede o seguinte, e a rodada seguinte repete o que faltou):
 *
 *   1. emitir      — factura de cada período devido, com o link de pagamento
 *   2. links       — factura aberta que ficou sem link (o PaySuite estava fora)
 *   3. reconciliar — pergunta ao PaySuite por quem ainda não foi dado como pago
 *   4. régua       — lembrete, aviso final, suspensão (ver `acaoDaRegua`)
 *   5. reactivar   — conta suspensa por cobrança sem dívida vencida volta sozinha
 *
 * Ninguém tem de se lembrar de nada. O webhook do PaySuite só ACELERA o passo 3:
 * se ele falhar, a rodada seguinte descobre o pagamento por si.
 *
 * Tudo o que toca o mundo — o PaySuite, o e-mail, a auditoria — entra por
 * `DependenciasDaRodada`, e é por isso que o fluxo inteiro tem prova sem rede.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  acaoDaRegua,
  dataEmMaputo,
  dataPrevistaDaSuspensao,
  indicesAEmitir,
  somarDias,
  montarLinhas,
  periodoDaFatura,
  vencimentoDaFatura,
  type ItemDeCobranca,
} from "@/lib/billing/calculo";
import type { ConfigDaFaturacao } from "@/lib/billing/config";
import { LIMIARES_DE_TOKENS, estadoDosTokens } from "@/lib/billing/tokens";
import { montarEmail, type DadosDoEmail, type Mensagem, type TipoDeEmail } from "@/lib/billing/emails";
import type { AuditAction } from "@/lib/audit/actions";
import { logger } from "@/lib/logger";

export interface Gateway {
  criar(entrada: { amountCents: number; reference: string; description: string }): Promise<{ id: string; checkoutUrl: string }>;
  consultar(providerPaymentId: string): Promise<"pending" | "paid" | "failed">;
}

export interface DependenciasDaRodada {
  db: SupabaseClient;
  cfg: ConfigDaFaturacao;
  agora: Date;
  /** `null` = o PaySuite da organização que recebe não está configurado. */
  gateway: Gateway | null;
  /** E-mail dos administradores da organização. */
  emailsDosAdmins: (organizationId: string) => Promise<string[]>;
  /** E-mails do fornecedor (quem factura), para os avisos de tokens. Ausente = o fornecedor não é avisado. */
  emailsDoFornecedor?: () => Promise<string[]>;
  /** `false` = não entregou (sem transporte, endereço recusado). Nunca lança. */
  enviarEmail: (para: string[], mensagem: Mensagem) => Promise<boolean>;
  suporte: string | null;
  auditar: (e: {
    action: AuditAction;
    organizationId: string;
    resourceType: string;
    resourceId: string;
    metadata?: Record<string, unknown>;
  }) => void;
}

export interface ResumoDaRodada {
  emitidas: number;
  links: number;
  pagas: number;
  lembretes: number;
  avisos: number;
  suspensas: number;
  reativadas: number;
  /** Avisos de tokens de IA (80% ou 100%) enviados nesta rodada. */
  avisosDeTokens: number;
  erros: number;
}

const ZERO: ResumoDaRodada = {
  emitidas: 0, links: 0, pagas: 0, lembretes: 0, avisos: 0, suspensas: 0, reativadas: 0, avisosDeTokens: 0, erros: 0,
};

export interface FaturaAberta {
  id: string;
  organization_id: string;
  subscription_id: string;
  period_start: string;
  due_date: string;
  amount_cents: number;
  currency: string;
  reference: string;
  provider_payment_id: string | null;
  checkout_url: string | null;
  reminded_at: string | null;
  warned_at: string | null;
}

export const COLUNAS_DA_FATURA =
  "id, organization_id, subscription_id, period_start, due_date, amount_cents, currency, reference, provider_payment_id, checkout_url, reminded_at, warned_at";

/** Só organizações vivas são facturadas. `redacted` e `archived` já não existem para o negócio. */
const ESTADOS_FACTURAVEIS = new Set(["active", "suspended"]);

async function nomeDaOrganizacao(db: SupabaseClient, id: string): Promise<string> {
  const { data } = await db.from("organizations").select("display_name").eq("id", id).maybeSingle();
  return (data as { display_name?: string } | null)?.display_name ?? "a sua empresa";
}

async function enviar(d: DependenciasDaRodada, f: FaturaAberta, tipo: TipoDeEmail, extra: Partial<DadosDoEmail> = {}): Promise<boolean> {
  try {
    const para = await d.emailsDosAdmins(f.organization_id);
    if (para.length === 0) return false;
    const mensagem = montarEmail(tipo, {
      organizacao: await nomeDaOrganizacao(d.db, f.organization_id),
      amountCents: f.amount_cents,
      currency: f.currency,
      vencimento: f.due_date,
      periodo: f.period_start,
      linkDePagamento: f.checkout_url,
      suporte: d.suporte,
      instrucoesDeTransferencia: d.cfg.instrucoesDeTransferencia,
      ...extra,
    });
    return await d.enviarEmail(para, mensagem);
  } catch (erro) {
    logger.warn("faturação: e-mail não saiu", { tipo, detalhe: erro instanceof Error ? erro.message : String(erro) });
    return false;
  }
}

// ─── 1. emitir ──────────────────────────────────────────────────────────────

interface Assinatura {
  id: string;
  organization_id: string;
  started_at: string;
  billing_anchor: string | null;
  agreed_price_cents: number | null;
  agreed_setup_cents: number | null;
  is_pilot: boolean;
  plan: { display_name: string; price_cents: number | null; setup_fee_cents: number | null; currency: string } | null;
}

interface LinhaDeItem {
  id: string;
  description: string;
  unit_price_cents: number;
  quantity: number;
  recurrence: "monthly" | "once";
  started_on: string;
  ended_on: string | null;
  billed_invoice_id: string | null;
}

async function emitir(d: DependenciasDaRodada, resumo: ResumoDaRodada): Promise<void> {
  const hoje = dataEmMaputo(d.agora);
  const { data: subs, error } = await d.db
    .from("organization_subscriptions")
    .select(
      "id, organization_id, started_at, billing_anchor, agreed_price_cents, agreed_setup_cents, is_pilot, plan:plans(display_name, price_cents, setup_fee_cents, currency)",
    )
    .is("ended_at", null)
    .eq("status", "active");
  if (error) throw new Error(`emitir: ${error.message}`);

  const assinaturas = ((subs ?? []) as unknown as Assinatura[]).filter(
    (s) => s.plan && s.organization_id !== d.cfg.organizationId,
  );
  if (assinaturas.length === 0) return;

  const { data: orgs } = await d.db
    .from("organizations")
    .select("id, status")
    .in("id", assinaturas.map((s) => s.organization_id));
  const estado = new Map(((orgs ?? []) as Array<{ id: string; status: string }>).map((o) => [o.id, o.status]));

  for (const sub of assinaturas) {
    if (!ESTADOS_FACTURAVEIS.has(estado.get(sub.organization_id) ?? "")) continue;
    const plano = sub.plan!;
    const ancora = sub.billing_anchor ?? dataEmMaputo(sub.started_at);

    const { data: feitas } = await d.db.from("billing_invoices").select("period_start").eq("organization_id", sub.organization_id);
    const jaEmitidos = new Set(((feitas ?? []) as Array<{ period_start: string }>).map((f) => f.period_start));
    const indices = indicesAEmitir({ hoje, inicio: ancora, ativaDesde: d.cfg.ativaDesde, jaEmitidos });
    if (indices.length === 0) continue;

    const { data: linhasDeItem } = await d.db.from("subscription_items").select("*").eq("organization_id", sub.organization_id);
    const itens: ItemDeCobranca[] = ((linhasDeItem ?? []) as LinhaDeItem[]).map((i) => ({
      id: i.id,
      description: i.description,
      unitPriceCents: i.unit_price_cents,
      quantity: i.quantity,
      recurrence: i.recurrence,
      startedOn: i.started_on,
      endedOn: i.ended_on,
      billedInvoiceId: i.billed_invoice_id,
    }));

    for (const indice of indices) {
      const periodo = periodoDaFatura(ancora, indice);
      const linhas = montarLinhas({
        indice,
        periodoInicio: periodo.inicio,
        periodoFim: periodo.fim,
        planoNome: plano.display_name,
        planoPriceCents: plano.price_cents,
        planoSetupCents: plano.setup_fee_cents,
        agreedPriceCents: sub.agreed_price_cents,
        agreedSetupCents: sub.agreed_setup_cents,
        isPilot: sub.is_pilot,
        itens,
      });
      if (!linhas) continue; // sem preço: a organização fica isenta, nunca cobrada em zero

      const referencia = `fat-${sub.organization_id.slice(0, 8)}-${periodo.inicio}`;
      const { data: id, error: erroDaEmissao } = await d.db.rpc("fn_emitir_fatura", {
        p_org: sub.organization_id,
        p_sub: sub.id,
        p_period_start: periodo.inicio,
        p_period_end: periodo.fim,
        p_due: vencimentoDaFatura({ indice, inicioDoPeriodo: periodo.inicio, hoje }),
        p_currency: plano.currency,
        p_reference: referencia,
        p_lines: linhas.map((l) => ({
          kind: l.kind,
          description: l.description,
          amount_cents: l.amountCents,
          item_id: l.itemId ?? null,
        })),
      });
      if (erroDaEmissao) throw new Error(`emitir ${referencia}: ${erroDaEmissao.message}`);
      if (!id) continue; // já existia (outra rodada, ao mesmo tempo): nada a fazer

      resumo.emitidas++;
      const { data: fatura } = await d.db.from("billing_invoices").select(COLUNAS_DA_FATURA).eq("id", id as string).single();
      const f = fatura as unknown as FaturaAberta;
      d.auditar({
        action: "billing.invoice_issued",
        organizationId: f.organization_id,
        resourceType: "billing_invoice",
        resourceId: f.id,
        metadata: { period_start: f.period_start, amount_cents: f.amount_cents, due_date: f.due_date, pilot: sub.is_pilot && indice === 0 },
      });

      if (f.amount_cents === 0) {
        // Nada a pagar (piloto a zero, cliente isento): fecha-se sozinha, sem e-mail.
        await d.db.rpc("fn_marcar_fatura_paga", { p_invoice: f.id, p_provider_payment_id: null });
        continue;
      }
      const comLink = await criarLink(d, f, resumo);
      await enviar(d, comLink, "fatura_nova");
    }
  }
}

// ─── 2. links ───────────────────────────────────────────────────────────────

async function criarLink(d: DependenciasDaRodada, f: FaturaAberta, resumo: ResumoDaRodada): Promise<FaturaAberta> {
  if (!d.gateway || f.checkout_url) return f;
  try {
    const criado = await d.gateway.criar({
      amountCents: f.amount_cents,
      reference: f.reference,
      description: `Factura ${f.period_start}`.slice(0, 125),
    });
    const { error } = await d.db
      .from("billing_invoices")
      .update({ provider_payment_id: criado.id, checkout_url: criado.checkoutUrl })
      .eq("id", f.id)
      .is("provider_payment_id", null);
    if (error) throw new Error(error.message);
    resumo.links++;
    return { ...f, provider_payment_id: criado.id, checkout_url: criado.checkoutUrl };
  } catch (erro) {
    // A factura existe; só falta o link. A rodada seguinte tenta de novo.
    logger.warn("faturação: não deu para criar o link de pagamento", {
      factura: f.id,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return f;
  }
}

async function garantirLinks(d: DependenciasDaRodada, resumo: ResumoDaRodada): Promise<void> {
  if (!d.gateway) return;
  const { data } = await d.db
    .from("billing_invoices")
    .select(COLUNAS_DA_FATURA)
    .eq("status", "open")
    .is("checkout_url", null)
    .gt("amount_cents", 0);
  for (const f of (data ?? []) as unknown as FaturaAberta[]) {
    const comLink = await criarLink(d, f, resumo);
    if (comLink.checkout_url) await enviar(d, comLink, "fatura_nova");
  }
}

// ─── 3. reconciliar ─────────────────────────────────────────────────────────

/** Dá a factura como paga, reactiva a conta se era isso que a prendia, e agradece. Idempotente. */
export async function registrarPagamentoDeFatura(
  d: DependenciasDaRodada,
  f: FaturaAberta,
  resumo: ResumoDaRodada = { ...ZERO },
  /** Por onde entrou o dinheiro. A transferência bancária é dada como paga por uma pessoa. */
  via: "paysuite" | "transferencia" = "paysuite",
  /** Quem deu a transferência como paga e a referência do comprovativo — vai à auditoria. */
  nota?: { ator?: string; referencia?: string },
): Promise<boolean> {
  const { data, error } = await d.db.rpc("fn_marcar_fatura_paga", {
    p_invoice: f.id,
    p_provider_payment_id: f.provider_payment_id,
    p_via: via,
  });
  if (error) throw new Error(`marcar paga ${f.id}: ${error.message}`);
  if (!(data as { changed?: boolean } | null)?.changed) return false;

  resumo.pagas++;
  d.auditar({
    action: "billing.invoice_paid",
    organizationId: f.organization_id,
    resourceType: "billing_invoice",
    resourceId: f.id,
    metadata: {
      amount_cents: f.amount_cents,
      period_start: f.period_start,
      via,
      ...(nota?.ator ? { marked_by: nota.ator } : {}),
      ...(nota?.referencia ? { proof_reference: nota.referencia } : {}),
    },
  });
  await enviar(d, f, "pagamento_recebido");
  await reativarSePago(d, f.organization_id, resumo);
  return true;
}

async function reconciliar(d: DependenciasDaRodada, resumo: ResumoDaRodada): Promise<void> {
  if (!d.gateway) return;
  const { data } = await d.db
    .from("billing_invoices")
    .select(COLUNAS_DA_FATURA)
    .eq("status", "open")
    .not("provider_payment_id", "is", null)
    .order("due_date", { ascending: true })
    .limit(200);
  for (const f of (data ?? []) as unknown as FaturaAberta[]) {
    let estado: "pending" | "paid" | "failed";
    try {
      estado = await d.gateway.consultar(f.provider_payment_id!);
    } catch (erro) {
      logger.warn("faturação: o PaySuite não respondeu", { factura: f.id, detalhe: erro instanceof Error ? erro.message : String(erro) });
      continue;
    }
    if (estado === "paid") await registrarPagamentoDeFatura(d, f, resumo);
    else if (estado === "failed") await renovarLink(d, f);
  }
}

/**
 * O pagamento falhou no PaySuite (cartão recusado, M-Pesa sem saldo, expirou): o
 * link antigo está morto. Solta-o e muda a referência — o PaySuite trata a
 * referência como chave de idempotência e devolveria o mesmo pagamento falhado —,
 * e o passo "links" cria um novo na mesma rodada ou na seguinte.
 */
async function renovarLink(d: DependenciasDaRodada, f: FaturaAberta): Promise<void> {
  const nova = `${f.reference.slice(0, 36)}-${d.agora.getTime().toString(36)}`.slice(0, 50);
  await d.db
    .from("billing_invoices")
    .update({ provider_payment_id: null, checkout_url: null, reference: nova })
    .eq("id", f.id)
    .eq("status", "open")
    .eq("provider_payment_id", f.provider_payment_id);
}

// ─── 4. régua ───────────────────────────────────────────────────────────────

async function aplicarRegua(d: DependenciasDaRodada, resumo: ResumoDaRodada): Promise<void> {
  const hoje = dataEmMaputo(d.agora);
  const { data } = await d.db
    .from("billing_invoices")
    .select(COLUNAS_DA_FATURA)
    .eq("status", "open")
    .lte("due_date", hoje)
    .gt("amount_cents", 0);
  const abertas = (data ?? []) as unknown as FaturaAberta[];
  if (abertas.length === 0) return;

  const { data: orgs } = await d.db.from("organizations").select("id, status").in("id", [...new Set(abertas.map((f) => f.organization_id))]);
  const estado = new Map(((orgs ?? []) as Array<{ id: string; status: string }>).map((o) => [o.id, o.status]));

  for (const f of abertas) {
    if (!ESTADOS_FACTURAVEIS.has(estado.get(f.organization_id) ?? "")) continue;
    const acao = acaoDaRegua({
      hoje,
      agora: d.agora,
      vencimento: f.due_date,
      remindedAt: f.reminded_at ? new Date(f.reminded_at) : null,
      warnedAt: f.warned_at ? new Date(f.warned_at) : null,
    });
    if (!acao) continue;

    if (acao === "lembrar") {
      const { data: marcada } = await d.db
        .from("billing_invoices")
        .update({ reminded_at: d.agora.toISOString() })
        .eq("id", f.id)
        .is("reminded_at", null)
        .select("id")
        .maybeSingle();
      if (!marcada) continue; // outra rodada foi mais rápida
      resumo.lembretes++;
      d.auditar({ action: "billing.reminder_sent", organizationId: f.organization_id, resourceType: "billing_invoice", resourceId: f.id, metadata: { due_date: f.due_date } });
      await enviar(d, f, "lembrete");
    } else if (acao === "avisar") {
      const { data: marcada } = await d.db
        .from("billing_invoices")
        .update({ warned_at: d.agora.toISOString() })
        .eq("id", f.id)
        .is("warned_at", null)
        .select("id")
        .maybeSingle();
      if (!marcada) continue;
      resumo.avisos++;
      const quando = dataPrevistaDaSuspensao(f.due_date, null, d.agora);
      d.auditar({ action: "billing.warning_sent", organizationId: f.organization_id, resourceType: "billing_invoice", resourceId: f.id, metadata: { suspension_planned_on: quando } });
      await enviar(d, f, "aviso_final", { suspensaoPrevista: quando });
    } else {
      const { data: resultado, error } = await d.db.rpc("fn_suspender_organizacao", {
        p_org: f.organization_id,
        p_kind: "cobranca",
        p_motivo: `Factura de ${f.period_start} por pagar desde ${f.due_date}`,
        p_ator: null,
      });
      if (error) throw new Error(`suspender ${f.organization_id}: ${error.message}`);
      await d.db.from("billing_invoices").update({ suspended_at: d.agora.toISOString() }).eq("id", f.id).is("suspended_at", null);
      if ((resultado as { changed?: boolean } | null)?.changed) {
        resumo.suspensas++;
        d.auditar({ action: "billing.org_suspended", organizationId: f.organization_id, resourceType: "organization", resourceId: f.organization_id, metadata: { invoice_id: f.id, due_date: f.due_date } });
        await enviar(d, f, "suspensa");
      }
    }
  }
}

// ─── 5. reactivar ───────────────────────────────────────────────────────────

/**
 * Reactiva a organização se ela está suspensa POR COBRANÇA e já não deve nada
 * vencido. Suspensão administrativa nunca é tocada: essa é decisão de uma pessoa.
 */
export async function reativarSePago(
  d: DependenciasDaRodada,
  organizationId: string,
  resumo: ResumoDaRodada = { ...ZERO },
): Promise<void> {
  const hoje = dataEmMaputo(d.agora);
  const { data: org } = await d.db.from("organizations").select("status, suspended_kind").eq("id", organizationId).maybeSingle();
  const o = org as { status: string; suspended_kind: string | null } | null;
  if (!o || o.status !== "suspended" || o.suspended_kind !== "cobranca") return;

  const { data: devidas } = await d.db
    .from("billing_invoices")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .lt("due_date", hoje)
    .gt("amount_cents", 0);
  if ((devidas ?? []).length > 0) return;

  const { data: resultado, error } = await d.db.rpc("fn_reativar_organizacao", {
    p_org: organizationId,
    p_kind_exigido: "cobranca",
    p_ator: null,
  });
  if (error) throw new Error(`reativar ${organizationId}: ${error.message}`);
  if (!(resultado as { changed?: boolean } | null)?.changed) return;

  resumo.reativadas++;
  d.auditar({ action: "billing.org_reactivated", organizationId, resourceType: "organization", resourceId: organizationId, metadata: { motivo: "pagamento_recebido" } });
  const fake: FaturaAberta = {
    id: "", organization_id: organizationId, subscription_id: "", period_start: hoje, due_date: hoje,
    amount_cents: 0, currency: "MZN", reference: "", provider_payment_id: null, checkout_url: null, reminded_at: null, warned_at: null,
  };
  await enviar(d, fake, "reativada");
}

async function reativarQuemPagou(d: DependenciasDaRodada, resumo: ResumoDaRodada): Promise<void> {
  const { data } = await d.db.from("organizations").select("id").eq("status", "suspended").eq("suspended_kind", "cobranca");
  for (const o of (data ?? []) as Array<{ id: string }>) await reativarSePago(d, o.id, resumo);
}

// ─── 6. tokens de IA ────────────────────────────────────────────────────────

/**
 * Avisa quando uma organização chega a 80% e a 100% da quota de tokens do período.
 *
 * Cada nível sai UMA vez por período (`ai_token_alerts` tem `unique` por
 * organização, período e nível). Se o consumo salta de 50% para 120% numa hora, os
 * dois níveis ficam registados mas só o mais alto gera mensagem: dois e-mails
 * seguidos a dizer a mesma coisa em graus diferentes é ruído. Quem a recebe: os
 * administradores do cliente e o fornecedor. Só avisa — não corta o serviço.
 */
export async function vigiarTokens(d: DependenciasDaRodada, resumo: ResumoDaRodada): Promise<void> {
  const { data: subs } = await d.db.from("organization_subscriptions").select("organization_id").is("ended_at", null).eq("status", "active");
  const ids = [...new Set(((subs ?? []) as Array<{ organization_id: string }>).map((s) => s.organization_id))].filter(
    (id) => id !== d.cfg.organizationId,
  );
  if (ids.length === 0) return;

  const { data: orgs } = await d.db.from("organizations").select("id, status, display_name").in("id", ids);
  const vivas = ((orgs ?? []) as Array<{ id: string; status: string; display_name: string }>).filter((o) => ESTADOS_FACTURAVEIS.has(o.status));

  for (const org of vivas) {
    let estado;
    try {
      estado = await estadoDosTokens(d.db, org.id, d.agora);
    } catch (erro) {
      resumo.erros++;
      logger.error("faturação: não deu para medir os tokens", { organization_id: org.id, detalhe: erro instanceof Error ? erro.message : String(erro) });
      continue;
    }
    if (!estado || estado.quota === null || estado.nivel === 0) continue;

    const novos: number[] = [];
    for (const nivel of LIMIARES_DE_TOKENS) {
      if (nivel > estado.nivel) continue;
      const { data: linha } = await d.db
        .from("ai_token_alerts")
        .upsert(
          {
            organization_id: org.id,
            window_start: estado.janela.inicio,
            window_end: estado.janela.fim,
            level: nivel,
            consumed_tokens: estado.consumidos,
            quota_tokens: estado.quota,
          },
          { onConflict: "organization_id,window_start,level", ignoreDuplicates: true },
        )
        .select("id");
      if ((linha ?? []).length > 0) novos.push(nivel);
    }
    if (novos.length === 0) continue;

    const nivelDoAviso = Math.max(...novos) as 80 | 100;
    resumo.avisosDeTokens++;
    d.auditar({
      action: "billing.tokens_alert",
      organizationId: org.id,
      resourceType: "organization",
      resourceId: org.id,
      metadata: { level: nivelDoAviso, consumed_tokens: estado.consumidos, quota_tokens: estado.quota, window_end: estado.janela.fim },
    });

    const dados: DadosDoEmail = {
      organizacao: org.display_name,
      amountCents: 0,
      currency: "MZN",
      vencimento: estado.janela.fim,
      periodo: estado.janela.inicio,
      suporte: d.suporte,
      tokens: {
        consumidos: estado.consumidos,
        quota: estado.quota,
        percentagem: estado.percentagem ?? nivelDoAviso,
        renovaA: somarDias(estado.janela.fim, 1),
      },
    };
    try {
      const clientes = await d.emailsDosAdmins(org.id);
      if (clientes.length > 0) await d.enviarEmail(clientes, montarEmail(nivelDoAviso === 100 ? "tokens_100" : "tokens_80", dados));
      const fornecedor = (await d.emailsDoFornecedor?.()) ?? [];
      if (fornecedor.length > 0) {
        await d.enviarEmail(fornecedor, montarEmail(nivelDoAviso === 100 ? "fornecedor_tokens_100" : "fornecedor_tokens_80", dados));
      }
    } catch (erro) {
      logger.warn("faturação: e-mail de tokens não saiu", { organization_id: org.id, detalhe: erro instanceof Error ? erro.message : String(erro) });
    }
  }
}

// ─── a rodada ───────────────────────────────────────────────────────────────

export async function rodarFaturacao(d: DependenciasDaRodada): Promise<ResumoDaRodada> {
  const resumo: ResumoDaRodada = { ...ZERO };
  const passos: Array<[string, () => Promise<void>]> = [
    ["emitir", () => emitir(d, resumo)],
    // Reconciliar ANTES dos links: um pagamento falhado solta o link, e o passo
    // seguinte cria o novo na mesma rodada.
    ["reconciliar", () => reconciliar(d, resumo)],
    ["links", () => garantirLinks(d, resumo)],
    ["regua", () => aplicarRegua(d, resumo)],
    ["reativar", () => reativarQuemPagou(d, resumo)],
    ["tokens", () => vigiarTokens(d, resumo)],
  ];
  for (const [nome, passo] of passos) {
    try {
      await passo();
    } catch (erro) {
      resumo.erros++;
      logger.error(`faturação: o passo "${nome}" falhou`, { detalhe: erro instanceof Error ? erro.message : String(erro) });
    }
  }
  return resumo;
}
