/**
 * O AVISO DE CASO TAMBÉM POR E-MAIL (SonghaiCRM, 9012).
 *
 * O aviso no WhatsApp (`aviso-ao-suporte.ts`) vai para UM número, e acrescentar
 * mais números ali mexe no corte da ingestão do WhatsApp de todo o sistema. Este
 * canal é ADICIONAL e independente: uma lista de e-mails que recebe o mesmo aviso
 * quando a IA abre um caso. Não toca no WhatsApp, não toca na ingestão, não
 * partilha estado com o outro aviso.
 *
 * Reusa do outro o que é regra de DOMÍNIO e não de transporte:
 * - o texto (`montarAvisoDeCaso`): primeiro nome só, título/resumo sanitizados,
 *   marca resolvida de fora, idioma da organização;
 * - as origens e os estados que merecem aviso, e o teto de idade do evento;
 * - o titular anonimizado não é avisado.
 *
 * ─── Nenhum desfecho é `error` ───────────────────────────────────────────────
 * Pelo mesmo motivo do outro: `error` no dreno conta tentativas e mata o evento.
 * E-mail que não sai vira `retry`; o teto de idade do evento (30 min) é o que
 * encerra a insistência — um aviso velho é ruído.
 *
 * ─── Cada evento é consumido uma vez ─────────────────────────────────────────
 * O dreno marca o consumidor como concluído por linha de evento (`ok`/`skipped`),
 * por isso não há tabela de entregas aqui: o que o outro aviso guarda por causa
 * do espaçamento e do teto do número do WhatsApp não existe para e-mail.
 */
import type { EventRow } from "@/lib/event-log/dispatcher";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

import {
  EVENTO_CASO_ABERTO,
  IDADE_MAXIMA_DO_EVENTO_MS,
  type CasoDoAviso,
  type DesfechoDoAviso,
} from "./aviso-ao-suporte";
import { montarAvisoDeCaso } from "./texto-do-aviso";
import { linkDoCaso, urlPublicaUsavel } from "./url-publica";

export const AVISO_POR_EMAIL_HANDLER_KEY = "escalacao-aviso-por-email.v1";

/** Adiamento quando o e-mail não saiu; o teto de idade do evento limita as tentativas. */
export const ADIAMENTO_DO_EMAIL_MS = 5 * 60 * 1000;
/** Dentro de uma requisição HTTP não se toca a rede (mesma regra do aviso no WhatsApp). */
export const ADIAMENTO_DO_DRENO_EM_REQUEST_MS = 15 * 1000;

/** As mesmas duas origens e os mesmos dois estados do aviso no WhatsApp. */
const ORIGENS_ACEITAS = new Set(["agent", "guardrail_autofallback"]);
const STATUS_ABERTOS = new Set(["awaiting_human", "awaiting_lead"]);

export interface ConfigDoAvisoPorEmail {
  organization_id: string;
  emails: string[];
  ligado: boolean;
}

export interface AvisoPorEmailDeps {
  db: {
    carregaConfigEmail(orgId: string): Promise<ConfigDoAvisoPorEmail | null>;
    carregaCaso(orgId: string, caseId: string): Promise<CasoDoAviso | null>;
    contatoAnonimizado(orgId: string, contactId: string): Promise<boolean>;
    nomeDoContato(orgId: string, contactId: string): Promise<string | null>;
    marcaDaOrganizacao(orgId: string): Promise<{ nome: string; idioma: Idioma }>;
  };
  /** `false` = não saiu (sem transporte, endereço recusado). Pode lançar: é tratado como não saiu. */
  enviarEmail(para: string[], mensagem: { assunto: string; texto: string; html: string }): Promise<boolean>;
  clock: () => Date;
  urlPublica: string | null | undefined;
  origemDoDreno: () => "worker" | "request";
  audita: (entrada: { organizationId: string; caseId: string; metadata: Record<string, unknown> }) => void;
}

const skipped = (detail: string): DesfechoDoAviso => ({ status: "skipped", detail });
const retry = (quando: Date, detail: string): DesfechoDoAviso => ({ status: "retry", detail, retry_at: quando.toISOString() });
const textoOuNulo = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v : null);

function passouDoTeto(row: EventRow, agora: Date): boolean {
  if (!row.created_at) return false;
  const emitido = Date.parse(row.created_at);
  return !Number.isNaN(emitido) && agora.getTime() - emitido > IDADE_MAXIMA_DO_EVENTO_MS;
}

function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** O texto em HTML mínimo: parágrafos por linha em branco, quebras por linha, o link clicável. */
function emHtml(texto: string): string {
  const linhas = texto.split(String.fromCharCode(10));
  const corpo = linhas
    .map((l) => {
      const seguro = escapar(l);
      return seguro.replace(/(https?:\/\/\S+)/g, (url) => `<a href="${url}">${url}</a>`);
    })
    .join("<br>");
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.5">${corpo}</div>`;
}

export async function aplicaAvisoPorEmail(deps: AvisoPorEmailDeps, row: EventRow): Promise<DesfechoDoAviso> {
  const agora = deps.clock();
  if (row.event_type !== EVENTO_CASO_ABERTO) return skipped("evento_ignorado");

  const orgId = row.organization_id;
  const caseId = textoOuNulo(row.payload.case_id);
  if (!caseId) return skipped("payload_incompleto");

  // O caminho de toda organização que nunca ligou isto: uma leitura, zero rede.
  const cfg = await deps.db.carregaConfigEmail(orgId);
  if (!cfg || !cfg.ligado || cfg.emails.length === 0) return skipped("sem_configuracao");

  if (deps.origemDoDreno() === "request") {
    return retry(new Date(agora.getTime() + ADIAMENTO_DO_DRENO_EM_REQUEST_MS), "adiado: dreno dentro do webhook");
  }
  if (passouDoTeto(row, agora)) return skipped("evento_velho");

  const caso = await deps.db.carregaCaso(orgId, caseId);
  if (!caso) return skipped("caso_inexistente");
  if (!ORIGENS_ACEITAS.has(caso.source ?? "")) return skipped(`origem_nao_aceita:${caso.source}`);
  if (!STATUS_ABERTOS.has(caso.status)) return skipped(`caso_fechado:${caso.status}`);

  const contactId = textoOuNulo(row.payload.contact_id);
  if (contactId && (await deps.db.contatoAnonimizado(orgId, contactId))) return skipped("titular_anonimizado");

  // O link precisa abrir no computador de outra pessoa.
  if (!urlPublicaUsavel(deps.urlPublica)) return skipped("sem_endereco_publico");

  const marca = await deps.db.marcaDaOrganizacao(orgId);
  const nome = contactId ? await deps.db.nomeDoContato(orgId, contactId) : null;
  const texto = montarAvisoDeCaso({
    marca: marca.nome,
    idioma: marca.idioma,
    kind: caso.kind,
    source: caso.source,
    title: caso.title,
    summary: caso.summary,
    blocker: caso.blocker,
    nomeDoCliente: nome,
    link: linkDoCaso(deps.urlPublica as string, caso.id),
  });
  const assunto = `${marca.nome}: ${traduzir("novo caso à espera de uma pessoa", marca.idioma)}`;

  let saiu = false;
  try {
    saiu = await deps.enviarEmail(cfg.emails, { assunto, texto, html: emHtml(texto) });
  } catch {
    saiu = false;
  }
  if (!saiu) return retry(new Date(agora.getTime() + ADIAMENTO_DO_EMAIL_MS), "email_nao_saiu");

  deps.audita({ organizationId: orgId, caseId, metadata: { destinatarios: cfg.emails.length } });
  return { status: "ok", detail: `para=${cfg.emails.length}` };
}
