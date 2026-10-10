/**
 * A CONFIGURAÇÃO DA FATURAÇÃO — o que a instalação guarda em `platform_config`.
 *
 * Duas chaves, ambas não secretas:
 * - `BILLING_ORGANIZATION_ID`: a organização que RECEBE (a da Songhai). As
 *   credenciais do PaySuite são as dessa organização — as mesmas que ela já
 *   configura em Integrações › PaySuite para cobrar os clientes dela.
 * - `BILLING_ATIVA_DESDE`: o dia em que a faturação foi ligada. Períodos que
 *   começaram antes não se cobram (ver `indicesAEmitir`), para ligar isto numa
 *   instalação com clientes antigos não fazer chover facturas do passado.
 *
 * Sem `BILLING_ORGANIZATION_ID` a faturação está DESLIGADA: nada se emite, nada
 * se suspende, e quem opera vê o aviso na tela. Falha fechada, como os módulos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { dataEmMaputo } from "@/lib/billing/calculo";
import { logger } from "@/lib/logger";

export const CHAVE_DA_ORGANIZACAO_QUE_RECEBE = "BILLING_ORGANIZATION_ID";
export const CHAVE_DA_ATIVACAO = "BILLING_ATIVA_DESDE";
/** Os dados para pagar por transferência bancária (banco, titular, NIB/IBAN). Texto livre, que o operador escreve. */
export const CHAVE_DAS_INSTRUCOES_DE_TRANSFERENCIA = "BILLING_TRANSFER_INSTRUCTIONS";
export const TAMANHO_MAXIMO_DAS_INSTRUCOES = 600;
/** Para onde vão os avisos AO FORNECEDOR (tokens a esgotar). Vazio = os administradores da plataforma. */
export const CHAVE_DOS_EMAILS_DO_FORNECEDOR = "BILLING_PROVIDER_EMAILS";
export const MAXIMO_DE_EMAILS_DO_FORNECEDOR = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Separa por vírgula, ponto e vírgula, espaço ou linha; descarta o que não é e-mail; sem repetidos. */
export function lerEmails(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const partes = texto.split(/[,;\s]+/).map((p) => p.trim().toLowerCase()).filter((p) => EMAIL.test(p));
  return [...new Set(partes)];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export interface ConfigDaFaturacao {
  /** A organização que recebe. */
  organizationId: string;
  /** `AAAA-MM-DD` em Maputo. */
  ativaDesde: string;
  /** Como pagar por transferência bancária, ou `null` se o operador não definiu. Vai nas facturas e nos e-mails. */
  instrucoesDeTransferencia: string | null;
  /** Quem recebe os avisos do fornecedor (tokens a esgotar). Vazio = os administradores da plataforma. */
  emailsDoFornecedor: string[];
}

/** `null` = faturação desligada (não configurada). Nunca lança. */
export async function lerConfigDaFaturacao(db: SupabaseClient): Promise<ConfigDaFaturacao | null> {
  try {
    const { data, error } = await db
      .from("platform_config")
      .select("chave, valor")
      .in("chave", [
        CHAVE_DA_ORGANIZACAO_QUE_RECEBE,
        CHAVE_DA_ATIVACAO,
        CHAVE_DAS_INSTRUCOES_DE_TRANSFERENCIA,
        CHAVE_DOS_EMAILS_DO_FORNECEDOR,
      ]);
    if (error) {
      logger.error("faturação: não deu para ler a configuração", { detalhe: error.message });
      return null;
    }
    const mapa = new Map((data ?? []).map((l) => [(l as { chave: string }).chave, (l as { valor: string | null }).valor]));
    const org = mapa.get(CHAVE_DA_ORGANIZACAO_QUE_RECEBE);
    if (!org || !UUID.test(org)) return null;
    const desde = mapa.get(CHAVE_DA_ATIVACAO);
    const instrucoes = mapa.get(CHAVE_DAS_INSTRUCOES_DE_TRANSFERENCIA)?.trim();
    return {
      organizationId: org,
      ativaDesde: desde && DATA.test(desde) ? desde : dataEmMaputo(new Date()),
      instrucoesDeTransferencia: instrucoes ? instrucoes : null,
      emailsDoFornecedor: lerEmails(mapa.get(CHAVE_DOS_EMAILS_DO_FORNECEDOR)),
    };
  } catch (erro) {
    logger.error("faturação: leitura da configuração falhou", {
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
}

/**
 * Liga a faturação (ou troca a organização que recebe). A data de activação só é
 * gravada na PRIMEIRA vez: trocar a organização que recebe não pode reabrir o
 * passado.
 */
export async function gravarConfigDaFaturacao(
  db: SupabaseClient,
  organizationId: string,
  ator: string,
  hoje: string = dataEmMaputo(new Date()),
): Promise<boolean> {
  const { data: existente } = await db
    .from("platform_config")
    .select("valor")
    .eq("chave", CHAVE_DA_ATIVACAO)
    .maybeSingle();
  const linhas = [
    { chave: CHAVE_DA_ORGANIZACAO_QUE_RECEBE, valor: organizationId },
    ...(existente ? [] : [{ chave: CHAVE_DA_ATIVACAO, valor: hoje }]),
  ].map((l) => ({ ...l, eh_segredo: false, semeado_do_env: false, updated_by: ator }));
  const { error } = await db.from("platform_config").upsert(linhas, { onConflict: "chave" });
  if (error) {
    logger.error("faturação: não deu para gravar a configuração", { detalhe: error.message });
    return false;
  }
  return true;
}

/**
 * Grava (ou apaga, com `null` ou texto vazio) os dados para pagar por
 * transferência bancária. O sistema não os valida nem os interpreta: são texto
 * que o operador escreve e que o cliente lê.
 */
export async function gravarInstrucoesDeTransferencia(
  db: SupabaseClient,
  texto: string | null,
  ator: string,
): Promise<boolean> {
  const limpo = texto?.trim() ?? "";
  if (limpo === "") {
    const { error } = await db.from("platform_config").delete().eq("chave", CHAVE_DAS_INSTRUCOES_DE_TRANSFERENCIA);
    return !error;
  }
  if (limpo.length > TAMANHO_MAXIMO_DAS_INSTRUCOES) return false;
  const { error } = await db.from("platform_config").upsert(
    { chave: CHAVE_DAS_INSTRUCOES_DE_TRANSFERENCIA, valor: limpo, eh_segredo: false, semeado_do_env: false, updated_by: ator },
    { onConflict: "chave" },
  );
  if (error) logger.error("faturação: não deu para gravar as instruções de transferência", { detalhe: error.message });
  return !error;
}

/** Só as instruções, para telas que não precisam do resto da configuração. Nunca lança. */
export async function instrucoesDeTransferencia(db: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await db.from("platform_config").select("valor").eq("chave", CHAVE_DAS_INSTRUCOES_DE_TRANSFERENCIA).maybeSingle();
    const v = (data as { valor?: string | null } | null)?.valor?.trim();
    return v ? v : null;
  } catch {
    return null;
  }
}

/**
 * Grava a lista de e-mails que recebe os avisos do fornecedor. Lista vazia apaga
 * (e os avisos voltam aos administradores da plataforma). Devolve `false` se algum
 * item não for e-mail ou houver mais do que o máximo — nada se grava pela metade.
 */
export async function gravarEmailsDoFornecedor(db: SupabaseClient, emails: readonly string[], ator: string): Promise<boolean> {
  const limpos = lerEmails(emails.join(" "));
  if (limpos.length !== new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)).size) return false;
  if (limpos.length > MAXIMO_DE_EMAILS_DO_FORNECEDOR) return false;
  if (limpos.length === 0) {
    const { error } = await db.from("platform_config").delete().eq("chave", CHAVE_DOS_EMAILS_DO_FORNECEDOR);
    return !error;
  }
  const { error } = await db.from("platform_config").upsert(
    { chave: CHAVE_DOS_EMAILS_DO_FORNECEDOR, valor: limpos.join(", "), eh_segredo: false, semeado_do_env: false, updated_by: ator },
    { onConflict: "chave" },
  );
  if (error) logger.error("faturação: não deu para gravar os e-mails do fornecedor", { detalhe: error.message });
  return !error;
}
