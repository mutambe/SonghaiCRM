/**
 * MÓDULO ADAPTADO DO UPSTREAM (DeskcommCRM) — integração Google Calendar.
 *
 * `oauth.ts`, `estado.ts`, `vinculo.ts`, `token.ts` e `calendarios.ts` nesta
 * pasta vieram quase byte a byte do upstream: são camada pura (matemática de
 * token, assinatura HMAC, chamada HTTP), sem nenhum acoplamento ao schema —
 * por isso reutilizáveis sem risco. `config.ts` (este arquivo), a migration, e
 * as rotas em `app/api/v1/agenda/google/` foram REESCRITOS para o schema deste
 * fork (`appointments`/`appointment_types`, não `calendar_appointments`).
 *
 * Simplificação deliberada: o upstream permite configurar o app OAuth pela
 * TELA (tabela `platform_google_oauth`, cifrada, com fallback pro `.env`).
 * Esta Fase 1 só lê do `.env` — a camada de configuração pela tela fica pra
 * quando (e se) fizer sentido, sem migration nem UI extra agora.
 *
 * ─── Por que "opcional" aqui é requisito, e não descuido ──────────────────
 * Sem `GOOGLE_CALENDAR_CLIENT_ID`/`GOOGLE_CALENDAR_CLIENT_SECRET` o módulo de
 * Agenda inteiro continua funcionando — some só o botão "Conectar Google", e a
 * tela explica o que falta. `configuracaoDoGoogle()` por isso devolve `null`
 * em vez de lançar; quem chama decide o que fazer com a ausência.
 *
 * ─── UMA fonte para o `redirect_uri` ───────────────────────────────────────
 * O Google compara o `redirect_uri` do consentimento com o da troca do código
 * BYTE A BYTE. Só existe `enderecoDeRetorno()`; se um dia mudar, muda num
 * lugar só.
 */

import { env } from "@/lib/env";

/** O caminho da rota de callback. Tem de estar registrado no console do Google. */
export const CAMINHO_DO_CALLBACK = "/api/v1/agenda/google/callback";

/** Os nomes das variáveis, para a tela poder dizer exatamente o que falta. */
export const VARIAVEIS_DO_GOOGLE = ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"] as const;

export interface AppDoGoogleConfigurado {
  clientId: string;
  clientSecret: string;
  /** Absoluto, e idêntico nos dois lados do fluxo. */
  redirectUri: string;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * O endereço de retorno, derivado da URL pública da instalação.
 *
 * Sem barra dupla e sem barra final: o Google compara a string exata, e
 * `https://crm.exemplo//api/...` é um endereço diferente de
 * `https://crm.exemplo/api/...` para ele.
 */
export function enderecoDeRetorno(urlDaAplicacao: string = env.NEXT_PUBLIC_APP_URL): string {
  const base = texto(urlDaAplicacao).replace(/\/+$/, "");
  return `${base}${CAMINHO_DO_CALLBACK}`;
}

/**
 * Uma pessoa desenvolvendo no próprio computador pode abrir o mesmo processo
 * por `localhost` enquanto a URL canônica da instalação é outra. OAuth compara
 * o redirect byte a byte; nesse caso, usar o host que o navegador realmente
 * abriu evita `redirect_uri_mismatch`.
 *
 * Só aceitamos loopback como exceção — host arbitrário nunca vence a URL
 * canônica, para que um cabeçalho `Host` forjado não troque o destino do
 * código de autorização.
 */
export function origemLocalDoNavegador(origem: string | null | undefined): string | null {
  if (!origem) return null;
  try {
    const url = new URL(origem);
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return url.origin;
  } catch {
    // Cabeçalho ausente ou inválido: a URL canônica segue sendo o piso seguro.
  }
  return null;
}

export function origemLocalDosCabecalhos(cabecalhos: Pick<Headers, "get">): string | null {
  const host = cabecalhos.get("x-forwarded-host") ?? cabecalhos.get("host");
  const protocolo = (cabecalhos.get("x-forwarded-proto") ?? "http").split(",")[0]?.trim() || "http";
  return origemLocalDoNavegador(host ? `${protocolo}://${host}` : null);
}

/** A configuração em vigor, ou `null` quando a instalação não tem app OAuth. Nunca lança. */
export function configuracaoDoGoogle(urlDaAplicacao?: string): AppDoGoogleConfigurado | null {
  const clientId = texto(env.GOOGLE_CALENDAR_CLIENT_ID);
  const clientSecret = texto(env.GOOGLE_CALENDAR_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: enderecoDeRetorno(urlDaAplicacao) };
}

/** Conectar o Google está disponível nesta instalação? */
export function googleEstaConfigurado(): boolean {
  return configuracaoDoGoogle() !== null;
}

/** O que falta, pelo nome — para a tela dizer em vez de só desabilitar o botão. */
export function faltaParaConectarOGoogle(): string[] {
  if (googleEstaConfigurado()) return [];
  const faltando: string[] = [];
  if (!texto(env.GOOGLE_CALENDAR_CLIENT_ID)) faltando.push("GOOGLE_CALENDAR_CLIENT_ID");
  if (!texto(env.GOOGLE_CALENDAR_CLIENT_SECRET)) faltando.push("GOOGLE_CALENDAR_CLIENT_SECRET");
  return faltando;
}
