/**
 * A QUOTA DE TOKENS DE IA POR CONTA (SonghaiCRM, 9011).
 *
 * O site promete a cada pacote uma quantidade mensal de tokens, ligada a cada
 * conta de WhatsApp. Aqui está a conta:
 *
 *   quota da organização = tokens por conta (do pacote) × contas de WhatsApp contratadas
 *                          — ou o valor ACORDADO só com este cliente, que vence
 *
 * Contratadas = o limite do pacote + os extras (um número a mais sobe a quota na
 * hora). Pacote sem teto de números (Enterprise) conta as contas que existem.
 *
 * ─── O período é o ciclo de facturação ──────────────────────────────────────
 * A quota renova quando a conta renova: o período é o da facturação (ancorado no
 * dia em que o cliente começou), e não o mês do calendário. Sem facturação, vale
 * o mês do calendário — o mesmo que o orçamento em dinheiro usa.
 *
 * ─── O que conta ────────────────────────────────────────────────────────────
 * Tokens de entrada + saída de cada chamada de IA (`llm_calls`). O cache de
 * prompt não conta: é desconto do fornecedor, não consumo do cliente.
 *
 * ─── O que NÃO faz ──────────────────────────────────────────────────────────
 * Só mede e avisa. Não corta o serviço: para cortar existe o orçamento em
 * dinheiro (Uso › orçamento), que é outra régua e outra decisão.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { dataEmMaputo, limitesAcrescentadosPelosExtras, periodoDaFatura, somarDias } from "@/lib/billing/calculo";

export const LIMIARES_DE_TOKENS = [80, 100] as const;
export type LimiarDeTokens = (typeof LIMIARES_DE_TOKENS)[number];
export type NivelDeTokens = 0 | LimiarDeTokens;

export interface JanelaDeTokens {
  /** `AAAA-MM-DD`, primeiro dia (inclusive). */
  inicio: string;
  /** `AAAA-MM-DD`, último dia (inclusive). */
  fim: string;
}

/** O período de facturação, de índice qualquer, que contém `hoje`. */
export function periodoQueContem(ancora: string, hoje: string): JanelaDeTokens {
  if (hoje < ancora) return periodoDaFatura(ancora, 0);
  const [a1, m1] = ancora.split("-").map(Number);
  const [a2, m2] = hoje.split("-").map(Number);
  let i = Math.max(0, (a2! - a1!) * 12 + (m2! - m1!));
  while (i > 0 && periodoDaFatura(ancora, i).inicio > hoje) i--;
  while (periodoDaFatura(ancora, i).fim < hoje) i++;
  return periodoDaFatura(ancora, i);
}

/** O período da quota: o ciclo de facturação, ou o mês do calendário se não há ciclo. */
export function janelaDeTokens(hoje: string, ancora: string | null): JanelaDeTokens {
  if (ancora) return periodoQueContem(ancora, hoje);
  const [a, m] = hoje.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a!, m!, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { inicio: `${a}-${mm}-01`, fim: `${a}-${mm}-${String(ultimo).padStart(2, "0")}` };
}

export type OrigemDaQuota = "acordado" | "pacote" | "sem_limite";

/**
 * A quota da organização. O valor acordado vence tudo; sem ele, tokens por conta ×
 * contas; sem nenhum dos dois, não há limite (`null`) — nunca zero.
 */
export function quotaDeTokens(e: {
  porConta: number | null;
  contas: number;
  override: number | null;
}): { quota: number | null; origem: OrigemDaQuota } {
  if (e.override !== null) return { quota: e.override, origem: "acordado" };
  if (e.porConta !== null) return { quota: e.porConta * Math.max(1, e.contas), origem: "pacote" };
  return { quota: null, origem: "sem_limite" };
}

export function percentagemDeTokens(consumidos: number, quota: number | null): number | null {
  if (quota === null || quota <= 0) return null;
  return Math.floor((consumidos * 100) / quota);
}

/** O maior limiar já atingido: 100, 80 ou 0 (nenhum). */
export function nivelAtingido(consumidos: number, quota: number | null): NivelDeTokens {
  const pct = percentagemDeTokens(consumidos, quota);
  if (pct === null) return 0;
  if (pct >= 100) return 100;
  if (pct >= 80) return 80;
  return 0;
}

/** `1 234 567` — milhares separados por espaço, que é como se lê em Moçambique. */
export function tokensLegiveis(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export interface EstadoDosTokens {
  /** Total da organização neste período. `null` = sem limite. */
  quota: number | null;
  origem: OrigemDaQuota;
  /** Contas de WhatsApp que contam para a quota do pacote. */
  contas: number;
  consumidos: number;
  /** `null` = sem limite. Pode passar de 100. */
  percentagem: number | null;
  nivel: NivelDeTokens;
  janela: JanelaDeTokens;
}

/** Instante de Maputo à meia-noite do dia. */
function inicioDoDia(data: string): Date {
  return new Date(`${data}T00:00:00+02:00`);
}

/**
 * O estado dos tokens de UMA organização. `null` quando ela não tem assinatura
 * vigente (sem pacote não há quota). Lê pela organização dada, sempre com
 * `organization_id` explícito. Lança se o banco recusar: quem chama decide.
 */
export async function estadoDosTokens(
  db: SupabaseClient,
  organizationId: string,
  agora: Date = new Date(),
): Promise<EstadoDosTokens | null> {
  const hoje = dataEmMaputo(agora);

  const { data: sub, error } = await db
    .from("organization_subscriptions")
    .select("started_at, billing_anchor, ai_tokens_override, plan:plans(limits)")
    .eq("organization_id", organizationId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw new Error(`tokens: ${error.message}`);
  if (!sub) return null;

  const s = sub as unknown as {
    started_at: string;
    billing_anchor: string | null;
    ai_tokens_override: number | null;
    plan: { limits: Record<string, unknown> | null } | null;
  };
  const limites = s.plan?.limits ?? {};
  const porConta = typeof limites.ai_tokens_per_account === "number" ? limites.ai_tokens_per_account : null;

  // Contas contratadas: o limite do pacote + os extras. Sem teto no pacote, as que existem.
  const { data: extras } = await db
    .from("subscription_items")
    .select("quantity, adds_whatsapp_connections, adds_users, started_on, ended_on")
    .eq("organization_id", organizationId);
  const somaExtras = limitesAcrescentadosPelosExtras(
    (Array.isArray(extras) ? extras : []).map((l: Record<string, unknown>) => ({
      quantity: Number(l.quantity),
      addsWhatsappConnections: Number(l.adds_whatsapp_connections),
      addsUsers: Number(l.adds_users),
      startedOn: String(l.started_on),
      endedOn: (l.ended_on as string | null) ?? null,
    })),
    hoje,
  );
  let contas: number;
  if (typeof limites.max_whatsapp_connections === "number") {
    contas = limites.max_whatsapp_connections + somaExtras.whatsapp;
  } else {
    const { data: sessoes } = await db.from("channel_sessions").select("id").eq("organization_id", organizationId);
    contas = Math.max(1, Array.isArray(sessoes) ? sessoes.length : 1);
  }

  const { quota, origem } = quotaDeTokens({ porConta, contas, override: s.ai_tokens_override });
  const janela = janelaDeTokens(hoje, s.billing_anchor ?? dataEmMaputo(s.started_at));

  const { data: soma, error: erroDaSoma } = await db.rpc("fn_tokens_de_ia_no_periodo", {
    p_org: organizationId,
    p_from: inicioDoDia(janela.inicio).toISOString(),
    p_to: inicioDoDia(somarDias(janela.fim, 1)).toISOString(),
  });
  if (erroDaSoma) throw new Error(`tokens: ${erroDaSoma.message}`);
  const consumidos = Number(soma ?? 0);

  return {
    quota,
    origem,
    contas,
    consumidos,
    percentagem: percentagemDeTokens(consumidos, quota),
    nivel: nivelAtingido(consumidos, quota),
    janela,
  };
}

export interface AvisoDeTokens {
  nivel: LimiarDeTokens;
  consumidos: number;
  quota: number;
  /** `AAAA-MM-DD`: quando o período recomeça. */
  renovaA: string;
}

/**
 * O aviso de tokens que vale HOJE para uma organização, lido do que a rodada já
 * registou — uma consulta indexada, barata para pôr no layout de toda página.
 * É o retrato da hora do aviso, e não uma medição nova: a medição exacta está na
 * página de facturação. Nunca lança (o aviso é acréscimo, não pode derrubar a tela).
 */
export async function avisoDeTokensAtual(
  db: SupabaseClient,
  organizationId: string,
  agora: Date = new Date(),
): Promise<AvisoDeTokens | null> {
  try {
    const hoje = dataEmMaputo(agora);
    const { data } = await db
      .from("ai_token_alerts")
      .select("level, consumed_tokens, quota_tokens, window_end")
      .eq("organization_id", organizationId)
      .gte("window_end", hoje)
      .lte("window_start", hoje)
      .order("level", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const a = data as { level: number; consumed_tokens: number; quota_tokens: number; window_end: string };
    if (a.level !== 80 && a.level !== 100) return null;
    return { nivel: a.level, consumidos: Number(a.consumed_tokens), quota: Number(a.quota_tokens), renovaA: somarDias(a.window_end, 1) };
  } catch {
    return null;
  }
}
