/**
 * As MENSAGENS da faturação — texto puro, sem envio (SonghaiCRM, 9010).
 *
 * Seis momentos, nesta ordem de vida de uma factura. Cada uma diz o que é, quanto,
 * até quando e o que fazer — e a que dá medo (o aviso final) diz a DATA exacta em
 * que a conta será suspensa e que os dados ficam guardados.
 *
 * Português de Moçambique: «factura», «a pagar», sem gerúndio. O envio passa pelo
 * `sendEmail` do roteador, que ainda aplica a camada pt-MZ ao texto.
 */
import { tokensLegiveis } from "@/lib/billing/tokens";
import { formatCents } from "@/lib/money";

export type TipoDeEmail =
  | "fatura_nova"
  | "lembrete"
  | "aviso_final"
  | "suspensa"
  | "pagamento_recebido"
  | "reativada"
  // Tokens de IA a esgotar (9011): ao cliente e ao fornecedor.
  | "tokens_80"
  | "tokens_100"
  | "fornecedor_tokens_80"
  | "fornecedor_tokens_100";

export interface DadosDoEmail {
  organizacao: string;
  amountCents: number;
  currency: string;
  /** `AAAA-MM-DD`. */
  vencimento: string;
  /** `AAAA-MM-DD` do início do período facturado. */
  periodo: string;
  linkDePagamento?: string | null;
  /** `AAAA-MM-DD`: quando a conta será suspensa se nada for pago. */
  suspensaoPrevista?: string;
  /** Contacto de quem factura (o `SUPPORT_EMAIL` da instalação), se houver. */
  suporte?: string | null;
  /** Como pagar por transferência bancária (texto do operador). Entra nas mensagens que pedem pagamento. */
  instrucoesDeTransferencia?: string | null;
  /** Só nas mensagens de tokens. `renovaA` é `AAAA-MM-DD`: o dia em que o período recomeça. */
  tokens?: { consumidos: number; quota: number; percentagem: number; renovaA: string };
}

export interface Mensagem {
  assunto: string;
  html: string;
  texto: string;
}

/** `2026-11-10` → `10/11/2026`. */
export function dataLegivel(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function montarEmail(tipo: TipoDeEmail, d: DadosDoEmail): Mensagem {
  const valor = formatCents(d.amountCents, d.currency);
  const venc = dataLegivel(d.vencimento);
  const periodo = dataLegivel(d.periodo);
  const contacto = d.suporte ? `Para qualquer dúvida, escreva para ${d.suporte}.` : "";

  let assunto: string;
  let paragrafos: string[];
  let botao: string | null = null;

  switch (tipo) {
    case "fatura_nova":
      assunto = `Nova factura de ${valor} — vence a ${venc}`;
      paragrafos = [
        `Foi emitida a factura de ${d.organizacao} referente ao período que começa a ${periodo}.`,
        `Valor: ${valor}. Vencimento: ${venc}.`,
      ];
      botao = "Pagar agora (M-Pesa, e-Mola ou cartão)";
      break;
    case "lembrete":
      assunto = `A sua factura de ${valor} vence hoje`;
      paragrafos = [`A factura de ${d.organizacao}, no valor de ${valor}, vence a ${venc}.`, "Se já pagou, ignore esta mensagem."];
      botao = "Pagar agora";
      break;
    case "aviso_final":
      assunto = `Aviso final: a conta será suspensa a ${d.suspensaoPrevista ? dataLegivel(d.suspensaoPrevista) : "breve"}`;
      paragrafos = [
        `A factura de ${d.organizacao}, no valor de ${valor}, venceu a ${venc} e continua por pagar.`,
        `Se não for paga até ${d.suspensaoPrevista ? dataLegivel(d.suspensaoPrevista) : "breve"}, a conta será suspensa: o assistente deixa de responder aos seus clientes no WhatsApp.`,
        "Os seus dados ficam guardados e tudo volta ao normal assim que o pagamento entrar.",
      ];
      botao = "Pagar agora";
      break;
    case "suspensa":
      assunto = "A conta foi suspensa por falta de pagamento";
      paragrafos = [
        `A factura de ${d.organizacao}, no valor de ${valor}, venceu a ${venc} e não foi paga. A conta está suspensa: o assistente não responde no WhatsApp.`,
        "Os dados estão guardados. Assim que o pagamento entrar, a conta volta sozinha — não precisa de contactar ninguém.",
      ];
      botao = "Pagar agora";
      break;
    case "pagamento_recebido":
      assunto = "Pagamento recebido — obrigado";
      paragrafos = [`Recebemos o pagamento de ${valor} de ${d.organizacao}. Está tudo em dia.`];
      break;
    case "tokens_80":
    case "tokens_100":
    case "fornecedor_tokens_80":
    case "fornecedor_tokens_100": {
      const k = d.tokens;
      const uso = k ? `${tokensLegiveis(k.consumidos)} de ${tokensLegiveis(k.quota)} tokens` : "o limite de tokens";
      const renova = k ? dataLegivel(k.renovaA) : "—";
      if (tipo === "tokens_80") {
        assunto = `Consumo de IA a ${k?.percentagem ?? 80}% do limite deste período`;
        paragrafos = [
          `${d.organizacao} já usou ${uso} de IA (${k?.percentagem ?? 80}%) neste período. O período recomeça a ${renova}.`,
          "Se prevê precisar de mais, fale com a equipa para aumentar o limite antes de ele acabar.",
        ];
      } else if (tipo === "tokens_100") {
        assunto = "Limite de tokens de IA atingido";
        paragrafos = [
          `${d.organizacao} usou ${uso} de IA: o limite deste período foi atingido. O período recomeça a ${renova}.`,
          "Para aumentar o limite sem esperar pela renovação, fale com a equipa.",
        ];
      } else if (tipo === "fornecedor_tokens_80") {
        assunto = `${d.organizacao}: tokens de IA a ${k?.percentagem ?? 80}%`;
        paragrafos = [`A conta ${d.organizacao} chegou a ${k?.percentagem ?? 80}% do limite de tokens: ${uso}. Renova a ${renova}.`];
      } else {
        assunto = `${d.organizacao}: limite de tokens de IA atingido`;
        paragrafos = [`A conta ${d.organizacao} atingiu o limite de tokens: ${uso}. Renova a ${renova}.`];
      }
      break;
    }
    case "reativada":
      assunto = "A conta foi reativada";
      paragrafos = [
        `O pagamento de ${d.organizacao} entrou e a conta está activa outra vez.`,
        "Pode haver conversas que chegaram durante a suspensão: estão guardadas na Central, para rever.",
      ];
      break;
  }

  // Quem pede pagamento diz TAMBÉM como pagar por transferência, quando o operador definiu.
  if (botao && d.instrucoesDeTransferencia) {
    const emUmaLinha = d.instrucoesDeTransferencia
      .split(String.fromCharCode(10))
      .map((linha) => linha.trim())
      .filter(Boolean)
      .join(" · ");
    paragrafos.push(
      `Se preferir pagar directamente (transferência bancária ou números de recepção): ${emUmaLinha}. Depois de transferir, envie o comprovativo: a conta é actualizada assim que a equipa confirmar.`,
    );
  }
  if (contacto) paragrafos.push(contacto);
  const link = botao && d.linkDePagamento ? d.linkDePagamento : null;

  const html = [
    `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#111">`,
    ...paragrafos.map((p) => `<p style="line-height:1.5">${escapar(p)}</p>`),
    link
      ? `<p><a href="${escapar(link)}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none">${escapar(botao!)}</a></p>`
      : "",
    `</div>`,
  ].join("");
  const texto = [...paragrafos, link ? `${botao}: ${link}` : ""].filter(Boolean).join("\n\n");

  return { assunto, html, texto };
}
