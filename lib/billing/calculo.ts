/**
 * FATURAÇÃO DOS PACOTES — o cálculo, sem banco e sem relógio (SonghaiCRM, 9010).
 *
 * Tudo aqui é função pura: recebe o que leu e devolve o que decidiu. Quem lê o
 * banco, chama o PaySuite e envia e-mail está em `lib/billing/executar.ts`. A
 * separação existe para o dinheiro poder ser provado caso a caso, sem Postgres.
 *
 * ─── Os dois níveis de preço ─────────────────────────────────────────────────
 * - GLOBAL: `plans.price_cents` / `setup_fee_cents`. Mudar o preço do pacote vale
 *   para todo cliente SEM preço acordado, a partir da PRÓXIMA factura.
 * - POR CLIENTE: `agreed_price_cents` / `agreed_setup_cents` na assinatura, e os
 *   EXTRAS (`subscription_items`, p. ex. um número de WhatsApp a mais). O preço
 *   acordado vence o do pacote; o extra soma-se a ele.
 *
 * Factura emitida NUNCA muda: o preço novo só alcança facturas ainda por emitir.
 *
 * ─── Datas ───────────────────────────────────────────────────────────────────
 * Datas de calendário são texto `AAAA-MM-DD` no fuso de Maputo (`FUSO_PADRAO`),
 * nunca `Date` solto: o servidor corre em UTC, e "hoje" em UTC não é "hoje" para
 * quem paga em Maputo (UTC+2, sem horário de verão).
 */
import { FUSO_PADRAO } from "@/lib/tempo/fusos";

/** Dias de antecedência com que a factura de um período é emitida. */
export const DIAS_DE_ANTECEDENCIA = 5;
/** Dias para pagar a PRIMEIRA factura (a do setup), contados da emissão. */
export const DIAS_PARA_PAGAR_A_PRIMEIRA = 5;
/** Dias de atraso em que o aviso final sai. */
export const DIAS_DO_AVISO = 3;
/** Dias de atraso em que a conta é suspensa (se o aviso saiu há ≥ 48 h). */
export const DIAS_DA_SUSPENSAO = 7;
/** Intervalo mínimo entre o aviso final e a suspensão. */
export const HORAS_ENTRE_AVISO_E_SUSPENSAO = 48;
/** Desconto do piloto sobre a mensalidade do primeiro mês. */
export const PERCENTUAL_DO_PILOTO = 50;

// ─── datas ──────────────────────────────────────────────────────────────────

/** `AAAA-MM-DD` de um instante, no fuso de Maputo. */
export function dataEmMaputo(instante: Date | string): string {
  const d = typeof instante === "string" ? new Date(instante) : instante;
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_PADRAO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")}`;
}

function paraUtc(data: string): Date {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a!, m! - 1, d!));
}

function deUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Soma dias a uma data de calendário. */
export function somarDias(data: string, dias: number): string {
  const d = paraUtc(data);
  d.setUTCDate(d.getUTCDate() + dias);
  return deUtc(d);
}

/** Dias inteiros de `b` a `a` (positivo se `a` é depois de `b`). */
export function diasEntre(a: string, b: string): number {
  return Math.round((paraUtc(a).getTime() - paraUtc(b).getTime()) / 86_400_000);
}

/**
 * Soma meses mantendo o dia, e encosta no fim do mês quando ele não existe:
 * 31 de Janeiro + 1 mês = 28 (ou 29) de Fevereiro. É a conta de TODA a
 * periodicidade, a partir da data de início — nunca mês a mês encadeado, senão o
 * dia 31 derivaria para o 28 e ficaria lá.
 */
export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const alvo = new Date(Date.UTC(a!, m! - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d!, ultimo));
  return deUtc(alvo);
}

/** O período de índice `i` (0 = o primeiro) de uma assinatura iniciada em `inicio`. */
export function periodoDaFatura(inicio: string, indice: number): { inicio: string; fim: string } {
  return {
    inicio: somarMeses(inicio, indice),
    // o período acaba na véspera do seguinte
    fim: somarDias(somarMeses(inicio, indice + 1), -1),
  };
}

/**
 * Que períodos já devem ter factura e ainda não têm.
 *
 * - O período `i` é emitido `DIAS_DE_ANTECEDENCIA` antes de começar; o primeiro
 *   (`i = 0`) é emitido logo.
 * - `ativaDesde` é o dia em que a facturação foi ligada. Período que COMEÇOU
 *   antes dele não é cobrado: sem isto, ligar a facturação numa instalação com
 *   clientes de meses faria chover facturas do passado.
 * - Devolve índices por ordem; a cobrança de vários de uma vez só acontece se o
 *   relógio ficou parado, e aí cada um é, de facto, devido.
 */
export function indicesAEmitir(entrada: {
  hoje: string;
  inicio: string;
  ativaDesde: string;
  jaEmitidos: ReadonlySet<string>;
  /** Fim da assinatura (troca de plano / cancelamento); nada se emite depois dele. */
  fim?: string | null;
}): number[] {
  const { hoje, inicio, ativaDesde, jaEmitidos, fim } = entrada;
  const indices: number[] = [];
  for (let i = 0; i < 600; i++) {
    const { inicio: comeca } = periodoDaFatura(inicio, i);
    const emissao = i === 0 ? comeca : somarDias(comeca, -DIAS_DE_ANTECEDENCIA);
    if (emissao > hoje) break;
    if (fim && comeca > fim) break;
    if (comeca < ativaDesde) continue;
    if (jaEmitidos.has(comeca)) continue;
    indices.push(i);
  }
  return indices;
}

/** Vencimento: o início do período; a primeira factura ganha prazo a contar de hoje. */
export function vencimentoDaFatura(entrada: { indice: number; inicioDoPeriodo: string; hoje: string }): string {
  const { indice, inicioDoPeriodo, hoje } = entrada;
  if (indice === 0) return somarDias(hoje > inicioDoPeriodo ? hoje : inicioDoPeriodo, DIAS_PARA_PAGAR_A_PRIMEIRA);
  return inicioDoPeriodo;
}

// ─── linhas ─────────────────────────────────────────────────────────────────

export interface ItemDeCobranca {
  id: string;
  description: string;
  unitPriceCents: number;
  quantity: number;
  recurrence: "monthly" | "once";
  /** `AAAA-MM-DD` em Maputo. */
  startedOn: string;
  endedOn: string | null;
  /** Para `once`: a factura que já o cobrou. */
  billedInvoiceId: string | null;
}

export type TipoDeLinha = "plano" | "setup" | "extra" | "desconto";

export interface LinhaDaFatura {
  kind: TipoDeLinha;
  description: string;
  /** Pode ser negativo (desconto). */
  amountCents: number;
  itemId?: string;
}

export interface EntradaDasLinhas {
  indice: number;
  periodoInicio: string;
  periodoFim: string;
  planoNome: string;
  planoPriceCents: number | null;
  planoSetupCents: number | null;
  agreedPriceCents: number | null;
  agreedSetupCents: number | null;
  isPilot: boolean;
  itens: readonly ItemDeCobranca[];
}

/** A mensalidade que vale: o preço acordado vence o do pacote. `null` = sem preço (Enterprise sob consulta). */
export function mensalidadeQueVale(planoPriceCents: number | null, agreedPriceCents: number | null): number | null {
  return agreedPriceCents ?? planoPriceCents;
}

/**
 * As linhas da factura de um período, ou `null` quando não há o que cobrar (sem
 * preço nenhum — a organização fica isenta, nunca cobrada em zero).
 */
export function montarLinhas(e: EntradaDasLinhas): LinhaDaFatura[] | null {
  const base = mensalidadeQueVale(e.planoPriceCents, e.agreedPriceCents);
  if (base === null) return null;

  const linhas: LinhaDaFatura[] = [
    { kind: "plano", description: `${e.planoNome} — mensalidade`, amountCents: base },
  ];

  if (e.indice === 0) {
    const setup = e.agreedSetupCents ?? e.planoSetupCents ?? 0;
    if (setup > 0) {
      linhas.push({ kind: "setup", description: "Setup (pagamento único)", amountCents: setup });
      if (e.isPilot) {
        linhas.push({ kind: "desconto", description: "Piloto — setup grátis", amountCents: -setup });
      }
    }
    if (e.isPilot && base > 0) {
      linhas.push({
        kind: "desconto",
        description: `Piloto — ${PERCENTUAL_DO_PILOTO}% de desconto no primeiro mês`,
        amountCents: -Math.round((base * PERCENTUAL_DO_PILOTO) / 100),
      });
    }
  }

  for (const item of e.itens) {
    const total = item.unitPriceCents * item.quantity;
    const rotulo = `${item.description}${item.quantity > 1 ? ` (×${item.quantity})` : ""}`;
    if (item.recurrence === "monthly") {
      const ativo = item.startedOn <= e.periodoFim && (item.endedOn === null || item.endedOn >= e.periodoInicio);
      if (ativo && total > 0) linhas.push({ kind: "extra", description: `Extra: ${rotulo}`, amountCents: total, itemId: item.id });
    } else if (item.billedInvoiceId === null && item.endedOn === null && item.startedOn <= e.periodoFim && total > 0) {
      linhas.push({ kind: "extra", description: `Extra (pontual): ${rotulo}`, amountCents: total, itemId: item.id });
    }
  }

  return linhas;
}

export function totalDasLinhas(linhas: readonly LinhaDaFatura[]): number {
  return Math.max(0, linhas.reduce((soma, l) => soma + l.amountCents, 0));
}

// ─── limites que os extras somam ─────────────────────────────────────────────

export interface ItemComLimites {
  quantity: number;
  addsWhatsappConnections: number;
  addsUsers: number;
  endedOn: string | null;
  startedOn: string;
}

/**
 * O que os extras acrescentam aos limites do pacote, HOJE. Um extra que acabou
 * deixa de contar; um que ainda não começou, também. Assim o limite do cliente
 * sobe sozinho quando o extra é contratado — e desce sozinho quando acaba.
 */
export function limitesAcrescentadosPelosExtras(
  itens: readonly ItemComLimites[],
  hoje: string,
): { whatsapp: number; utilizadores: number } {
  let whatsapp = 0;
  let utilizadores = 0;
  for (const i of itens) {
    if (i.startedOn > hoje || (i.endedOn !== null && i.endedOn < hoje)) continue;
    whatsapp += i.addsWhatsappConnections * i.quantity;
    utilizadores += i.addsUsers * i.quantity;
  }
  return { whatsapp, utilizadores };
}

// ─── a régua de atraso ──────────────────────────────────────────────────────

export type AcaoDaRegua = "lembrar" | "avisar" | "suspender";

export interface EntradaDaRegua {
  hoje: string;
  agora: Date;
  vencimento: string;
  remindedAt: Date | null;
  warnedAt: Date | null;
}

/**
 * O que fazer com UMA factura em aberto. No máximo uma acção por rodada, e a
 * mais tardia vence — mas a suspensão exige o aviso final com ≥ 48 h:
 *
 *   vencimento ........ lembrete
 *   +3 dias ........... aviso final ("será suspensa em …")
 *   +7 dias e aviso há ≥ 48 h ... suspensão
 *
 * Se o relógio esteve parado e a factura já passou dos 7 dias sem aviso, o aviso
 * sai AGORA e a suspensão espera as 48 h: ninguém é suspenso sem ter sido avisado.
 */
export function acaoDaRegua(e: EntradaDaRegua): AcaoDaRegua | null {
  const atraso = diasEntre(e.hoje, e.vencimento);
  if (atraso < 0) return null;

  if (atraso >= DIAS_DA_SUSPENSAO && e.warnedAt) {
    const horas = (e.agora.getTime() - e.warnedAt.getTime()) / 3_600_000;
    if (horas >= HORAS_ENTRE_AVISO_E_SUSPENSAO) return "suspender";
    return null;
  }
  if (atraso >= DIAS_DO_AVISO && !e.warnedAt) return "avisar";
  if (!e.remindedAt && !e.warnedAt) return "lembrar";
  return null;
}

/** Quando a conta será suspensa se nada for pago: o que vier depois — dia 7 ou aviso + 48 h. */
export function dataPrevistaDaSuspensao(vencimento: string, warnedAt: Date | null, agora: Date): string {
  const porPrazo = somarDias(vencimento, DIAS_DA_SUSPENSAO);
  const aposAviso = dataEmMaputo(
    new Date((warnedAt ?? agora).getTime() + HORAS_ENTRE_AVISO_E_SUSPENSAO * 3_600_000),
  );
  return porPrazo > aposAviso ? porPrazo : aposAviso;
}
