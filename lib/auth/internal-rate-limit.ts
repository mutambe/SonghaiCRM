/**
 * Rate limit para superfícies internas autenticadas por segredo fixo — MCP
 * (`api_tokens`), `/api/internal/*` (`INTERNAL_SECRET`) e os crons
 * (`INTERNAL_CRON_SECRET`/`INTERNAL_SECRET`). `lib/auth/rate-limit.ts` cobre
 * login/signup/reset/convite; estas rotas ficaram de fora porque não passam
 * por aquele fluxo de auth de usuário.
 *
 * Mesma política documentada em `lib/auth/rate-limit.ts`: sem IP identificável
 * o limite NÃO entra, em vez de cair num balde único compartilhado. O kit
 * self-host expõe o app direto (sem proxy reverso por padrão), e é o próprio
 * `scheduler` do `docker-compose.prod.yml` quem chama os crons — um balde
 * global aqui trancaria a automação da instalação inteira, não um atacante.
 */
import type { NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { opaque } from "@/lib/auth/rate-limit";

function ipFromRequest(req: NextRequest): string | null {
  const encaminhado = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (encaminhado) return encaminhado;
  const real = req.headers.get("x-real-ip")?.trim();
  return real || null;
}

/**
 * `true` = barre a requisição.
 *
 * @param scope rótulo do bucket (`cron`, `mcp`, `internal_agents_run`) —
 *   isola o orçamento de cada superfície.
 */
export async function internalSurfaceRateLimited(
  req: NextRequest,
  scope: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const ip = ipFromRequest(req);
  if (ip === null) return false;
  const result = await checkRateLimit(`internal_auth:${scope}:${opaque(ip)}`, limit, windowSec);
  return !result.allowed;
}
