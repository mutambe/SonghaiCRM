/**
 * O RESUMO da faturação para o painel do operador (SonghaiCRM, 9010): o que está
 * configurado, quanto cobra cada pacote, quem deve, quem foi suspenso por dívida.
 * Só leitura; filtra por `organization_id` onde a pergunta é de uma organização.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { dataEmMaputo, somarDias } from "@/lib/billing/calculo";
import { instrucoesDeTransferencia, lerConfigDaFaturacao, type ConfigDaFaturacao } from "@/lib/billing/config";
import { estadoDosTokens } from "@/lib/billing/tokens";

export interface PacoteNoResumo {
  id: string;
  slug: string;
  display_name: string;
  price_cents: number | null;
  setup_fee_cents: number | null;
  currency: string;
  /** `plans.limits`: `features` (ausente = todas), `max_users`, `max_whatsapp_connections` (ausente = sem limite). */
  limits: { features?: string[]; max_users?: number; max_whatsapp_connections?: number; ai_tokens_per_account?: number };
  /** Clientes com este pacote vigente. */
  clientes: number;
  /** Destes, quantos seguem o preço do pacote (sem preço acordado): os que uma mudança global alcança. */
  clientes_sem_acordo: number;
}

export interface FaturaNoResumo {
  id: string;
  organization_id: string;
  organizacao: string;
  period_start: string;
  due_date: string;
  amount_cents: number;
  currency: string;
  status: string;
  checkout_url: string | null;
}

export interface ResumoDaFaturacao {
  config: (ConfigDaFaturacao & { organizacao: string }) | null;
  /** Como pagar por transferência bancária (texto do operador), ou `null` se ainda não definiu. */
  instrucoes_de_transferencia: string | null;
  /** Quem recebe os avisos do fornecedor. Vazio = os administradores da plataforma. */
  emails_do_fornecedor: string[];
  /** Consumo de tokens de IA por cliente que tem quota, do mais perto do limite para o mais longe. */
  tokens: Array<{
    organization_id: string;
    organizacao: string;
    consumidos: number;
    quota: number;
    percentagem: number;
    nivel: number;
    renova_a: string;
  }>;
  /** O PaySuite da organização que recebe está configurado? `null` quando não há organização que recebe. */
  paysuite: boolean | null;
  pacotes: PacoteNoResumo[];
  extras: Array<{ id: string; slug: string; description: string; unit_price_cents: number | null; recurrence: string; is_active: boolean }>;
  totais: { abertas: number; vencidas: number; vencidas_cents: number; suspensas_por_cobranca: number };
  faturas: FaturaNoResumo[];
}

export async function resumoDaFaturacao(db: SupabaseClient, agora: Date = new Date()): Promise<ResumoDaFaturacao> {
  const hoje = dataEmMaputo(agora);
  const cfg = await lerConfigDaFaturacao(db);

  let config: ResumoDaFaturacao["config"] = null;
  let paysuite: boolean | null = null;
  if (cfg) {
    const { data: org } = await db.from("organizations").select("display_name").eq("id", cfg.organizationId).maybeSingle();
    config = { ...cfg, organizacao: (org as { display_name?: string } | null)?.display_name ?? "—" };
    const { data: cred } = await db
      .from("payment_credentials")
      .select("organization_id")
      .eq("organization_id", cfg.organizationId)
      .eq("provider", "paysuite")
      .maybeSingle();
    paysuite = Boolean(cred);
  }

  const [{ data: planos }, { data: assinaturas }, { data: extras }, { data: abertas }, { data: recentes }, { data: suspensas }] =
    await Promise.all([
      db.from("plans").select("id, slug, display_name, price_cents, setup_fee_cents, currency, limits").eq("is_active", true).order("price_cents", { ascending: true }),
      db.from("organization_subscriptions").select("plan_id, agreed_price_cents").is("ended_at", null),
      db.from("billing_addons").select("id, slug, description, unit_price_cents, recurrence, is_active").order("sort", { ascending: true }),
      db.from("billing_invoices").select("due_date, amount_cents").eq("status", "open"),
      db
        .from("billing_invoices")
        .select("id, organization_id, period_start, due_date, amount_cents, currency, status, checkout_url, organizations(display_name)")
        .order("issued_at", { ascending: false })
        .limit(50),
      db.from("organizations").select("id").eq("status", "suspended").eq("suspended_kind", "cobranca"),
    ]);

  const porPlano = new Map<string, { clientes: number; semAcordo: number }>();
  for (const a of (assinaturas ?? []) as Array<{ plan_id: string; agreed_price_cents: number | null }>) {
    const atual = porPlano.get(a.plan_id) ?? { clientes: 0, semAcordo: 0 };
    atual.clientes++;
    if (a.agreed_price_cents === null) atual.semAcordo++;
    porPlano.set(a.plan_id, atual);
  }

  const vencidas = ((abertas ?? []) as Array<{ due_date: string; amount_cents: number }>).filter((f) => f.due_date < hoje);

  return {
    config,
    instrucoes_de_transferencia: await instrucoesDeTransferencia(db),
    emails_do_fornecedor: cfg?.emailsDoFornecedor ?? [],
    tokens: await consumoDeTokensPorCliente(db, agora),
    paysuite,
    pacotes: ((planos ?? []) as Array<Omit<PacoteNoResumo, "clientes" | "clientes_sem_acordo">>).map((p) => ({
      ...p,
      clientes: porPlano.get(p.id)?.clientes ?? 0,
      clientes_sem_acordo: porPlano.get(p.id)?.semAcordo ?? 0,
    })),
    extras: (extras ?? []) as ResumoDaFaturacao["extras"],
    totais: {
      abertas: (abertas ?? []).length,
      vencidas: vencidas.length,
      vencidas_cents: vencidas.reduce((s, f) => s + f.amount_cents, 0),
      suspensas_por_cobranca: (suspensas ?? []).length,
    },
    faturas: ((recentes ?? []) as unknown as Array<FaturaNoResumo & { organizations: { display_name: string } | { display_name: string }[] | null }>).map(
      ({ organizations, ...f }) => {
        const org = Array.isArray(organizations) ? organizations[0] : organizations;
        return { ...f, organizacao: org?.display_name ?? "—" };
      },
    ),
  };
}

/**
 * Quanto cada cliente com quota já gastou do seu período. Um cliente que não se
 * consegue medir é saltado (o resumo não cai por causa de um); no máximo 100.
 */
async function consumoDeTokensPorCliente(db: SupabaseClient, agora: Date): Promise<ResumoDaFaturacao["tokens"]> {
  const { data } = await db.from("organization_subscriptions").select("organization_id, organizations(display_name)").is("ended_at", null).limit(100);
  const linhas = (data ?? []) as unknown as Array<{ organization_id: string; organizations: { display_name: string } | { display_name: string }[] | null }>;
  const saida: ResumoDaFaturacao["tokens"] = [];
  for (const l of linhas) {
    try {
      const e = await estadoDosTokens(db, l.organization_id, agora);
      if (!e || e.quota === null) continue;
      const org = Array.isArray(l.organizations) ? l.organizations[0] : l.organizations;
      saida.push({
        organization_id: l.organization_id,
        organizacao: org?.display_name ?? "—",
        consumidos: e.consumidos,
        quota: e.quota,
        percentagem: e.percentagem ?? 0,
        nivel: e.nivel,
        renova_a: somarDias(e.janela.fim, 1),
      });
    } catch {
      continue;
    }
  }
  return saida.sort((a, b) => b.percentagem - a.percentagem);
}
