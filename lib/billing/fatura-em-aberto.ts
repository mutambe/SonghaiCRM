/**
 * A FACTURA QUE O CLIENTE TEM DE VER (SonghaiCRM, 9010): a mais urgente em
 * aberto de UMA organização, para o aviso no topo da aplicação e para a tela de
 * conta suspensa.
 *
 * O aviso na tela é o canal que nunca falha: o e-mail depende de transporte
 * configurado e de o dono ler a caixa de entrada; a tela é onde ele está. É por
 * isso que a régua conta o aviso como dado mesmo que o e-mail não saia.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { DIAS_DE_ANTECEDENCIA, dataEmMaputo, dataPrevistaDaSuspensao, diasEntre, somarDias } from "@/lib/billing/calculo";
import { logger } from "@/lib/logger";

export interface FaturaEmAberto {
  id: string;
  amountCents: number;
  currency: string;
  dueDate: string;
  checkoutUrl: string | null;
  /** Negativo = ainda não venceu (faltam `-atraso` dias). */
  atrasoDias: number;
  /** `AAAA-MM-DD`: quando a conta será suspensa se nada for pago. `null` enquanto não venceu. */
  suspensaoPrevista: string | null;
}

/**
 * Nunca lança: o aviso é acréscimo, e uma falha ao lê-lo não pode derrubar o
 * layout de todas as telas. Só aparece a partir de `DIAS_DE_ANTECEDENCIA` dias
 * antes do vencimento — antes disso seria ruído.
 */
export async function faturaMaisUrgente(
  db: SupabaseClient,
  organizationId: string,
  agora: Date = new Date(),
): Promise<FaturaEmAberto | null> {
  try {
    const hoje = dataEmMaputo(agora);
    const { data, error } = await db
      .from("billing_invoices")
      .select("id, amount_cents, currency, due_date, checkout_url, warned_at")
      .eq("organization_id", organizationId)
      .eq("status", "open")
      .gt("amount_cents", 0)
      .lte("due_date", somarDias(hoje, DIAS_DE_ANTECEDENCIA))
      .order("due_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const f = data as {
      id: string;
      amount_cents: number;
      currency: string;
      due_date: string;
      checkout_url: string | null;
      warned_at: string | null;
    };
    const atrasoDias = diasEntre(hoje, f.due_date);
    return {
      id: f.id,
      amountCents: f.amount_cents,
      currency: f.currency,
      dueDate: f.due_date,
      checkoutUrl: f.checkout_url,
      atrasoDias,
      suspensaoPrevista:
        atrasoDias >= 0 ? dataPrevistaDaSuspensao(f.due_date, f.warned_at ? new Date(f.warned_at) : null, agora) : null,
    };
  } catch (erro) {
    logger.warn("faturação: não deu para ler a factura em aberto", {
      organization_id: organizationId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
}
