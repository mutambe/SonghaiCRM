/**
 * A ADMINISTRAÇÃO DOS PREÇOS — o que o operador muda, e onde (SonghaiCRM, 9010).
 *
 * Três níveis, do mais largo ao mais estreito, e nenhum toca em factura emitida:
 *
 *   1. GLOBAL      preço do pacote (`plans`) e preço padrão dos extras (`billing_addons`)
 *   2. POR CLIENTE preço e setup acordados, e o piloto (`organization_subscriptions`)
 *   3. EXTRAS      o que um cliente contratou a mais (`subscription_items`)
 *
 * Aqui só há regra e escrita no banco; as rotas (`app/api/v1/admin/...`) são a
 * borda — autorização, Zod, auditoria — e a tela é de quem opera.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { dataEmMaputo, somarDias } from "@/lib/billing/calculo";
import { ehFuncionalidadeDoPlano } from "@/lib/plans/funcionalidades";

export interface Resultado<T> {
  ok: boolean;
  /** Código estável, para a rota traduzir em HTTP e a tela em frase. */
  erro?: string;
  dados?: T;
}

const falha = <T>(erro: string): Resultado<T> => ({ ok: false, erro });
const sucesso = <T>(dados: T): Resultado<T> => ({ ok: true, dados });

// ─── 1. global ──────────────────────────────────────────────────────────────

export interface PrecoDoPacote {
  /** `null` em `price_cents` = sob consulta (Enterprise). */
  price_cents?: number | null;
  setup_fee_cents?: number | null;
}

/**
 * Muda o preço de um pacote para todos os clientes SEM preço acordado, a partir
 * da PRÓXIMA factura. Devolve quantos clientes serão afectados, para a tela
 * dizer o que o clique faz antes e depois de o fazer.
 */
export async function alterarPrecoDoPacote(
  db: SupabaseClient,
  planId: string,
  entrada: PrecoDoPacote,
): Promise<Resultado<{ antes: PrecoDoPacote; depois: PrecoDoPacote; clientesAfetados: number }>> {
  const { data: atual } = await db.from("plans").select("id, price_cents, setup_fee_cents").eq("id", planId).maybeSingle();
  if (!atual) return falha("plano_nao_encontrado");
  // Cópia, e não a própria linha: o que "era" tem de sobreviver ao update.
  const linha = atual as { price_cents: number | null; setup_fee_cents: number | null };
  const antes = { price_cents: linha.price_cents, setup_fee_cents: linha.setup_fee_cents };

  const mudanca: Record<string, number | null> = {};
  if (entrada.price_cents !== undefined) mudanca.price_cents = entrada.price_cents;
  if (entrada.setup_fee_cents !== undefined) mudanca.setup_fee_cents = entrada.setup_fee_cents;
  if (Object.keys(mudanca).length === 0) return falha("nada_a_alterar");

  const { error } = await db.from("plans").update(mudanca).eq("id", planId);
  if (error) return falha("banco_recusou");

  const { data: afetados } = await db
    .from("organization_subscriptions")
    .select("id")
    .eq("plan_id", planId)
    .is("ended_at", null)
    .is("agreed_price_cents", null);

  return sucesso({
    antes: { price_cents: antes.price_cents, setup_fee_cents: antes.setup_fee_cents },
    depois: { price_cents: antes.price_cents, setup_fee_cents: antes.setup_fee_cents, ...mudanca },
    clientesAfetados: (afetados ?? []).length,
  });
}

export interface PrecoDoExtra {
  unit_price_cents?: number | null;
  is_active?: boolean;
}

export async function alterarExtraDoCatalogo(
  db: SupabaseClient,
  addonId: string,
  entrada: PrecoDoExtra,
): Promise<Resultado<{ id: string }>> {
  const mudanca: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (entrada.unit_price_cents !== undefined) mudanca.unit_price_cents = entrada.unit_price_cents;
  if (entrada.is_active !== undefined) mudanca.is_active = entrada.is_active;
  if (Object.keys(mudanca).length === 1) return falha("nada_a_alterar");
  const { data, error } = await db.from("billing_addons").update(mudanca).eq("id", addonId).select("id").maybeSingle();
  if (error) return falha("banco_recusou");
  if (!data) return falha("extra_nao_encontrado");
  return sucesso({ id: addonId });
}

// ─── 2. por cliente ─────────────────────────────────────────────────────────

export interface TermosDoCliente {
  agreed_price_cents?: number | null;
  agreed_setup_cents?: number | null;
  is_pilot?: boolean;
  /** Quota MENSAL de tokens de IA acordada só com este cliente (total da organização). `null` = vale a do pacote. */
  ai_tokens_override?: number | null;
}

/**
 * Preço e setup acordados com ESTE cliente, e o piloto. O piloto só se muda
 * antes de a primeira factura existir: depois dela o desconto já foi (ou não foi)
 * dado, e mudá-lo agora só criaria uma inconsistência entre a flag e a história.
 */
export async function alterarTermosDoCliente(
  db: SupabaseClient,
  organizationId: string,
  entrada: TermosDoCliente,
): Promise<Resultado<{ assinaturaId: string }>> {
  const { data: sub } = await db
    .from("organization_subscriptions")
    .select("id, is_pilot")
    .eq("organization_id", organizationId)
    .is("ended_at", null)
    .maybeSingle();
  if (!sub) return falha("sem_assinatura");
  const assinatura = sub as { id: string; is_pilot: boolean };

  const mudanca: Record<string, unknown> = {};
  if (entrada.agreed_price_cents !== undefined) mudanca.agreed_price_cents = entrada.agreed_price_cents;
  if (entrada.agreed_setup_cents !== undefined) mudanca.agreed_setup_cents = entrada.agreed_setup_cents;
  if (entrada.ai_tokens_override !== undefined) {
    if (entrada.ai_tokens_override !== null && (!Number.isInteger(entrada.ai_tokens_override) || entrada.ai_tokens_override < 1)) {
      return falha("limite_invalido");
    }
    mudanca.ai_tokens_override = entrada.ai_tokens_override;
  }
  if (entrada.is_pilot !== undefined && entrada.is_pilot !== assinatura.is_pilot) {
    const { data: feitas } = await db.from("billing_invoices").select("id").eq("organization_id", organizationId).limit(1);
    if ((feitas ?? []).length > 0) return falha("piloto_ja_nao_se_aplica");
    mudanca.is_pilot = entrada.is_pilot;
  }
  if (Object.keys(mudanca).length === 0) return falha("nada_a_alterar");

  const { error } = await db.from("organization_subscriptions").update(mudanca).eq("id", assinatura.id);
  if (error) return falha("banco_recusou");
  return sucesso({ assinaturaId: assinatura.id });
}

// ─── 3. extras ──────────────────────────────────────────────────────────────

export interface NovoExtra {
  /** Do catálogo (`billing_addons.slug`). Ausente = extra à medida, com descrição e preço próprios. */
  addon_slug?: string;
  description?: string;
  /** Preço unitário PARA ESTE CLIENTE. Ausente = o padrão do catálogo. */
  unit_price_cents?: number;
  quantity?: number;
  recurrence?: "monthly" | "once";
}

interface LinhaDoCatalogo {
  description: string;
  kind: "whatsapp_extra" | "user_extra" | "custom";
  unit_price_cents: number | null;
  recurrence: "monthly" | "once";
  adds_whatsapp_connections: number;
  adds_users: number;
  is_active: boolean;
}

/**
 * Contrata um extra a um cliente. Os limites que o extra acrescenta
 * (`adds_whatsapp_connections`, `adds_users`) vêm do catálogo e sobem o teto do
 * cliente na hora (`limitesDoTenant`); o preço entra na factura seguinte.
 */
export async function adicionarExtra(
  db: SupabaseClient,
  organizationId: string,
  entrada: NovoExtra,
  ator: string,
  hoje: string = dataEmMaputo(new Date()),
): Promise<Resultado<{ id: string }>> {
  const { data: sub } = await db
    .from("organization_subscriptions")
    .select("id")
    .eq("organization_id", organizationId)
    .is("ended_at", null)
    .maybeSingle();
  if (!sub) return falha("sem_assinatura");

  let base: LinhaDoCatalogo;
  if (entrada.addon_slug) {
    const { data } = await db.from("billing_addons").select("*").eq("slug", entrada.addon_slug).maybeSingle();
    if (!data) return falha("extra_nao_encontrado");
    base = data as unknown as LinhaDoCatalogo;
    if (!base.is_active) return falha("extra_desativado");
  } else {
    if (!entrada.description || entrada.unit_price_cents === undefined || !entrada.recurrence) {
      return falha("extra_incompleto");
    }
    base = {
      description: entrada.description,
      kind: "custom",
      unit_price_cents: entrada.unit_price_cents,
      recurrence: entrada.recurrence,
      adds_whatsapp_connections: 0,
      adds_users: 0,
      is_active: true,
    };
  }

  const preco = entrada.unit_price_cents ?? base.unit_price_cents;
  // Nunca vender um extra sem preço: o padrão por definir não vira zero em silêncio.
  if (preco === null || preco === undefined) return falha("preco_por_definir");

  const { data: criado, error } = await db
    .from("subscription_items")
    .insert({
      organization_id: organizationId,
      kind: base.kind,
      description: (entrada.description ?? base.description).slice(0, 120),
      unit_price_cents: preco,
      quantity: entrada.quantity ?? 1,
      recurrence: entrada.recurrence ?? base.recurrence,
      adds_whatsapp_connections: base.adds_whatsapp_connections,
      adds_users: base.adds_users,
      started_on: hoje,
      created_by: ator,
    })
    .select("id")
    .single();
  if (error || !criado) return falha("banco_recusou");
  return sucesso({ id: (criado as { id: string }).id });
}

/**
 * Acaba um extra. Nunca apaga: a história das facturas aponta para ele. O
 * recorrente deixa de ser cobrado a partir do período seguinte e o teto do
 * cliente desce; o pontual ainda não facturado fica sem efeito. Já facturado não
 * se desfaz aqui (é dinheiro emitido).
 */
export async function terminarExtra(
  db: SupabaseClient,
  organizationId: string,
  itemId: string,
  hoje: string = dataEmMaputo(new Date()),
): Promise<Resultado<{ id: string }>> {
  const { data } = await db
    .from("subscription_items")
    .select("id, recurrence, started_on, ended_on, billed_invoice_id")
    .eq("id", itemId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return falha("extra_nao_encontrado");
  const item = data as { id: string; recurrence: string; started_on: string; ended_on: string | null; billed_invoice_id: string | null };
  if (item.ended_on) return falha("extra_ja_terminado");
  if (item.recurrence === "once" && item.billed_invoice_id) return falha("extra_ja_facturado");

  // Pontual por facturar: acaba no próprio dia de início e a factura ignora-o.
  // Recorrente: acaba ONTEM, para o teto do cliente descer já; o período em curso,
  // se já facturado, não é reembolsado, e os seguintes não o levam. Nunca antes do
  // início (a base proíbe `ended_on < started_on`).
  const ontem = somarDias(hoje, -1);
  const fim = item.recurrence === "once" ? item.started_on : ontem < item.started_on ? item.started_on : ontem;
  const { error } = await db
    .from("subscription_items")
    .update({ ended_on: fim })
    .eq("id", itemId)
    .eq("organization_id", organizationId)
    .is("ended_on", null);
  if (error) return falha("banco_recusou");
  return sucesso({ id: itemId });
}

// ─── 4. dar prazo / anular ─────────────────────────────────────────────────

/** Quanto se pode adiar um vencimento de uma vez: negociar não é perdoar. */
export const MAXIMO_DE_DIAS_DE_PRAZO = 60;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Dá mais prazo a UMA factura em aberto. A régua recomeça do zero para ela (o
 * lembrete e o aviso final voltam a valer em relação à data nova) — senão a conta
 * seria suspensa por um aviso que já não é verdade. Se a conta estava suspensa
 * por falta de pagamento, a rota reactiva-a na hora.
 */
export async function darPrazo(
  db: SupabaseClient,
  organizationId: string,
  invoiceId: string,
  novaData: string,
  hoje: string = dataEmMaputo(new Date()),
): Promise<Resultado<{ dueDate: string }>> {
  if (!DATA.test(novaData)) return falha("data_invalida");
  if (novaData < hoje) return falha("data_no_passado");
  if (novaData > somarDias(hoje, MAXIMO_DE_DIAS_DE_PRAZO)) return falha("prazo_demasiado_longo");

  const { data } = await db
    .from("billing_invoices")
    .select("id, status, due_date")
    .eq("id", invoiceId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return falha("fatura_nao_encontrada");
  const f = data as { id: string; status: string; due_date: string };
  if (f.status !== "open") return falha("fatura_nao_aberta");
  if (novaData <= f.due_date) return falha("prazo_nao_avanca");

  const { error } = await db
    .from("billing_invoices")
    .update({ due_date: novaData, reminded_at: null, warned_at: null, suspended_at: null })
    .eq("id", invoiceId)
    .eq("organization_id", organizationId)
    .eq("status", "open");
  if (error) return falha("banco_recusou");
  return sucesso({ dueDate: novaData });
}

/** Anula uma factura em aberto (engano, acordo). Paga não se anula: é dinheiro que entrou. */
export async function anularFatura(
  db: SupabaseClient,
  organizationId: string,
  invoiceId: string,
): Promise<Resultado<{ id: string }>> {
  const { data } = await db
    .from("billing_invoices")
    .select("id, status")
    .eq("id", invoiceId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return falha("fatura_nao_encontrada");
  if ((data as { status: string }).status !== "open") return falha("fatura_nao_aberta");
  const { error } = await db
    .from("billing_invoices")
    .update({ status: "void" })
    .eq("id", invoiceId)
    .eq("organization_id", organizationId)
    .eq("status", "open");
  if (error) return falha("banco_recusou");
  return sucesso({ id: invoiceId });
}

// ─── 5. o que o pacote inclui ───────────────────────────────────────────────

export interface ConteudoDoPacote {
  /** Lista = exactamente estas. `null` = todas (como o Enterprise). */
  features?: readonly string[] | null;
  /** Teto de utilizadores. `null` = sem limite. */
  max_users?: number | null;
  /** Teto de números de WhatsApp. `null` = sem limite. */
  max_whatsapp_connections?: number | null;
  /** Tokens de IA por mês, POR CONTA de WhatsApp. `null` = sem limite (e sem aviso). */
  ai_tokens_per_account?: number | null;
}

/**
 * Muda o que um pacote INCLUI — funcionalidades e limites. Ao contrário do
 * preço, isto vale NA HORA para todos os clientes do pacote (o plano é lido a
 * cada pedido): por isso devolve quantos são. Dado nenhum se apaga; a
 * funcionalidade que sai só fica indisponível e volta se for posta de novo.
 *
 * Chave ausente em `plans.limits` significa "sem limite" / "todas"; é assim que
 * `null` se grava.
 */
export async function alterarConteudoDoPacote(
  db: SupabaseClient,
  planId: string,
  entrada: ConteudoDoPacote,
): Promise<Resultado<{ limites: Record<string, unknown>; clientesAfetados: number }>> {
  const { data } = await db.from("plans").select("id, limits").eq("id", planId).maybeSingle();
  if (!data) return falha("plano_nao_encontrado");

  const limites: Record<string, unknown> = { ...(((data as { limits: Record<string, unknown> | null }).limits) ?? {}) };
  let mudou = false;

  if (entrada.features !== undefined) {
    if (entrada.features === null) delete limites.features;
    else {
      const validas = entrada.features.filter(ehFuncionalidadeDoPlano);
      if (validas.length !== entrada.features.length) return falha("funcionalidade_desconhecida");
      limites.features = [...new Set(validas)];
    }
    mudou = true;
  }
  for (const chave of ["max_users", "max_whatsapp_connections", "ai_tokens_per_account"] as const) {
    const v = entrada[chave];
    if (v === undefined) continue;
    if (v === null) delete limites[chave];
    else if (!Number.isInteger(v) || v < 1) return falha("limite_invalido");
    else limites[chave] = v;
    mudou = true;
  }
  if (!mudou) return falha("nada_a_alterar");

  const { error } = await db.from("plans").update({ limits: limites }).eq("id", planId);
  if (error) return falha("banco_recusou");

  const { data: afetados } = await db
    .from("organization_subscriptions")
    .select("id")
    .eq("plan_id", planId)
    .is("ended_at", null);
  return sucesso({ limites, clientesAfetados: (afetados ?? []).length });
}
