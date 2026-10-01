/**
 * LIMITE DE TENTATIVAS NAS SUPERFÍCIES AUTENTICADAS POR SEGREDO (SonghaiCRM).
 *
 * `/api/mcp` (token `dsk_…`), `/api/internal/*` (`INTERNAL_SECRET`) e as rotas
 * de `/api/v1/cron/*` (`INTERNAL_CRON_SECRET`) validam um segredo fixo dentro de
 * cada rota e não passam pelo fluxo de login — então nenhuma tinha teto de
 * tentativas: quem quisesse adivinhar o segredo podia tentar sem custo.
 *
 * Aplicado UMA vez, no `proxy.ts`, e não rota a rota: o upstream tem dezenas de
 * crons e acrescenta outros a cada versão — repetir a guarda em cada uma seria
 * esquecer a próxima, e conflito em todo merge.
 *
 * Mesma política de `lib/auth/rate-limit.ts`: SEM IP identificável o limite não
 * entra, em vez de cair num balde único. O kit expõe o app sem proxy reverso por
 * padrão, e é o próprio `scheduler` do `docker-compose.prod.yml` quem chama os
 * crons, sem `x-forwarded-for` — um balde global trancaria a automação da
 * instalação inteira, não um atacante.
 */
import { createHash } from "node:crypto";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";

/** Teto por IP e por minuto de cada superfície (os do fork SonghaiCRM). */
const SUPERFICIES: ReadonlyArray<{ prefixo: string; escopo: string; limite: number }> = [
  { prefixo: "/api/mcp", escopo: "mcp", limite: 120 },
  { prefixo: "/api/internal/", escopo: "internal", limite: 60 },
  { prefixo: "/api/v1/cron/", escopo: "cron", limite: 30 },
];
const JANELA_SEG = 60;

/** A superfície interna deste caminho, ou `null`. */
export function superficieInterna(pathname: string): { escopo: string; limite: number } | null {
  // "/api/mcp" é a rota em si (e o que vier abaixo dela); os outros são pastas.
  const s = SUPERFICIES.find(({ prefixo }) =>
    prefixo.endsWith("/") ? pathname.startsWith(prefixo) : pathname === prefixo || pathname.startsWith(`${prefixo}/`),
  );
  return s ? { escopo: s.escopo, limite: s.limite } : null;
}

function ipDaRequisicao(headers: Headers): string | null {
  const encaminhado = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (encaminhado) return encaminhado;
  return headers.get("x-real-ip")?.trim() || null;
}

/** `true` = barre a requisição (429). Sem IP identificável, nunca barra. */
export async function superficieInternaLimitada(pathname: string, headers: Headers): Promise<boolean> {
  const superficie = superficieInterna(pathname);
  if (!superficie) return false;
  const ip = ipDaRequisicao(headers);
  if (ip === null) return false;
  const balde = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  const r = await checkRateLimit(`internal_auth:${superficie.escopo}:${balde}`, superficie.limite, JANELA_SEG);
  return !r.allowed;
}

export const __JANELA_SEG_PARA_TESTE = JANELA_SEG;
